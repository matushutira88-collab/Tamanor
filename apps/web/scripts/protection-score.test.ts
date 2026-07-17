/**
 * V1.59 — deterministic protection score. Pure. Run: pnpm protection-score:test
 */
import { computeProtectionScore } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const ALL_OFF = { metaPermissionsHealthy: false, syncHealthy: false, rulesActive: false, dangerousLinksHandled: false, fraudProtection: false, reviewWorkflow: false, actionConfigured: false };
const ALL_ON = { metaPermissionsHealthy: true, syncHealthy: true, rulesActive: true, dangerousLinksHandled: true, fraudProtection: true, reviewWorkflow: true, actionConfigured: true };

function run() {
  check("all off → 0 / critical", computeProtectionScore(ALL_OFF).score === 0 && computeProtectionScore(ALL_OFF).level === "critical");
  check("all on → 100 / strong", computeProtectionScore(ALL_ON).score === 100 && computeProtectionScore(ALL_ON).level === "strong");
  check("max is 100", computeProtectionScore(ALL_ON).max === 100);

  // Deterministic: same input → same score, always.
  check("deterministic (not random)", computeProtectionScore(ALL_ON).score === computeProtectionScore(ALL_ON).score);

  // Predictable component weights.
  const perm = computeProtectionScore({ ...ALL_OFF, metaPermissionsHealthy: true });
  check("Meta permissions = 20", perm.score === 20 && perm.components.find((c) => c.key === "metaPermissionsHealthy")?.points === 20);
  const links = computeProtectionScore({ ...ALL_OFF, dangerousLinksHandled: true });
  check("dangerous links = 10", links.score === 10);

  // A single config change moves the score by exactly that component's weight (predictable).
  const base = computeProtectionScore({ ...ALL_OFF, metaPermissionsHealthy: true, syncHealthy: true }); // 40
  const plusRules = computeProtectionScore({ ...ALL_OFF, metaPermissionsHealthy: true, syncHealthy: true, rulesActive: true }); // 60
  check("enabling rules raises score by exactly 20", plusRules.score - base.score === 20);

  // Breakdown is explainable + complete.
  check("breakdown has all 7 components", computeProtectionScore(ALL_ON).components.length === 7);
  check("breakdown sums to score", computeProtectionScore(ALL_ON).components.reduce((s, c) => s + c.points, 0) === 100);

  // Levels are monotonic.
  check("level thresholds ordered", computeProtectionScore({ ...ALL_OFF, metaPermissionsHealthy: true }).level === "critical"
    && computeProtectionScore({ ...ALL_ON, actionConfigured: false, reviewWorkflow: false }).level === "good");

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — protection score (V1.59): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
