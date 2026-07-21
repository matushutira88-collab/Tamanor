import { ActorKind, Prisma } from "@prisma/client";
import {
  Permission, Role, can, CYBERBULLYING_AUDIT_EVENTS, IncidentCategory, IncidentTimelineEventType,
  EscalationStatus, EscalationSeverity, EscalationReason, RecipientPurpose,
  NotificationType, NotificationEntityType,
  isEscalationSeverity, isEscalationReason, escalationReasonRequiresNote, canEscalationTransition, ESCALATION_NOTE_MAX,
  type IncidentActorContext,
} from "@guardora/core";
import { withTenant } from "./repositories";
import { resolveIncidentRecipientsTx, isValidIncidentRecipientTx, createNotificationTx, notifyIncidentTx } from "./cyberbullying-notifications";

/**
 * C10 — Manual escalation. An explicit human step marking an incident as needing
 * higher attention. It NEVER mutates the incident lifecycle, manual risk level,
 * milestones, tasks, or assignments. Create requires `cyberbullying:review` + scope;
 * resolve/cancel/reassign require the elevated `cyberbullying:escalate` (or being the
 * target, for resolve). The confidential `note` is stored but never written to the
 * timeline, audit, or a notification payload. At most one ACTIVE escalation per
 * incident (duplicate ⇒ fail-closed).
 */

type Tx = Prisma.TransactionClient;
const DOMAIN = IncidentCategory.Cyberbullying;

export type EscalationErrorCode = "forbidden" | "not_found" | "invalid_transition" | "invalid_recipient" | "invalid_reason" | "missing_note" | "duplicate";
export class EscalationError extends Error {
  constructor(public readonly code: EscalationErrorCode) { super(`escalation: ${code}`); this.name = "EscalationError"; }
}

async function authorizeScope(db: Tx, actor: IncidentActorContext, incidentId: string): Promise<void> {
  const inc = await db.incident.findFirst({
    where: { id: incidentId, tenantId: actor.tenantId, domain: DOMAIN },
    select: { id: true, cyberbullyingDetail: { select: { assignedReviewerUserId: true } }, participants: { where: { userId: actor.userId }, select: { id: true } } },
  });
  if (!inc) throw new EscalationError("not_found");
  const role = actor.role as Role;
  const tenantWide = role === Role.Owner || role === Role.Admin;
  const inScope = inc.participants.length > 0 || inc.cyberbullyingDetail?.assignedReviewerUserId === actor.userId;
  if (!tenantWide && !inScope) throw new EscalationError("forbidden");
}

async function escTimeline(db: Tx, actor: IncidentActorContext, incidentId: string, eventType: IncidentTimelineEventType, reason?: string | null): Promise<void> {
  await db.incidentTimelineEvent.create({ data: { tenantId: actor.tenantId, incidentId, eventType, actorUserId: actor.userId, reason: reason ?? null } });
}
async function escAudit(db: Tx, actor: IncidentActorContext, event: string, escalationId: string, metadata: Record<string, string>): Promise<void> {
  await db.auditLog.create({ data: { tenantId: actor.tenantId, event, actorKind: ActorKind.human, actorUserId: actor.userId, targetType: "escalation", targetId: escalationId, metadata: metadata as never } });
}

// --- Create ----------------------------------------------------------------

export async function createManualEscalation(
  actor: IncidentActorContext, incidentId: string,
  input: { severity: string; reasonCode: string; note?: string | null; targetUserId?: string | null; targetRole?: string | null },
): Promise<{ escalationId: string; status: string; duplicate?: boolean }> {
  if (!can(actor.role as Role, Permission.CyberbullyingReview)) throw new EscalationError("forbidden");
  if (!isEscalationSeverity(input.severity)) throw new EscalationError("invalid_reason");
  if (!isEscalationReason(input.reasonCode)) throw new EscalationError("invalid_reason");
  const note = (input.note ?? "").trim();
  if (escalationReasonRequiresNote(input.reasonCode as EscalationReason) && !note) throw new EscalationError("missing_note");
  if (note.length > ESCALATION_NOTE_MAX) throw new EscalationError("invalid_reason");

  return withTenant(actor.tenantId, async (db) => {
    await authorizeScope(db, actor, incidentId);
    // At most one ACTIVE escalation per incident.
    const active = await db.cyberbullyingEscalation.findFirst({ where: { incidentId, tenantId: actor.tenantId, status: EscalationStatus.Active }, select: { id: true, status: true, targetUserId: true } });
    if (active) throw new EscalationError("duplicate");
    // Validate an explicit target (must be able to open the incident).
    if (input.targetUserId && !(await isValidIncidentRecipientTx(db, actor.tenantId, incidentId, input.targetUserId))) throw new EscalationError("invalid_recipient");
    if (input.targetRole && ![Role.Owner, Role.Admin, Role.Reviewer].includes(input.targetRole as Role)) throw new EscalationError("invalid_recipient");

    const esc = await db.cyberbullyingEscalation.create({ data: {
      tenantId: actor.tenantId, incidentId, status: EscalationStatus.Active, severity: input.severity, reasonCode: input.reasonCode,
      note: note || null, escalatedByUserId: actor.userId, targetUserId: input.targetUserId || null, targetRole: input.targetRole || null,
    } });
    // Timeline + audit — reason code + severity only, NEVER the note.
    await escTimeline(db, actor, incidentId, IncidentTimelineEventType.EscalationCreated, `${input.reasonCode}:${input.severity}`);
    await escAudit(db, actor, CYBERBULLYING_AUDIT_EVENTS.escalationCreated, esc.id, { reasonCode: input.reasonCode, severity: input.severity, ...(input.targetRole ? { targetRole: input.targetRole } : {}) });
    // Notify — deduped, sanitized (no note).
    await notifyIncidentTx(db, actor, incidentId, RecipientPurpose.Escalation,
      { type: NotificationType.IncidentEscalated, entityType: NotificationEntityType.Escalation, entityId: esc.id, incidentId, discriminator: esc.id, metadata: { severity: input.severity, reasonCode: input.reasonCode } },
      { targetUserId: input.targetUserId, targetRole: input.targetRole });
    return { escalationId: esc.id, status: esc.status };
  });
}

// --- Resolve / cancel / reassign -------------------------------------------

async function loadActive(db: Tx, actor: IncidentActorContext, escalationId: string): Promise<{ id: string; incidentId: string; status: string; targetUserId: string | null }> {
  const esc = await db.cyberbullyingEscalation.findFirst({ where: { id: escalationId, tenantId: actor.tenantId }, select: { id: true, incidentId: true, status: true, targetUserId: true } });
  if (!esc) throw new EscalationError("not_found");
  return esc;
}

export async function resolveEscalation(actor: IncidentActorContext, escalationId: string, resolutionCode?: string): Promise<void> {
  return withTenant(actor.tenantId, async (db) => {
    const esc = await loadActive(db, actor, escalationId);
    // Manage (escalate) OR the escalation target may resolve.
    const canManage = can(actor.role as Role, Permission.CyberbullyingEscalate);
    if (!canManage && !(esc.targetUserId === actor.userId && can(actor.role as Role, Permission.CyberbullyingReview))) throw new EscalationError("forbidden");
    if (!canEscalationTransition(esc.status as EscalationStatus, EscalationStatus.Resolved)) throw new EscalationError("invalid_transition");
    await db.cyberbullyingEscalation.update({ where: { id: escalationId }, data: { status: EscalationStatus.Resolved, resolvedAt: new Date(), resolvedByUserId: actor.userId, resolutionCode: resolutionCode || null } });
    await escTimeline(db, actor, esc.incidentId, IncidentTimelineEventType.EscalationResolved);
    await escAudit(db, actor, CYBERBULLYING_AUDIT_EVENTS.escalationResolved, escalationId, resolutionCode ? { resolutionCode } : {});
    await notifyIncidentTx(db, actor, esc.incidentId, RecipientPurpose.Escalation, { type: NotificationType.EscalationResolved, entityType: NotificationEntityType.Escalation, entityId: escalationId, incidentId: esc.incidentId, discriminator: `resolved:${escalationId}` }, { targetUserId: esc.targetUserId });
  });
}

export async function cancelEscalation(actor: IncidentActorContext, escalationId: string): Promise<void> {
  if (!can(actor.role as Role, Permission.CyberbullyingEscalate)) throw new EscalationError("forbidden");
  return withTenant(actor.tenantId, async (db) => {
    const esc = await loadActive(db, actor, escalationId);
    if (!canEscalationTransition(esc.status as EscalationStatus, EscalationStatus.Cancelled)) throw new EscalationError("invalid_transition");
    await db.cyberbullyingEscalation.update({ where: { id: escalationId }, data: { status: EscalationStatus.Cancelled, resolvedAt: new Date(), resolvedByUserId: actor.userId } });
    await escTimeline(db, actor, esc.incidentId, IncidentTimelineEventType.EscalationCancelled);
    await escAudit(db, actor, CYBERBULLYING_AUDIT_EVENTS.escalationCancelled, escalationId, {});
  });
}

export async function reassignEscalationTarget(actor: IncidentActorContext, escalationId: string, newTargetUserId: string): Promise<void> {
  if (!can(actor.role as Role, Permission.CyberbullyingEscalate)) throw new EscalationError("forbidden");
  return withTenant(actor.tenantId, async (db) => {
    const esc = await loadActive(db, actor, escalationId);
    if (esc.status !== EscalationStatus.Active) throw new EscalationError("invalid_transition");
    if (!(await isValidIncidentRecipientTx(db, actor.tenantId, esc.incidentId, newTargetUserId))) throw new EscalationError("invalid_recipient");
    await db.cyberbullyingEscalation.update({ where: { id: escalationId }, data: { targetUserId: newTargetUserId } });
    await escTimeline(db, actor, esc.incidentId, IncidentTimelineEventType.EscalationTargetChanged);
    await escAudit(db, actor, CYBERBULLYING_AUDIT_EVENTS.escalationTargetChanged, escalationId, {});
    await createNotificationTx(db, actor.tenantId, actor.userId, newTargetUserId, { type: NotificationType.IncidentEscalated, entityType: NotificationEntityType.Escalation, entityId: escalationId, incidentId: esc.incidentId, discriminator: `reassigned:${escalationId}:${newTargetUserId}` });
  });
}

// --- Read ------------------------------------------------------------------

/** Eligible escalation-target candidates for the incident (reviewers/managers in scope). */
export async function getEscalationRecipients(actor: IncidentActorContext, incidentId: string): Promise<string[]> {
  if (!can(actor.role as Role, Permission.CyberbullyingReview)) throw new EscalationError("forbidden");
  return withTenant(actor.tenantId, (db) => resolveIncidentRecipientsTx(db, actor.tenantId, incidentId, RecipientPurpose.CriticalRisk, {}));
}

export interface EscalationView {
  id: string; status: string; severity: string; reasonCode: string;
  escalatedByUserId: string; escalatedAt: string; targetUserId: string | null; targetRole: string | null;
  resolvedAt: string | null; resolvedByUserId: string | null; resolutionCode: string | null;
}
/** The active escalation for an incident (sanitized — NO confidential note returned). */
export async function getIncidentEscalationView(actor: IncidentActorContext, incidentId: string): Promise<EscalationView | null> {
  if (!can(actor.role as Role, Permission.CyberbullyingReview)) throw new EscalationError("forbidden");
  return withTenant(actor.tenantId, async (db) => {
    const esc = await db.cyberbullyingEscalation.findFirst({ where: { incidentId, tenantId: actor.tenantId, status: EscalationStatus.Active }, orderBy: { escalatedAt: "desc" }, select: {
      id: true, status: true, severity: true, reasonCode: true, escalatedByUserId: true, escalatedAt: true, targetUserId: true, targetRole: true, resolvedAt: true, resolvedByUserId: true, resolutionCode: true,
    } });
    if (!esc) return null;
    return { ...esc, escalatedAt: esc.escalatedAt.toISOString(), resolvedAt: esc.resolvedAt?.toISOString() ?? null }; // note intentionally omitted
  });
}
