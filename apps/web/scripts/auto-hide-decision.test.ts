/**
 * V1.59 — the automatic-hide decision gate (7 gates, fixed order). Pure. Run: pnpm auto-hide-decision:test
 */
import { evaluateAutoHideDecision } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

// A fully-permitting input; each test flips ONE gate off to assert it blocks with the right reason.
const OK = {
  featureEnabled: true, planAllows: true, accountActive: true, metaPermissionsOk: true,
  autoHideEnabled: true, autoHideMode: "automatic" as const, autoHideRiskThreshold: "high" as const,
  autoHideCategories: ["spam"], riskLevel: "high" as const, matchedCategory: "spam", notAlreadyActioned: true,
};

function run() {
  check("all gates pass → allowed", evaluateAutoHideDecision(OK).allow === true && evaluateAutoHideDecision(OK).gate === "allowed");

  check("global feature OFF → deny (feature_disabled)", evaluateAutoHideDecision({ ...OK, featureEnabled: false }).gate === "feature_disabled");
  check("plan denies → deny", evaluateAutoHideDecision({ ...OK, planAllows: false }).gate === "plan_denied");
  check("account inactive → deny", evaluateAutoHideDecision({ ...OK, accountActive: false }).gate === "account_inactive");
  check("permissions missing → deny", evaluateAutoHideDecision({ ...OK, metaPermissionsOk: false }).gate === "permissions_missing");
  check("auto-hide disabled → deny", evaluateAutoHideDecision({ ...OK, autoHideEnabled: false }).gate === "auto_hide_disabled");
  check("not automatic mode → deny", evaluateAutoHideDecision({ ...OK, autoHideMode: "manual_approval" }).gate === "not_automatic_mode");
  check("below risk threshold → deny", evaluateAutoHideDecision({ ...OK, riskLevel: "medium", autoHideRiskThreshold: "high" }).gate === "below_threshold");
  check("category not enabled → deny", evaluateAutoHideDecision({ ...OK, matchedCategory: "fraud" }).gate === "category_not_enabled");
  check("empty enabled categories → deny", evaluateAutoHideDecision({ ...OK, autoHideCategories: [] }).gate === "category_not_enabled");
  check("already actioned (idempotency) → deny", evaluateAutoHideDecision({ ...OK, notAlreadyActioned: false }).gate === "already_actioned");

  // Threshold ordering: critical comment passes a high threshold.
  check("critical >= high threshold → allowed", evaluateAutoHideDecision({ ...OK, riskLevel: "critical" }).allow === true);
  // Fixed gate ORDER: the first failing gate wins (feature flag beats a later block).
  check("gate order: feature flag beats a later block", evaluateAutoHideDecision({ ...OK, featureEnabled: false, autoHideEnabled: false }).gate === "feature_disabled");

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — auto-hide decision gate (V1.59): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
