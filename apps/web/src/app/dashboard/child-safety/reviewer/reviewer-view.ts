/**
 * Child Safety Reviewer Console V1 — PURE view-model (no React, no I/O).
 *
 * All presentation logic that must be deterministic and testable lives here: severity/urgency/status/
 * escalation → tone, the timeline entry → (category, tone, icon, titleKey) mapping, the status → available
 * review actions state-machine mirror, and human duration formatting. The UI components consume these; the
 * backend remains the single source of truth for data + ordering (this file never re-sorts a timeline).
 */
// Import from the specific BROWSER-SAFE core subpaths (not the "@guardora/core" barrel), so this shared
// client module never drags the barrel's server-only crypto modules (hibp / rate-limit-store /
// child-safety-signing → node:crypto) into the client bundle.
import { ChildSafetyIncidentStatus, isTerminalChildSafetyIncidentStatus } from "@guardora/core/child-safety-orchestration";
import { ChildSafetyReviewStatus, canTransitionChildSafetyReviewStatus, ChildSafetyIncidentSort } from "@guardora/core/child-safety-review";
import { ChildSafetyProtectionPlanStatus, ChildSafetyProtectionActionStatus, canTransitionPlanStatus, canTransitionActionStatus } from "@guardora/core/child-safety-protection-plan";

export type Tone = "neutral" | "brand" | "ok" | "warn" | "danger";

export function severityTone(severity: string): Tone {
  switch (severity) {
    case "critical": return "danger";
    case "high": return "warn";
    case "medium": return "brand";
    default: return "neutral";
  }
}
export function urgencyTone(urgency: string): Tone {
  switch (urgency) {
    case "immediate": return "danger";
    case "elevated": return "warn";
    default: return "neutral";
  }
}
export function statusTone(status: string): Tone {
  switch (status) {
    case ChildSafetyIncidentStatus.Open:
    case ChildSafetyIncidentStatus.UnderReview: return "brand";
    case ChildSafetyIncidentStatus.Waiting:
    case ChildSafetyIncidentStatus.Reopened:
    case ChildSafetyIncidentStatus.Monitoring: return "warn";
    case ChildSafetyIncidentStatus.ActionRequired: return "danger";
    case ChildSafetyIncidentStatus.Resolved: return "ok";
    case ChildSafetyIncidentStatus.Dismissed:
    case ChildSafetyIncidentStatus.Closed: return "neutral";
    default: return "neutral";
  }
}
export function escalationTone(escalationState: string): Tone {
  return escalationState === "escalated" ? "danger" : "neutral";
}

/** The seven timeline categories the console color-codes, per the spec. */
export type TimelineCategory = "incident" | "signal" | "escalation" | "notification" | "guardian" | "review" | "recovery";

export interface TimelineEntryView { category: TimelineCategory; tone: Tone; icon: string; titleKey: string; }

/** Deterministic map of a backend timeline `type` → its presentation. Unknown types fall back safely. */
export function timelineEntryView(type: string): TimelineEntryView {
  switch (type) {
    case "incident_created": return { category: "incident", tone: "brand", icon: "📁", titleKey: "tl.incident_created" };
    case "signal_linked": return { category: "signal", tone: "neutral", icon: "📶", titleKey: "tl.signal_linked" };
    case "severity_increased": return { category: "signal", tone: "warn", icon: "⬆️", titleKey: "tl.severity_increased" };
    case "urgency_increased": return { category: "signal", tone: "warn", icon: "⏫", titleKey: "tl.urgency_increased" };
    case "escalation_triggered": return { category: "escalation", tone: "danger", icon: "🚨", titleKey: "tl.escalation_triggered" };
    case "notification_sent": return { category: "notification", tone: "warn", icon: "🔔", titleKey: "tl.notification_sent" };
    case "guardian_delivery": return { category: "guardian", tone: "ok", icon: "🛡️", titleKey: "tl.guardian_delivery" };
    case "recovery_repair": return { category: "recovery", tone: "warn", icon: "🩹", titleKey: "tl.recovery_repair" };
    case "reviewer_assigned": return { category: "review", tone: "brand", icon: "👤", titleKey: "tl.reviewer_assigned" };
    case "reviewer_unassigned": return { category: "review", tone: "neutral", icon: "👥", titleKey: "tl.reviewer_unassigned" };
    case "status_changed": return { category: "review", tone: "brand", icon: "🔁", titleKey: "tl.status_changed" };
    case "reviewer_note": return { category: "review", tone: "brand", icon: "📝", titleKey: "tl.reviewer_note" };
    default: return { category: "review", tone: "neutral", icon: "•", titleKey: "tl.event" };
  }
}

/** All review status targets, in display order. */
export const REVIEW_STATUS_TARGETS: readonly ChildSafetyReviewStatus[] = [
  ChildSafetyReviewStatus.UnderReview, ChildSafetyReviewStatus.Waiting,
  ChildSafetyReviewStatus.Resolved, ChildSafetyReviewStatus.Dismissed, ChildSafetyReviewStatus.Reopened,
];

/** The status targets legally reachable from `status` (mirrors the server state-machine; the server re-checks). */
export function availableStatusTargets(status: string): ChildSafetyReviewStatus[] {
  return REVIEW_STATUS_TARGETS.filter((to) => canTransitionChildSafetyReviewStatus(status, to));
}

/** Whether a status change to `to` is destructive/terminal (⇒ show a confirmation dialog). */
export function isTerminalReviewTarget(to: ChildSafetyReviewStatus): boolean {
  return to === ChildSafetyReviewStatus.Resolved || to === ChildSafetyReviewStatus.Dismissed;
}

/** The full set of review actions the console offers, with per-status availability (manager-gated separately). */
export interface ReviewActionAvailability { assign: boolean; unassign: boolean; note: boolean; statusTargets: ChildSafetyReviewStatus[]; }
export function availableReviewActions(status: string, assignedReviewerId: string | null): ReviewActionAvailability {
  return {
    assign: true,          // may (re)assign any incident
    unassign: assignedReviewerId !== null, // only when currently assigned
    note: true,            // notes are always append-able (even on a closed incident)
    statusTargets: availableStatusTargets(status),
  };
}

export const INCIDENT_SORTS: readonly { value: ChildSafetyIncidentSort; labelKey: string }[] = [
  { value: ChildSafetyIncidentSort.Newest, labelKey: "sort.newest" },
  { value: ChildSafetyIncidentSort.Oldest, labelKey: "sort.oldest" },
  { value: ChildSafetyIncidentSort.HighestSeverity, labelKey: "sort.severity" },
  { value: ChildSafetyIncidentSort.HighestUrgency, labelKey: "sort.urgency" },
];

export const SEVERITY_OPTIONS = ["critical", "high", "medium", "low"] as const;
export const URGENCY_OPTIONS = ["immediate", "elevated", "routine"] as const;

/** Human, compact duration (e.g. 3d 4h, 2h 5m, 45m, 30s). Null → em dash. Deterministic. */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) { const rm = m % 60; return rm ? `${h}h ${rm}m` : `${h}h`; }
  const d = Math.floor(h / 24); const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

/** Whether the terminal-status guard means the incident is closed (drives the read-only detail affordances). */
export function isClosedIncident(status: string): boolean {
  return isTerminalChildSafetyIncidentStatus(status);
}

/** Truncate an opaque id for compact table display (keeps head + tail; never a content value). */
export function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;
}

/**
 * Minimal, XSS-SAFE markdown → HTML for reviewer note preview. HTML is escaped FIRST, so no user input
 * can inject markup; only a tiny allow-list of inline formatting (bold / italic / inline code) and line
 * breaks is then applied. Never renders links, images, or raw HTML. Deterministic.
 */
export function renderMarkdownSafe(md: string): string {
  const escaped = (md ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\n/g, "<br/>");
}

/** Evidence integrity status → tone (verified→ok, failed→danger, unverified→neutral). */
export function integrityTone(status: string): Tone {
  return status === "verified" ? "ok" : status === "failed" ? "danger" : "neutral";
}

/** Compact human byte size (deterministic). */
export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Deterministic UTC "YYYY-MM-DD HH:mm" from an ISO string (hydration-safe; no locale/timezone drift). */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const d = new Date(t);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// ── Protection Plans view-model ───────────────────────────────────────────────
export function planStatusTone(status: string): Tone {
  switch (status) {
    case "active": return "brand";
    case "completed": return "ok";
    case "reopened": return "warn";
    case "cancelled": return "neutral";
    default: return "neutral"; // draft
  }
}
export function actionStatusTone(status: string): Tone {
  switch (status) {
    case "in_progress": return "brand";
    case "blocked": return "danger";
    case "completed": return "ok";
    case "reopened": return "warn";
    default: return "neutral"; // pending / skipped
  }
}
export function priorityTone(priority: string): Tone {
  switch (priority) {
    case "urgent": return "danger";
    case "high": return "warn";
    default: return "neutral"; // normal / low
  }
}

/** Plan status targets a manager may move the plan INTO (mirrors the server state-machine). */
export function availablePlanTargets(status: string): ChildSafetyProtectionPlanStatus[] {
  return (Object.values(ChildSafetyProtectionPlanStatus) as ChildSafetyProtectionPlanStatus[]).filter((to) => canTransitionPlanStatus(status, to));
}
/** Action status targets a manager may move an action INTO (mirrors the server state-machine). */
export function availableActionTargets(status: string): ChildSafetyProtectionActionStatus[] {
  return (Object.values(ChildSafetyProtectionActionStatus) as ChildSafetyProtectionActionStatus[]).filter((to) => canTransitionActionStatus(status, to));
}

/** Resolve a catalog title key (pp.action.<type>.title) to localized text; a custom reviewer title passes through. */
export function resolveActionTitle(title: string, actionType: string, labels: Record<string, { title: string }>): string {
  if (title.startsWith("pp.action.")) return labels[actionType]?.title ?? title;
  return title;
}
