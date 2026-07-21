import { Prisma } from "@prisma/client";
import {
  Permission, Role, can, CYBERBULLYING_AUDIT_EVENTS, IncidentCategory, IncidentLifecycleStatus, IncidentTimelineEventType,
  CaseRiskLevel, CaseTaskStatus, SlaType, SlaState, SLA_POLICY,
  firstReviewSlaState, criticalRiskSlaState, taskSlaState, followUpSlaState,
  notificationTypeForSlaTransition, NotificationEntityType, RecipientPurpose,
  type IncidentActorContext,
} from "@guardora/core";
import { withTenant } from "./repositories";
import { resolveIncidentRecipientsTx, createNotificationTx } from "./cyberbullying-notifications";

/**
 * C10 — SLA calculation, evaluator, and read models. SLA state is DERIVED from UTC
 * timestamps (never an authoritative stored user status). The evaluator creates
 * deduped notifications only on a state TRANSITION (idempotent across runs) and
 * NEVER mutates the incident lifecycle, risk level, tasks, or assignments. Bounded
 * batch + cursor. A `now` is injectable for deterministic tests.
 */

const DOMAIN = IncidentCategory.Cyberbullying;
const ACTIVE = [IncidentLifecycleStatus.Open, IncidentLifecycleStatus.UnderReview, IncidentLifecycleStatus.Acknowledged, IncidentLifecycleStatus.Confirmed, IncidentLifecycleStatus.ActionRequired] as string[];
const OPEN_TASKS = [CaseTaskStatus.Todo, CaseTaskStatus.InProgress] as string[];
const REVIEW_EVENTS = [IncidentTimelineEventType.ReviewStarted, IncidentTimelineEventType.Acknowledged] as string[];
const HOUR = 3_600_000;

export class SlaAccessDenied extends Error { constructor() { super("cyberbullying sla: access denied"); this.name = "SlaAccessDenied"; } }
function assertReview(actor: IncidentActorContext): void { if (!can(actor.role as Role, Permission.CyberbullyingReview)) throw new SlaAccessDenied(); }

/** Incident scope fragment: owner/admin tenant-wide; reviewer participant/assignee. */
function incidentScopeWhere(actor: IncidentActorContext): Prisma.IncidentWhereInput {
  const base: Prisma.IncidentWhereInput = { tenantId: actor.tenantId, domain: DOMAIN };
  const role = actor.role as Role;
  if (role === Role.Owner || role === Role.Admin) return base;
  return { ...base, OR: [{ participants: { some: { userId: actor.userId } } }, { cyberbullyingDetail: { is: { assignedReviewerUserId: actor.userId } } }] };
}

// --- SLA overview (aggregate counts, bounded) ------------------------------

export interface SlaOverview {
  firstReviewOverdue: number; firstReviewDueSoon: number;
  criticalOverdue: number; criticalDueSoon: number;
  taskOverdue: number; taskDueSoon: number;
  followUpOverdue: number; followUpDueSoon: number;
  activeEscalations: number;
  nextDeadline: string | null; oldestOverdue: string | null;
}

export async function getCyberbullyingSlaOverview(actor: IncidentActorContext, now: Date = new Date()): Promise<SlaOverview> {
  assertReview(actor);
  const scope = incidentScopeWhere(actor);
  const frOverdue = new Date(now.getTime() - SLA_POLICY.incidentFirstReview.overdueHours * HOUR);
  const frDueSoon = new Date(now.getTime() - SLA_POLICY.incidentFirstReview.dueSoonHours * HOUR);
  const taskSoon = new Date(now.getTime() + SLA_POLICY.taskDue.dueSoonHours * HOUR);
  const fuSoon = new Date(now.getTime() + SLA_POLICY.followUpDue.dueSoonHours * HOUR);
  const noReview: Prisma.IncidentWhereInput = { timelineEvents: { none: { eventType: { in: REVIEW_EVENTS } } } };

  return withTenant(actor.tenantId, async (db) => {
    const [firstReviewOverdue, firstReviewDueSoon, taskOverdue, taskDueSoon, followUpOverdue, followUpDueSoon, activeEscalations, criticalRows, nearestTask, nearestFollowUp, oldestTask] = await Promise.all([
      db.incident.count({ where: { AND: [scope], status: { in: ACTIVE }, createdAt: { lte: frOverdue }, ...noReview } }),
      db.incident.count({ where: { AND: [scope], status: { in: ACTIVE }, createdAt: { lte: frDueSoon, gt: frOverdue }, ...noReview } }),
      db.cyberbullyingCaseTask.count({ where: { tenantId: actor.tenantId, incident: { is: scope }, status: { in: OPEN_TASKS }, dueDate: { lte: now } } }),
      db.cyberbullyingCaseTask.count({ where: { tenantId: actor.tenantId, incident: { is: scope }, status: { in: OPEN_TASKS }, dueDate: { gt: now, lte: taskSoon } } }),
      db.cyberbullyingProtectionPlan.count({ where: { tenantId: actor.tenantId, incident: { is: scope }, nextReviewAt: { lte: now } } }),
      db.cyberbullyingProtectionPlan.count({ where: { tenantId: actor.tenantId, incident: { is: scope }, nextReviewAt: { gt: now, lte: fuSoon } } }),
      db.cyberbullyingEscalation.count({ where: { tenantId: actor.tenantId, status: "active", incident: { is: scope } } }),
      // Critical-risk SLA needs the responded-since check ⇒ small bounded fetch.
      db.cyberbullyingProtectionPlan.findMany({ where: { tenantId: actor.tenantId, incident: { is: scope }, riskLevel: CaseRiskLevel.Critical, criticalRiskSetAt: { not: null } }, take: 200, select: { criticalRiskSetAt: true, incident: { select: { timelineEvents: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } } } } }),
      db.cyberbullyingCaseTask.findFirst({ where: { tenantId: actor.tenantId, incident: { is: scope }, status: { in: OPEN_TASKS }, dueDate: { gt: now } }, orderBy: { dueDate: "asc" }, select: { dueDate: true } }),
      db.cyberbullyingProtectionPlan.findFirst({ where: { tenantId: actor.tenantId, incident: { is: scope }, nextReviewAt: { gt: now } }, orderBy: { nextReviewAt: "asc" }, select: { nextReviewAt: true } }),
      db.cyberbullyingCaseTask.findFirst({ where: { tenantId: actor.tenantId, incident: { is: scope }, status: { in: OPEN_TASKS }, dueDate: { lte: now } }, orderBy: { dueDate: "asc" }, select: { dueDate: true } }),
    ]);

    let criticalOverdue = 0, criticalDueSoon = 0;
    for (const p of criticalRows) {
      const state = criticalRiskSlaState(p.criticalRiskSetAt, p.incident.timelineEvents[0]?.createdAt ?? null, now);
      if (state === SlaState.Overdue) criticalOverdue++;
      else if (state === SlaState.DueSoon) criticalDueSoon++;
    }
    const deadlines = [nearestTask?.dueDate, nearestFollowUp?.nextReviewAt].filter(Boolean) as Date[];
    const nextDeadline = deadlines.length ? new Date(Math.min(...deadlines.map((d) => d.getTime()))) : null;

    return {
      firstReviewOverdue, firstReviewDueSoon, criticalOverdue, criticalDueSoon,
      taskOverdue, taskDueSoon, followUpOverdue, followUpDueSoon, activeEscalations,
      nextDeadline: nextDeadline?.toISOString() ?? null, oldestOverdue: oldestTask?.dueDate?.toISOString() ?? null,
    };
  });
}

// --- Per-incident SLA view -------------------------------------------------

export interface IncidentSlaView {
  firstReview: string; // SlaState
  criticalRisk: string; // SlaState (not_applicable unless risk=critical)
  taskOverdue: number; taskDueSoon: number; nearestTaskDue: string | null;
  followUp: string; nextReviewAt: string | null;
  hasActiveEscalation: boolean;
}

export async function getIncidentSlaView(actor: IncidentActorContext, incidentId: string, now: Date = new Date()): Promise<IncidentSlaView | null> {
  assertReview(actor);
  const scope = incidentScopeWhere(actor);
  return withTenant(actor.tenantId, async (db) => {
    const inc = await db.incident.findFirst({
      where: { AND: [scope], id: incidentId },
      select: {
        createdAt: true,
        caseProtectionPlan: { select: { riskLevel: true, criticalRiskSetAt: true, nextReviewAt: true } },
        timelineEvents: { where: { eventType: { in: REVIEW_EVENTS } }, orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true } },
        caseTasks: { where: { status: { in: OPEN_TASKS }, dueDate: { not: null } }, select: { dueDate: true } },
        escalations: { where: { status: "active" }, select: { id: true }, take: 1 },
      },
    });
    if (!inc) return null;

    const plan = inc.caseProtectionPlan;
    let criticalRisk: SlaState = SlaState.NotApplicable;
    if (plan?.riskLevel === CaseRiskLevel.Critical && plan.criticalRiskSetAt) {
      const responded = await db.incidentTimelineEvent.findFirst({ where: { incidentId, tenantId: actor.tenantId, createdAt: { gt: plan.criticalRiskSetAt } }, orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true } });
      criticalRisk = criticalRiskSlaState(plan.criticalRiskSetAt, responded?.createdAt ?? null, now);
    }
    let taskOverdue = 0, taskDueSoon = 0; let nearest: Date | null = null;
    for (const tk of inc.caseTasks) {
      const s = taskSlaState(tk.dueDate, false, now);
      if (s === SlaState.Overdue) taskOverdue++; else if (s === SlaState.DueSoon) taskDueSoon++;
      if (tk.dueDate && tk.dueDate.getTime() > now.getTime() && (!nearest || tk.dueDate < nearest)) nearest = tk.dueDate;
    }
    return {
      firstReview: firstReviewSlaState(inc.createdAt, inc.timelineEvents[0]?.createdAt ?? null, now),
      criticalRisk,
      taskOverdue, taskDueSoon, nearestTaskDue: nearest?.toISOString() ?? null,
      followUp: followUpSlaState(plan?.nextReviewAt ?? null, now),
      nextReviewAt: plan?.nextReviewAt?.toISOString() ?? null,
      hasActiveEscalation: inc.escalations.length > 0,
    };
  });
}

// --- Evaluator (system; bounded batch + cursor; idempotent) ----------------

export interface SlaEvalResult { evaluated: number; notified: number; transitions: number; nextCursor: string | null }

/**
 * Evaluate deadline SLAs (task + follow-up) for a tenant and raise deduped
 * notifications ONLY on a state transition (a repeated run is a no-op). Emits a
 * timeline SLA event + audit ONLY when a notification is newly created. NEVER
 * changes any domain state. Bounded batch keyed by incident id cursor.
 */
export async function evaluateCyberbullyingSla(tenantId: string, opts: { now?: Date; limit?: number; cursor?: string } = {}): Promise<SlaEvalResult> {
  const now = opts.now ?? new Date();
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  return withTenant(tenantId, async (db) => {
    const incidents = await db.incident.findMany({
      where: { tenantId, domain: DOMAIN, status: { in: ACTIVE }, ...(opts.cursor ? { id: { gt: opts.cursor } } : {}) },
      orderBy: { id: "asc" }, take: limit,
      select: { id: true, caseProtectionPlan: { select: { nextReviewAt: true } }, caseTasks: { where: { status: { in: OPEN_TASKS }, dueDate: { not: null } }, select: { id: true, dueDate: true, assigneeUserId: true } } },
    });
    let notified = 0, transitions = 0;

    const raise = async (incidentId: string, sla: SlaType, state: SlaState, entityType: NotificationEntityType, entityId: string, dueEpoch: number, purpose: RecipientPurpose, targetUserId: string | null) => {
      const type = notificationTypeForSlaTransition(sla, state);
      if (!type) return;
      const disc = `${state}:${dueEpoch}`; // state + due epoch ⇒ a changed due date is a new scope
      const recipients = await resolveIncidentRecipientsTx(db, tenantId, incidentId, purpose, { targetUserId, isOverdue: state === SlaState.Overdue });
      let anyNew = false;
      for (const r of recipients) if (await createNotificationTx(db, tenantId, null, r, { type, entityType, entityId, incidentId, discriminator: disc, metadata: { slaState: state } })) { anyNew = true; notified++; }
      if (anyNew) {
        transitions++;
        await db.incidentTimelineEvent.create({ data: { tenantId, incidentId, eventType: state === SlaState.Overdue ? IncidentTimelineEventType.SlaOverdueDetected : IncidentTimelineEventType.SlaDueSoonDetected, actorUserId: null, reason: `${sla}:${entityId}` } });
        await db.auditLog.create({ data: { tenantId, event: CYBERBULLYING_AUDIT_EVENTS.slaStateTransition, actorKind: "system", actorUserId: null, targetType: "incident", targetId: incidentId, metadata: { slaType: sla, newState: state } as never } });
      }
    };

    for (const inc of incidents) {
      for (const tk of inc.caseTasks) {
        await raise(inc.id, SlaType.TaskDue, taskSlaState(tk.dueDate, false, now), NotificationEntityType.CaseTask, tk.id, tk.dueDate!.getTime(), taskSlaState(tk.dueDate, false, now) === SlaState.Overdue ? RecipientPurpose.TaskOverdue : RecipientPurpose.TaskDueSoon, tk.assigneeUserId ?? null);
      }
      const nra = inc.caseProtectionPlan?.nextReviewAt ?? null;
      if (nra) await raise(inc.id, SlaType.FollowUpDue, followUpSlaState(nra, now), NotificationEntityType.FollowUp, inc.id, nra.getTime(), RecipientPurpose.FollowUp, null);
    }
    const nextCursor = incidents.length === limit ? incidents[incidents.length - 1]!.id : null;
    return { evaluated: incidents.length, notified, transitions, nextCursor };
  });
}
