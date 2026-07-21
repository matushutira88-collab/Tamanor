/**
 * Cyberbullying Protection — C3 Incident Core (domain).
 *
 * Types, enums, and the pure lifecycle transition function for cyberbullying
 * incidents, built on the SINGLE `Incident` ledger (ADR-0001) and the SINGLE
 * canonical lifecycle (ADR-0002, in security.ts). No parallel case ledger, no
 * second lifecycle. Detection ≠ incident; `confirmed` requires a human.
 */

import {
  IncidentLifecycleStatus,
  canTransitionIncident,
  incidentTransitionRequiresReason,
  INCIDENT_STATUS_TRANSITIONS,
  INCIDENT_REOPEN_TRANSITIONS,
  TERMINAL_INCIDENT_STATUSES,
} from "./security";
import { Permission, can } from "./permissions";
import { Role } from "./tenant";

// --- Enums -----------------------------------------------------------------

/** How a cyberbullying incident was opened. */
export enum IncidentReportSource {
  ManualReport = "manual_report",
  Detection = "detection",
}

/**
 * C6 — neutral cyberbullying harm categories. The single source of truth for
 * validating, localizing and rendering a manual report's category; persisted to
 * the free `Incident.category` string column (not a new DB field). Values are
 * descriptive and non-accusatory — never a guilt/verdict label.
 */
export enum CyberbullyingCategory {
  Harassment = "harassment",
  Threats = "threats",
  Impersonation = "impersonation",
  Doxxing = "doxxing",
  Exclusion = "exclusion",
  Other = "other",
}
export const CYBERBULLYING_CATEGORIES: readonly CyberbullyingCategory[] = Object.values(CyberbullyingCategory);
export function isCyberbullyingCategory(x: unknown): x is CyberbullyingCategory {
  return typeof x === "string" && (CYBERBULLYING_CATEGORIES as readonly string[]).includes(x);
}
export function isIncidentReportSource(x: unknown): x is IncidentReportSource {
  return x === IncidentReportSource.ManualReport || x === IncidentReportSource.Detection;
}

// --- C6 Manual report input + validation (pure; server-authoritative) -------

/** Bounds for a manual report. Enforced server-side regardless of client checks. */
export const MANUAL_REPORT_LIMITS = {
  summaryMin: 10,
  summaryMax: 4000,
  actorLabelMax: 200,
  actorRefMax: 200,
  subjectIdMax: 64,
  idempotencyKeyMax: 100,
} as const;

export type ManualReportField =
  | "protectedSubjectId" | "reportSource" | "category" | "summary"
  | "allegedActorLabel" | "allegedActorExternalReference" | "idempotencyKey";
export type ManualReportErrorCode = "required" | "too_short" | "too_long" | "invalid";

/** Raw (client-supplied) manual report input, before trust-sensitive server values. */
export interface ManualReportInput {
  protectedSubjectId: string;
  reportSource: string;
  category: string;
  summary: string;
  allegedActorLabel?: string | null;
  allegedActorExternalReference?: string | null;
  idempotencyKey: string;
}

export interface ManualReportValidation {
  ok: boolean;
  errors: Partial<Record<ManualReportField, ManualReportErrorCode>>;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Validate a manual report. PURE and fail-closed — the same function guards the
 * client (UX) and the server (authority). Returns per-field error CODES only
 * (the UI localizes them); never a raw message that could leak internals. The
 * confidential `summary` value is validated but never returned in errors.
 */
export function validateManualReportInput(input: ManualReportInput): ManualReportValidation {
  const errors: Partial<Record<ManualReportField, ManualReportErrorCode>> = {};
  const L = MANUAL_REPORT_LIMITS;

  const subject = (input.protectedSubjectId ?? "").trim();
  if (!subject) errors.protectedSubjectId = "required";
  else if (subject.length > L.subjectIdMax || !SAFE_ID.test(subject)) errors.protectedSubjectId = "invalid";

  // Manual flow: the ONLY valid source is manual_report (fail-closed on anything else).
  if (input.reportSource !== IncidentReportSource.ManualReport) errors.reportSource = "invalid";

  if (!input.category) errors.category = "required";
  else if (!isCyberbullyingCategory(input.category)) errors.category = "invalid";

  const summary = (input.summary ?? "").trim();
  if (!summary) errors.summary = "required";
  else if (summary.length < L.summaryMin) errors.summary = "too_short";
  else if (summary.length > L.summaryMax) errors.summary = "too_long";

  const label = (input.allegedActorLabel ?? "").trim();
  if (label.length > L.actorLabelMax) errors.allegedActorLabel = "too_long";

  const ref = (input.allegedActorExternalReference ?? "").trim();
  if (ref.length > L.actorRefMax) errors.allegedActorExternalReference = "too_long";

  const key = (input.idempotencyKey ?? "").trim();
  if (!key) errors.idempotencyKey = "required";
  else if (key.length > L.idempotencyKeyMax || !SAFE_ID.test(key)) errors.idempotencyKey = "invalid";

  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * A person's role in an incident. `alleged_actor` is deliberate — the system
 * NEVER labels a person a confirmed/guilty attacker without human review.
 */
export enum IncidentParticipantRole {
  ProtectedSubject = "protected_subject",
  Reporter = "reporter",
  AllegedActor = "alleged_actor",
  Reviewer = "reviewer",
  TrustedContact = "trusted_contact",
}

/** Append-only, human-readable case timeline event types. */
export enum IncidentTimelineEventType {
  Created = "created",
  ReviewStarted = "review_started",
  Acknowledged = "acknowledged",
  Confirmed = "confirmed",
  Dismissed = "dismissed",
  ActionRequired = "action_required",
  Resolved = "resolved",
  Archived = "archived",
  Reopened = "reopened",
  DetectionLinked = "detection_linked",
  EvidenceLinked = "evidence_linked",
  ParticipantAdded = "participant_added",
  ParticipantRemoved = "participant_removed",
  // C5 — operations. Reviewer assignment + internal notes. The note BODY is never
  // written to the timeline (confidential); only that a note was added.
  ReviewerAssigned = "reviewer_assigned",
  ReviewerReassigned = "reviewer_reassigned",
  ReviewerUnassigned = "reviewer_unassigned",
  NoteAdded = "note_added",
  // C9 — case management (a case IS the incident). Append-only, sanitized (note/
  // objective/description CONTENT is never written to the timeline).
  ProtectionPlanUpdated = "protection_plan_updated",
  TaskCreated = "task_created",
  TaskUpdated = "task_updated",
  TaskCompleted = "task_completed",
  FollowUpUpdated = "follow_up_updated",
  MilestoneChanged = "milestone_changed",
  // C10 — SLA transitions (only on state CHANGE, never per evaluation run) +
  // manual escalation. No confidential text in metadata.
  SlaDueSoonDetected = "sla_due_soon_detected",
  SlaOverdueDetected = "sla_overdue_detected",
  EscalationCreated = "escalation_created",
  EscalationResolved = "escalation_resolved",
  EscalationCancelled = "escalation_cancelled",
  EscalationTargetChanged = "escalation_target_changed",
}

/**
 * C5 — the kind of an append-only assignment-history event. One primary reviewer
 * per incident; every assign/reassign/unassign records who acted on whom, when,
 * and why.
 */
export enum IncidentAssignmentAction {
  Assigned = "assigned",
  Reassigned = "reassigned",
  Unassigned = "unassigned",
}

// --- C8 Detection triage (human triage of existing SecurityDetections) ------

/**
 * Cyberbullying triage state of an existing SecurityDetection. A separate overlay
 * from the security-domain `SecurityDetection.status` (never overloaded). Default
 * (no triage row yet) is `New`. Append-only audited; a detection is never deleted.
 */
export enum CyberbullyingDetectionStatus {
  New = "new",
  UnderReview = "under_review",
  FalsePositive = "false_positive",
  LinkedToIncident = "linked_to_incident",
  Ignored = "ignored",
}

/** Append-only detection-triage timeline event types (the detection's own history). */
export enum CyberbullyingDetectionEventType {
  ReviewStarted = "detection_review_started",
  Ignored = "detection_ignored",
  FalsePositive = "detection_false_positive",
  Linked = "detection_linked",
  Reopened = "detection_reopened",
}

/** Reviewer triage operations. `create_incident` links via the C3 contract. */
export type CyberbullyingDetectionOp = "start_review" | "ignore" | "false_positive" | "reopen" | "create_incident";

const DS = CyberbullyingDetectionStatus;

/** Pure transition table. Returns the resulting status, or null if the op is illegal. */
export function detectionTransitionTarget(from: CyberbullyingDetectionStatus, op: CyberbullyingDetectionOp): CyberbullyingDetectionStatus | null {
  switch (op) {
    case "start_review": return from === DS.New ? DS.UnderReview : null;
    case "ignore": return from === DS.New || from === DS.UnderReview ? DS.Ignored : null;
    case "false_positive": return from === DS.New || from === DS.UnderReview ? DS.FalsePositive : null;
    case "create_incident": return from === DS.New || from === DS.UnderReview ? DS.LinkedToIncident : null;
    case "reopen": return from === DS.FalsePositive || from === DS.Ignored ? DS.UnderReview : null;
    default: return null;
  }
}

/** The triage event a successful op appends to the detection timeline. */
export function detectionEventForOp(op: CyberbullyingDetectionOp): CyberbullyingDetectionEventType {
  switch (op) {
    case "start_review": return CyberbullyingDetectionEventType.ReviewStarted;
    case "ignore": return CyberbullyingDetectionEventType.Ignored;
    case "false_positive": return CyberbullyingDetectionEventType.FalsePositive;
    case "create_incident": return CyberbullyingDetectionEventType.Linked;
    case "reopen": return CyberbullyingDetectionEventType.Reopened;
  }
}

export interface AvailableDetectionActions {
  startReview: boolean;
  ignore: boolean;
  falsePositive: boolean;
  createIncident: boolean;
  reopen: boolean;
}

/**
 * Operations a reviewer may perform on a detection (permission × status). All
 * triage requires `cyberbullying:review`; without it every action is false
 * (read-only / denied). `create_incident` is hidden once already linked.
 */
export function availableDetectionActions(role: string, status: CyberbullyingDetectionStatus, alreadyLinked: boolean): AvailableDetectionActions {
  const review = can(role as Role, Permission.CyberbullyingReview);
  if (!review) return { startReview: false, ignore: false, falsePositive: false, createIncident: false, reopen: false };
  const active = status === DS.New || status === DS.UnderReview;
  return {
    startReview: status === DS.New,
    ignore: active,
    falsePositive: active,
    createIncident: active && !alreadyLinked,
    reopen: status === DS.FalsePositive || status === DS.Ignored,
  };
}

// --- C9 Case management (Case = Incident; all decisions are human) ----------

/** Manual case risk level — set ONLY by a human reviewer. Never inferred. */
export enum CaseRiskLevel {
  Low = "low",
  Medium = "medium",
  High = "high",
  Critical = "critical",
}
export const CASE_RISK_LEVELS: readonly CaseRiskLevel[] = Object.values(CaseRiskLevel);
export function isCaseRiskLevel(x: unknown): x is CaseRiskLevel {
  return typeof x === "string" && (CASE_RISK_LEVELS as readonly string[]).includes(x);
}

/** Current protection status of the case. Manual. */
export enum CaseProtectionStatus {
  NotStarted = "not_started",
  Monitoring = "monitoring",
  Active = "active",
  Resolved = "resolved",
}
export const CASE_PROTECTION_STATUSES: readonly CaseProtectionStatus[] = Object.values(CaseProtectionStatus);
export function isCaseProtectionStatus(x: unknown): x is CaseProtectionStatus {
  return typeof x === "string" && (CASE_PROTECTION_STATUSES as readonly string[]).includes(x);
}

/** Case task status. */
export enum CaseTaskStatus {
  Todo = "todo",
  InProgress = "in_progress",
  Done = "done",
  Cancelled = "cancelled",
}
export const CASE_TASK_STATUSES: readonly CaseTaskStatus[] = Object.values(CaseTaskStatus);
export function isCaseTaskStatus(x: unknown): x is CaseTaskStatus {
  return typeof x === "string" && (CASE_TASK_STATUSES as readonly string[]).includes(x);
}

const CT = CaseTaskStatus;
/** Legal task status transitions (identity is not a transition). */
export const CASE_TASK_TRANSITIONS: Readonly<Record<CaseTaskStatus, readonly CaseTaskStatus[]>> = {
  [CT.Todo]: [CT.InProgress, CT.Done, CT.Cancelled],
  [CT.InProgress]: [CT.Todo, CT.Done, CT.Cancelled],
  [CT.Done]: [CT.InProgress, CT.Cancelled], // reopen / cancel a completed task
  [CT.Cancelled]: [CT.Todo], // reopen a cancelled task
};
export function canTaskTransition(from: CaseTaskStatus, to: CaseTaskStatus): boolean {
  return from !== to && (CASE_TASK_TRANSITIONS[from]?.includes(to) ?? false);
}

/** The fixed, manually-toggled case milestones (never automatic). */
export enum CaseMilestoneKey {
  InitialReview = "initial_review",
  EvidenceCollected = "evidence_collected",
  VictimContacted = "victim_contacted",
  ProtectionActive = "protection_active",
  Resolved = "resolved",
}
export const CASE_MILESTONE_KEYS: readonly CaseMilestoneKey[] = Object.values(CaseMilestoneKey);
export function isCaseMilestoneKey(x: unknown): x is CaseMilestoneKey {
  return typeof x === "string" && (CASE_MILESTONE_KEYS as readonly string[]).includes(x);
}

/** Bounds for case-management free text (server-authoritative). */
export const CASE_LIMITS = {
  taskTitleMin: 1,
  taskTitleMax: 200,
  taskDescriptionMax: 4000,
  objectiveMax: 500,
  notesMax: 4000,
  followUpNotesMax: 4000,
} as const;

export type CaseTaskField = "title" | "description" | "status" | "dueDate";
export type CaseFieldErrorCode = "required" | "too_long" | "invalid";

/** Validate a due date string (ISO or empty). Returns a Date, null (empty), or "invalid". */
export function parseCaseDueDate(value: string | null | undefined): Date | null | "invalid" {
  if (value == null || value.trim() === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

/** Validate task create/update input. Pure + fail-closed. Returns per-field codes. */
export function validateCaseTaskInput(input: { title?: string; description?: string | null; status?: string; dueDate?: string | null }, opts: { requireTitle?: boolean } = {}): Partial<Record<CaseTaskField, CaseFieldErrorCode>> {
  const errors: Partial<Record<CaseTaskField, CaseFieldErrorCode>> = {};
  const title = (input.title ?? "").trim();
  if (opts.requireTitle || input.title !== undefined) {
    if (!title) errors.title = "required";
    else if (title.length > CASE_LIMITS.taskTitleMax) errors.title = "too_long";
  }
  if (input.description != null && input.description.length > CASE_LIMITS.taskDescriptionMax) errors.description = "too_long";
  if (input.status !== undefined && !isCaseTaskStatus(input.status)) errors.status = "invalid";
  if (parseCaseDueDate(input.dueDate) === "invalid") errors.dueDate = "invalid";
  return errors;
}

// --- Domain shapes (plain; NOT Prisma) -------------------------------------

export interface CyberbullyingIncidentDetail {
  id: string;
  tenantId: string;
  incidentId: string;
  protectedSubjectId: string;
  reportSource: IncidentReportSource;
  /** Confidential — never logged. */
  summary: string;
  allegedActorLabel: string | null;
  allegedActorExternalReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IncidentParticipant {
  id: string;
  tenantId: string;
  incidentId: string;
  role: IncidentParticipantRole;
  protectedSubjectId: string | null;
  userId: string | null;
  externalReference: string | null;
  createdAt: Date;
}

export interface IncidentDetectionLink {
  id: string;
  tenantId: string;
  incidentId: string;
  securityDetectionId: string;
  linkedByUserId: string | null;
  linkReason: string;
  createdAt: Date;
}

export interface IncidentTimelineEvent {
  id: string;
  tenantId: string;
  incidentId: string;
  eventType: IncidentTimelineEventType;
  actorUserId: string | null;
  reason: string | null;
  createdAt: Date;
}

/**
 * C5 — an append-only internal reviewer note. CONFIDENTIAL: the body is never
 * logged (audit records only that a note exists) and is never shown to a protected
 * subject. No edit, no delete — the record is immutable once written.
 */
export interface IncidentReviewerNote {
  id: string;
  tenantId: string;
  incidentId: string;
  authorUserId: string;
  /** Confidential free text. Not evidence, not stored as a blob, never in logs. */
  body: string;
  createdAt: Date;
}

/**
 * C5 — an append-only assignment-history record. `assigneeUserId` is null for an
 * `unassigned` action; `previousAssigneeUserId` is null for the first assignment.
 */
export interface IncidentAssignmentEvent {
  id: string;
  tenantId: string;
  incidentId: string;
  action: IncidentAssignmentAction;
  assigneeUserId: string | null;
  previousAssigneeUserId: string | null;
  assignedByUserId: string;
  reason: string | null;
  createdAt: Date;
}

// --- Lifecycle transition (pure, domain-validated) -------------------------

export type IncidentTransitionError = "illegal_transition" | "terminal" | "no_change" | "reason_required";

export interface IncidentTransitionResult {
  ok: boolean;
  from: IncidentLifecycleStatus;
  to: IncidentLifecycleStatus;
  /** True when this was performed as an explicit reopen (elevated + reason). */
  reopen: boolean;
  error?: IncidentTransitionError;
}

/**
 * Validate an incident transition. Forward transitions use the canonical matrix;
 * `reopen` uses the elevated reopen map (out of a terminal/resolved state). A
 * mandatory-reason target without a reason is rejected (`reason_required`).
 * Identity (from == to) is `no_change`. Pure — no side effects.
 */
export function applyIncidentTransition(
  from: IncidentLifecycleStatus,
  to: IncidentLifecycleStatus,
  opts: { reopen?: boolean; reason?: string | null } = {},
): IncidentTransitionResult {
  const base = { from, to, reopen: !!opts.reopen };
  if (from === to) return { ...base, ok: false, error: "no_change" };

  if (opts.reopen) {
    const target = INCIDENT_REOPEN_TRANSITIONS[from];
    if (!target || target !== to) {
      return { ...base, ok: false, error: TERMINAL_INCIDENT_STATUSES.includes(from) || from === IncidentLifecycleStatus.Resolved ? "illegal_transition" : "illegal_transition" };
    }
    if (!opts.reason || opts.reason.trim() === "") return { ...base, ok: false, error: "reason_required" };
    return { ...base, ok: true };
  }

  if (!canTransitionIncident(from, to)) {
    const error: IncidentTransitionError = TERMINAL_INCIDENT_STATUSES.includes(from) ? "terminal" : "illegal_transition";
    return { ...base, ok: false, error };
  }
  if (incidentTransitionRequiresReason(to) && (!opts.reason || opts.reason.trim() === "")) {
    return { ...base, ok: false, error: "reason_required" };
  }
  return { ...base, ok: true };
}

// --- Permission mapping + available actions (pure) -------------------------

/**
 * Which RBAC permission a lifecycle target requires. Review-level moves
 * (under_review/acknowledged/dismissed) need `cyberbullying:review`; the weightier
 * outcomes (confirmed/action_required/resolved/archived) need `cyberbullying:manage`.
 * Single source of truth shared by the service and the read model.
 */
export function permissionForIncidentTransition(to: IncidentLifecycleStatus): Permission {
  switch (to) {
    case IncidentLifecycleStatus.UnderReview:
    case IncidentLifecycleStatus.Acknowledged:
    case IncidentLifecycleStatus.Dismissed:
      return Permission.CyberbullyingReview;
    default: // confirmed | action_required | resolved | archived
      return Permission.CyberbullyingManage;
  }
}

/** Whether `status` is a terminal/resolved state that only an elevated reopen can leave. */
export function isReopenableStatus(status: IncidentLifecycleStatus): boolean {
  return status in INCIDENT_REOPEN_TRANSITIONS;
}

/**
 * Compute the operations an actor may perform on an incident, from
 * permission × lifecycle × assignment. Pure and deterministic — the UI renders
 * exactly this and the service re-validates each action server-side. A role with
 * no cyberbullying write permission (e.g. a protected subject on view_own) gets an
 * empty/all-false result: read-only.
 */
export function availableIncidentActions(
  role: string,
  status: IncidentLifecycleStatus,
  ctx: { assigned: boolean } = { assigned: false },
): AvailableIncidentActions {
  const r = role as Role;
  const review = can(r, Permission.CyberbullyingReview);
  const manage = can(r, Permission.CyberbullyingManage);

  const transitions = (INCIDENT_STATUS_TRANSITIONS[status] ?? [])
    .filter((to) => can(r, permissionForIncidentTransition(to)))
    .map((to) => ({ to, requiresReason: incidentTransitionRequiresReason(to) }));

  return {
    transitions,
    canReopen: manage && isReopenableStatus(status),
    // Claim an unassigned case = review. Reassign/unassign an assigned case = manage.
    canAssign: review && !ctx.assigned,
    canReassign: manage && ctx.assigned,
    canUnassign: manage && ctx.assigned,
    canAddNote: review,
  };
}

// --- Server CONTRACT (interface) -------------------------------------------

/** Actor context for a write. Role drives RBAC; userId is the audit actor. */
export interface IncidentActorContext {
  tenantId: string;
  userId: string;
  role: string;
}

/**
 * Contract for the incident service (implemented in @guardora/db). Every write is
 * tenant-scoped, permission-checked, transactional, audited, and fail-closed.
 */
export interface CyberbullyingIncidentService {
  createFromManualReport(actor: IncidentActorContext, input: { protectedSubjectId: string; summary: string; category?: string; severity?: string; title?: string; allegedActorLabel?: string | null; allegedActorExternalReference?: string | null; idempotencyKey?: string }): Promise<{ incidentId: string; duplicate?: boolean }>;
  createFromDetections(actor: IncidentActorContext, input: { protectedSubjectId: string; summary: string; detectionIds: string[]; severity?: string; title?: string }): Promise<{ incidentId: string }>;
  linkDetection(actor: IncidentActorContext, incidentId: string, securityDetectionId: string, linkReason: string): Promise<{ linkId: string; created: boolean }>;
  linkEvidence(actor: IncidentActorContext, incidentId: string, evidenceId: string): Promise<void>;
  addParticipant(actor: IncidentActorContext, incidentId: string, input: { role: IncidentParticipantRole; protectedSubjectId?: string | null; userId?: string | null; externalReference?: string | null }): Promise<{ participantId: string; created: boolean }>;
  removeParticipant(actor: IncidentActorContext, incidentId: string, participantId: string): Promise<void>;
  transition(actor: IncidentActorContext, incidentId: string, to: IncidentLifecycleStatus, reason?: string): Promise<IncidentTransitionResult>;
  reopen(actor: IncidentActorContext, incidentId: string, reason: string): Promise<IncidentTransitionResult>;
  // C5 — operations. Assign is claim-level (review); reassign/unassign are elevated
  // (manage). Notes are append-only and confidential.
  assignReviewer(actor: IncidentActorContext, incidentId: string, assigneeUserId: string, reason?: string): Promise<{ action: IncidentAssignmentAction }>;
  unassignReviewer(actor: IncidentActorContext, incidentId: string, reason?: string): Promise<void>;
  addReviewerNote(actor: IncidentActorContext, incidentId: string, body: string): Promise<{ noteId: string }>;
}

/**
 * C5 — the set of operations an actor may perform on an incident, computed from
 * permission × lifecycle × assignment. The UI renders ONLY what appears here; the
 * service re-checks every one server-side (defence in depth). Read-only actors
 * (e.g. a protected subject) get an all-false/empty result.
 */
export interface AvailableIncidentActions {
  /** Legal forward transitions the actor is permitted to perform. */
  transitions: { to: IncidentLifecycleStatus; requiresReason: boolean }[];
  /** Elevated reopen out of a terminal/resolved state (reason mandatory). */
  canReopen: boolean;
  canAssign: boolean;
  canReassign: boolean;
  canUnassign: boolean;
  canAddNote: boolean;
}
