import { ActorKind, Prisma } from "@prisma/client";
import {
  Permission, Role, can, CYBERBULLYING_AUDIT_EVENTS, IncidentCategory, IncidentTimelineEventType,
  isCaseRiskLevel, isCaseProtectionStatus, canTaskTransition, isCaseMilestoneKey,
  validateCaseTaskInput, parseCaseDueDate, CASE_LIMITS,
  CaseTaskStatus, CaseMilestoneKey, type CaseFieldErrorCode, type CaseTaskField, type IncidentActorContext,
} from "@guardora/core";
import { withTenant } from "./repositories";

/**
 * C9 — Case Management service. A case IS the incident (no second case model): this
 * writes the 1:1 Protection Plan, its follow-up + manually-toggled milestones, and
 * the incident's Case Tasks. EVERY value is human-set — nothing automatic, no AI, no
 * auto-close/escalation. Each op is permission-checked (`cyberbullying:review`),
 * tenant + incident-scoped (fail-closed), transactional, and appends a SANITIZED
 * timeline + audit event. Confidential free text (objective/notes/task title/desc)
 * is NEVER written to the timeline or audit.
 */

type Tx = Prisma.TransactionClient;
const DOMAIN = IncidentCategory.Cyberbullying;

export type CaseErrorCode = "forbidden" | "not_found" | "invalid_transition" | "validation";
export class CaseError extends Error {
  constructor(public readonly code: CaseErrorCode, public readonly fieldErrors?: Partial<Record<CaseTaskField, CaseFieldErrorCode>>) {
    super(`case op rejected: ${code}`); this.name = "CaseError";
  }
}

function assertReview(actor: IncidentActorContext): void {
  if (!can(actor.role as Role, Permission.CyberbullyingReview)) throw new CaseError("forbidden");
}

/** Load the incident + enforce cyberbullying domain and subject scope (fail-closed). */
async function authorizeIncident(db: Tx, actor: IncidentActorContext, incidentId: string): Promise<void> {
  const inc = await db.incident.findFirst({
    where: { id: incidentId, tenantId: actor.tenantId, domain: DOMAIN },
    select: { id: true, cyberbullyingDetail: { select: { assignedReviewerUserId: true } }, participants: { where: { userId: actor.userId }, select: { id: true } } },
  });
  if (!inc) throw new CaseError("not_found");
  const role = actor.role as Role;
  const tenantWide = role === Role.Owner || role === Role.Admin;
  const inScope = inc.participants.length > 0 || inc.cyberbullyingDetail?.assignedReviewerUserId === actor.userId;
  if (!tenantWide && !inScope) throw new CaseError("forbidden");
}

async function caseTimeline(db: Tx, actor: IncidentActorContext, incidentId: string, eventType: IncidentTimelineEventType, reason?: string | null): Promise<void> {
  await db.incidentTimelineEvent.create({ data: { tenantId: actor.tenantId, incidentId, eventType, actorUserId: actor.userId, reason: reason ?? null } });
}
async function caseAudit(db: Tx, actor: IncidentActorContext, event: string, incidentId: string, metadata: Record<string, string | number | boolean>): Promise<void> {
  await db.auditLog.create({ data: { tenantId: actor.tenantId, event, actorKind: ActorKind.human, actorUserId: actor.userId, targetType: "incident", targetId: incidentId, metadata: metadata as never } });
}

/** Ensure a protection plan row exists for the incident; returns its id. */
async function ensurePlan(db: Tx, actor: IncidentActorContext, incidentId: string): Promise<string> {
  const existing = await db.cyberbullyingProtectionPlan.findFirst({ where: { incidentId, tenantId: actor.tenantId }, select: { id: true } });
  if (existing) return existing.id;
  const created = await db.cyberbullyingProtectionPlan.create({ data: { tenantId: actor.tenantId, incidentId } });
  return created.id;
}

// --- Protection plan -------------------------------------------------------

export async function updateProtectionPlan(
  actor: IncidentActorContext, incidentId: string,
  patch: { riskLevel?: string | null; protectionStatus?: string; objective?: string | null; notes?: string | null },
): Promise<void> {
  assertReview(actor);
  // Validate enums + bounds server-side (no client bypass).
  if (patch.riskLevel != null && patch.riskLevel !== "" && !isCaseRiskLevel(patch.riskLevel)) throw new CaseError("validation");
  if (patch.protectionStatus !== undefined && !isCaseProtectionStatus(patch.protectionStatus)) throw new CaseError("validation");
  if (patch.objective != null && patch.objective.length > CASE_LIMITS.objectiveMax) throw new CaseError("validation");
  if (patch.notes != null && patch.notes.length > CASE_LIMITS.notesMax) throw new CaseError("validation");

  await withTenant(actor.tenantId, async (db) => {
    await authorizeIncident(db, actor, incidentId);
    const id = await ensurePlan(db, actor, incidentId);
    const data: Prisma.CyberbullyingProtectionPlanUpdateInput = {};
    if (patch.riskLevel !== undefined) data.riskLevel = patch.riskLevel === "" ? null : patch.riskLevel;
    if (patch.protectionStatus !== undefined) data.protectionStatus = patch.protectionStatus;
    if (patch.objective !== undefined) data.objective = patch.objective || null;
    if (patch.notes !== undefined) data.notes = patch.notes || null;
    await db.cyberbullyingProtectionPlan.update({ where: { id }, data });
    await caseTimeline(db, actor, incidentId, IncidentTimelineEventType.ProtectionPlanUpdated); // no content
    await caseAudit(db, actor, CYBERBULLYING_AUDIT_EVENTS.protectionPlanUpdated, incidentId, {
      ...(data.riskLevel !== undefined ? { riskLevel: String(data.riskLevel ?? "cleared") } : {}),
      ...(data.protectionStatus !== undefined ? { protectionStatus: String(data.protectionStatus) } : {}),
    });
  });
}

export async function updateFollowUp(
  actor: IncidentActorContext, incidentId: string,
  patch: { nextReviewAt?: string | null; lastReviewAt?: string | null; followUpNotes?: string | null },
): Promise<void> {
  assertReview(actor);
  const next = parseCaseDueDate(patch.nextReviewAt);
  const last = parseCaseDueDate(patch.lastReviewAt);
  if (next === "invalid" || last === "invalid") throw new CaseError("validation");
  if (patch.followUpNotes != null && patch.followUpNotes.length > CASE_LIMITS.followUpNotesMax) throw new CaseError("validation");

  await withTenant(actor.tenantId, async (db) => {
    await authorizeIncident(db, actor, incidentId);
    const id = await ensurePlan(db, actor, incidentId);
    const data: Prisma.CyberbullyingProtectionPlanUpdateInput = {};
    if (patch.nextReviewAt !== undefined) data.nextReviewAt = next as Date | null;
    if (patch.lastReviewAt !== undefined) data.lastReviewAt = last as Date | null;
    if (patch.followUpNotes !== undefined) data.followUpNotes = patch.followUpNotes || null;
    await db.cyberbullyingProtectionPlan.update({ where: { id }, data });
    await caseTimeline(db, actor, incidentId, IncidentTimelineEventType.FollowUpUpdated);
    await caseAudit(db, actor, CYBERBULLYING_AUDIT_EVENTS.followUpUpdated, incidentId, {});
  });
}

const MILESTONE_COLUMN: Record<CaseMilestoneKey, keyof Prisma.CyberbullyingProtectionPlanUpdateInput> = {
  [CaseMilestoneKey.InitialReview]: "milestoneInitialReviewAt",
  [CaseMilestoneKey.EvidenceCollected]: "milestoneEvidenceCollectedAt",
  [CaseMilestoneKey.VictimContacted]: "milestoneVictimContactedAt",
  [CaseMilestoneKey.ProtectionActive]: "milestoneProtectionActiveAt",
  [CaseMilestoneKey.Resolved]: "milestoneResolvedAt",
};

export async function setCaseMilestone(actor: IncidentActorContext, incidentId: string, key: string, achieved: boolean): Promise<void> {
  assertReview(actor);
  if (!isCaseMilestoneKey(key)) throw new CaseError("validation");
  await withTenant(actor.tenantId, async (db) => {
    await authorizeIncident(db, actor, incidentId);
    const id = await ensurePlan(db, actor, incidentId);
    const column = MILESTONE_COLUMN[key];
    await db.cyberbullyingProtectionPlan.update({ where: { id }, data: { [column]: achieved ? new Date() : null } as Prisma.CyberbullyingProtectionPlanUpdateInput });
    await caseTimeline(db, actor, incidentId, IncidentTimelineEventType.MilestoneChanged, `${key}:${achieved ? "achieved" : "cleared"}`);
    await caseAudit(db, actor, CYBERBULLYING_AUDIT_EVENTS.milestoneUpdated, incidentId, { milestone: key, achieved });
  });
}

// --- Case tasks ------------------------------------------------------------

export async function createCaseTask(
  actor: IncidentActorContext, incidentId: string,
  input: { title: string; description?: string | null; assigneeUserId?: string | null; dueDate?: string | null },
): Promise<{ taskId: string }> {
  assertReview(actor);
  const errors = validateCaseTaskInput({ title: input.title, description: input.description, dueDate: input.dueDate }, { requireTitle: true });
  if (Object.keys(errors).length) throw new CaseError("validation", errors);
  const due = parseCaseDueDate(input.dueDate) as Date | null;

  return withTenant(actor.tenantId, async (db) => {
    await authorizeIncident(db, actor, incidentId);
    const task = await db.cyberbullyingCaseTask.create({ data: {
      tenantId: actor.tenantId, incidentId, title: input.title.trim(), description: input.description?.trim() || null,
      status: CaseTaskStatus.Todo, assigneeUserId: input.assigneeUserId || null, dueDate: due, createdByUserId: actor.userId,
    } });
    await caseTimeline(db, actor, incidentId, IncidentTimelineEventType.TaskCreated, `task:${task.id}`); // id only, no title
    await caseAudit(db, actor, CYBERBULLYING_AUDIT_EVENTS.caseTaskCreated, incidentId, { taskId: task.id, status: CaseTaskStatus.Todo });
    return { taskId: task.id };
  });
}

export async function updateCaseTask(
  actor: IncidentActorContext, incidentId: string, taskId: string,
  patch: { title?: string; description?: string | null; status?: string; assigneeUserId?: string | null; dueDate?: string | null },
): Promise<void> {
  assertReview(actor);
  const errors = validateCaseTaskInput({ title: patch.title, description: patch.description, status: patch.status, dueDate: patch.dueDate });
  if (Object.keys(errors).length) throw new CaseError("validation", errors);
  const due = patch.dueDate !== undefined ? (parseCaseDueDate(patch.dueDate) as Date | null) : undefined;

  await withTenant(actor.tenantId, async (db) => {
    await authorizeIncident(db, actor, incidentId);
    const task = await db.cyberbullyingCaseTask.findFirst({ where: { id: taskId, incidentId, tenantId: actor.tenantId }, select: { id: true, status: true } });
    if (!task) throw new CaseError("not_found");

    const data: Prisma.CyberbullyingCaseTaskUpdateInput = {};
    if (patch.title !== undefined) data.title = patch.title.trim();
    if (patch.description !== undefined) data.description = patch.description?.trim() || null;
    if (patch.assigneeUserId !== undefined) data.assigneeUserId = patch.assigneeUserId || null;
    if (due !== undefined) data.dueDate = due;

    let event = IncidentTimelineEventType.TaskUpdated;
    let auditEvent: string = CYBERBULLYING_AUDIT_EVENTS.caseTaskUpdated;
    if (patch.status !== undefined && patch.status !== task.status) {
      const from = task.status as CaseTaskStatus;
      const to = patch.status as CaseTaskStatus;
      if (!canTaskTransition(from, to)) throw new CaseError("invalid_transition");
      data.status = to;
      data.completedAt = to === CaseTaskStatus.Done ? new Date() : null;
      if (to === CaseTaskStatus.Done) { event = IncidentTimelineEventType.TaskCompleted; auditEvent = CYBERBULLYING_AUDIT_EVENTS.caseTaskCompleted; }
      else if (to === CaseTaskStatus.Cancelled) { auditEvent = CYBERBULLYING_AUDIT_EVENTS.caseTaskCancelled; }
    }
    await db.cyberbullyingCaseTask.update({ where: { id: taskId }, data });
    await caseTimeline(db, actor, incidentId, event, `task:${taskId}`);
    await caseAudit(db, actor, auditEvent, incidentId, { taskId, ...(data.status !== undefined ? { status: String(data.status) } : {}) });
  });
}
