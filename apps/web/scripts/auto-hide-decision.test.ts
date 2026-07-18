/**
 * V1.59/V1.60 — the automatic-hide decision gate (fixed order). Pure. Run: pnpm auto-hide-decision:test
 */
import { evaluateAutoHideDecision, isAutoHideEligibleCategory, AUTO_HIDE_ELIGIBLE_CATEGORIES } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

// A fully-permitting input; each test flips ONE gate off to assert it blocks with the right reason.
const OK = {
  featureEnabled: true, planAllows: true, accountActive: true, isTestOrReadOnly: false, metaPermissionsOk: true,
  autoHideEnabled: true, autoHideMode: "automatic" as const, autoHideRiskThreshold: "high" as const,
  autoHideCategories: ["spam"], riskLevel: "high" as const, confidence: 0.9, confidenceThreshold: 0.8,
  matchedCategory: "spam", notAlreadyActioned: true,
};

function run() {
  check("all gates pass → allowed", evaluateAutoHideDecision(OK).allow === true && evaluateAutoHideDecision(OK).gate === "allowed");

  check("global feature OFF → deny (feature_disabled)", evaluateAutoHideDecision({ ...OK, featureEnabled: false }).gate === "feature_disabled");
  check("plan denies → deny", evaluateAutoHideDecision({ ...OK, planAllows: false }).gate === "plan_denied");
  check("account inactive → deny", evaluateAutoHideDecision({ ...OK, accountActive: false }).gate === "account_inactive");
  check("test/read-only account → deny (account_test_or_read_only)", evaluateAutoHideDecision({ ...OK, isTestOrReadOnly: true }).gate === "account_test_or_read_only");
  check("permissions missing → deny", evaluateAutoHideDecision({ ...OK, metaPermissionsOk: false }).gate === "permissions_missing");
  check("auto-hide disabled → deny", evaluateAutoHideDecision({ ...OK, autoHideEnabled: false }).gate === "auto_hide_disabled");
  check("not automatic mode (manual_approval) → deny", evaluateAutoHideDecision({ ...OK, autoHideMode: "manual_approval" }).gate === "not_automatic_mode");
  check("recommend mode (SUGGEST_ONLY) → deny", evaluateAutoHideDecision({ ...OK, autoHideMode: "recommend" }).gate === "not_automatic_mode");
  check("below risk threshold → deny", evaluateAutoHideDecision({ ...OK, riskLevel: "medium", autoHideRiskThreshold: "high" }).gate === "below_threshold");
  check("below confidence threshold → deny (low_confidence)", evaluateAutoHideDecision({ ...OK, confidence: 0.79 }).gate === "low_confidence");
  check("category not enabled → deny", evaluateAutoHideDecision({ ...OK, matchedCategory: "hate_speech" }).gate === "category_not_enabled");
  check("empty enabled categories → deny", evaluateAutoHideDecision({ ...OK, autoHideCategories: [] }).gate === "category_not_enabled");
  // Enabled by the user but NOT on the conservative server allow-list → still blocked.
  check("subjective category enabled but not server-eligible → deny (category_not_auto_eligible)",
    evaluateAutoHideDecision({ ...OK, autoHideCategories: ["profanity"], matchedCategory: "profanity" }).gate === "category_not_auto_eligible");
  check("hate_speech enabled but not server-eligible → deny (category_not_auto_eligible)",
    evaluateAutoHideDecision({ ...OK, autoHideCategories: ["hate_speech"], matchedCategory: "hate_speech" }).gate === "category_not_auto_eligible");
  check("already actioned (idempotency) → deny", evaluateAutoHideDecision({ ...OK, notAlreadyActioned: false }).gate === "already_actioned");

  // Server allow-list: only spam/scam/phishing auto-execute; scam & phishing also allowed when enabled.
  check("scam (enabled + eligible) → allowed", evaluateAutoHideDecision({ ...OK, autoHideCategories: ["scam"], matchedCategory: "scam" }).allow === true);
  check("phishing (enabled + eligible) → allowed", evaluateAutoHideDecision({ ...OK, autoHideCategories: ["phishing"], matchedCategory: "phishing" }).allow === true);
  check("allow-list = exactly spam/scam/phishing", AUTO_HIDE_ELIGIBLE_CATEGORIES.slice().sort().join(",") === "phishing,scam,spam");
  check("isAutoHideEligibleCategory: spam yes, profanity no, null no",
    isAutoHideEligibleCategory("spam") && !isAutoHideEligibleCategory("profanity") && !isAutoHideEligibleCategory(null));

  // Threshold ordering: critical comment passes a high threshold.
  check("critical >= high threshold → allowed", evaluateAutoHideDecision({ ...OK, riskLevel: "critical" }).allow === true);
  // Fixed gate ORDER: the first failing gate wins (feature flag beats a later block).
  check("gate order: feature flag beats a later block", evaluateAutoHideDecision({ ...OK, featureEnabled: false, autoHideEnabled: false }).gate === "feature_disabled");
  check("gate order: test/read-only beats permissions", evaluateAutoHideDecision({ ...OK, isTestOrReadOnly: true, metaPermissionsOk: false }).gate === "account_test_or_read_only");

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — auto-hide decision gate (V1.60): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
