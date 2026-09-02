/**
 * Bounded key → tone mappings for the Inbox.
 *
 * Pure and dictionary-free: the LABEL always comes from i18n, this file only says
 * which tone reinforces it. Tone is never the sole carrier of meaning — every
 * badge in the UI renders a localized word alongside it.
 *
 * Every lookup is total: an unrecognised key from a future server version falls
 * back to a neutral tone rather than crashing or being rendered raw.
 */

import type {
  ClassificationState, ConnectorHealth, InboxActionState, InboxItem, InboxPriority,
  InboxProcessing, InboxRisk, InboxSentiment, InboxWorkflow,
} from "@/api/types";

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger";

const RISK_TONE: Record<InboxRisk, Tone> = {
  none: "neutral", low: "neutral", medium: "warning", high: "danger", critical: "danger",
};

const SENTIMENT_TONE: Record<InboxSentiment, Tone> = {
  positive: "success", neutral: "neutral", negative: "warning", risky: "danger",
};

const PRIORITY_TONE: Record<InboxPriority, Tone> = {
  low: "neutral", normal: "neutral", high: "warning", urgent: "danger",
};

const WORKFLOW_TONE: Record<InboxWorkflow, Tone> = {
  new: "brand", in_review: "warning", action_required: "danger", resolved: "success",
};

/**
 * Truthful processing tone. A limit/disabled/failed state is NEVER "ok" — it means
 * the advanced tier did not run, not that analysis was performed and came back clean.
 */
const PROCESSING_TONE: Record<InboxProcessing, Tone> = {
  pending: "neutral",
  processed_rules: "neutral",
  processed_local: "neutral",
  processed_paid: "success",
  cached: "neutral",
  basic_limit_reached: "warning",
  premium_limit_reached: "warning",
  paid_ai_disabled: "neutral",
  failed: "danger",
};

/** Honest connector health. Only a genuinely healthy connector reads as success. */
const HEALTH_TONE: Record<ConnectorHealth, Tone> = {
  healthy: "success",
  verification_pending: "warning",
  rate_limited: "warning",
  permission_missing: "danger",
  disconnected: "danger",
  api_unavailable: "neutral",
  error: "danger",
};

const ACTION_TONE: Record<InboxActionState, Tone> = {
  deleted: "neutral", hidden: "success", cannot_hide: "warning", pending: "warning",
  monitored: "brand", no_action: "neutral", kept: "neutral", captured: "neutral",
};

const CLASSIFICATION_TONE: Record<ClassificationState, Tone> = {
  confirmed: "danger", review_required: "warning", no_issue: "neutral",
};

/**
 * Total lookup. Uses an OWN-property check rather than plain indexing: a key such
 * as `__proto__` or `constructor` would otherwise resolve to an inherited
 * `Object.prototype` member and slip past a `??` fallback.
 */
const total = <K extends string>(map: Record<K, Tone>, key: K | string): Tone =>
  Object.prototype.hasOwnProperty.call(map, key) ? (map as Record<string, Tone>)[key]! : "neutral";

export const riskTone = (v: InboxRisk | string): Tone => total(RISK_TONE, v);
export const sentimentTone = (v: InboxSentiment | string): Tone => total(SENTIMENT_TONE, v);
export const priorityTone = (v: InboxPriority | string): Tone => total(PRIORITY_TONE, v);
export const workflowTone = (v: InboxWorkflow | string): Tone => total(WORKFLOW_TONE, v);
export const processingTone = (v: InboxProcessing | string): Tone => total(PROCESSING_TONE, v);
export const connectorTone = (v: ConnectorHealth | string): Tone => total(HEALTH_TONE, v);
export const actionStateTone = (v: InboxActionState | string): Tone => total(ACTION_TONE, v);
export const classificationTone = (v: ClassificationState | string): Tone => total(CLASSIFICATION_TONE, v);

/** Display label for a platform key, falling back to the raw key when unknown. */
const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  google_business: "Google Business",
  youtube: "YouTube",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};
export const platformLabel = (key: string): string => PLATFORM_LABEL[key] ?? key;

/**
 * Whether the item's processing state should be surfaced at all.
 *
 * A normally-analysed row does not need a chip; a limit, disabled or failed state
 * does, because the user would otherwise assume advanced analysis ran.
 */
export function shouldShowProcessing(processing: InboxProcessing | string): boolean {
  return processing === "basic_limit_reached" || processing === "premium_limit_reached"
    || processing === "paid_ai_disabled" || processing === "failed" || processing === "pending";
}

/** Whether the connector state is worth surfacing on a row. */
export function shouldShowConnector(health: ConnectorHealth | string): boolean {
  return health !== "healthy";
}

/**
 * Whether the public/action state is worth surfacing. `captured` is the ordinary
 * resting state and would be noise on every row.
 */
export function shouldShowActionState(state: InboxActionState | string): boolean {
  return state !== "captured" && state !== "kept";
}

/** True for a review that carries a rating but no written text. */
export function isRatingOnlyReview(item: Pick<InboxItem, "type" | "preview" | "rating">): boolean {
  return item.type === "review" && !item.preview && item.rating !== null;
}
