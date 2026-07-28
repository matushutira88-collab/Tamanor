/**
 * BUSINESS BILLING TRUTH — PURE presentation-resolver tests (no DB, no Stripe). Proves the canonical
 * `resolveBusinessBillingPresentation` derives the EFFECTIVE plan + state from the TRUSTED subscription,
 * never a stale Tenant.plan, with deterministic precedence and fail-closed on unknown/mismatched input.
 * Run: pnpm business-billing-presentation:test
 */
import { resolveBusinessBillingPresentation, resolveEffectiveBusinessPlan, normalizeBusinessPaidPlan } from "../src/index";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const NOW = new Date("2026-06-15T12:00:00.000Z");
const future = (days: number) => new Date(NOW.getTime() + days * 86_400_000);
const past = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

/** Build an input with sensible defaults; override per case. */
function inp(over: Partial<Parameters<typeof resolveBusinessBillingPresentation>[0]> = {}) {
  return resolveBusinessBillingPresentation({
    tenantPlan: "free_trial", billingStatus: "no_subscription", trialEndsAt: null, subscription: null, now: NOW, ...over,
  });
}
const sub = (over: Record<string, unknown> = {}) => ({ plan: "starter", status: "active", billingInterval: "monthly", currentPeriodEnd: future(20), cancelAtPeriodEnd: false, ...over } as never);

function main() {
  console.log("\n1. active paid Starter with STALE tenant trial plan → Starter (subscription wins)");
  {
    const p = inp({ tenantPlan: "free_trial", billingStatus: "active", trialEndsAt: future(3), subscription: sub({ plan: "starter" }) });
    check("★ effectivePlanId=starter, isPaid, source=subscription, not trial", p.effectivePlanId === "starter" && p.isPaid && p.source === "subscription" && !p.isTrial);
    check("★ effectivePlanName=Starter", p.effectivePlanName === "Starter");
  }

  console.log("\n2. active paid Growth with STALE tenant Starter plan → Growth");
  {
    const p = inp({ tenantPlan: "starter", billingStatus: "active", subscription: sub({ plan: "growth" }) });
    check("★ effectivePlanId=growth (ignores stale tenant starter)", p.effectivePlanId === "growth" && p.isPaid && p.holdsCurrentSubscription);
  }

  console.log("\n3. active paid Agency");
  {
    const p = inp({ tenantPlan: "agency", billingStatus: "active", subscription: sub({ plan: "agency", billingInterval: "yearly" }) });
    check("★ effectivePlanId=agency, interval yearly, name Business", p.effectivePlanId === "agency" && p.billingInterval === "yearly" && p.effectivePlanName === "Business");
  }

  console.log("\n4. cancel-at-period-end BEFORE currentPeriodEnd → still paid/current");
  {
    const p = inp({ tenantPlan: "growth", billingStatus: "active", subscription: sub({ plan: "growth", cancelAtPeriodEnd: true, currentPeriodEnd: future(10) }) });
    check("★ isPaid + cancelAtPeriodEnd + lifecycle active_paid + holds current", p.isPaid && p.cancelAtPeriodEnd && p.lifecycle === "active_paid" && p.holdsCurrentSubscription && p.effectivePlanId === "growth");
  }

  console.log("\n5. canceled subscription AFTER paid-through period → canceled, not paid");
  {
    const p = inp({ tenantPlan: "growth", billingStatus: "canceled", subscription: sub({ plan: "growth", status: "canceled", currentPeriodEnd: past(2), cancelAtPeriodEnd: true }) });
    check("★ lifecycle=canceled, isPaid=false, not current (re-purchasable)", p.lifecycle === "canceled" && !p.isPaid && !p.holdsCurrentSubscription);
    check("★ subscriptionStatus=canceled surfaced", p.subscriptionStatus === "canceled");
  }

  console.log("\n6. active trial with NO paid subscription → trial");
  {
    const p = inp({ tenantPlan: "free_trial", billingStatus: "no_subscription", trialEndsAt: future(5), subscription: null });
    check("★ isTrial, effectivePlanId=free_trial, source=trial, trialDaysRemaining=5", p.isTrial && p.effectivePlanId === "free_trial" && p.source === "trial" && p.trialDaysRemaining === 5);
    check("★ not paid, no subscription held", !p.isPaid && !p.holdsCurrentSubscription);
  }

  console.log("\n7. expired trial → not trial, not paid, fail-closed to free_trial");
  {
    const p = inp({ tenantPlan: "free_trial", billingStatus: "no_subscription", trialEndsAt: past(1), subscription: null });
    check("★ lifecycle=trial_expired, isTrial=false, isPaid=false, source=none", p.lifecycle === "trial_expired" && !p.isTrial && !p.isPaid && p.source === "none");
  }

  console.log("\n8. past_due subscription → plan shown truthfully, not clean-paid");
  {
    const p = inp({ tenantPlan: "growth", billingStatus: "past_due", subscription: sub({ plan: "growth", status: "past_due", currentPeriodEnd: future(3) }) });
    check("★ effectivePlanId=growth, lifecycle=past_due, isPaid=false, holds current", p.effectivePlanId === "growth" && p.lifecycle === "past_due" && !p.isPaid && p.holdsCurrentSubscription);
  }

  console.log("\n9. unpaid subscription → suspended, plan truthful");
  {
    const p = inp({ tenantPlan: "agency", billingStatus: "unpaid", subscription: sub({ plan: "agency", status: "unpaid" }) });
    check("★ lifecycle=suspended, effectiveAccessState=suspended, plan=agency", p.lifecycle === "suspended" && p.effectiveAccessState === "suspended" && p.effectivePlanId === "agency" && !p.isPaid);
  }

  console.log("\n10. suspended tenant (admin override) → suspended regardless of active sub");
  {
    const p = inp({ tenantPlan: "growth", billingStatus: "active", persistedAccessState: "suspended", subscription: sub({ plan: "growth", status: "active" }) });
    check("★ effectiveAccessState=suspended, lifecycle=suspended", p.effectiveAccessState === "suspended" && p.lifecycle === "suspended" && !p.isPaid);
  }

  console.log("\n11. internalAccess tenant → internal unlimited");
  {
    const p = inp({ tenantPlan: "starter", billingStatus: "no_subscription", internalAccess: true, subscription: null });
    check("★ isInternalUnlimited, source=internal, full_access, active_paid", p.isInternalUnlimited && p.source === "internal" && p.effectiveAccessState === "full_access" && p.lifecycle === "active_paid");
    check("★ internal is not marked isPaid/holdsCurrentSubscription", !p.isPaid && !p.holdsCurrentSubscription);
  }

  console.log("\n12. no subscription (and no trial) → fail-closed free_trial, none");
  {
    const p = inp({ tenantPlan: "free_trial", billingStatus: "no_subscription", trialEndsAt: null, subscription: null });
    check("★ effectivePlanId=free_trial, source=none, not paid/trial", p.effectivePlanId === "free_trial" && p.source === "none" && !p.isPaid && !p.isTrial);
  }

  console.log("\n13. UNKNOWN subscription plan on an active sub → fails closed (no invented paid plan)");
  {
    const p = inp({ tenantPlan: "growth", billingStatus: "active", subscription: sub({ plan: "platinum_deluxe", status: "active" }) });
    check("★ effectivePlanId=free_trial (NOT a paid plan), isPaid=false, source=none", p.effectivePlanId === "free_trial" && !p.isPaid && p.source === "none");
  }

  console.log("\n14. subscription/workspace mismatch (Family plan on Business tenant) → cannot grant a plan");
  {
    const p = inp({ tenantPlan: "starter", billingStatus: "active", subscription: sub({ plan: "family_premium", status: "active" }) });
    check("★ Family plan rejected → effectivePlanId=free_trial, isPaid=false", p.effectivePlanId === "free_trial" && !p.isPaid);
  }

  console.log("\n15. helpers + effective-plan authority parity");
  check("★ normalizeBusinessPaidPlan accepts only starter/growth/agency", normalizeBusinessPaidPlan("STARTER") === "starter" && normalizeBusinessPaidPlan("growth") === "growth" && normalizeBusinessPaidPlan("free_trial") === null && normalizeBusinessPaidPlan("enterprise") === null && normalizeBusinessPaidPlan("family_plus") === null && normalizeBusinessPaidPlan(null) === null);
  check("★ resolveEffectiveBusinessPlan === presentation.effectivePlanId (single authority)", resolveEffectiveBusinessPlan({ tenantPlan: "free_trial", billingStatus: "active", trialEndsAt: null, subscription: sub({ plan: "growth" }), now: NOW }) === "growth");
  check("★ browser value in tenantPlan cannot pick the plan (subscription wins)", resolveEffectiveBusinessPlan({ tenantPlan: "agency", billingStatus: "active", trialEndsAt: null, subscription: sub({ plan: "starter" }), now: NOW }) === "starter");

  console.log("\n16. NO live subscription → Tenant.plan governs the tier (never a downgrade vs prior enforcement)");
  {
    // No subscription row but a paid Tenant.plan (legacy/edge): keep the tenant's plan, do not fail-closed lower.
    const p = inp({ tenantPlan: "growth", billingStatus: "active", subscription: null });
    check("★ no live sub + Tenant.plan growth → growth (source=tenant, not downgraded)", p.effectivePlanId === "growth" && p.source === "tenant" && !p.isPaid);
    // But a LIVE subscription with an unknown plan still fails closed (never falls back to Tenant.plan).
    const q = inp({ tenantPlan: "growth", billingStatus: "active", subscription: sub({ plan: "mystery", status: "active" }) });
    check("★ live sub + unknown plan → free_trial (fail-closed, ignores Tenant.plan)", q.effectivePlanId === "free_trial" && q.source === "none");
  }
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Business billing presentation: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
