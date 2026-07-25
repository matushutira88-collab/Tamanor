/**
 * Child Safety Protection Plans V1 — pure domain vocabulary + deterministic policy.
 *
 * A structured, INTERNAL protection-plan layer ON TOP of the canonical ChildSafetyIncident. It lets an
 * authorized reviewer define, assign, track, complete, reopen, and audit concrete protective ACTIONS. It
 * is deliberately narrow — NOT a generic workflow/case-management engine. Everything here is deterministic
 * and content-free (no raw communication content). Recommendations are advisory only and never execute
 * anything autonomously.
 */
import { Role } from "./tenant";
import { Permission, can } from "./permissions";
import { canViewChildSafetyReview, canManageChildSafetyReview } from "./child-safety-review";
import { ChildSafetyRiskFamily } from "./child-safety-orchestration";

// ── Permissions — Owner / Administrator / Safety Reviewer only ────────────────
export function canViewChildSafetyProtectionPlan(role: Role): boolean {
  return can(role, Permission.ChildSafetyProtectionPlanView) || canViewChildSafetyReview(role);
}
export function canManageChildSafetyProtectionPlan(role: Role): boolean {
  return can(role, Permission.ChildSafetyProtectionPlanManage) || canManageChildSafetyReview(role);
}

// ── Priorities (bounded, ranked) ──────────────────────────────────────────────
export enum ChildSafetyProtectionPriority { Low = "low", Normal = "normal", High = "high", Urgent = "urgent" }
export const PROTECTION_PRIORITY_RANK: Record<string, number> = { low: 0, normal: 1, high: 2, urgent: 3 };
export function higherPriority(a: string, b: string): string {
  return (PROTECTION_PRIORITY_RANK[a] ?? 0) >= (PROTECTION_PRIORITY_RANK[b] ?? 0) ? a : b;
}

// ── Plan + action lifecycle ───────────────────────────────────────────────────
export enum ChildSafetyProtectionPlanStatus { Draft = "draft", Active = "active", Completed = "completed", Cancelled = "cancelled", Reopened = "reopened" }
export enum ChildSafetyProtectionActionStatus { Pending = "pending", InProgress = "in_progress", Blocked = "blocked", Completed = "completed", Skipped = "skipped", Reopened = "reopened" }

/** The single active plan status (an incident may have at most one plan in this state). */
export const ACTIVE_PLAN_STATUSES: readonly string[] = [ChildSafetyProtectionPlanStatus.Draft, ChildSafetyProtectionPlanStatus.Active, ChildSafetyProtectionPlanStatus.Reopened];
export const TERMINAL_PLAN_STATUSES: readonly string[] = [ChildSafetyProtectionPlanStatus.Completed, ChildSafetyProtectionPlanStatus.Cancelled];
/** Action statuses considered "resolved" for plan-completion gating + progress. */
export const RESOLVED_ACTION_STATUSES: readonly string[] = [ChildSafetyProtectionActionStatus.Completed, ChildSafetyProtectionActionStatus.Skipped];

/** Plan lifecycle: draft→active; active→completed/cancelled; completed/cancelled→reopened(→active). Same→same fails. */
export function canTransitionPlanStatus(from: string, to: ChildSafetyProtectionPlanStatus): boolean {
  if (from === to) return false;
  switch (to) {
    case ChildSafetyProtectionPlanStatus.Active: return from === ChildSafetyProtectionPlanStatus.Draft || from === ChildSafetyProtectionPlanStatus.Reopened;
    case ChildSafetyProtectionPlanStatus.Completed: return from === ChildSafetyProtectionPlanStatus.Active || from === ChildSafetyProtectionPlanStatus.Reopened;
    case ChildSafetyProtectionPlanStatus.Cancelled: return from === ChildSafetyProtectionPlanStatus.Draft || from === ChildSafetyProtectionPlanStatus.Active || from === ChildSafetyProtectionPlanStatus.Reopened;
    case ChildSafetyProtectionPlanStatus.Reopened: return from === ChildSafetyProtectionPlanStatus.Completed || from === ChildSafetyProtectionPlanStatus.Cancelled;
    default: return false;
  }
}

/** Action lifecycle. pending→in_progress; {pending,in_progress}→blocked; {pending,in_progress,blocked}→{completed,skipped}; {completed,skipped}→reopened. */
export function canTransitionActionStatus(from: string, to: ChildSafetyProtectionActionStatus): boolean {
  if (from === to) return false;
  const live = [ChildSafetyProtectionActionStatus.Pending, ChildSafetyProtectionActionStatus.InProgress, ChildSafetyProtectionActionStatus.Blocked, ChildSafetyProtectionActionStatus.Reopened] as string[];
  switch (to) {
    case ChildSafetyProtectionActionStatus.InProgress: return from === ChildSafetyProtectionActionStatus.Pending || from === ChildSafetyProtectionActionStatus.Blocked || from === ChildSafetyProtectionActionStatus.Reopened;
    case ChildSafetyProtectionActionStatus.Blocked: return from === ChildSafetyProtectionActionStatus.Pending || from === ChildSafetyProtectionActionStatus.InProgress || from === ChildSafetyProtectionActionStatus.Reopened;
    case ChildSafetyProtectionActionStatus.Completed:
    case ChildSafetyProtectionActionStatus.Skipped: return live.includes(from);
    case ChildSafetyProtectionActionStatus.Reopened: return from === ChildSafetyProtectionActionStatus.Completed || from === ChildSafetyProtectionActionStatus.Skipped;
    default: return false;
  }
}

// ── Append-only event types ───────────────────────────────────────────────────
export enum ChildSafetyProtectionEventType {
  PlanCreated = "plan_created", PlanActivated = "plan_activated", PlanCompleted = "plan_completed",
  PlanCancelled = "plan_cancelled", PlanReopened = "plan_reopened",
  ActionAdded = "action_added", ActionAssigned = "action_assigned", ActionUnassigned = "action_unassigned",
  ActionStarted = "action_started", ActionBlocked = "action_blocked", ActionCompleted = "action_completed",
  ActionSkipped = "action_skipped", ActionReopened = "action_reopened",
  DueDateChanged = "due_date_changed", PriorityChanged = "priority_changed",
}

/** Bounded, content-free audit event names (reuse the shared audit log). */
export const CHILD_SAFETY_PROTECTION_AUDIT_EVENTS = {
  planCreated: "child_safety.protection_plan.created", planActivated: "child_safety.protection_plan.activated",
  planCompleted: "child_safety.protection_plan.completed", planCancelled: "child_safety.protection_plan.cancelled",
  planReopened: "child_safety.protection_plan.reopened", actionChanged: "child_safety.protection_action.changed",
} as const;

// ── Action catalog (bounded, typed, NOT user-extensible in V1) ────────────────
export enum ChildSafetyProtectionActionType {
  ReviewAccountSafety = "review_account_safety",
  PreserveEvidence = "preserve_evidence",
  VerifyGuardianContact = "verify_guardian_contact",
  NotifyAuthorizedGuardian = "notify_authorized_guardian",
  RestrictInteraction = "restrict_interaction",
  RecommendBlocking = "recommend_blocking",
  RecommendReporting = "recommend_reporting",
  EscalateInternalSafety = "escalate_internal_safety",
  LegalReview = "legal_review",
  WelfareCheck = "welfare_check",
  FollowUpReview = "follow_up_review",
  CustomInternalAction = "custom_internal_action",
}
export const CHILD_SAFETY_PROTECTION_ACTION_TYPES: readonly ChildSafetyProtectionActionType[] = Object.values(ChildSafetyProtectionActionType);
export function isProtectionActionType(v: string): v is ChildSafetyProtectionActionType {
  return (CHILD_SAFETY_PROTECTION_ACTION_TYPES as readonly string[]).includes(v);
}

export interface ProtectionActionTemplate {
  type: ChildSafetyProtectionActionType;
  defaultPriority: ChildSafetyProtectionPriority;
  guardianRelevant: boolean;
  evidenceRecommended: boolean;
  escalationRecommended: boolean;
  /** i18n keys (text lives in the web dictionary; core stays content-free). */
  titleKey: string;
  descriptionKey: string;
}
const T = (type: ChildSafetyProtectionActionType, defaultPriority: ChildSafetyProtectionPriority, opts: { g?: boolean; e?: boolean; x?: boolean } = {}): ProtectionActionTemplate =>
  ({ type, defaultPriority, guardianRelevant: !!opts.g, evidenceRecommended: !!opts.e, escalationRecommended: !!opts.x, titleKey: `pp.action.${type}.title`, descriptionKey: `pp.action.${type}.desc` });

/** The bounded internal catalog. Templates are RECOMMENDATIONS only — never legal/medical advice, never autonomous. */
export const PROTECTION_ACTION_CATALOG: Record<ChildSafetyProtectionActionType, ProtectionActionTemplate> = {
  [ChildSafetyProtectionActionType.ReviewAccountSafety]: T(ChildSafetyProtectionActionType.ReviewAccountSafety, ChildSafetyProtectionPriority.High),
  [ChildSafetyProtectionActionType.PreserveEvidence]: T(ChildSafetyProtectionActionType.PreserveEvidence, ChildSafetyProtectionPriority.High, { e: true }),
  [ChildSafetyProtectionActionType.VerifyGuardianContact]: T(ChildSafetyProtectionActionType.VerifyGuardianContact, ChildSafetyProtectionPriority.High, { g: true }),
  [ChildSafetyProtectionActionType.NotifyAuthorizedGuardian]: T(ChildSafetyProtectionActionType.NotifyAuthorizedGuardian, ChildSafetyProtectionPriority.High, { g: true }),
  [ChildSafetyProtectionActionType.RestrictInteraction]: T(ChildSafetyProtectionActionType.RestrictInteraction, ChildSafetyProtectionPriority.High),
  [ChildSafetyProtectionActionType.RecommendBlocking]: T(ChildSafetyProtectionActionType.RecommendBlocking, ChildSafetyProtectionPriority.Normal),
  [ChildSafetyProtectionActionType.RecommendReporting]: T(ChildSafetyProtectionActionType.RecommendReporting, ChildSafetyProtectionPriority.High, { x: true }),
  [ChildSafetyProtectionActionType.EscalateInternalSafety]: T(ChildSafetyProtectionActionType.EscalateInternalSafety, ChildSafetyProtectionPriority.Urgent, { x: true }),
  [ChildSafetyProtectionActionType.LegalReview]: T(ChildSafetyProtectionActionType.LegalReview, ChildSafetyProtectionPriority.High, { x: true }),
  [ChildSafetyProtectionActionType.WelfareCheck]: T(ChildSafetyProtectionActionType.WelfareCheck, ChildSafetyProtectionPriority.Urgent),
  [ChildSafetyProtectionActionType.FollowUpReview]: T(ChildSafetyProtectionActionType.FollowUpReview, ChildSafetyProtectionPriority.Normal),
  [ChildSafetyProtectionActionType.CustomInternalAction]: T(ChildSafetyProtectionActionType.CustomInternalAction, ChildSafetyProtectionPriority.Normal),
};

// ── Deterministic recommendation engine ───────────────────────────────────────
export interface RecommendationInput {
  riskFamily: string; severity: string; urgency: string; escalationState: string;
  guardianDelivered: boolean; evidenceCount: number; incidentStatus: string;
}
export interface RecommendedAction { type: ChildSafetyProtectionActionType; priority: ChildSafetyProtectionPriority; dueWindowHours: number; reasonCode: string; }
export interface PlanRecommendation { priority: ChildSafetyProtectionPriority; actions: RecommendedAction[]; explanationCodes: string[]; }

const SEV_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const URG_RANK: Record<string, number> = { routine: 0, elevated: 1, immediate: 2 };
const dueFor = (p: ChildSafetyProtectionPriority): number => ({ urgent: 4, high: 24, normal: 72, low: 168 }[p]);

/** Per-risk-family base action set (deterministic). Content-free. */
const FAMILY_ACTIONS: Record<string, ChildSafetyProtectionActionType[]> = {
  [ChildSafetyRiskFamily.Sexual]: [ChildSafetyProtectionActionType.PreserveEvidence, ChildSafetyProtectionActionType.VerifyGuardianContact, ChildSafetyProtectionActionType.NotifyAuthorizedGuardian, ChildSafetyProtectionActionType.RestrictInteraction, ChildSafetyProtectionActionType.RecommendReporting, ChildSafetyProtectionActionType.WelfareCheck],
  [ChildSafetyRiskFamily.Grooming]: [ChildSafetyProtectionActionType.PreserveEvidence, ChildSafetyProtectionActionType.VerifyGuardianContact, ChildSafetyProtectionActionType.NotifyAuthorizedGuardian, ChildSafetyProtectionActionType.RestrictInteraction, ChildSafetyProtectionActionType.RecommendReporting],
  [ChildSafetyRiskFamily.Violence]: [ChildSafetyProtectionActionType.WelfareCheck, ChildSafetyProtectionActionType.NotifyAuthorizedGuardian, ChildSafetyProtectionActionType.PreserveEvidence],
  [ChildSafetyRiskFamily.Coercion]: [ChildSafetyProtectionActionType.VerifyGuardianContact, ChildSafetyProtectionActionType.RestrictInteraction, ChildSafetyProtectionActionType.PreserveEvidence],
  [ChildSafetyRiskFamily.Scam]: [ChildSafetyProtectionActionType.RecommendBlocking, ChildSafetyProtectionActionType.VerifyGuardianContact],
  [ChildSafetyRiskFamily.Bullying]: [ChildSafetyProtectionActionType.RestrictInteraction, ChildSafetyProtectionActionType.RecommendBlocking, ChildSafetyProtectionActionType.FollowUpReview],
  [ChildSafetyRiskFamily.Identity]: [ChildSafetyProtectionActionType.RecommendBlocking, ChildSafetyProtectionActionType.VerifyGuardianContact],
};

/**
 * Produce a deterministic recommended plan from canonical incident state. No LLM, no external call, no
 * clock. The SAME canonical input always produces the SAME recommendation. Advisory only.
 */
export function recommendProtectionPlan(input: RecommendationInput): PlanRecommendation {
  const sev = SEV_RANK[input.severity] ?? 0;
  const urg = URG_RANK[input.urgency] ?? 0;
  const isUrgent = sev >= 3 || urg >= 2;
  const isElevated = sev >= 2 || urg >= 1;
  const explain: string[] = [];

  // Ordered, de-duplicated action set: always-on baseline + family set + state-driven additions.
  const ordered: ChildSafetyProtectionActionType[] = [ChildSafetyProtectionActionType.ReviewAccountSafety];
  for (const a of (FAMILY_ACTIONS[input.riskFamily] ?? [])) ordered.push(a);

  if (input.evidenceCount === 0) { ordered.push(ChildSafetyProtectionActionType.PreserveEvidence); explain.push("no_evidence_captured"); }
  if (!input.guardianDelivered) { ordered.push(ChildSafetyProtectionActionType.NotifyAuthorizedGuardian); explain.push("guardian_not_notified"); }
  else explain.push("guardian_notified");
  if (isUrgent) { ordered.push(ChildSafetyProtectionActionType.EscalateInternalSafety, ChildSafetyProtectionActionType.LegalReview); explain.push("urgent_risk"); }
  else if (isElevated) explain.push("elevated_risk");
  if (input.escalationState === "escalated") explain.push("already_escalated");
  ordered.push(ChildSafetyProtectionActionType.FollowUpReview);

  const seen = new Set<string>();
  const planPriority = isUrgent ? ChildSafetyProtectionPriority.Urgent : isElevated ? ChildSafetyProtectionPriority.High : ChildSafetyProtectionPriority.Normal;
  const actions: RecommendedAction[] = [];
  for (const type of ordered) {
    if (seen.has(type)) continue; seen.add(type);
    const tmpl = PROTECTION_ACTION_CATALOG[type];
    // Escalate priority for urgent incidents; never lower a template's default.
    const priority = isUrgent ? higherPriority(tmpl.defaultPriority, ChildSafetyProtectionPriority.High) as ChildSafetyProtectionPriority : tmpl.defaultPriority;
    actions.push({ type, priority, dueWindowHours: dueFor(priority), reasonCode: reasonFor(type, input) });
  }
  return { priority: planPriority, actions, explanationCodes: dedupe(explain) };
}
function dedupe(a: string[]): string[] { return Array.from(new Set(a)); }
function reasonFor(type: ChildSafetyProtectionActionType, input: RecommendationInput): string {
  switch (type) {
    case ChildSafetyProtectionActionType.PreserveEvidence: return input.evidenceCount === 0 ? "no_evidence_captured" : "preserve_existing_evidence";
    case ChildSafetyProtectionActionType.NotifyAuthorizedGuardian: return input.guardianDelivered ? "guardian_already_notified" : "guardian_not_notified";
    case ChildSafetyProtectionActionType.EscalateInternalSafety: return input.escalationState === "escalated" ? "already_escalated" : "urgent_risk";
    default: return `family_${input.riskFamily}`;
  }
}

// ── Progress calculation ──────────────────────────────────────────────────────
export interface PlanProgress { total: number; pending: number; inProgress: number; blocked: number; completed: number; skipped: number; overdue: number; completionPct: number; }

/**
 * Progress over a plan's actions. `completionPct = round(100 * completed / (total − skipped))` — skipped
 * actions are EXCLUDED from the denominator (they are deliberately not-applicable), so they are never
 * counted as completed. An all-skipped or empty plan is 100% (nothing left to do). `overdue` = a due,
 * unresolved action past `now`.
 */
export function computePlanProgress(actions: Array<{ status: string; dueAt: Date | string | null }>, now: Date = new Date()): PlanProgress {
  const nowMs = now.getTime();
  const p: PlanProgress = { total: actions.length, pending: 0, inProgress: 0, blocked: 0, completed: 0, skipped: 0, overdue: 0, completionPct: 0 };
  for (const a of actions) {
    switch (a.status) {
      case "pending": p.pending++; break;
      case "in_progress": p.inProgress++; break;
      case "blocked": p.blocked++; break;
      case "completed": p.completed++; break;
      case "skipped": p.skipped++; break;
      case "reopened": p.pending++; break; // reopened counts as unresolved/pending for progress
    }
    if (a.dueAt && !(RESOLVED_ACTION_STATUSES as string[]).includes(a.status)) {
      const due = typeof a.dueAt === "string" ? Date.parse(a.dueAt) : a.dueAt.getTime();
      if (!Number.isNaN(due) && due < nowMs) p.overdue++;
    }
  }
  const base = p.total - p.skipped;
  p.completionPct = base <= 0 ? 100 : Math.round((p.completed / base) * 100);
  return p;
}

/** A plan may be completed only when EVERY action is resolved (completed or explicitly skipped). Fail-closed. */
export function canCompletePlan(actions: Array<{ status: string }>): boolean {
  return actions.length > 0 && actions.every((a) => (RESOLVED_ACTION_STATUSES as string[]).includes(a.status));
}
