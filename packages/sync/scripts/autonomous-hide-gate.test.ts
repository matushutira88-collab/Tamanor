/**
 * V1.60 (increment 2b) — the runtime→gate mapping for the AUTONOMOUS trigger. Pure, no DB.
 * Proves the single decision authority (evaluateAutonomousHide → evaluateAutoHideDecision) blocks
 * every unsafe combination and only lets a real, monitored, AUTOMATIC account with an enabled,
 * server-eligible, high-confidence category proceed to the execution layer.
 * Run: pnpm autonomous-hide-gate:test
 */
import { evaluateAutonomousHide, type AutonomousHideInput } from "../src/autonomous-hide-gate";

let pass = 0, fail = 0;
const check = (l: string, cond: boolean, d = "") => { console.log(`${cond ? "  ✓" : "  ✗"} ${l}${cond ? "" : `  — ${d}`}`); cond ? pass++ : fail++; };

// A fully-permitting, realistic runtime input: Starter plan, real active+connected FB account with the
// hide permission, per-account AUTOMATIC, Control-Center spam=autonomous, spam comment @ high/0.9.
const BASE: AutonomousHideInput = {
  plan: "starter", accessState: "full_access", featureEnabled: true,
  account: { status: "active", mode: "oauth_ready", grantedPermissions: ["pages_manage_engagement"], connectionStatus: "connected", tokenHealth: "ok" },
  effectiveProtection: { monitoringEnabled: true, autoHideEnabled: true, autoHideMode: "automatic", autoHideRiskThreshold: "high" },
  controlPolicies: [{ category: "spam", mode: "autonomous", minConfidence: 0.8 }],
  matchedCategory: "spam", riskLevel: "high", confidence: 0.9,
};
const g = (over: Partial<AutonomousHideInput>) => evaluateAutonomousHide({ ...BASE, ...over });

function run() {
  console.log("Baseline");
  check("real+monitored+AUTOMATIC+spam@0.9 → allowed", g({}).allow === true && g({}).gate === "allowed");

  console.log("Per-account master mode (SUGGEST_ONLY / REQUIRE_APPROVAL never autonomous)");
  check("SUGGEST_ONLY (recommend) never executes → not_automatic_mode",
    g({ effectiveProtection: { ...BASE.effectiveProtection, autoHideMode: "recommend" } }).gate === "not_automatic_mode");
  check("REQUIRE_APPROVAL (manual_approval) never autonomous → not_automatic_mode",
    g({ effectiveProtection: { ...BASE.effectiveProtection, autoHideMode: "manual_approval" } }).gate === "not_automatic_mode");
  check("auto-hide master OFF → auto_hide_disabled",
    g({ effectiveProtection: { ...BASE.effectiveProtection, autoHideEnabled: false } }).gate === "auto_hide_disabled");

  console.log("Category (Control-Center enabled ∩ server allow-list)");
  check("AUTOMATIC + enabled + eligible spam → allowed", g({}).allow === true);
  check("scam enabled+eligible → allowed", g({ controlPolicies: [{ category: "scam", mode: "autonomous" }], matchedCategory: "scam" }).allow === true);
  check("phishing enabled+eligible → allowed", g({ controlPolicies: [{ category: "phishing", mode: "autonomous" }], matchedCategory: "phishing" }).allow === true);
  check("per-category NOT autonomous (approval) → category_not_enabled",
    g({ controlPolicies: [{ category: "spam", mode: "approval" }] }).gate === "category_not_enabled");
  check("no Control-Center policy for the category → category_not_enabled",
    g({ controlPolicies: [] }).gate === "category_not_enabled");
  check("subjective category enabled but NOT server-eligible (hate_speech) → category_not_auto_eligible",
    g({ controlPolicies: [{ category: "hate_speech", mode: "autonomous" }], matchedCategory: "hate_speech" }).gate === "category_not_auto_eligible");
  check("brand_impersonation autonomous but not eligible → category_not_auto_eligible",
    g({ controlPolicies: [{ category: "brand_impersonation", mode: "autonomous" }], matchedCategory: "brand_impersonation" }).gate === "category_not_auto_eligible");

  console.log("Confidence + risk threshold");
  check("below Control-Center minConfidence → low_confidence",
    g({ controlPolicies: [{ category: "spam", mode: "autonomous", minConfidence: 0.95 }], confidence: 0.9 }).gate === "low_confidence");
  check("below hard 0.8 floor even with no policy minConfidence → low_confidence",
    g({ controlPolicies: [{ category: "spam", mode: "autonomous" }], confidence: 0.7 }).gate === "low_confidence");
  check("below risk threshold (medium < high) → below_threshold", g({ riskLevel: "medium" }).gate === "below_threshold");

  console.log("Plan entitlement (moderationExecution)");
  check("unknown plan (free → MINIMAL, no moderationExecution) → plan_denied", g({ plan: "free" }).gate === "plan_denied");
  check("restricted access state → plan_denied", g({ accessState: "restricted" }).gate === "plan_denied");
  check("suspended access state → plan_denied", g({ accessState: "suspended" }).gate === "plan_denied");
  check("growth plan allowed", g({ plan: "growth" }).allow === true);
  check("free_trial plan allowed (limited elsewhere by quota)", g({ plan: "free_trial" }).allow === true);

  console.log("Account kind + monitoring + connection");
  check("mock_connected account → blocked (never allowed)", g({ account: { ...BASE.account, status: "mock_connected" } }).allow === false);
  check("test account (placeholder mode) → account_test_or_read_only", g({ account: { ...BASE.account, mode: "placeholder" } }).gate === "account_test_or_read_only");
  check("read-only account (no engagement perm) → account_test_or_read_only",
    g({ account: { ...BASE.account, mode: "read_only", grantedPermissions: [] } }).gate === "account_test_or_read_only");
  check("monitoring OFF → account_inactive", g({ effectiveProtection: { ...BASE.effectiveProtection, monitoringEnabled: false } }).gate === "account_inactive");
  check("connection not connected (needs_reconnect) → account_inactive", g({ account: { ...BASE.account, connectionStatus: "needs_reconnect" } }).gate === "account_inactive");
  check("missing hide permission → permissions_missing", g({ account: { ...BASE.account, grantedPermissions: ["pages_read_engagement"], mode: "oauth_ready" } }).gate === "permissions_missing");
  check("expired token → permissions_missing", g({ account: { ...BASE.account, tokenHealth: "expired" } }).gate === "permissions_missing");

  console.log("Global kill switch");
  check("global feature kill switch OFF → feature_disabled (no Meta request path)", g({ featureEnabled: false }).gate === "feature_disabled");

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — autonomous-hide runtime→gate mapping (V1.60): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
