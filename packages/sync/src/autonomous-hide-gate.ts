/**
 * V1.60 — the ONE place that maps live runtime state → the pure evaluateAutoHideDecision gate for the
 * AUTONOMOUS trigger. index.ts calls this at the autonomous-execution site (no inline decisioning), and
 * it is unit-tested directly (pure, no I/O). The decision is the INTERSECTION of:
 *   - the global feature kill switch,
 *   - the plan entitlement (moderationExecution) + access state,
 *   - the per-ACCOUNT effective protection (resolveAccountProtection): monitored + master mode `automatic`
 *     + risk threshold,
 *   - the Control-Center per-category autonomous policy (which categories) + its minConfidence,
 *   - the conservative server allow-list (spam/scam/phishing) inside the pure gate,
 *   - the classifier confidence,
 *   - the account kind (real — not test/mock/read-only) and connection state.
 * Unknown/incomplete inputs fail closed inside the pure gate.
 */
import {
  evaluateAutoHideDecision,
  AUTO_HIDE_MIN_CONFIDENCE,
  resolveEntitlements,
  accessAllowsOperations,
  type AutoHideDecision,
} from "@guardora/core";

const FACEBOOK_HIDE_PERMISSION = "pages_manage_engagement";
type Level = "low" | "medium" | "high" | "critical";

export interface AutonomousHideInput {
  plan: string;
  accessState: string;
  featureEnabled: boolean;
  account: {
    status: string;
    mode: string | null;
    grantedPermissions: string[];
    connectionStatus: string | null;
    tokenHealth: string | null;
  };
  effectiveProtection: {
    monitoringEnabled: boolean;
    autoHideEnabled: boolean;
    autoHideMode: "recommend" | "manual_approval" | "automatic";
    autoHideRiskThreshold: Level;
  };
  /** Control-Center per-category policies for this brand (autonomous ⇒ category is user-enabled). */
  controlPolicies: { category: string; mode: string; minConfidence?: number | null }[];
  matchedCategory: string | null;
  riskLevel: Level;
  confidence: number;
}

export function evaluateAutonomousHide(i: AutonomousHideInput): AutoHideDecision {
  const autonomousCategories = i.controlPolicies.filter((p) => p.mode === "autonomous").map((p) => p.category);
  const matchedPolicy = i.controlPolicies.find((p) => p.category === i.matchedCategory);
  const ent = resolveEntitlements(i.plan, i.accessState as never);
  const engagementOk = i.account.grantedPermissions.includes(FACEBOOK_HIDE_PERMISSION);
  // Mirrors accountKindOf (dashboard-metrics): real = not mock/placeholder and not read-only-without-engagement.
  const accountKindReal =
    i.account.status !== "mock_connected" && i.account.mode !== "placeholder" &&
    !(i.account.mode === "read_only" && !engagementOk);
  return evaluateAutoHideDecision({
    featureEnabled: i.featureEnabled,
    planAllows: ent.moderationExecution && accessAllowsOperations(i.accessState as never),
    accountActive: i.effectiveProtection.monitoringEnabled && i.account.status === "active" && i.account.connectionStatus === "connected",
    isTestOrReadOnly: !accountKindReal,
    metaPermissionsOk: engagementOk && !["expired", "invalid", "revoked"].includes(i.account.tokenHealth ?? ""),
    autoHideEnabled: i.effectiveProtection.autoHideEnabled,
    autoHideMode: i.effectiveProtection.autoHideMode,
    autoHideRiskThreshold: i.effectiveProtection.autoHideRiskThreshold,
    autoHideCategories: autonomousCategories,
    riskLevel: i.riskLevel,
    confidence: i.confidence,
    confidenceThreshold: Math.max(matchedPolicy?.minConfidence ?? 0, AUTO_HIDE_MIN_CONFIDENCE),
    matchedCategory: i.matchedCategory,
    // Idempotency is enforced in the EXECUTION layer (findExistingExecutions + the partial unique index
    // on executed rows); the pure decision stays idempotency-agnostic here.
    notAlreadyActioned: true,
  });
}
