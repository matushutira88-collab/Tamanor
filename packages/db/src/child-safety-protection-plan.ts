/**
 * Child Safety Protection Plans V1 — operational service (SYSTEM-scoped, systemDb).
 *
 * Internal protective-action coordination over the canonical ChildSafetyIncident. NOT a generic workflow
 * engine. Every operation is tenant-isolated (explicit tenantId + composite (id,tenantId) FKs — SYSTEM
 * tables, so explicit scoping is the enforcement), permission-checked, transactional, and appends both a
 * canonical (content-free) action event and a content-free audit entry. Concurrency is safe:
 *   • at most ONE non-terminal plan per incident — advisory lock + partial unique index backstop;
 *   • gap-free unique action `sequence` — advisory lock + unique index backstop;
 *   • status transitions use a guarded conditional update (updateMany WHERE status IN allowed) so a
 *     concurrent double-complete / lost update is impossible.
 * `completionNote` + `blockReason` are internal protected free text — stored only on the action row,
 * never copied into events, audit, or notifications.
 */
import { ActorKind } from "@prisma/client";
import {
  Role,
  ChildSafetyProtectionPlanStatus, ChildSafetyProtectionActionStatus, ChildSafetyProtectionEventType,
  ChildSafetyProtectionActionType, ChildSafetyProtectionPriority, PROTECTION_ACTION_CATALOG,
  canViewChildSafetyProtectionPlan, canManageChildSafetyProtectionPlan,
  canTransitionPlanStatus, canTransitionActionStatus, canCompletePlan, computePlanProgress,
  recommendProtectionPlan, isProtectionActionType, riskFamilyOf,
  ACTIVE_PLAN_STATUSES, PROTECTION_PRIORITY_RANK, CHILD_SAFETY_PROTECTION_AUDIT_EVENTS,
  type PlanRecommendation, type PlanProgress,
} from "@guardora/core";
import { systemDb } from "./index";
// PHASE 3B3 — a plan-status transition that lands the plan IN a Family-disclosable state (active / reopened)
// atomically enqueues one bounded family_protection_plan_updated event in the SAME owner transaction (explicit
// tenantId, no plan actions/notes/evidence). Materiality is an explicit before/after allow-list check (never a
// bare updatedAt); every such transition also bumps the canonical `revision` (the stable eventVersion marker).
// The processor later resolves recipients via the Phase 2b plan → incident → linked-signal visibility authority.
import { enqueueFamilyNotificationOutboxEventOwnerTx, isMaterialFamilyProtectionPlanUpdate } from "./internal/family-notification-outbox";

export interface ProtectionActor { tenantId: string; userId: string; role: Role; }
export class ChildSafetyProtectionForbiddenError extends Error { constructor(public readonly reason: string) { super("child_safety_protection_forbidden"); } }
export class ChildSafetyProtectionNotFoundError extends Error { constructor() { super("child_safety_protection_not_found"); } }
class ProtectionInputError extends Error {}

const CUSTOM_TITLE_MAX = 200, CUSTOM_DESC_MAX = 2000, NOTE_MAX = 2000;
function assertView(a: ProtectionActor): void { if (!canViewChildSafetyProtectionPlan(a.role)) throw new ChildSafetyProtectionForbiddenError("view"); }
function assertManage(a: ProtectionActor): void { if (!canManageChildSafetyProtectionPlan(a.role)) throw new ChildSafetyProtectionForbiddenError("manage"); }

async function audit(tenantId: string, actorUserId: string, event: string, targetId: string, metadata: Record<string, string | number | boolean>): Promise<void> {
  await systemDb.auditLog.create({ data: { tenantId, event, actorKind: ActorKind.human, actorUserId, targetType: "child_safety_protection_plan", targetId, metadata: metadata as never } }).catch(() => {});
}
async function emit(tenantId: string, planId: string, actionId: string | null, eventType: ChildSafetyProtectionEventType, actorUserId: string, fromValue?: string | null, toValue?: string | null): Promise<void> {
  await systemDb.childSafetyProtectionActionEvent.create({ data: { tenantId, planId, actionId, eventType, actorUserId, fromValue: fromValue ?? null, toValue: toValue ?? null } });
}
async function requireIncident(tenantId: string, incidentId: string) {
  const inc = await systemDb.childSafetyIncident.findFirst({ where: { id: incidentId, tenantId }, select: { id: true, riskFamily: true, severity: true, urgency: true, escalationState: true, status: true } });
  if (!inc) throw new ChildSafetyProtectionNotFoundError();
  return inc;
}
async function requirePlan(tenantId: string, planId: string) {
  const plan = await systemDb.childSafetyProtectionPlan.findFirst({ where: { id: planId, tenantId } });
  if (!plan) throw new ChildSafetyProtectionNotFoundError();
  return plan;
}
async function requireAction(tenantId: string, actionId: string) {
  const action = await systemDb.childSafetyProtectionAction.findFirst({ where: { id: actionId, tenantId } });
  if (!action) throw new ChildSafetyProtectionNotFoundError();
  return action;
}

// ── Recommendation preview (deterministic, content-free, NOT persisted) ────────
export async function generateProtectionRecommendation(actor: ProtectionActor, incidentId: string): Promise<PlanRecommendation> {
  assertView(actor);
  const inc = await requireIncident(actor.tenantId, incidentId);
  const [guardianDelivered, evidenceCount] = await Promise.all([
    systemDb.childSafetyIntervention.count({ where: { tenantId: actor.tenantId, incidentRef: incidentId, deliveryStatus: "done" } }).then((n) => n > 0),
    systemDb.childSafetyEvidence.count({ where: { tenantId: actor.tenantId, incidentId } }),
  ]);
  // riskFamily is already a family string on the incident; normalize defensively through riskFamilyOf if it's a RiskType.
  const riskFamily = inc.riskFamily;
  return recommendProtectionPlan({ riskFamily, severity: inc.severity, urgency: inc.urgency, escalationState: inc.escalationState, guardianDelivered, evidenceCount, incidentStatus: inc.status });
}

// ── Read: plan-by-incident + actions + progress + timeline ─────────────────────
const ACTION_PUBLIC = { id: true, planId: true, actionType: true, title: true, description: true, priority: true, status: true, assignedReviewerId: true, dueAt: true, completedAt: true, completedBy: true, completionNote: true, blockReason: true, sequence: true, createdBy: true, createdAt: true } as const;
function toActionPublic(a: { id: string; actionType: string; title: string; description: string | null; priority: string; status: string; assignedReviewerId: string | null; dueAt: Date | null; completedAt: Date | null; completedBy: string | null; completionNote: string | null; blockReason: string | null; sequence: number; createdBy: string; createdAt: Date }) {
  return { id: a.id, actionType: a.actionType, title: a.title, description: a.description, priority: a.priority, status: a.status, assignedReviewerId: a.assignedReviewerId, dueAt: a.dueAt?.toISOString() ?? null, completedAt: a.completedAt?.toISOString() ?? null, completedBy: a.completedBy, completionNote: a.completionNote, blockReason: a.blockReason, sequence: a.sequence, createdBy: a.createdBy, createdAt: a.createdAt.toISOString() };
}

/** The current (non-terminal) plan for an incident, if any, with actions + progress. Terminal plans are returned only via getProtectionPlan(planId). */
export async function getProtectionPlanForIncident(actor: ProtectionActor, incidentId: string) {
  assertView(actor);
  await requireIncident(actor.tenantId, incidentId);
  const plan = await systemDb.childSafetyProtectionPlan.findFirst({ where: { tenantId: actor.tenantId, incidentId, status: { in: [...ACTIVE_PLAN_STATUSES] } }, orderBy: { createdAt: "desc" } });
  if (!plan) return null;
  return assembleplan(actor.tenantId, plan);
}
export async function getProtectionPlan(actor: ProtectionActor, planId: string) {
  assertView(actor);
  const plan = await requirePlan(actor.tenantId, planId);
  return assembleplan(actor.tenantId, plan);
}
async function assembleplan(tenantId: string, plan: { id: string; incidentId: string; status: string; priority: string; createdBy: string; activatedAt: Date | null; completedAt: Date | null; closedReason: string | null; revision: number; createdAt: Date }, now: Date = new Date()) {
  const actions = await systemDb.childSafetyProtectionAction.findMany({ where: { tenantId, planId: plan.id }, orderBy: [{ sequence: "asc" }], select: ACTION_PUBLIC });
  const progress = computePlanProgress(actions.map((a) => ({ status: a.status, dueAt: a.dueAt })), now);
  return {
    plan: { id: plan.id, incidentId: plan.incidentId, status: plan.status, priority: plan.priority, createdBy: plan.createdBy, activatedAt: plan.activatedAt?.toISOString() ?? null, completedAt: plan.completedAt?.toISOString() ?? null, closedReason: plan.closedReason, revision: plan.revision, createdAt: plan.createdAt.toISOString() },
    actions: actions.map(toActionPublic),
    progress,
  };
}

export async function getProtectionPlanProgress(actor: ProtectionActor, planId: string): Promise<PlanProgress> {
  assertView(actor);
  await requirePlan(actor.tenantId, planId);
  const actions = await systemDb.childSafetyProtectionAction.findMany({ where: { tenantId: actor.tenantId, planId }, select: { status: true, dueAt: true } });
  return computePlanProgress(actions, new Date());
}

// Deterministic plan timeline from append-only events.
const EVENT_ORDER: Record<string, number> = { plan_created: 0, plan_activated: 1, action_added: 2, action_assigned: 3, action_unassigned: 4, due_date_changed: 5, priority_changed: 6, action_started: 7, action_blocked: 8, action_completed: 9, action_skipped: 10, action_reopened: 11, plan_completed: 12, plan_cancelled: 13, plan_reopened: 14 };
export async function getProtectionPlanTimeline(actor: ProtectionActor, planId: string) {
  assertView(actor);
  await requirePlan(actor.tenantId, planId);
  const rows = await systemDb.childSafetyProtectionActionEvent.findMany({ where: { tenantId: actor.tenantId, planId }, select: { id: true, actionId: true, eventType: true, actorUserId: true, fromValue: true, toValue: true, createdAt: true } });
  return rows
    .map((e) => ({ id: e.id, actionId: e.actionId, eventType: e.eventType, actorUserId: e.actorUserId, from: e.fromValue, to: e.toValue, at: e.createdAt.toISOString() }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (EVENT_ORDER[a.eventType] ?? 99) - (EVENT_ORDER[b.eventType] ?? 99) || a.id.localeCompare(b.id));
}

// ── Create draft (optionally from the recommendation) ──────────────────────────
export async function createDraftProtectionPlan(actor: ProtectionActor, incidentId: string, opts: { fromRecommendation?: boolean } = {}): Promise<{ planId: string }> {
  assertManage(actor);
  await requireIncident(actor.tenantId, incidentId);
  const rec = opts.fromRecommendation ? await generateProtectionRecommendation(actor, incidentId) : null;

  const planId = await systemDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cspp:${actor.tenantId}:${incidentId}`}, 0))`;
    const existing = await tx.childSafetyProtectionPlan.findFirst({ where: { tenantId: actor.tenantId, incidentId, status: { in: [...ACTIVE_PLAN_STATUSES] } }, select: { id: true } });
    if (existing) throw new ProtectionInputError("active_plan_exists");
    const plan = await tx.childSafetyProtectionPlan.create({ data: { tenantId: actor.tenantId, incidentId, status: ChildSafetyProtectionPlanStatus.Draft, priority: rec?.priority ?? ChildSafetyProtectionPriority.Normal, createdBy: actor.userId }, select: { id: true } });
    if (rec) {
      let seq = 0;
      for (const a of rec.actions) {
        seq += 1;
        const tmpl = PROTECTION_ACTION_CATALOG[a.type];
        const dueAt = new Date(Date.now() + a.dueWindowHours * 3600 * 1000);
        await tx.childSafetyProtectionAction.create({ data: { tenantId: actor.tenantId, planId: plan.id, actionType: a.type, title: tmpl.titleKey, priority: a.priority, sequence: seq, dueAt, createdBy: actor.userId } });
      }
    }
    return plan.id;
  });

  await emit(actor.tenantId, planId, null, ChildSafetyProtectionEventType.PlanCreated, actor.userId, null, opts.fromRecommendation ? "from_recommendation" : "blank");
  if (rec) { const acts = await systemDb.childSafetyProtectionAction.findMany({ where: { tenantId: actor.tenantId, planId }, select: { id: true, actionType: true } }); for (const a of acts) await emit(actor.tenantId, planId, a.id, ChildSafetyProtectionEventType.ActionAdded, actor.userId, null, a.actionType); }
  await audit(actor.tenantId, actor.userId, CHILD_SAFETY_PROTECTION_AUDIT_EVENTS.planCreated, planId, { incidentId, fromRecommendation: !!opts.fromRecommendation, actions: rec?.actions.length ?? 0 });
  return { planId };
}

// ── Add a bounded custom internal action ───────────────────────────────────────
export async function addProtectionAction(actor: ProtectionActor, planId: string, input: { actionType?: string; title: string; description?: string; priority?: string; dueAt?: Date | null }): Promise<{ actionId: string; sequence: number }> {
  assertManage(actor);
  const plan = await requirePlan(actor.tenantId, planId);
  if (!(ACTIVE_PLAN_STATUSES as string[]).includes(plan.status)) throw new ProtectionInputError("plan_not_editable");
  const type = input.actionType && isProtectionActionType(input.actionType) ? input.actionType : ChildSafetyProtectionActionType.CustomInternalAction;
  const title = (input.title ?? "").trim().slice(0, CUSTOM_TITLE_MAX);
  if (!title) throw new ProtectionInputError("title_required");
  const description = input.description ? input.description.trim().slice(0, CUSTOM_DESC_MAX) : null;
  const priority = input.priority && PROTECTION_PRIORITY_RANK[input.priority] !== undefined ? input.priority : PROTECTION_ACTION_CATALOG[type].defaultPriority;

  const created = await systemDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cppa:${actor.tenantId}:${planId}`}, 0))`;
    const last = await tx.childSafetyProtectionAction.findFirst({ where: { tenantId: actor.tenantId, planId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
    const sequence = (last?.sequence ?? 0) + 1;
    return tx.childSafetyProtectionAction.create({ data: { tenantId: actor.tenantId, planId, actionType: type, title, description, priority, sequence, dueAt: input.dueAt ?? null, createdBy: actor.userId }, select: { id: true, sequence: true } });
  });
  await emit(actor.tenantId, planId, created.id, ChildSafetyProtectionEventType.ActionAdded, actor.userId, null, type);
  await audit(actor.tenantId, actor.userId, CHILD_SAFETY_PROTECTION_AUDIT_EVENTS.actionChanged, created.id, { planId, change: "added", actionType: type });
  return { actionId: created.id, sequence: created.sequence };
}

// ── Action mutations (assign / due / priority — plain updates) ─────────────────
export async function assignProtectionAction(actor: ProtectionActor, actionId: string, assigneeUserId: string): Promise<void> {
  assertManage(actor);
  if (!assigneeUserId) throw new ProtectionInputError("assignee_required");
  const a = await requireAction(actor.tenantId, actionId);
  await systemDb.childSafetyProtectionAction.update({ where: { id: actionId }, data: { assignedReviewerId: assigneeUserId } });
  await emit(actor.tenantId, a.planId, actionId, ChildSafetyProtectionEventType.ActionAssigned, actor.userId, a.assignedReviewerId, assigneeUserId);
  await audit(actor.tenantId, actor.userId, CHILD_SAFETY_PROTECTION_AUDIT_EVENTS.actionChanged, actionId, { planId: a.planId, change: "assigned" });
}
export async function unassignProtectionAction(actor: ProtectionActor, actionId: string): Promise<void> {
  assertManage(actor);
  const a = await requireAction(actor.tenantId, actionId);
  if (a.assignedReviewerId === null) return;
  await systemDb.childSafetyProtectionAction.update({ where: { id: actionId }, data: { assignedReviewerId: null } });
  await emit(actor.tenantId, a.planId, actionId, ChildSafetyProtectionEventType.ActionUnassigned, actor.userId, a.assignedReviewerId, null);
  await audit(actor.tenantId, actor.userId, CHILD_SAFETY_PROTECTION_AUDIT_EVENTS.actionChanged, actionId, { planId: a.planId, change: "unassigned" });
}
export async function updateProtectionActionDueDate(actor: ProtectionActor, actionId: string, dueAt: Date | null): Promise<void> {
  assertManage(actor);
  const a = await requireAction(actor.tenantId, actionId);
  await systemDb.childSafetyProtectionAction.update({ where: { id: actionId }, data: { dueAt } });
  await emit(actor.tenantId, a.planId, actionId, ChildSafetyProtectionEventType.DueDateChanged, actor.userId, a.dueAt?.toISOString() ?? null, dueAt?.toISOString() ?? null);
  await audit(actor.tenantId, actor.userId, CHILD_SAFETY_PROTECTION_AUDIT_EVENTS.actionChanged, actionId, { planId: a.planId, change: "due_date" });
}
export async function updateProtectionActionPriority(actor: ProtectionActor, actionId: string, priority: string): Promise<void> {
  assertManage(actor);
  if (PROTECTION_PRIORITY_RANK[priority] === undefined) throw new ProtectionInputError("invalid_priority");
  const a = await requireAction(actor.tenantId, actionId);
  await systemDb.childSafetyProtectionAction.update({ where: { id: actionId }, data: { priority } });
  await emit(actor.tenantId, a.planId, actionId, ChildSafetyProtectionEventType.PriorityChanged, actor.userId, a.priority, priority);
  await audit(actor.tenantId, actor.userId, CHILD_SAFETY_PROTECTION_AUDIT_EVENTS.actionChanged, actionId, { planId: a.planId, change: "priority", to: priority });
}

// ── Action status transitions (guarded, concurrency-safe) ──────────────────────
const ACTION_STATUSES = Object.values(ChildSafetyProtectionActionStatus) as string[];
function allowedFrom(to: ChildSafetyProtectionActionStatus): string[] { return ACTION_STATUSES.filter((f) => canTransitionActionStatus(f, to)); }
const EVENT_FOR_ACTION: Record<string, ChildSafetyProtectionEventType> = { in_progress: ChildSafetyProtectionEventType.ActionStarted, blocked: ChildSafetyProtectionEventType.ActionBlocked, completed: ChildSafetyProtectionEventType.ActionCompleted, skipped: ChildSafetyProtectionEventType.ActionSkipped, reopened: ChildSafetyProtectionEventType.ActionReopened };

async function transitionAction(actor: ProtectionActor, actionId: string, to: ChildSafetyProtectionActionStatus, extra: { completionNote?: string; blockReason?: string } = {}): Promise<{ status: string }> {
  assertManage(actor);
  const a = await requireAction(actor.tenantId, actionId);
  const froms = allowedFrom(to);
  const data: Record<string, unknown> = { status: to };
  if (to === ChildSafetyProtectionActionStatus.Completed) { data.completedAt = new Date(); data.completedBy = actor.userId; if (extra.completionNote) data.completionNote = extra.completionNote.trim().slice(0, NOTE_MAX); }
  if (to === ChildSafetyProtectionActionStatus.Skipped) { data.completedAt = new Date(); data.completedBy = actor.userId; }
  if (to === ChildSafetyProtectionActionStatus.Blocked && extra.blockReason) data.blockReason = extra.blockReason.trim().slice(0, NOTE_MAX);
  if (to === ChildSafetyProtectionActionStatus.Reopened) { data.completedAt = null; data.completedBy = null; }
  // Guarded conditional update — only one concurrent transition from a valid prior state can win.
  const res = await systemDb.childSafetyProtectionAction.updateMany({ where: { id: actionId, tenantId: actor.tenantId, status: { in: froms } }, data: data as never });
  if (res.count !== 1) throw new ProtectionInputError(`invalid_transition:${a.status}->${to}`);
  await emit(actor.tenantId, a.planId, actionId, EVENT_FOR_ACTION[to]!, actor.userId, a.status, to);
  await audit(actor.tenantId, actor.userId, CHILD_SAFETY_PROTECTION_AUDIT_EVENTS.actionChanged, actionId, { planId: a.planId, change: "status", to });
  return { status: to };
}
export const startProtectionAction = (actor: ProtectionActor, actionId: string) => transitionAction(actor, actionId, ChildSafetyProtectionActionStatus.InProgress);
export const blockProtectionAction = (actor: ProtectionActor, actionId: string, blockReason?: string) => transitionAction(actor, actionId, ChildSafetyProtectionActionStatus.Blocked, { blockReason });
export const completeProtectionAction = (actor: ProtectionActor, actionId: string, completionNote?: string) => transitionAction(actor, actionId, ChildSafetyProtectionActionStatus.Completed, { completionNote });
export const skipProtectionAction = (actor: ProtectionActor, actionId: string) => transitionAction(actor, actionId, ChildSafetyProtectionActionStatus.Skipped);
export const reopenProtectionAction = (actor: ProtectionActor, actionId: string) => transitionAction(actor, actionId, ChildSafetyProtectionActionStatus.Reopened);

// ── Plan status transitions ────────────────────────────────────────────────────
async function transitionPlan(actor: ProtectionActor, planId: string, to: ChildSafetyProtectionPlanStatus, event: ChildSafetyProtectionEventType, auditEvent: string, mutate: (plan: { status: string }) => Record<string, unknown>, opts: { checkComplete?: boolean; incidentLock?: boolean } = {}): Promise<{ status: string }> {
  assertManage(actor);
  const plan = await requirePlan(actor.tenantId, planId);
  if (!canTransitionPlanStatus(plan.status, to)) throw new ProtectionInputError(`invalid_transition:${plan.status}->${to}`);
  await systemDb.$transaction(async (tx) => {
    if (opts.incidentLock) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cspp:${actor.tenantId}:${plan.incidentId}`}, 0))`;
    if (opts.checkComplete) {
      const actions = await tx.childSafetyProtectionAction.findMany({ where: { tenantId: actor.tenantId, planId }, select: { status: true } });
      if (!canCompletePlan(actions)) throw new ProtectionInputError("actions_incomplete");
    }
    if (to === ChildSafetyProtectionPlanStatus.Reopened) {
      const other = await tx.childSafetyProtectionPlan.findFirst({ where: { tenantId: actor.tenantId, incidentId: plan.incidentId, status: { in: [...ACTIVE_PLAN_STATUSES] }, id: { not: planId } }, select: { id: true } });
      if (other) throw new ProtectionInputError("active_plan_exists");
    }
    // Guarded on both the from-status AND the revision (optimistic concurrency) so no lost update.
    const res = await tx.childSafetyProtectionPlan.updateMany({ where: { id: planId, tenantId: actor.tenantId, status: plan.status, revision: plan.revision }, data: { ...mutate(plan), status: to, revision: { increment: 1 } } as never });
    if (res.count !== 1) throw new ProtectionInputError("concurrent_modification");
    // Atomic with the transition: enqueue ONLY when it lands in a Family-disclosable state (activate / reopen).
    // ONE event per atomic operation. eventVersion = the just-incremented revision (stable per transition; a
    // retry of the same transition reuses it, a new material revision produces a new one). Enqueue failure rolls
    // the whole transition back. occurredAt is not part of identity (dedupe is by revision).
    if (isMaterialFamilyProtectionPlanUpdate({ status: plan.status }, { status: to })) {
      await enqueueFamilyNotificationOutboxEventOwnerTx(tx, {
        tenantId: actor.tenantId,
        notificationType: "family_protection_plan_updated",
        source: { protectionPlanId: planId },
        eventVersion: `${to}:${plan.revision + 1}`,
        occurredAt: new Date(),
      });
    }
  });
  await emit(actor.tenantId, planId, null, event, actor.userId, plan.status, to);
  await audit(actor.tenantId, actor.userId, auditEvent, planId, { from: plan.status, to });
  return { status: to };
}
export const activateProtectionPlan = (actor: ProtectionActor, planId: string) => transitionPlan(actor, planId, ChildSafetyProtectionPlanStatus.Active, ChildSafetyProtectionEventType.PlanActivated, CHILD_SAFETY_PROTECTION_AUDIT_EVENTS.planActivated, () => ({ activatedAt: new Date() }));
export const completeProtectionPlan = (actor: ProtectionActor, planId: string, closedReason?: string) => transitionPlan(actor, planId, ChildSafetyProtectionPlanStatus.Completed, ChildSafetyProtectionEventType.PlanCompleted, CHILD_SAFETY_PROTECTION_AUDIT_EVENTS.planCompleted, () => ({ completedAt: new Date(), closedReason: closedReason ?? "resolved" }), { checkComplete: true });
export const cancelProtectionPlan = (actor: ProtectionActor, planId: string, closedReason?: string) => transitionPlan(actor, planId, ChildSafetyProtectionPlanStatus.Cancelled, ChildSafetyProtectionEventType.PlanCancelled, CHILD_SAFETY_PROTECTION_AUDIT_EVENTS.planCancelled, () => ({ closedReason: closedReason ?? "cancelled" }));
export const reopenProtectionPlan = (actor: ProtectionActor, planId: string) => transitionPlan(actor, planId, ChildSafetyProtectionPlanStatus.Reopened, ChildSafetyProtectionEventType.PlanReopened, CHILD_SAFETY_PROTECTION_AUDIT_EVENTS.planReopened, () => ({ completedAt: null, closedReason: null }), { incidentLock: true });

// ── Dashboard metrics (narrow) ─────────────────────────────────────────────────
export async function getProtectionPlanDashboard(actor: ProtectionActor, now: Date = new Date()) {
  assertView(actor);
  const tenantId = actor.tenantId;
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [activePlans, plansWithActive, openIncidents, overdueActions, blockedActions, plansCompletedToday] = await Promise.all([
    systemDb.childSafetyProtectionPlan.count({ where: { tenantId, status: ChildSafetyProtectionPlanStatus.Active } }),
    systemDb.childSafetyProtectionPlan.findMany({ where: { tenantId, status: { in: [...ACTIVE_PLAN_STATUSES] } }, select: { incidentId: true } }),
    systemDb.childSafetyIncident.findMany({ where: { tenantId, status: { in: ["open", "under_review", "waiting", "action_required", "monitoring", "reopened"] } }, select: { id: true } }),
    systemDb.childSafetyProtectionAction.count({ where: { tenantId, dueAt: { lt: now }, status: { notIn: ["completed", "skipped"] } } }),
    systemDb.childSafetyProtectionAction.count({ where: { tenantId, status: "blocked" } }),
    systemDb.childSafetyProtectionPlan.count({ where: { tenantId, status: ChildSafetyProtectionPlanStatus.Completed, completedAt: { gte: startOfDay } } }),
  ]);
  const incidentsWithActivePlan = new Set(plansWithActive.map((p) => p.incidentId));
  const incidentsWithoutActivePlan = openIncidents.filter((i) => !incidentsWithActivePlan.has(i.id)).length;
  return { incidentsWithoutActivePlan, activePlans, overdueActions, blockedActions, plansCompletedToday };
}

void riskFamilyOf;
