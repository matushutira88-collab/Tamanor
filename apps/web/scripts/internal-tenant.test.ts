/**
 * V1.73 — PURE tests for the internal Tamanor admin tenant override (no DB). Proves the central
 * resolvers grant unlimited access for an internal tenant (entitlements, access state, usage) while
 * NON-internal tenants still follow the exact billing rules, and that deletion still wins over internal.
 * Run: pnpm internal-tenant:test
 */
import { resolveEntitlements, resolveEffectiveAccessState, resolveEffectiveUsagePolicy, resolveTenantLifecycle } from "@guardora/core";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => { console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`); cond ? pass++ : fail++; };
const past = new Date("2020-01-01"); const future = new Date("2100-01-01");

function run() {
  // ---- INTERNAL tenant → unlimited everything (even over a would-be restricted state) ----------------
  const intEnt = resolveEntitlements("free_trial", "restricted", { internalAccess: true });
  check("internal: unlimited brands/accounts/seats/processed", intEnt.maxBrands === null && intEnt.maxConnectedAccounts === null && intEnt.maxTeamMembers === null && intEnt.monthlyProcessedItems === null);
  check("internal: export ON + all operation gates ON", intEnt.export === true && intEnt.providerSync === true && intEnt.moderationExecution === true && intEnt.paidAi === true);
  check("internal: per-brand platform caps unlimited", intEnt.maxFacebookPerBrand === null && intEnt.maxInstagramPerBrand === null);
  check("internal: effective access = full_access even for an EXPIRED trial", resolveEffectiveAccessState({ status: "no_subscription", trialEndsAt: past, internalAccess: true }) === "full_access");
  check("internal: effective access = full_access even when unpaid/suspended-ish", resolveEffectiveAccessState({ status: "unpaid", internalAccess: true }) === "full_access");
  check("internal: lifecycle reads active_paid (not trial_expired)", resolveTenantLifecycle({ status: "no_subscription", trialEndsAt: past, internalAccess: true }) === "active_paid");
  const intUsage = resolveEffectiveUsagePolicy("free_trial", "restricted", { internalAccess: true });
  check("internal: unlimited usage (no basic/premium/cost caps)", intUsage.basicUnitsPerPeriod === null && intUsage.premiumCallsPerPeriod === null && intUsage.premiumCostLimitMicros === null && intUsage.allowPaidFallback === true);

  // ---- deletion STILL wins over internal ------------------------------------------------------------
  const del = resolveEntitlements("enterprise", "full_access", { internalAccess: true, deletingTenant: true });
  check("deletion wins over internal (ops off, creation blocked)", del.providerSync === false && del.maxConnectedAccounts === 0);

  // ---- NON-internal tenants still follow the exact billing rules ------------------------------------
  const expired = resolveEntitlements("free_trial", "restricted", {});
  check("normal EXPIRED trial: restricted (caps 0, ops off) — still blocked", expired.maxConnectedAccounts === 0 && expired.maxBrands === 0 && expired.providerSync === false);
  check("normal expired trial access = restricted", resolveEffectiveAccessState({ status: "no_subscription", trialEndsAt: past }) === "restricted");
  check("normal UNPAID access = suspended → entitlements locked", resolveEffectiveAccessState({ status: "unpaid" }) === "suspended" && resolveEntitlements("starter", "suspended", {}).providerSync === false);
  check("normal PAID (active) → full_access + plan entitlements (growth: 3 brands, ops on)",
    resolveEffectiveAccessState({ status: "active", currentPeriodEnd: future }) === "full_access" &&
    resolveEntitlements("growth", "full_access", {}).maxBrands === 3 && resolveEntitlements("growth", "full_access", {}).providerSync === true);
  check("normal usage NOT unlimited (starter basic cap present)", resolveEffectiveUsagePolicy("starter", "full_access", {}).basicUnitsPerPeriod === 4000);

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — internal admin tenant override (V1.73): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
