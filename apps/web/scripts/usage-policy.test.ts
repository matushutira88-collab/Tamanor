/**
 * V1.44 — usage policy + pricing + fuse-config truth (pure, no DB).
 * Run: pnpm usage-policy:test
 */
import { resolveUsagePolicy, isKnownPlan, POLICY_VERSION, estimateCostMicros, actualCostMicros, SAFE_FALLBACK_MICROS, hasPricing } from "@guardora/core";
import { getPaidAiFuseConfig } from "@guardora/config";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

function run() {
  const free = resolveUsagePolicy("free");
  check("1) Free = 500 basic / 10 premium / 200000 micros, no generated replies", free.basicUnitsPerPeriod === 500 && free.premiumCallsPerPeriod === 10 && free.premiumCostLimitMicros === 200_000n && free.allowGeneratedReplies === false && free.allowPaidFallback === true);
  check("2) unknown / null / '' / legacy 'dev' plan → Free (never unlimited paid)", [resolveUsagePolicy("banana"), resolveUsagePolicy(null), resolveUsagePolicy(undefined), resolveUsagePolicy(""), resolveUsagePolicy("dev")].every((p) => p.plan === "free" && p.premiumCallsPerPeriod === 10 && p.premiumCostLimitMicros === 200_000n));
  check("3) known plans validate; unknown does not", isKnownPlan("free") && isKnownPlan("enterprise") && !isKnownPlan("banana") && !isKnownPlan(null));
  check("4) enterprise (KNOWN) may be uncapped, but that is never reachable from an unknown plan", resolveUsagePolicy("enterprise").premiumCallsPerPeriod === null && resolveUsagePolicy("enterprise").premiumCostLimitMicros === null);
  check("5) POLICY_VERSION is set", typeof POLICY_VERSION === "string" && POLICY_VERSION.length > 0);

  // pricing — integer micros, conservative fallback
  check("6) none/mock providers are free", estimateCostMicros("none", "none", 2000, 512) === 0n && estimateCostMicros("mock", "mock", 2000, 512) === 0n);
  const est = estimateCostMicros("unpriced-provider", "x", 2000, 512);
  check("7) unpriced paid provider falls back to a conservative (expensive) estimate — fail closed", est === SAFE_FALLBACK_MICROS && typeof est === "bigint" && !hasPricing("unpriced-provider", "x"));
  check("8) actual cost is integer micros bigint", typeof actualCostMicros("mock", "mock", 100, 50) === "bigint");

  // fuses — fail closed by default
  const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
  check("9) paid AI is DISABLED by default (kill switch off)", getPaidAiFuseConfig(env({})).effectiveEnabled === false);
  check("10) paid AI enabled only with the explicit master switch + sane caps", getPaidAiFuseConfig(env({ AI_PAID_ENABLED: "true" })).effectiveEnabled === true);
  check("11) emergency disable overrides enabled (fail closed)", getPaidAiFuseConfig(env({ AI_PAID_ENABLED: "true", AI_PAID_EMERGENCY_DISABLE: "true" })).effectiveEnabled === false);
  check("12) invalid config (zero global cap) fails closed to disabled", getPaidAiFuseConfig(env({ AI_PAID_ENABLED: "true", AI_PAID_GLOBAL_DAILY_CALL_LIMIT: "0" })).effectiveEnabled === false);

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — usage policy / pricing / fuses (V1.44)`);
  process.exit(failures === 0 ? 0 : 1);
}
run();
