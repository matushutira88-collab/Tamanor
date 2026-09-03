/**
 * Bounded key → tone mappings for the Action Queue.
 *
 * Pure and dictionary-free: the LABEL always comes from i18n; this file only says
 * which tone reinforces it. Tone is never the sole carrier of meaning.
 *
 * The central presentation rule of M5 lives here too: a QUEUE DECISION and a
 * PROVIDER EXECUTION are separate truths and must never collapse into one "Done".
 * `executionSummary` exists so a screen cannot accidentally conflate them.
 */

import type {
  ExecutionStatus, Lifecycle, ProposedAction, QueueExecution, QueueItem,
  QueueState, Readiness,
} from "@/api/types";

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger";

/** Own-property lookup: `__proto__` must not resolve to an inherited member. */
const total = <K extends string>(map: Record<K, Tone>, key: K | string): Tone =>
  Object.prototype.hasOwnProperty.call(map, key) ? (map as Record<string, Tone>)[key]! : "neutral";

const QUEUE_STATE_TONE: Record<QueueState, Tone> = {
  suggested: "brand",
  approval_required: "warning",
  approved: "success",
  rejected: "neutral",
  blocked_by_safety: "brand",
  dry_run: "neutral",
  executed: "success",
  failed: "danger",
  rollback_needed: "danger",
  monitor: "neutral",
  no_action: "neutral",
};

/**
 * Execution tone. `blocked` is NOT alarming — Tamanor's safety gates holding an
 * action back is the system working, not a failure.
 */
const EXECUTION_TONE: Record<ExecutionStatus, Tone> = {
  blocked: "neutral",
  dry_run: "neutral",
  executed: "success",
  failed: "danger",
  rollback_pending: "warning",
  rolled_back: "neutral",
};

const READINESS_TONE: Record<Readiness, Tone> = {
  blocked: "neutral",
  dry_run: "neutral",
  live_possible: "brand",
  already_executed: "success",
  not_applicable: "neutral",
};

const LIFECYCLE_TONE: Record<Lifecycle, Tone> = {
  visible: "neutral",
  hidden: "success",
  deleted: "neutral",
  cannot_hide: "warning",
  unknown: "neutral",
};

/** A proposed action's weight — a hide reads heavier than a notify. */
const ACTION_TONE: Record<ProposedAction, Tone> = {
  notify: "neutral",
  create_inbox_item: "neutral",
  suggest_reply: "brand",
  request_approval: "warning",
  hide_comment: "warning",
  report: "warning",
  escalate: "danger",
  assign_to_user: "neutral",
  create_incident: "danger",
  no_action: "neutral",
};

const RISK_TONE: Record<string, Tone> = {
  none: "neutral", low: "neutral", medium: "warning", high: "danger", critical: "danger",
};

export const queueStateTone = (v: QueueState | string): Tone => total(QUEUE_STATE_TONE, v);
export const executionTone = (v: ExecutionStatus | string): Tone => total(EXECUTION_TONE, v);
export const readinessTone = (v: Readiness | string): Tone => total(READINESS_TONE, v);
export const lifecycleTone = (v: Lifecycle | string): Tone => total(LIFECYCLE_TONE, v);
export const proposedActionTone = (v: ProposedAction | string): Tone => total(ACTION_TONE, v);
export const riskTone = (v: string | null): Tone => (v ? total(RISK_TONE, v) : "neutral");

/** Display label for a platform key, falling back to the raw key when unknown. */
const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  facebook_page: "Facebook",
  instagram: "Instagram",
  google_business: "Google Business",
  youtube: "YouTube",
  tiktok: "TikTok",
};
/** Own-property lookup — `__proto__` must not resolve to the prototype object. */
export const platformLabel = (key: string | null): string | null =>
  key ? (Object.prototype.hasOwnProperty.call(PLATFORM_LABEL, key) ? PLATFORM_LABEL[key]! : key) : null;

/**
 * Whether the queue row needs an operator decision RIGHT NOW.
 *
 * Not every active item does: `failed` is active work but is not awaiting an
 * approval, and a safety-blocked item is informational. This is what lets the
 * Active tab distinguish "needs you" from "still open".
 */
export function needsDecision(item: Pick<QueueItem, "queueState" | "canApprove">): boolean {
  return item.queueState === "approval_required" && item.canApprove;
}

/**
 * The two truths, deliberately kept apart.
 *
 * `decision` is what a human (or policy) decided inside Tamanor. `platform` is what
 * actually happened — or did not happen — on the provider. A screen renders both
 * labels; it must never show one "Done".
 */
export interface ExecutionSummary {
  /** Always present — the Tamanor-side decision. */
  decisionState: QueueState;
  /** Null when nothing has ever been attempted on the platform. */
  platformStatus: ExecutionStatus | null;
  platformTrigger: QueueExecution["trigger"] | null;
  /** True when the public content is known to have changed. */
  publicallyChanged: boolean;
}

export function executionSummary(item: Pick<QueueItem, "queueState" | "execution" | "lifecycle">): ExecutionSummary {
  const e = item.execution;
  return {
    decisionState: item.queueState,
    platformStatus: e?.status ?? null,
    platformTrigger: e?.trigger ?? null,
    // Only an actually-executed hide or a confirmed deletion changed the public post.
    publicallyChanged: item.lifecycle === "hidden" || item.lifecycle === "deleted",
  };
}

/** Whether the lifecycle is worth surfacing — `unknown` and `visible` are noise. */
export function shouldShowLifecycle(lifecycle: Lifecycle | string): boolean {
  return lifecycle !== "unknown" && lifecycle !== "visible";
}

/** Whether readiness is worth surfacing. Information only — never a live control. */
export function shouldShowReadiness(readiness: Readiness | string): boolean {
  return readiness !== "not_applicable";
}
