/**
 * V1.59 — the SINGLE deterministic gate for whether an automatic comment-hide may execute. Every gate
 * must pass, checked in a fixed order so the FIRST failing gate is the reported reason. This is a pure
 * decision function (no I/O) so it is exhaustively testable; the caller supplies the already-loaded
 * facts. It never loosens any existing safety check — it is defense-in-depth on top of them.
 *
 * Gate order (spec K): global feature flag → plan entitlement → account status → Meta permissions →
 * account-level rules (enabled + automatic mode + risk threshold + category) → risk result → idempotency.
 */
/** Local risk-level alias (the canonical RiskLevel is exported from ./reputation). */
type Level = "low" | "medium" | "high" | "critical";

export interface AutoHideDecisionInput {
  /** Global kill switch: META_COMMENT_HIDE_FEATURE_ENABLED. Off ⇒ NO automatic action anywhere. */
  featureEnabled: boolean;
  /** Plan permits automatic operations for this tenant (entitlement/access state). */
  planAllows: boolean;
  /** Account is active + monitored (not disconnected / not per-account killSwitch). */
  accountActive: boolean;
  /** Meta permissions healthy enough to hide (token ok + required permission granted). */
  metaPermissionsOk: boolean;
  /** Effective (resolved) account protection. */
  autoHideEnabled: boolean;
  autoHideMode: "recommend" | "manual_approval" | "automatic";
  autoHideRiskThreshold: Level;
  autoHideCategories: string[];
  /** The classifier result for this comment. */
  riskLevel: Level;
  matchedCategory: string | null;
  /** Idempotency: this comment has NOT already had a hide executed/recorded. */
  notAlreadyActioned: boolean;
}

export type AutoHideGate =
  | "feature_disabled" | "plan_denied" | "account_inactive" | "permissions_missing"
  | "auto_hide_disabled" | "not_automatic_mode" | "below_threshold" | "category_not_enabled"
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
  if (!input.metaPermissionsOk) return { allow: false, gate: "permissions_missing" };
  if (!input.autoHideEnabled) return { allow: false, gate: "auto_hide_disabled" };
  if (input.autoHideMode !== "automatic") return { allow: false, gate: "not_automatic_mode" };
  if (RANK[input.riskLevel] < RANK[input.autoHideRiskThreshold]) return { allow: false, gate: "below_threshold" };
  // Category gate: an empty enabled-category set means "no category enabled" ⇒ never auto-hide.
  if (!input.matchedCategory || !input.autoHideCategories.includes(input.matchedCategory)) {
    return { allow: false, gate: "category_not_enabled" };
  }
  if (!input.notAlreadyActioned) return { allow: false, gate: "already_actioned" };
  return { allow: true, gate: "allowed" };
}
