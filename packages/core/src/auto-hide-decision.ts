/**
 * V1.59/V1.60 — the SINGLE deterministic gate for whether an automatic comment-hide may execute. Every
 * gate must pass, checked in a fixed order so the FIRST failing gate is the reported reason. This is a
 * pure decision function (no I/O) so it is exhaustively testable; the caller supplies the already-loaded
 * facts. It never loosens any existing safety check — it is defense-in-depth on top of them.
 *
 * V1.60 hybrid model: the per-ACCOUNT protection mode (recommend | manual_approval | automatic) is the
 * master switch — only `automatic` may act autonomously. WHICH categories are eligible is the
 * intersection of the account's enabled categories (from the Control Center per-category autonomous
 * policy) AND a conservative server-side allow-list ({@link AUTO_HIDE_ELIGIBLE_CATEGORIES}) that, at
 * launch, permits only the relatively objective categories (spam / scam / phishing). Subjective
 * categories (profanity, hate, harassment, impersonation, …) can be detected and proposed but are NEVER
 * executed autonomously — they fail `category_not_auto_eligible` here regardless of user configuration.
 *
 * Gate order: global feature flag → plan entitlement → account status → test/read-only → Meta
 * permissions → account-level rules (enabled + automatic mode) → risk threshold → confidence →
 * category enabled → category server-eligible → idempotency.
 */
/** Local risk-level alias (the canonical RiskLevel is exported from ./reputation). */
type Level = "low" | "medium" | "high" | "critical";

/**
 * Conservative server-side allow-list of categories that may be executed AUTONOMOUSLY at launch. This is
 * intentionally STRICTER than the broader `AUTONOMOUS_ELIGIBLE` set used for the manual/approval paths:
 * only relatively objective abuse categories are auto-executed. "malicious/suspicious link" is covered by
 * `phishing`/`spam` (there is no separate category). Widening this set is a deliberate product decision
 * that must follow real false-positive data — never loosen it implicitly.
 */
export const AUTO_HIDE_ELIGIBLE_CATEGORIES: readonly string[] = ["spam", "scam", "phishing"];
export function isAutoHideEligibleCategory(category: string | null | undefined): boolean {
  return !!category && AUTO_HIDE_ELIGIBLE_CATEGORIES.includes(category);
}

/** Hard server-side confidence floor for ANY autonomous hide. A per-category Control-Center
 *  minConfidence may raise it, never lower it. Single source for the decision + execution layers. */
export const AUTO_HIDE_MIN_CONFIDENCE = 0.8;

export interface AutoHideDecisionInput {
  /** Global kill switch: META_COMMENT_HIDE_FEATURE_ENABLED. Off ⇒ NO automatic action anywhere. */
  featureEnabled: boolean;
  /** Plan permits automatic operations for this tenant (entitlement + access state). */
  planAllows: boolean;
  /** Account is active + monitored (not disconnected / not per-account killSwitch). */
  accountActive: boolean;
  /** Account is a real, actionable account — NOT a demo/mock/read-only account. */
  isTestOrReadOnly: boolean;
  /** Meta permissions healthy enough to hide (token ok + required permission granted). */
  metaPermissionsOk: boolean;
  /** Effective (resolved) per-account protection. */
  autoHideEnabled: boolean;
  autoHideMode: "recommend" | "manual_approval" | "automatic";
  autoHideRiskThreshold: Level;
  /** Categories the user/Control Center has enabled for autonomous action on this account. */
  autoHideCategories: string[];
  /** The classifier result for this comment. */
  riskLevel: Level;
  /** Classifier confidence 0..1 and the minimum required to auto-execute. */
  confidence: number;
  confidenceThreshold: number;
  matchedCategory: string | null;
  /** Idempotency: this comment has NOT already had a hide executed/recorded. */
  notAlreadyActioned: boolean;
}

export type AutoHideGate =
  | "feature_disabled" | "plan_denied" | "account_inactive" | "account_test_or_read_only"
  | "permissions_missing" | "auto_hide_disabled" | "not_automatic_mode" | "below_threshold"
  | "low_confidence" | "category_not_enabled" | "category_not_auto_eligible"
  | "already_actioned" | "allowed";

export interface AutoHideDecision {
  allow: boolean;
  gate: AutoHideGate;
}

const RANK: Record<Level, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function evaluateAutoHideDecision(input: AutoHideDecisionInput): AutoHideDecision {
  if (!input.featureEnabled) return { allow: false, gate: "feature_disabled" };
  if (!input.planAllows) return { allow: false, gate: "plan_denied" };
  if (!input.accountActive) return { allow: false, gate: "account_inactive" };
  if (input.isTestOrReadOnly) return { allow: false, gate: "account_test_or_read_only" };
  if (!input.metaPermissionsOk) return { allow: false, gate: "permissions_missing" };
  if (!input.autoHideEnabled) return { allow: false, gate: "auto_hide_disabled" };
  if (input.autoHideMode !== "automatic") return { allow: false, gate: "not_automatic_mode" };
  if (RANK[input.riskLevel] < RANK[input.autoHideRiskThreshold]) return { allow: false, gate: "below_threshold" };
  if (input.confidence < input.confidenceThreshold) return { allow: false, gate: "low_confidence" };
  // Category gate: an empty enabled-category set means "no category enabled" ⇒ never auto-hide.
  if (!input.matchedCategory || !input.autoHideCategories.includes(input.matchedCategory)) {
    return { allow: false, gate: "category_not_enabled" };
  }
  // Server-side safety allow-list: even a user-enabled category is auto-executed only if it is one of the
  // conservative objective categories. Subjective categories are detect/propose-only at launch.
  if (!isAutoHideEligibleCategory(input.matchedCategory)) {
    return { allow: false, gate: "category_not_auto_eligible" };
  }
  if (!input.notAlreadyActioned) return { allow: false, gate: "already_actioned" };
  return { allow: true, gate: "allowed" };
}
