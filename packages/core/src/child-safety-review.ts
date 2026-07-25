/**
 * Child Safety Reviewer Workspace V1 — pure review vocabulary + policy.
 *
 * Operational layer ON TOP of the accepted canonical incident domain (CS-C15A/B/C). It adds NO new
 * detection, decision, or intervention behavior — only the human review lifecycle: sorting/filtering
 * vocabulary for the incident list, the review status state-machine, the append-only review event
 * kinds, and the permission wrapper. Everything here is deterministic and content-free.
 */
import { Role } from "./tenant";
import { Permission, can } from "./permissions";
import { ChildSafetyIncidentStatus, isTerminalChildSafetyIncidentStatus } from "./child-safety-orchestration";

// ─────────────────────────────────────────────────────────────────────────────
// Permissions — Owner / Administrator / Safety Reviewer (Role.reviewer) ONLY.
// No public, guardian, SDK, or gateway access. Tenant isolation is enforced separately.
// ─────────────────────────────────────────────────────────────────────────────

/** May open the reviewer workspace: read incidents, timeline, dashboard. */
export function canViewChildSafetyReview(role: Role): boolean {
  return can(role, Permission.ChildSafetyReviewView);
}
/** May act: assign/unassign, add note, transition review status. */
export function canManageChildSafetyReview(role: Role): boolean {
  return can(role, Permission.ChildSafetyReviewManage);
}

// ─────────────────────────────────────────────────────────────────────────────
// Review status state machine (a subset of ChildSafetyIncidentStatus is reviewer-settable).
// ─────────────────────────────────────────────────────────────────────────────

/** The statuses a reviewer may explicitly move an incident INTO. */
export enum ChildSafetyReviewStatus {
  UnderReview = "under_review",
  Waiting = "waiting",
  Resolved = "resolved",
  Dismissed = "dismissed",
  Reopened = "reopened",
}
export const CHILD_SAFETY_REVIEW_STATUSES: readonly ChildSafetyReviewStatus[] = Object.values(ChildSafetyReviewStatus);

/** Whether `s` is a status a reviewer may target. */
export function isChildSafetyReviewStatus(s: string): s is ChildSafetyReviewStatus {
  return (CHILD_SAFETY_REVIEW_STATUSES as readonly string[]).includes(s);
}

/**
 * Deterministic transition policy. A terminal status (resolved/dismissed/closed) may ONLY be left via
 * an explicit Reopened. From a live status a reviewer may pick up (under_review), park (waiting), or
 * finish (resolved/dismissed). Reopened lands the incident back under review. Idempotent no-op
 * transitions (same → same) are rejected so every persisted event is a real change.
 */
export function canTransitionChildSafetyReviewStatus(from: string, to: ChildSafetyReviewStatus): boolean {
  if (from === to) return false;
  const terminal = isTerminalChildSafetyIncidentStatus(from);
  if (to === ChildSafetyReviewStatus.Reopened) return terminal; // reopen only a finished incident
  if (terminal) return false; // a finished incident must be reopened before anything else
  // Live incident (open / under_review / waiting / reopened / action_required / monitoring):
  return true;
}

/** The concrete incident status a review action resolves to (Reopened parks the incident back under review). */
export function resolvedIncidentStatusFor(to: ChildSafetyReviewStatus): ChildSafetyIncidentStatus {
  switch (to) {
    case ChildSafetyReviewStatus.UnderReview: return ChildSafetyIncidentStatus.UnderReview;
    case ChildSafetyReviewStatus.Waiting: return ChildSafetyIncidentStatus.Waiting;
    case ChildSafetyReviewStatus.Resolved: return ChildSafetyIncidentStatus.Resolved;
    case ChildSafetyReviewStatus.Dismissed: return ChildSafetyIncidentStatus.Dismissed;
    case ChildSafetyReviewStatus.Reopened: return ChildSafetyIncidentStatus.Reopened;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Append-only review event kinds (the reviewer-activity timeline source).
// ─────────────────────────────────────────────────────────────────────────────

export enum ChildSafetyReviewEventType {
  Assigned = "assigned",
  Unassigned = "unassigned",
  NoteAdded = "note_added",
  StatusChanged = "status_changed",
  Reopened = "reopened",
}

/** Bounded, content-free audit event names for reviewer actions (reuse the shared audit log). */
export const CHILD_SAFETY_REVIEW_AUDIT_EVENTS = {
  viewed: "child_safety.review.viewed",
  assigned: "child_safety.review.assigned",
  unassigned: "child_safety.review.unassigned",
  noteAdded: "child_safety.review.note_added",
  statusChanged: "child_safety.review.status_changed",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Incident-list sorting + filtering vocabulary (deterministic).
// ─────────────────────────────────────────────────────────────────────────────

export enum ChildSafetyIncidentSort {
  Newest = "newest",
  Oldest = "oldest",
  HighestSeverity = "highest_severity",
  HighestUrgency = "highest_urgency",
}
export const CHILD_SAFETY_INCIDENT_SORTS: readonly ChildSafetyIncidentSort[] = Object.values(ChildSafetyIncidentSort);
export function parseIncidentSort(v: string | null | undefined): ChildSafetyIncidentSort {
  return (CHILD_SAFETY_INCIDENT_SORTS as readonly string[]).includes(v ?? "") ? (v as ChildSafetyIncidentSort) : ChildSafetyIncidentSort.Newest;
}

/** Coarse status buckets the list can filter to (maps to one-or-more concrete statuses / escalation state). */
export enum ChildSafetyIncidentListFilter {
  All = "all",
  Open = "open",
  Escalated = "escalated",
  Resolved = "resolved",
  Dismissed = "dismissed",
}

/** Deterministic monotonic ranks (shared with the incident service) — higher = more severe/urgent. */
export const CHILD_SAFETY_SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
export const CHILD_SAFETY_URGENCY_RANK: Record<string, number> = { routine: 0, elevated: 1, immediate: 2 };

/** The set of concrete statuses the list treats as "open" (live, non-terminal, not escalation-specific). */
export const CHILD_SAFETY_OPEN_STATUSES: readonly string[] = [
  ChildSafetyIncidentStatus.Open, ChildSafetyIncidentStatus.UnderReview, ChildSafetyIncidentStatus.Waiting,
  ChildSafetyIncidentStatus.ActionRequired, ChildSafetyIncidentStatus.Monitoring, ChildSafetyIncidentStatus.Reopened,
];

/** Max page size — bounds the blast radius of any single list query. */
export const CHILD_SAFETY_INCIDENT_PAGE_MAX = 100;
export const CHILD_SAFETY_INCIDENT_PAGE_DEFAULT = 25;
export function clampPageSize(n: number | null | undefined): number {
  if (!n || !Number.isFinite(n) || n <= 0) return CHILD_SAFETY_INCIDENT_PAGE_DEFAULT;
  return Math.min(Math.floor(n), CHILD_SAFETY_INCIDENT_PAGE_MAX);
}

/** Max reviewer-note length. Notes are internal-only, plain/markdown text; never raw child content. */
export const CHILD_SAFETY_NOTE_MAX_LEN = 4000;
