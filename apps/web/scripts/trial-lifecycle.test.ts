/**
 * V1.68 — PURE tests for the tenant trial/billing lifecycle (no DB, no network). Proves:
 *  1) resolveEffectiveAccessState enforces trial expiry from billing fields at read time (the SPOF
 *     removal) — a lapsed trial is `restricted` WITHOUT any cron having run.
 *  2) The persisted "suspended" override and the billing-derived suspended (unpaid/paused) both win.
 *  3) resolveTenantLifecycle covers EXACTLY the six canonical states and each one is reachable.
 *  4) trialDaysRemaining is correct (ceil, floors at 0, null when no trial end).
 * Run: pnpm trial-lifecycle:test
 */
import {
  resolveEffectiveAccessState, resolveTenantLifecycle, trialDaysRemaining,
  TENANT_LIFECYCLE_STATES, type TenantLifecycleState,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};

const now = new Date("2026-07-16T12:00:00.000Z");
const inDays = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);

function run() {
  // ---- 1) trial expiry is enforced at READ time (no cron on the path) ----------------------------
  check("active trial (no_subscription, trialEndsAt in future) → full_access",
    resolveEffectiveAccessState({ status: "no_subscription", trialEndsAt: inDays(3), now }) === "full_access");
  check("EXPIRED trial (no_subscription, trialEndsAt in past) → restricted — no sweep needed",
    resolveEffectiveAccessState({ status: "no_subscription", trialEndsAt: inDays(-1), now }) === "restricted");
  check("expired trial but persisted accessState STILL 'full_access' (stale cache) → recomputed restricted",
    resolveEffectiveAccessState({ status: "no_subscription", trialEndsAt: inDays(-1), persistedAccessState: "full_access", now }) === "restricted");
  check("trialing status past its end → restricted",
    resolveEffectiveAccessState({ status: "trialing", trialEndsAt: inDays(-0.5), now }) === "restricted");

  // ---- paid + grace + suspended enforcement ------------------------------------------------------
  check("active subscription → full_access",
    resolveEffectiveAccessState({ status: "active", currentPeriodEnd: inDays(20), now }) === "full_access");
  check("past_due within grace (period ended 2d ago, 7d grace) → grace_period",
    resolveEffectiveAccessState({ status: "past_due", currentPeriodEnd: inDays(-2), now }) === "grace_period");
  check("past_due beyond grace → restricted",
    resolveEffectiveAccessState({ status: "past_due", currentPeriodEnd: inDays(-30), now }) === "restricted");
  check("unpaid (dunning exhausted) → suspended",
    resolveEffectiveAccessState({ status: "unpaid", currentPeriodEnd: inDays(-30), now }) === "suspended");
  check("paused → suspended",
    resolveEffectiveAccessState({ status: "paused", now }) === "suspended");
  check("persisted 'suspended' admin override wins over an otherwise-active billing state",
    resolveEffectiveAccessState({ status: "active", currentPeriodEnd: inDays(20), persistedAccessState: "suspended", now }) === "suspended");

  // ---- 3) lifecycle: exactly six states, each reachable ------------------------------------------
  const seen = new Set<TenantLifecycleState>();
  const lc = (o: Parameters<typeof resolveTenantLifecycle>[0]) => { const s = resolveTenantLifecycle(o); seen.add(s); return s; };
  check("active_trial", lc({ status: "no_subscription", trialEndsAt: inDays(5), now }) === "active_trial");
  check("trial_expired", lc({ status: "no_subscription", trialEndsAt: inDays(-1), now }) === "trial_expired");
  check("active_paid (active)", lc({ status: "active", currentPeriodEnd: inDays(20), now }) === "active_paid");
  check("active_paid (canceled but still within paid period → still paid through)",
    lc({ status: "canceled", currentPeriodEnd: inDays(5), now }) === "active_paid");
  check("past_due", lc({ status: "past_due", currentPeriodEnd: inDays(-1), now }) === "past_due");
  check("canceled (period over)", lc({ status: "canceled", currentPeriodEnd: inDays(-5), now }) === "canceled");
  check("suspended (unpaid)", lc({ status: "unpaid", now }) === "suspended");
  check("suspended (admin override)", lc({ status: "active", currentPeriodEnd: inDays(20), persistedAccessState: "suspended", now }) === "suspended");
  check("lifecycle covers EXACTLY the six canonical states, all reachable",
    seen.size === TENANT_LIFECYCLE_STATES.length && TENANT_LIFECYCLE_STATES.every((s) => seen.has(s)),
    `reached=${[...seen].sort().join(",")}`);

  // ---- 4) trialDaysRemaining --------------------------------------------------------------------
  check("trialDaysRemaining: ~3 days ahead → 3 (ceil)", trialDaysRemaining(inDays(3), now) === 3);
  check("trialDaysRemaining: partial day ahead → 1 (ceil)", trialDaysRemaining(new Date(now.getTime() + 60_000), now) === 1);
  check("trialDaysRemaining: elapsed → 0", trialDaysRemaining(inDays(-1), now) === 0);
  check("trialDaysRemaining: no trial end → null", trialDaysRemaining(null, now) === null);

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — trial/billing lifecycle (V1.68): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
