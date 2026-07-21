import { ActorKind, Prisma } from "@prisma/client";
import {
  Permission, Role, can, CYBERBULLYING_AUDIT_EVENTS,
  CyberbullyingDetectionStatus, CyberbullyingDetectionEventType,
  detectionTransitionTarget, detectionEventForOp,
  type CyberbullyingDetectionOp, type IncidentActorContext,
} from "@guardora/core";
import { withTenant } from "./repositories";
import { createIncidentFromDetectionsTx } from "./cyberbullying-incident";

/**
 * C8 — Detection triage service. Human triage of EXISTING SecurityDetections into
 * the cyberbullying workflow. NEVER creates an incident automatically and never runs
 * a classifier. Every op is permission-checked (`cyberbullying:review`), tenant-
 * scoped (withTenant/RLS), transactional, fail-closed, and produces an append-only
 * triage timeline event + a sanitized audit event. The security-domain
 * `SecurityDetection.status` is never touched; detections are never deleted.
 */

type Tx = Prisma.TransactionClient;
const DS = CyberbullyingDetectionStatus;
export const MAX_BULK_DETECTIONS = 100;

export type DetectionTriageErrorCode = "forbidden" | "not_found" | "invalid_transition" | "already_linked";
export class DetectionTriageError extends Error {
  constructor(public readonly code: DetectionTriageErrorCode) { super(`detection triage rejected: ${code}`); this.name = "DetectionTriageError"; }
}

/** Single-op triage (not create_incident, which needs a subject + summary). */
export type SingleTriageOp = "start_review" | "ignore" | "false_positive" | "reopen";

const AUDIT_FOR_OP: Record<CyberbullyingDetectionOp, string> = {
  start_review: CYBERBULLYING_AUDIT_EVENTS.detectionReviewStarted,
  ignore: CYBERBULLYING_AUDIT_EVENTS.detectionIgnored,
  false_positive: CYBERBULLYING_AUDIT_EVENTS.detectionFalsePositive,
  reopen: CYBERBULLYING_AUDIT_EVENTS.detectionReopened,
  create_incident: CYBERBULLYING_AUDIT_EVENTS.detectionLinkedToIncident,
};

function assertReview(actor: IncidentActorContext): void {
  if (!can(actor.role as Role, Permission.CyberbullyingReview)) throw new DetectionTriageError("forbidden");
}

async function triageEvent(db: Tx, actor: IncidentActorContext, detectionId: string, eventType: CyberbullyingDetectionEventType, reason?: string | null): Promise<void> {
  await db.cyberbullyingDetectionTriageEvent.create({ data: { tenantId: actor.tenantId, securityDetectionId: detectionId, eventType, actorUserId: actor.userId, reason: reason ?? null } });
}
async function triageAudit(db: Tx, actor: IncidentActorContext, event: string, detectionId: string, metadata: Record<string, string>): Promise<void> {
  await db.auditLog.create({ data: { tenantId: actor.tenantId, event, actorKind: ActorKind.human, actorUserId: actor.userId, targetType: "security_detection", targetId: detectionId, metadata: metadata as never } });
}

/** Apply a single-op transition inside a tx (fail-closed on illegal transition). */
async function applyTriageTx(db: Tx, actor: IncidentActorContext, detectionId: string, op: SingleTriageOp, reason?: string): Promise<CyberbullyingDetectionStatus> {
  const det = await db.securityDetection.findFirst({ where: { id: detectionId, tenantId: actor.tenantId }, select: { id: true, cyberbullyingTriage: { select: { id: true, status: true } } } });
  if (!det) throw new DetectionTriageError("not_found");
  const from = (det.cyberbullyingTriage?.status as CyberbullyingDetectionStatus) ?? DS.New;
  const to = detectionTransitionTarget(from, op);
  if (!to) throw new DetectionTriageError("invalid_transition");
  if (det.cyberbullyingTriage) await db.cyberbullyingDetectionTriage.update({ where: { id: det.cyberbullyingTriage.id }, data: { status: to, reviewedByUserId: actor.userId } });
  else await db.cyberbullyingDetectionTriage.create({ data: { tenantId: actor.tenantId, securityDetectionId: detectionId, status: to, reviewedByUserId: actor.userId } });
  await triageEvent(db, actor, detectionId, detectionEventForOp(op), reason);
  await triageAudit(db, actor, AUDIT_FOR_OP[op], detectionId, { status: to });
  return to;
}

export async function triageDetection(actor: IncidentActorContext, detectionId: string, op: SingleTriageOp, reason?: string): Promise<{ status: CyberbullyingDetectionStatus }> {
  assertReview(actor);
  const status = await withTenant(actor.tenantId, (db) => applyTriageTx(db, actor, detectionId, op, reason));
  return { status };
}

/**
 * Create a cyberbullying incident FROM a detection (human decision). Duplicate-
 * protected: fails closed if the detection is already linked to an incident. Atomic:
 * incident + C3 detection link + triage → LINKED_TO_INCIDENT + timeline + audit.
 * No reviewer is auto-assigned; the incident opens as `open`.
 */
export async function createIncidentFromDetectionTriage(
  actor: IncidentActorContext, detectionId: string, input: { protectedSubjectId: string; summary: string },
): Promise<{ incidentId: string }> {
  assertReview(actor);
  return withTenant(actor.tenantId, async (db) => {
    const det = await db.securityDetection.findFirst({
      where: { id: detectionId, tenantId: actor.tenantId },
      select: { id: true, cyberbullyingTriage: { select: { id: true, status: true } }, incidentLinks: { select: { id: true }, take: 1 } },
    });
    if (!det) throw new DetectionTriageError("not_found");
    const from = (det.cyberbullyingTriage?.status as CyberbullyingDetectionStatus) ?? DS.New;
    // Duplicate protection — an existing incident link OR a linked triage state blocks it.
    if (det.incidentLinks.length > 0 || from === DS.LinkedToIncident) throw new DetectionTriageError("already_linked");
    if (!detectionTransitionTarget(from, "create_incident")) throw new DetectionTriageError("invalid_transition");

    const incidentId = await createIncidentFromDetectionsTx(db, actor, { protectedSubjectId: input.protectedSubjectId, summary: input.summary, detectionIds: [detectionId] });
    if (det.cyberbullyingTriage) await db.cyberbullyingDetectionTriage.update({ where: { id: det.cyberbullyingTriage.id }, data: { status: DS.LinkedToIncident, incidentId, reviewedByUserId: actor.userId } });
    else await db.cyberbullyingDetectionTriage.create({ data: { tenantId: actor.tenantId, securityDetectionId: detectionId, status: DS.LinkedToIncident, incidentId, reviewedByUserId: actor.userId } });
    await triageEvent(db, actor, detectionId, CyberbullyingDetectionEventType.Linked, `incident:${incidentId}`);
    await triageAudit(db, actor, CYBERBULLYING_AUDIT_EVENTS.detectionLinkedToIncident, detectionId, { incidentId });
    return { incidentId };
  });
}

/**
 * Bulk single-op triage (start_review | ignore | false_positive ONLY — never bulk
 * create incident). Each detection is applied in its OWN transaction so an invalid
 * transition skips that item without rolling back the rest. Bounded batch.
 */
export async function bulkTriageDetections(actor: IncidentActorContext, detectionIds: string[], op: Exclude<SingleTriageOp, "reopen">): Promise<{ applied: number; skipped: number }> {
  assertReview(actor);
  const ids = Array.from(new Set(detectionIds)).slice(0, MAX_BULK_DETECTIONS);
  let applied = 0, skipped = 0;
  for (const id of ids) {
    try { await withTenant(actor.tenantId, (db) => applyTriageTx(db, actor, id, op)); applied++; }
    catch (e) {
      if (e instanceof DetectionTriageError && (e.code === "invalid_transition" || e.code === "not_found")) skipped++;
      else throw e;
    }
  }
  return { applied, skipped };
}
