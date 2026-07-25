/**
 * CS-C15C — the canonical ChildSafetyIncident service. A real domain record (NOT the intervention
 * ledger). Deterministically correlates related signals for a protected profile into ONE incident and
 * links each signal exactly once (`safetySignalId` unique). Severity/urgency/signalCount are monotonic
 * (never decrease). Tenant isolation is enforced by composite `(id, tenantId)` FKs (cross-tenant
 * linking is impossible at the DB level) + explicit `tenantId` in every query. Content-free (no raw
 * message/transcript/evidence). SYSTEM-scoped (systemDb / owner role).
 *
 * Concurrency: a per-correlation-group transaction-scoped advisory lock serializes concurrent
 * correlations for the same (tenant, profile, risk family), and the unique `safetySignalId` link index
 * is the belt-and-suspenders — two simultaneous attempts converge to exactly one incident + one link.
 */
import { Prisma } from "@prisma/client";
import {
  isTerminalChildSafetyIncidentStatus, ChildSafetyIncidentStatus, CHILD_SAFETY_AUDIT_EVENTS,
} from "@guardora/core";
import { ActorKind } from "@prisma/client";
import { systemDb } from "./index";

const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const URGENCY_RANK: Record<string, number> = { routine: 0, elevated: 1, immediate: 2 };
const higher = (rank: Record<string, number>, a: string, b: string): string => ((rank[a] ?? 0) >= (rank[b] ?? 0) ? a : b);
const isUnique = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

async function audit(tenantId: string, event: string, targetId: string, metadata: Record<string, string | number | boolean>): Promise<void> {
  await systemDb.auditLog.create({ data: { tenantId, event, actorKind: ActorKind.system, targetType: "child_safety_incident", targetId, metadata: metadata as never } }).catch(() => {});
}

export interface CorrelateAndLinkResult {
  incidentId: string;
  createdIncident: boolean;
  linkCreated: boolean;
  severity: string;
  urgency: string;
}

/** Read a single incident's coarse state in tenant context (system read). */
export async function getChildSafetyIncident(tenantId: string, incidentId: string) {
  return systemDb.childSafetyIncident.findFirst({ where: { id: incidentId, tenantId }, select: { id: true, status: true, riskFamily: true, severity: true, urgency: true, signalCount: true, escalationState: true } });
}

/** Whether a signal is already linked to a child-safety incident (idempotency probe). */
export async function findIncidentForSignal(tenantId: string, safetySignalId: string): Promise<string | null> {
  const link = await systemDb.childSafetyIncidentSignal.findFirst({ where: { safetySignalId, tenantId }, select: { incidentId: true } });
  return link?.incidentId ?? null;
}

/** The active (non-terminal) incident for a correlation group within the window, if any (for the decision). */
export async function findActiveGroupIncident(tenantId: string, protectedProfileId: string, riskFamily: string, windowMs: number, now: Date = new Date()): Promise<{ id: string; escalationState: string } | null> {
  const windowStart = new Date(now.getTime() - windowMs);
  const rows = await systemDb.childSafetyIncident.findMany({ where: { tenantId, protectedProfileId, riskFamily, lastSignalAt: { gte: windowStart } }, orderBy: { lastSignalAt: "desc" }, select: { id: true, status: true, escalationState: true } });
  const active = rows.find((r) => !isTerminalChildSafetyIncidentStatus(r.status));
  return active ? { id: active.id, escalationState: active.escalationState } : null;
}

/**
 * Correlate the signal into an eligible active incident (same tenant + profile + risk family,
 * non-terminal, lastSignalAt within `windowMs`) or create a new one, then link it exactly once and
 * elevate severity/urgency/signalCount monotonically. Idempotent: a re-link returns the existing
 * incident with `linkCreated:false`.
 */
export async function correlateAndLinkSignal(input: {
  tenantId: string;
  protectedProfileId: string;
  safetySignalId: string;
  riskFamily: string;
  severity: string;
  urgency: string;
  signalAt: Date;
  windowMs: number;
  now?: Date;
}): Promise<CorrelateAndLinkResult> {
  const now = input.now ?? new Date();
  const windowStart = new Date(now.getTime() - input.windowMs);

  return systemDb.$transaction(async (tx) => {
    // Serialize concurrent correlations for the SAME group (different groups never block).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`csinc:${input.tenantId}:${input.protectedProfileId}:${input.riskFamily}`}, 0))`;

    // Idempotent: already linked?
    const existingLink = await tx.childSafetyIncidentSignal.findFirst({ where: { safetySignalId: input.safetySignalId, tenantId: input.tenantId }, select: { incidentId: true } });
    if (existingLink) {
      const inc = await tx.childSafetyIncident.findUnique({ where: { id: existingLink.incidentId }, select: { severity: true, urgency: true } });
      return { incidentId: existingLink.incidentId, createdIncident: false, linkCreated: false, severity: inc?.severity ?? input.severity, urgency: inc?.urgency ?? input.urgency };
    }

    // Correlate an eligible active incident.
    const candidates = await tx.childSafetyIncident.findMany({
      where: { tenantId: input.tenantId, protectedProfileId: input.protectedProfileId, riskFamily: input.riskFamily, lastSignalAt: { gte: windowStart } },
      orderBy: { lastSignalAt: "desc" }, select: { id: true, status: true, severity: true, urgency: true, lastSignalAt: true },
    });
    const active = candidates.find((c) => !isTerminalChildSafetyIncidentStatus(c.status));

    let incidentId: string;
    let createdIncident: boolean;
    let severity: string;
    let urgency: string;
    if (active) {
      incidentId = active.id;
      createdIncident = false;
      severity = higher(SEVERITY_RANK, active.severity, input.severity); // monotonic up
      urgency = higher(URGENCY_RANK, active.urgency, input.urgency);
      const lastSignalAt = input.signalAt > active.lastSignalAt ? input.signalAt : active.lastSignalAt;
      await tx.childSafetyIncident.update({ where: { id: incidentId }, data: { severity, urgency, lastSignalAt, signalCount: { increment: 1 } } });
    } else {
      const inc = await tx.childSafetyIncident.create({
        data: { tenantId: input.tenantId, protectedProfileId: input.protectedProfileId, riskFamily: input.riskFamily, status: ChildSafetyIncidentStatus.Open, severity: input.severity, urgency: input.urgency, openedAt: now, lastSignalAt: input.signalAt, signalCount: 1 },
        select: { id: true },
      });
      incidentId = inc.id;
      createdIncident = true;
      severity = input.severity;
      urgency = input.urgency;
    }

    // Link exactly-once (unique safetySignalId). Serialized by the advisory lock; unique index is the backstop.
    await tx.childSafetyIncidentSignal.create({ data: { tenantId: input.tenantId, incidentId, safetySignalId: input.safetySignalId } });
    return { incidentId, createdIncident, linkCreated: true, severity, urgency };
  }).then(async (r) => {
    await audit(input.tenantId, r.createdIncident ? CHILD_SAFETY_INCIDENT_EVENTS.created : CHILD_SAFETY_INCIDENT_EVENTS.reused, r.incidentId, { riskFamily: input.riskFamily, severity: r.severity });
    if (r.linkCreated) await audit(input.tenantId, CHILD_SAFETY_INCIDENT_EVENTS.signalLinked, r.incidentId, { safetySignalId: input.safetySignalId });
    return r;
  }).catch(async (e) => {
    // A rare cross-transaction link race → converge on the winning link.
    if (!isUnique(e)) throw e;
    const winner = await findIncidentForSignal(input.tenantId, input.safetySignalId);
    if (!winner) throw e;
    const inc = await getChildSafetyIncident(input.tenantId, winner);
    return { incidentId: winner, createdIncident: false, linkCreated: false, severity: inc?.severity ?? input.severity, urgency: inc?.urgency ?? input.urgency };
  });
}

/** Bounded audit event names (reuse the shared audit log; content-free). */
export const CHILD_SAFETY_INCIDENT_EVENTS = {
  created: "child_safety.incident.created",
  reused: "child_safety.incident.reused",
  signalLinked: "child_safety.incident.signal_linked",
  severityElevated: "child_safety.incident.severity_elevated",
  urgencyElevated: "child_safety.incident.urgency_elevated",
} as const;

void CHILD_SAFETY_AUDIT_EVENTS; // (referenced for parity with the family audit vocabulary)
