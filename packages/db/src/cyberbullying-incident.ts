import { ActorKind, Prisma } from "@prisma/client";
import { withTenant } from "./repositories";
import { notifyIncidentTx } from "./cyberbullying-notifications";
import {
  Permission, Role, can,
  CYBERBULLYING_AUDIT_EVENTS,
  IncidentLifecycleStatus,
  applyIncidentTransition,
  incidentTransitionRequiresReason,
  permissionForIncidentTransition,
  IncidentTimelineEventType,
  IncidentParticipantRole,
  IncidentAssignmentAction,
  IncidentReportSource,
  IncidentCategory,
  SubjectScope,
  RecipientPurpose, CyberbullyingNotificationType, NotificationEntityType,
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

export class IncidentAssignmentRejected extends Error {
  readonly code = "ASSIGNMENT_REJECTED";
  constructor(public readonly reasonCode: "no_change" | "invalid_target") { super(`assignment rejected: ${reasonCode}`); this.name = "IncidentAssignmentRejected"; }
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
  input: { protectedSubjectId: string; summary: string; reportSource: IncidentReportSource; category?: string; severity?: string; title?: string; allegedActorLabel?: string | null; allegedActorExternalReference?: string | null },
): Promise<string> {
  const inc = await db.incident.create({ data: {
    tenantId: actor.tenantId, brandId: null, domain: DOMAIN_CYBERBULLYING, category: input.category ?? "unspecified",
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
  input: { protectedSubjectId: string; summary: string; category?: string; severity?: string; title?: string; allegedActorLabel?: string | null; allegedActorExternalReference?: string | null; idempotencyKey?: string },
): Promise<{ incidentId: string; duplicate?: boolean }> {
  assertPerm(actor, Permission.CyberbullyingReport);
  const key = input.idempotencyKey;
  try {
    const incidentId = await withTenant(actor.tenantId, async (db) => {
      const id = await createIncident(db, actor, { ...input, reportSource: IncidentReportSource.ManualReport });
      // C6 — DURABLE double-submit guard, inserted as the LAST write: a duplicate
      // (tenant,user,key) hits the unique index and rolls back the ENTIRE creation
      // (no orphan incident). The outer catch then returns the winning incident.
      if (key) await db.cyberbullyingReportSubmission.create({ data: { tenantId: actor.tenantId, userId: actor.userId, idempotencyKey: key, incidentId: id } });
      return id;
    });
    return { incidentId, duplicate: false };
  } catch (e) {
    if (key && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const prior = await withTenant(actor.tenantId, (db) => db.cyberbullyingReportSubmission.findFirst({ where: { tenantId: actor.tenantId, userId: actor.userId, idempotencyKey: key }, select: { incidentId: true } }));
      if (prior?.incidentId) return { incidentId: prior.incidentId, duplicate: true }; // idempotent success
    }
    throw e;
  }
}

/** Create a cyberbullying incident from detection(s) inside an existing transaction.
 *  Reused by the public wrapper AND by the C8 triage flow so linking is atomic. */
export async function createIncidentFromDetectionsTx(
  db: Tx, actor: IncidentActorContext,
  input: { protectedSubjectId: string; summary: string; detectionIds: string[]; severity?: string; title?: string },
): Promise<string> {
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
}

export async function createIncidentFromDetections(
  actor: IncidentActorContext,
  input: { protectedSubjectId: string; summary: string; detectionIds: string[]; severity?: string; title?: string },
): Promise<{ incidentId: string }> {
  assertPerm(actor, Permission.CyberbullyingReview);
  const incidentId = await withTenant(actor.tenantId, (db) => createIncidentFromDetectionsTx(db, actor, input));
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

/**
 * The C3 evidence→incident link, composable inside an existing transaction. Only
 * sets the incident link — NEVER touches immutable origin fields (hash/capturedAt/…)
 * — and appends the timeline + audit events. Reused by the public wrapper AND by the
 * C7 upload flow so a batch attaches atomically through the SAME contract.
 */
export async function linkEvidenceToIncidentTx(db: Tx, actor: IncidentActorContext, incidentId: string, evidenceId: string): Promise<void> {
  const inc = await db.incident.findFirst({ where: { id: incidentId, tenantId: actor.tenantId }, select: { id: true } });
  if (!inc) throw new IncidentNotFoundError();
  const ev = await db.incidentEvidence.findFirst({ where: { id: evidenceId, tenantId: actor.tenantId }, select: { id: true } });
  if (!ev) throw new IncidentNotFoundError();
  await db.incidentEvidence.update({ where: { id: evidenceId }, data: { incidentId } });
  await timeline(db, actor, incidentId, IncidentTimelineEventType.EvidenceLinked, `evidence:${evidenceId}`);
  await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.evidenceLinked, incidentId, { evidenceId });
}

export async function linkEvidenceToIncident(actor: IncidentActorContext, incidentId: string, evidenceId: string): Promise<void> {
  assertPerm(actor, Permission.CyberbullyingReview);
  await withTenant(actor.tenantId, (db) => linkEvidenceToIncidentTx(db, actor, incidentId, evidenceId));
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
  assertPerm(actor, permissionForIncidentTransition(to));
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
    const tl = await db.incidentTimelineEvent.create({ data: { tenantId: actor.tenantId, incidentId, eventType: IncidentTimelineEventType.Reopened, actorUserId: actor.userId, reason } });
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.incidentReopened, incidentId, { from });
    // C10 — notify the assignee + participants (deduped by the reopen timeline event id).
    await notifyIncidentTx(db, actor, incidentId, RecipientPurpose.Reopen, { type: CyberbullyingNotificationType.IncidentReopened, entityType: NotificationEntityType.Incident, entityId: incidentId, incidentId, discriminator: tl.id });
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

// --- C5: Assignment (one primary reviewer; append-only history) ------------

/**
 * Assign the single primary reviewer, or reassign it to a different reviewer.
 * Claiming an UNASSIGNED case needs `cyberbullying:review`; taking a case that is
 * already assigned to someone else (reassign) needs the elevated
 * `cyberbullying:manage`. Assigning to the current assignee is a no-change reject.
 * Transactional: detail update + append-only assignment event + timeline + audit.
 */
export async function assignReviewer(actor: IncidentActorContext, incidentId: string, assigneeUserId: string, reason?: string): Promise<{ action: IncidentAssignmentAction }> {
  if (!assigneeUserId || !assigneeUserId.trim()) throw new IncidentAssignmentRejected("invalid_target");
  return withTenant(actor.tenantId, async (db) => {
    const detail = await db.cyberbullyingIncidentDetail.findFirst({ where: { incidentId, tenantId: actor.tenantId }, select: { id: true, assignedReviewerUserId: true } });
    if (!detail) throw new IncidentNotFoundError();
    const previous = detail.assignedReviewerUserId;
    if (previous === assigneeUserId) throw new IncidentAssignmentRejected("no_change");
    // Claim (unassigned → assigned) is review-level; reassign (someone → someone else) is manage-level.
    const isReassign = previous != null;
    assertPerm(actor, isReassign ? Permission.CyberbullyingManage : Permission.CyberbullyingReview);
    const action = isReassign ? IncidentAssignmentAction.Reassigned : IncidentAssignmentAction.Assigned;

    await db.cyberbullyingIncidentDetail.update({ where: { id: detail.id }, data: { assignedReviewerUserId: assigneeUserId } });
    const evt = await db.incidentAssignmentEvent.create({ data: { tenantId: actor.tenantId, incidentId, action, assigneeUserId, previousAssigneeUserId: previous, assignedByUserId: actor.userId, reason: reason ?? null } });
    await timeline(db, actor, incidentId, isReassign ? IncidentTimelineEventType.ReviewerReassigned : IncidentTimelineEventType.ReviewerAssigned, reason ?? null);
    await audit(db, actor, isReassign ? CYBERBULLYING_AUDIT_EVENTS.incidentReassigned : CYBERBULLYING_AUDIT_EVENTS.incidentAssigned, incidentId, { action });
    // C10 — notify the new assignee (deduped by the assignment event id). Same transaction.
    await notifyIncidentTx(db, actor, incidentId, RecipientPurpose.Assignment, { type: isReassign ? CyberbullyingNotificationType.IncidentReassigned : CyberbullyingNotificationType.IncidentAssigned, entityType: NotificationEntityType.Incident, entityId: incidentId, incidentId, discriminator: evt.id }, { targetUserId: assigneeUserId });
    return { action };
  });
}

/**
 * Remove the primary reviewer. Elevated (`cyberbullying:manage`). No-op reject if
 * already unassigned. Transactional: detail clear + append-only event + timeline + audit.
 */
export async function unassignReviewer(actor: IncidentActorContext, incidentId: string, reason?: string): Promise<void> {
  assertPerm(actor, Permission.CyberbullyingManage);
  await withTenant(actor.tenantId, async (db) => {
    const detail = await db.cyberbullyingIncidentDetail.findFirst({ where: { incidentId, tenantId: actor.tenantId }, select: { id: true, assignedReviewerUserId: true } });
    if (!detail) throw new IncidentNotFoundError();
    const previous = detail.assignedReviewerUserId;
    if (previous == null) throw new IncidentAssignmentRejected("no_change");
    await db.cyberbullyingIncidentDetail.update({ where: { id: detail.id }, data: { assignedReviewerUserId: null } });
    const evt = await db.incidentAssignmentEvent.create({ data: { tenantId: actor.tenantId, incidentId, action: IncidentAssignmentAction.Unassigned, assigneeUserId: null, previousAssigneeUserId: previous, assignedByUserId: actor.userId, reason: reason ?? null } });
    await timeline(db, actor, incidentId, IncidentTimelineEventType.ReviewerUnassigned, reason ?? null);
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.incidentUnassigned, incidentId, { action: IncidentAssignmentAction.Unassigned });
    // C10 — notify the removed reviewer ONLY if they remain in scope (participant); a
    // user out of scope can't open the incident, so they are never notified.
    await notifyIncidentTx(db, actor, incidentId, RecipientPurpose.Assignment, { type: CyberbullyingNotificationType.IncidentUnassigned, entityType: NotificationEntityType.Incident, entityId: incidentId, incidentId, discriminator: evt.id }, { targetUserId: previous });
  });
}

// --- C5: Confidential reviewer notes (append-only; never shown to a subject) --

/**
 * Add an append-only, CONFIDENTIAL reviewer note. Requires `cyberbullying:review`
 * (a protected subject on `view_own` can never write — nor read — notes). The body
 * is persisted but NEVER written to the audit log or timeline. No edit, no delete.
 */
export async function addReviewerNote(actor: IncidentActorContext, incidentId: string, body: string): Promise<{ noteId: string }> {
  assertPerm(actor, Permission.CyberbullyingReview);
  const text = (body ?? "").trim();
  if (!text) throw new IncidentAssignmentRejected("invalid_target");
  return withTenant(actor.tenantId, async (db) => {
    const inc = await db.incident.findFirst({ where: { id: incidentId, tenantId: actor.tenantId, domain: DOMAIN_CYBERBULLYING }, select: { id: true } });
    if (!inc) throw new IncidentNotFoundError();
    const note = await db.incidentReviewerNote.create({ data: { tenantId: actor.tenantId, incidentId, authorUserId: actor.userId, body: text } });
    await timeline(db, actor, incidentId, IncidentTimelineEventType.NoteAdded, null); // body NEVER on the timeline
    await audit(db, actor, CYBERBULLYING_AUDIT_EVENTS.reviewerNoteAdded, incidentId, {}); // body NEVER in audit
    return { noteId: note.id };
  });
}

/** List confidential reviewer notes. Requires `cyberbullying:review` — a protected subject cannot read them. */
export async function listReviewerNotes(actor: IncidentActorContext, incidentId: string) {
  assertPerm(actor, Permission.CyberbullyingReview);
  return withTenant(actor.tenantId, async (db) => {
    const inc = await db.incident.findFirst({ where: { id: incidentId, tenantId: actor.tenantId, domain: DOMAIN_CYBERBULLYING }, select: { id: true } });
    if (!inc) throw new IncidentNotFoundError();
    return db.incidentReviewerNote.findMany({ where: { incidentId, tenantId: actor.tenantId }, orderBy: { createdAt: "asc" }, select: { id: true, authorUserId: true, body: true, createdAt: true } });
  });
}

/** List the append-only assignment history. Requires `cyberbullying:review`. */
export async function listAssignmentHistory(actor: IncidentActorContext, incidentId: string) {
  assertPerm(actor, Permission.CyberbullyingReview);
  return withTenant(actor.tenantId, async (db) => {
    const inc = await db.incident.findFirst({ where: { id: incidentId, tenantId: actor.tenantId, domain: DOMAIN_CYBERBULLYING }, select: { id: true } });
    if (!inc) throw new IncidentNotFoundError();
    return db.incidentAssignmentEvent.findMany({ where: { incidentId, tenantId: actor.tenantId }, orderBy: { createdAt: "asc" }, select: { id: true, action: true, assigneeUserId: true, previousAssigneeUserId: true, assignedByUserId: true, reason: true, createdAt: true } });
  });
}

// --- C6: Reportable protected subjects (manual report flow) ----------------

export class ReportSubjectNotAllowedError extends Error {
  readonly code = "SUBJECT_NOT_ALLOWED";
  constructor() { super("subject not allowed for reporting in this scope"); this.name = "ReportSubjectNotAllowedError"; }
}

export interface ReportableSubject {
  id: string;
  displayLabel: string;
  subjectType: string;
  active: boolean;
}

/**
 * Whether a role may open manual reports at all. Report is `cyberbullying:report`
 * (Owner/Admin/Reviewer per the matrix). The C1 data model carries no per-user
 * subject-authority grant, so a report-capable user may report for the tenant's
 * ACTIVE protected subjects (tenant-scoped, active-only). Finer per-user subject
 * authority is deferred to the (legally-gated) relationship sprint. Fail-closed.
 */
export function canReportManualIncident(role: string): boolean {
  return can(role as Role, Permission.CyberbullyingReport);
}

/** Active protected subjects the actor may file a report for. Tenant-scoped, permission-checked, server-filtered. */
export async function listReportableSubjects(actor: IncidentActorContext): Promise<ReportableSubject[]> {
  assertPerm(actor, Permission.CyberbullyingReport);
  return withTenant(actor.tenantId, (db) => db.protectedSubject.findMany({
    where: { tenantId: actor.tenantId, active: true },
    orderBy: { displayLabel: "asc" },
    take: 500,
    select: { id: true, displayLabel: true, subjectType: true, active: true },
  }));
}

/**
 * Assert the chosen subject is reportable by this actor and return its safe VM.
 * Fail-closed for a missing / inactive / cross-tenant / out-of-scope subject
 * (uniform error — never reveals which). RLS + the tenant filter make a
 * cross-tenant id structurally invisible; the active filter blocks inactive ones.
 */
export async function assertReportableSubject(actor: IncidentActorContext, subjectId: string): Promise<ReportableSubject> {
  assertPerm(actor, Permission.CyberbullyingReport);
  const subject = await withTenant(actor.tenantId, (db) => db.protectedSubject.findFirst({
    where: { id: subjectId, tenantId: actor.tenantId, active: true },
    select: { id: true, displayLabel: true, subjectType: true, active: true },
  }));
  if (!subject) throw new ReportSubjectNotAllowedError();
  return subject;
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
