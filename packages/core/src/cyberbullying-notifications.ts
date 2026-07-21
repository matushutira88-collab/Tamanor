/**
 * Cyberbullying Protection — C10 Notifications, Escalation & SLA (domain).
 *
 * PURE + crypto-free (client-safe via the `@guardora/core/cyberbullying-notifications`
 * subpath): notification/severity/SLA/escalation vocabulary, the CENTRALIZED SLA
 * policy, the pure deterministic SLA-state calculators (an injected `now`), the
 * deterministic deduplication-key builder, and the escalation reason rules. No IO.
 *
 * Boundaries (C10 §2): a Notification is an internal in-app message. An SLA state is
 * a DERIVED time status. An Escalation is an explicit human step. NONE of these ever
 * mutate the incident lifecycle, the manual risk level, tasks, or assignments.
 */

// --- Notifications ----------------------------------------------------------

export enum CyberbullyingNotificationType {
  IncidentAssigned = "incident_assigned",
  IncidentReassigned = "incident_reassigned",
  IncidentUnassigned = "incident_unassigned",
  CaseTaskAssigned = "case_task_assigned",
  TaskDueSoon = "task_due_soon",
  TaskOverdue = "task_overdue",
  FollowUpDueSoon = "follow_up_due_soon",
  FollowUpOverdue = "follow_up_overdue",
  CriticalRiskSet = "critical_risk_set",
  IncidentEscalated = "incident_escalated",
  EscalationResolved = "escalation_resolved",
  IncidentReopened = "incident_reopened",
  EvidenceScanPendingLong = "evidence_scan_pending_long",
}
export const ALL_NOTIFICATION_TYPES: readonly CyberbullyingNotificationType[] = Object.values(CyberbullyingNotificationType);
export function isNotificationType(x: unknown): x is CyberbullyingNotificationType {
  return typeof x === "string" && (ALL_NOTIFICATION_TYPES as readonly string[]).includes(x);
}

export enum CyberbullyingNotificationSeverity {
  Info = "info",
  Attention = "attention",
  Urgent = "urgent",
}

/** Default severity per type (a safe type→severity mapping; no free text). */
export const NOTIFICATION_SEVERITY: Record<CyberbullyingNotificationType, CyberbullyingNotificationSeverity> = {
  [CyberbullyingNotificationType.IncidentAssigned]: CyberbullyingNotificationSeverity.Attention,
  [CyberbullyingNotificationType.IncidentReassigned]: CyberbullyingNotificationSeverity.Attention,
  [CyberbullyingNotificationType.IncidentUnassigned]: CyberbullyingNotificationSeverity.Info,
  [CyberbullyingNotificationType.CaseTaskAssigned]: CyberbullyingNotificationSeverity.Attention,
  [CyberbullyingNotificationType.TaskDueSoon]: CyberbullyingNotificationSeverity.Attention,
  [CyberbullyingNotificationType.TaskOverdue]: CyberbullyingNotificationSeverity.Urgent,
  [CyberbullyingNotificationType.FollowUpDueSoon]: CyberbullyingNotificationSeverity.Attention,
  [CyberbullyingNotificationType.FollowUpOverdue]: CyberbullyingNotificationSeverity.Urgent,
  [CyberbullyingNotificationType.CriticalRiskSet]: CyberbullyingNotificationSeverity.Urgent,
  [CyberbullyingNotificationType.IncidentEscalated]: CyberbullyingNotificationSeverity.Urgent,
  [CyberbullyingNotificationType.EscalationResolved]: CyberbullyingNotificationSeverity.Info,
  [CyberbullyingNotificationType.IncidentReopened]: CyberbullyingNotificationSeverity.Attention,
  [CyberbullyingNotificationType.EvidenceScanPendingLong]: CyberbullyingNotificationSeverity.Attention,
};

/** Entity a notification points at (drives the safe CTA target). */
export enum NotificationEntityType {
  Incident = "incident",
  CaseTask = "case_task",
  FollowUp = "follow_up",
  Escalation = "escalation",
  Evidence = "evidence",
}

/**
 * Deterministic dedup key. Includes a `discriminator` (e.g. a due-timestamp epoch or
 * transition version) so a NEW relevant state creates a NEW notification while a
 * repeated evaluation of the SAME state does not. Never includes user text. The
 * recipient is a SEPARATE column in the unique index — this key is recipient-agnostic.
 */
export function notificationDedupKey(type: CyberbullyingNotificationType, entityType: NotificationEntityType, entityId: string, discriminator: string | number = ""): string {
  return `${type}:${entityType}:${entityId}:${discriminator}`;
}

// --- SLA policy (CENTRALIZED — never inline these numbers elsewhere) ---------

export const SLA_POLICY = {
  incidentFirstReview: { dueSoonHours: 12, overdueHours: 24 },
  criticalRiskResponse: { dueSoonHours: 1, overdueHours: 2 },
  taskDue: { dueSoonHours: 24 },
  followUpDue: { dueSoonHours: 24 },
  evidenceScanPendingLongHours: 24,
} as const;

export enum SlaType {
  IncidentFirstReview = "incident_first_review",
  CriticalRiskResponse = "critical_risk_response",
  TaskDue = "task_due",
  FollowUpDue = "follow_up_due",
}

export enum SlaState {
  NotApplicable = "not_applicable",
  OnTrack = "on_track",
  DueSoon = "due_soon",
  Overdue = "overdue",
  Satisfied = "satisfied",
}

const HOUR = 3_600_000;

/** Elapsed-since-start SLA (first review / critical response): satisfied once acted on. */
function elapsedSla(startAt: Date | null, satisfiedAt: Date | null, now: Date, dueSoonHours: number, overdueHours: number): SlaState {
  if (!startAt) return SlaState.NotApplicable;
  if (satisfiedAt && satisfiedAt.getTime() >= startAt.getTime()) return SlaState.Satisfied;
  const elapsedH = (now.getTime() - startAt.getTime()) / HOUR;
  if (elapsedH >= overdueHours) return SlaState.Overdue;
  if (elapsedH >= dueSoonHours) return SlaState.DueSoon;
  return SlaState.OnTrack;
}

/** Incident first-review SLA: created → first Start review / Acknowledge (C5). */
export function firstReviewSlaState(createdAt: Date, firstReviewAt: Date | null, now: Date): SlaState {
  return elapsedSla(createdAt, firstReviewAt, now, SLA_POLICY.incidentFirstReview.dueSoonHours, SLA_POLICY.incidentFirstReview.overdueHours);
}

/** Critical-risk response SLA: risk=CRITICAL set → next relevant human action. */
export function criticalRiskSlaState(criticalSetAt: Date | null, respondedAt: Date | null, now: Date): SlaState {
  return elapsedSla(criticalSetAt, respondedAt, now, SLA_POLICY.criticalRiskResponse.dueSoonHours, SLA_POLICY.criticalRiskResponse.overdueHours);
}

/** Deadline-based SLA (task / follow-up). `closed` (done/cancelled) ⇒ Satisfied. */
export function deadlineSlaState(dueAt: Date | null, closed: boolean, now: Date, dueSoonHours: number): SlaState {
  if (closed) return SlaState.Satisfied;
  if (!dueAt) return SlaState.NotApplicable;
  const remainingH = (dueAt.getTime() - now.getTime()) / HOUR;
  if (remainingH <= 0) return SlaState.Overdue;
  if (remainingH <= dueSoonHours) return SlaState.DueSoon;
  return SlaState.OnTrack;
}

export function taskSlaState(dueAt: Date | null, closed: boolean, now: Date): SlaState {
  return deadlineSlaState(dueAt, closed, now, SLA_POLICY.taskDue.dueSoonHours);
}
export function followUpSlaState(nextReviewAt: Date | null, now: Date): SlaState {
  return deadlineSlaState(nextReviewAt, false, now, SLA_POLICY.followUpDue.dueSoonHours);
}

/** The notification type a deadline SLA transition should raise (or null if none). */
export function notificationTypeForSlaTransition(sla: SlaType, to: SlaState): CyberbullyingNotificationType | null {
  if (to === SlaState.DueSoon) {
    if (sla === SlaType.TaskDue) return CyberbullyingNotificationType.TaskDueSoon;
    if (sla === SlaType.FollowUpDue) return CyberbullyingNotificationType.FollowUpDueSoon;
  }
  if (to === SlaState.Overdue) {
    if (sla === SlaType.TaskDue) return CyberbullyingNotificationType.TaskOverdue;
    if (sla === SlaType.FollowUpDue) return CyberbullyingNotificationType.FollowUpOverdue;
  }
  return null;
}

// --- Escalation -------------------------------------------------------------

export enum EscalationStatus {
  Active = "active",
  Resolved = "resolved",
  Cancelled = "cancelled",
}
export enum EscalationSeverity {
  Attention = "attention",
  Urgent = "urgent",
}
export function isEscalationSeverity(x: unknown): x is EscalationSeverity {
  return x === EscalationSeverity.Attention || x === EscalationSeverity.Urgent;
}

export enum EscalationReason {
  SlaBreach = "sla_breach",
  CriticalRisk = "critical_risk",
  NoReviewerResponse = "no_reviewer_response",
  RepeatedIncident = "repeated_incident",
  SafetyConcern = "safety_concern",
  Other = "other",
}
export const ALL_ESCALATION_REASONS: readonly EscalationReason[] = Object.values(EscalationReason);
export function isEscalationReason(x: unknown): x is EscalationReason {
  return typeof x === "string" && (ALL_ESCALATION_REASONS as readonly string[]).includes(x);
}
/** `OTHER` requires a confidential note (never logged). */
export function escalationReasonRequiresNote(reason: EscalationReason): boolean {
  return reason === EscalationReason.Other;
}

export const ESCALATION_NOTE_MAX = 2000;

/** Legal escalation transitions (active → resolved | cancelled; terminal otherwise). */
export function canEscalationTransition(from: EscalationStatus, to: EscalationStatus): boolean {
  return from === EscalationStatus.Active && (to === EscalationStatus.Resolved || to === EscalationStatus.Cancelled);
}

/** Who a resolved/cancelled/other action recipient set is derived for. */
export enum RecipientPurpose {
  Assignment = "assignment",
  TaskAssignment = "task_assignment",
  TaskOverdue = "task_overdue",
  TaskDueSoon = "task_due_soon",
  FollowUp = "follow_up",
  CriticalRisk = "critical_risk",
  Escalation = "escalation",
  Reopen = "reopen",
}
