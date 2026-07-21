import { ActorKind, Prisma } from "@prisma/client";
import { withTenant } from "./repositories";
import {
  Permission, Role, can,
  CYBERBULLYING_AUDIT_EVENTS,
  IncidentLifecycleStatus,
  applyIncidentTransition,
  incidentTransitionRequiresReason,
  IncidentTimelineEventType,
  IncidentParticipantRole,
  IncidentReportSource,
  IncidentCategory,
  SubjectScope,
  type IncidentActorContext,
  type IncidentTransitionResult,
} from "@guardora/core";

/**
 * C3 — Cyberbullying Incident service (backend). The `Incident` model is the SINGLE
 * case ledger; every write here is tenant-scoped (withTenant/RLS), permission-checked
 * (fail-closed), transactional, and audited (AuditLog + append-only timeline). No
 * AI/rule ever confirms an incident — confirmation is a human `cyberbullying:manage`
 * action. Actors are labelled `alleged`, never confirmed attackers.
 */

const DOMAIN_CYBERBULLYING = IncidentCategory.Cyberbullying; // "cyberbullying"

export class IncidentForbiddenError extends Error {
  readonly code = "FORBIDDEN";
  constructor(perm: Permission) { super(`forbidden: missing permission "${perm}"`); this.name = "IncidentForbiddenError"; }
}
export class IncidentNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  constructor() { super("incident not found in this tenant"); this.name = "IncidentNotFoundError"; }
}
export class IncidentTransitionRejected extends Error {
  readonly code = "TRANSITION_REJECTED";
  constructor(public readonly result: IncidentTransitionResult) { super(`transition rejected: ${result.error}`); this.name = "IncidentTransitionRejected"; }
}

function assertPerm(actor: IncidentActorContext, perm: Permission): void {
  if (!can(actor.role as Role, perm)) throw new IncidentForbiddenError(perm);
}

/** Which permission a lifecycle target requires. review-level vs manage-level. */
function permissionForTransition(to: IncidentLifecycleStatus): Permission {
  switch (to) {
    case IncidentLifecycleStatus.UnderReview:
    case IncidentLifecycleStatus.Acknowledged:
    case IncidentLifecycleStatus.Dismissed:
      return Permission.CyberbullyingReview;
    default: // confirmed | action_required | resolved | archived
      return Permission.CyberbullyingManage;
  }
}

const TIMELINE_FOR_STATUS: Record<string, IncidentTimelineEventType> = {
  [IncidentLifecycleStatus.UnderReview]: IncidentTimelineEventType.ReviewStarted,
  [IncidentLifecycleStatus.Acknowledged]: IncidentTimelineEventType.Acknowledged,
  [IncidentLifecycleStatus.Confirmed]: IncidentTimelineEventType.Confirmed,
  [IncidentLifecycleStatus.ActionRequired]: IncidentTimelineEventType.ActionRequired,
  [IncidentLifecycleStatus.Resolved]: IncidentTimelineEventType.Resolved,
  [IncidentLifecycleStatus.Dismissed]: IncidentTimelineEventType.Dismissed,
  [IncidentLifecycleStatus.Archived]: IncidentTimelineEventType.Archived,
};
const AUDIT_FOR_STATUS: Record<string, string> = {
  [IncidentLifecycleStatus.UnderReview]: CYBERBULLYING_AUDIT_EVENTS.incidentReviewStarted,
  [IncidentLifecycleStatus.Acknowledged]: CYBERBULLYING_AUDIT_EVENTS.incidentAcknowledged,
  [IncidentLifecycleStatus.Confirmed]: CYBERBULLYING_AUDIT_EVENTS.incidentConfirmed,
  [IncidentLifecycleStatus.ActionRequired]: CYBERBULLYING_AUDIT_EVENTS.incidentActionRequired,
  [IncidentLifecycleStatus.Resolved]: CYBERBULLYING_AUDIT_EVENTS.incidentResolved,
  [IncidentLifecycleStatus.Dismissed]: CYBERBULLYING_AUDIT_EVENTS.incidentDismissed,
  [IncidentLifecycleStatus.Archived]: CYBERBULLYING_AUDIT_EVENTS.incidentArchived,
};

type Tx = Prisma.TransactionClient;
async function timeline(db: Tx, actor: IncidentActorContext, incidentId: string, eventType: IncidentTimelineEventType, reason?: string | null): Promise<void> {
  await db.incidentTimelineEvent.create({ data: { tenantId: actor.tenantId, incidentId, eventType, actorUserId: actor.userId, reason: reason ?? null } });
}
// Sanitized audit — ids/counts only, NEVER summary/evidence/PII.
async function audit(db: Tx, actor: IncidentActorContext, event: string, incidentId: string, metadata?: Record<string, string | number | boolean>): Promise<void> {
  await db.auditLog.create({ data: { tenantId: actor.tenantId, event, actorKind: ActorKind.human, actorUserId: actor.userId, targetType: "incident", targetId: incidentId, metadata: (metadata ?? undefined) as never } });
}

// --- Create ----------------------------------------------------------------

async function createIncident(
  db: Tx, actor: IncidentActorContext,
  input: { protectedSubjectId: string; summary: string; reportSource: IncidentReportSource; severity?: string; title?: string; allegedActorLabel?: string | null; allegedActorExternalReference?: string | null },
): Promise<string> {
  const inc = await db.incident.create({ data: {
    tenantId: actor.tenantId, brandId: null, domain: DOMAIN_CYBERBULLYING, category: "unspecified",
    title: input.title ?? "Cyberbullying incident", severity: input.severity ?? "medium", status: IncidentLifecycleStatus.Open,
    relatedItemIds: [],
  } });
  await db.cyberbullyingIncidentDetail.create({ data: {
    tenantId: actor.tenantId, incidentId: inc.id, protectedSubjectId: input.protectedSubjectId,
    reportSource: input.reportSource, summary: input.summary,
    allegedActorLabel: input.allegedActorLabel ?? null, allegedActorExternalReference: input.allegedActorExternalReference ?? null,
  } });
  // Neutral participants: the protected subject (target) + the reporter.
  await db.incidentParticipant.create({ data: { tenantId: actor.tenantId, incidentId: inc.id, role: IncidentParticipantRole.ProtectedSubject, protectedSubjectId: input.protectedSubjectId } });
  await db.incidentParticipant.create({ data: { tenantId: actor.tenantId, incidentId: inc.id, role: IncidentParticipantRole.Reporter, userId: actor.userId } });
  await timeline(db, actor, inc.id, IncidentTimelineEventType.Created);
  await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.incidentCreated, inc.id, { reportSource: input.reportSource });
  return inc.id;
}

export async function createIncidentFromManualReport(
  actor: IncidentActorContext,
  input: { protectedSubjectId: string; summary: string; severity?: string; title?: string; allegedActorLabel?: string | null; allegedActorExternalReference?: string | null },
): Promise<{ incidentId: string }> {
  assertPerm(actor, Permission.CyberbullyingReport);
  const incidentId = await withTenant(actor.tenantId, (db) => createIncident(db, actor, { ...input, reportSource: IncidentReportSource.ManualReport }));
  return { incidentId };
}

export async function createIncidentFromDetections(
  actor: IncidentActorContext,
  input: { protectedSubjectId: string; summary: string; detectionIds: string[]; severity?: string; title?: string },
): Promise<{ incidentId: string }> {
  assertPerm(actor, Permission.CyberbullyingReview);
  const incidentId = await withTenant(actor.tenantId, async (db) => {
    const id = await createIncident(db, actor, { ...input, reportSource: IncidentReportSource.Detection });
    for (const detId of input.detectionIds) {
      // RLS guarantees same tenant; verify existence explicitly (fail-closed).
      const det = await db.securityDetection.findFirst({ where: { id: detId, tenantId: actor.tenantId }, select: { id: true } });
      if (!det) throw new IncidentNotFoundError();
      await db.incidentDetectionLink.create({ data: { tenantId: actor.tenantId, incidentId: id, securityDetectionId: detId, linkedByUserId: actor.userId, linkReason: "created_from_detection" } });
      await timeline(db, actor, id, IncidentTimelineEventType.DetectionLinked, `detection:${detId}`);
      await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.detectionLinked, id, { detectionId: detId });
    }
    return id;
  });
  return { incidentId };
}

// --- Link detection / evidence ---------------------------------------------

export async function linkDetectionToIncident(actor: IncidentActorContext, incidentId: string, securityDetectionId: string, linkReason: string): Promise<{ linkId: string; created: boolean }> {
  assertPerm(actor, Permission.CyberbullyingReview);
  return withTenant(actor.tenantId, async (db) => {
    const inc = await db.incident.findFirst({ where: { id: incidentId, tenantId: actor.tenantId }, select: { id: true } });
    if (!inc) throw new IncidentNotFoundError();
    const det = await db.securityDetection.findFirst({ where: { id: securityDetectionId, tenantId: actor.tenantId }, select: { id: true } });
    if (!det) throw new IncidentNotFoundError();
    const existing = await db.incidentDetectionLink.findFirst({ where: { incidentId, securityDetectionId, tenantId: actor.tenantId }, select: { id: true } });
    if (existing) return { linkId: existing.id, created: false }; // idempotent
    const link = await db.incidentDetectionLink.create({ data: { tenantId: actor.tenantId, incidentId, securityDetectionId, linkedByUserId: actor.userId, linkReason } });
    await timeline(db, actor, incidentId, IncidentTimelineEventType.DetectionLinked, `detection:${securityDetectionId}`);
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.detectionLinked, incidentId, { detectionId: securityDetectionId });
    return { linkId: link.id, created: true }; // linking NEVER confirms the incident
  });
}

export async function linkEvidenceToIncident(actor: IncidentActorContext, incidentId: string, evidenceId: string): Promise<void> {
  assertPerm(actor, Permission.CyberbullyingReview);
  await withTenant(actor.tenantId, async (db) => {
    const inc = await db.incident.findFirst({ where: { id: incidentId, tenantId: actor.tenantId }, select: { id: true } });
    if (!inc) throw new IncidentNotFoundError();
    const ev = await db.incidentEvidence.findFirst({ where: { id: evidenceId, tenantId: actor.tenantId }, select: { id: true } });
    if (!ev) throw new IncidentNotFoundError();
    // Only set the incident link — NEVER touch immutable origin fields (hash/capturedAt/…).
    await db.incidentEvidence.update({ where: { id: evidenceId }, data: { incidentId } });
    await timeline(db, actor, incidentId, IncidentTimelineEventType.EvidenceLinked, `evidence:${evidenceId}`);
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.evidenceLinked, incidentId, { evidenceId });
  });
}

// --- Participants ----------------------------------------------------------

export async function addIncidentParticipant(actor: IncidentActorContext, incidentId: string, input: { role: IncidentParticipantRole; protectedSubjectId?: string | null; userId?: string | null; externalReference?: string | null }): Promise<{ participantId: string; created: boolean }> {
  assertPerm(actor, Permission.CyberbullyingReview);
  return withTenant(actor.tenantId, async (db) => {
    const inc = await db.incident.findFirst({ where: { id: incidentId, tenantId: actor.tenantId }, select: { id: true } });
    if (!inc) throw new IncidentNotFoundError();
    const dup = await db.incidentParticipant.findFirst({ where: { tenantId: actor.tenantId, incidentId, role: input.role, protectedSubjectId: input.protectedSubjectId ?? null, userId: input.userId ?? null, externalReference: input.externalReference ?? null }, select: { id: true } });
    if (dup) return { participantId: dup.id, created: false };
    const p = await db.incidentParticipant.create({ data: { tenantId: actor.tenantId, incidentId, role: input.role, protectedSubjectId: input.protectedSubjectId ?? null, userId: input.userId ?? null, externalReference: input.externalReference ?? null } });
    await timeline(db, actor, incidentId, IncidentTimelineEventType.ParticipantAdded, `role:${input.role}`);
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.participantAdded, incidentId, { role: input.role });
    return { participantId: p.id, created: true };
  });
}

export async function removeIncidentParticipant(actor: IncidentActorContext, incidentId: string, participantId: string): Promise<void> {
  assertPerm(actor, Permission.CyberbullyingManage);
  await withTenant(actor.tenantId, async (db) => {
    const p = await db.incidentParticipant.findFirst({ where: { id: participantId, incidentId, tenantId: actor.tenantId }, select: { id: true, role: true } });
    if (!p) throw new IncidentNotFoundError();
    await db.incidentParticipant.delete({ where: { id: participantId } });
    await timeline(db, actor, incidentId, IncidentTimelineEventType.ParticipantRemoved, `role:${p.role}`);
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.participantRemoved, incidentId, { role: p.role });
  });
}

// --- Lifecycle -------------------------------------------------------------

export async function transitionIncident(actor: IncidentActorContext, incidentId: string, to: IncidentLifecycleStatus, reason?: string): Promise<IncidentTransitionResult> {
  assertPerm(actor, permissionForTransition(to));
  return withTenant(actor.tenantId, async (db) => {
    const inc = await db.incident.findFirst({ where: { id: incidentId, tenantId: actor.tenantId }, select: { status: true } });
    if (!inc) throw new IncidentNotFoundError();
    const from = inc.status as IncidentLifecycleStatus;
    const result = applyIncidentTransition(from, to, { reason });
    if (!result.ok) throw new IncidentTransitionRejected(result);
    await db.incident.update({ where: { id: incidentId }, data: { status: to, ...(to === IncidentLifecycleStatus.Resolved ? { resolvedAt: new Date() } : {}) } });
    await timeline(db, actor, incidentId, TIMELINE_FOR_STATUS[to]!, reason ?? null);
    await audit(db, actor, AUDIT_FOR_STATUS[to]!, incidentId, incidentTransitionRequiresReason(to) ? { hasReason: !!reason } : {});
    return result;
  });
}

export async function reopenIncident(actor: IncidentActorContext, incidentId: string, reason: string): Promise<IncidentTransitionResult> {
  assertPerm(actor, Permission.CyberbullyingManage); // elevated
  return withTenant(actor.tenantId, async (db) => {
    const inc = await db.incident.findFirst({ where: { id: incidentId, tenantId: actor.tenantId }, select: { status: true } });
    if (!inc) throw new IncidentNotFoundError();
    const from = inc.status as IncidentLifecycleStatus;
    const result = applyIncidentTransition(from, IncidentLifecycleStatus.UnderReview, { reopen: true, reason });
    if (!result.ok) throw new IncidentTransitionRejected(result);
    await db.incident.update({ where: { id: incidentId }, data: { status: IncidentLifecycleStatus.UnderReview, resolvedAt: null } });
    await timeline(db, actor, incidentId, IncidentTimelineEventType.Reopened, reason);
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.incidentReopened, incidentId, { from });
    return result;
  });
}

// --- Read ------------------------------------------------------------------

export async function getCyberbullyingIncidentById(actor: IncidentActorContext, incidentId: string) {
  assertPerm(actor, Permission.CyberbullyingViewOwn);
  return withTenant(actor.tenantId, (db) => db.incident.findFirst({ where: { id: incidentId, tenantId: actor.tenantId, domain: DOMAIN_CYBERBULLYING }, include: { cyberbullyingDetail: true } }));
}

export async function listCyberbullyingIncidents(actor: IncidentActorContext, opts: { limit?: number } = {}) {
  assertPerm(actor, Permission.CyberbullyingReview);
  return withTenant(actor.tenantId, (db) => db.incident.findMany({ where: { tenantId: actor.tenantId, domain: DOMAIN_CYBERBULLYING }, orderBy: { createdAt: "desc" }, take: opts.limit ?? 100, select: { id: true, status: true, severity: true, createdAt: true } }));
}

// --- Subject scope (ABOVE tenant RLS; fail-closed) -------------------------

/**
 * Minimal C1-contract SubjectScopeResolver. Tenant RLS isolates tenants; this
 * isolates SUBJECTS within a tenant. Fail-closed: unknown/ambiguous → Other (deny).
 * Minor/guardian/school/company scopes stay blocked by the legal gate — no such
 * scope is granted here.
 */
export function resolveSubjectScope(input: { role: string; isOwnSubject: boolean; isAssignedReviewer: boolean }): SubjectScope {
  const role = input.role as Role;
  if (input.isOwnSubject) return SubjectScope.Owner;
  if (role === Role.Owner || role === Role.Admin) return SubjectScope.SecurityAdmin;
  if (input.isAssignedReviewer && can(role, Permission.CyberbullyingReview)) return SubjectScope.Reviewer;
  if (can(role, Permission.CyberbullyingAudit) && !can(role, Permission.CyberbullyingReview)) return SubjectScope.Auditor;
  return SubjectScope.Other; // fail-closed deny
}
