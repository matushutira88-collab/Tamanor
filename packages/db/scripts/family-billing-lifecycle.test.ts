/**
 * FAMILY-BILLING S3 — lifecycle tests against the LOCAL DB. Proves:
 *   • startFamilyTrial: flag gate, workspace gate, plan gate, happy path fields, ONE-TIME (never
 *     grantable twice), concurrency (exactly one winner), conflicting-subscription rejection;
 *   • workspace-aware webhook apply (recordAndApplyStripeEvent): Family price on a Family tenant maps
 *     to the Family plan; Family cancellation falls back to family_free/full_access (data preserved);
 *     cross-workspace mismatches are rejected safely; flag-off Family events are quarantined; Business
 *     is unchanged;
 *   • sweepFamilyTrialExpirations: expired unconverted Family trial → family_free floor
 *     (familyTrialConsumedAt PRESERVED); active/converted trials untouched; Business trial sweep never
 *     touches a Family tenant.
 * Run: pnpm family-billing-lifecycle:test
 */
import { systemDb } from "../src/index";
import {
  startFamilyTrial, ensureStripeCustomer, recordAndApplyStripeEvent,
  sweepFamilyTrialExpirations, sweepTrialExpirations, type StripeSubStateInput,
} from "../src/index";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const sfx = `s3life_${process.pid}`;
const created: string[] = [];
const eventIds: string[] = [];
let n = 0, ev = 0;
async function seedTenant(workspaceKind: string, plan: string, extra: Record<string, unknown> = {}) {
  const id = `t${n++}_${sfx}`;
  await systemDb.tenant.create({ data: { id, name: id, slug: id, workspaceKind, plan, ...extra } });
  created.push(id);
  return id;
}
const get = (id: string) => systemDb.tenant.findUnique({
  where: { id },
  select: { plan: true, accessState: true, billingStatus: true, trialStartsAt: true, trialEndsAt: true, familyTrialConsumedAt: true },
});
/** Apply a synthetic Stripe subscription event for a customer-mapped tenant. */
async function applyEvent(input: StripeSubStateInput, eventType = "customer.subscription.updated") {
  const id = `evt_${sfx}_${ev++}`;
  eventIds.push(id);
  return recordAndApplyStripeEvent(id, eventType, input, Math.floor(Date.now() / 1000) + ev, new Date());
}

async function main() {
  const NOW = new Date();
  const future = (d: number) => new Date(NOW.getTime() + d * 864e5);
  const past = (d: number) => new Date(NOW.getTime() - d * 864e5);

  // ===========================================================================
  // A. startFamilyTrial — gates
  // ===========================================================================
  console.log("\nA. startFamilyTrial gates");
  const famA = await seedTenant("family", "family_free");
  delete process.env.FAMILY_BILLING_ENABLED;
  check("flag OFF → family_billing_disabled", (await startFamilyTrial({ tenantId: famA, targetPlan: "family_plus" })).ok === false);
  process.env.FAMILY_BILLING_ENABLED = "1";
  const bizA = await seedTenant("business", "free_trial");
  check("non-family workspace → not_family_workspace", ((await startFamilyTrial({ tenantId: bizA, targetPlan: "family_plus", enabled: true })) as { reason?: string }).reason === "not_family_workspace");
  check("invalid target plan (family_free) → invalid_plan", ((await startFamilyTrial({ tenantId: famA, targetPlan: "family_free" as never, enabled: true })) as { reason?: string }).reason === "invalid_plan");

  // ===========================================================================
  // B. startFamilyTrial — happy path + one-time
  // ===========================================================================
  console.log("\nB. startFamilyTrial happy path + one-time marker");
  const r1 = await startFamilyTrial({ tenantId: famA, targetPlan: "family_plus", durationDays: 14, now: NOW, enabled: true });
  check("first start ok", r1.ok === true);
  const a1 = await get(famA);
  check("plan=family_plus, billingStatus=trialing, accessState=full_access", a1?.plan === "family_plus" && a1?.billingStatus === "trialing" && a1?.accessState === "full_access");
  check("trialStartsAt & trialEndsAt set (~14d)", !!a1?.trialStartsAt && !!a1?.trialEndsAt && Math.abs((a1!.trialEndsAt!.getTime() - a1!.trialStartsAt!.getTime()) - 14 * 864e5) < 1000);
  check("★ familyTrialConsumedAt set (one-time marker)", a1?.familyTrialConsumedAt !== null);
  const r2 = await startFamilyTrial({ tenantId: famA, targetPlan: "family_premium", enabled: true });
  check("★ second start → trial_already_consumed (never grantable again)", r2.ok === false && (r2 as { reason?: string }).reason === "trial_already_consumed");
  check("consumed marker unchanged after rejected retry", (await get(famA))?.familyTrialConsumedAt?.getTime() === a1?.familyTrialConsumedAt?.getTime());

  // ===========================================================================
  // C. startFamilyTrial — concurrency (exactly one winner)
  // ===========================================================================
  console.log("\nC. startFamilyTrial concurrency");
  const famC = await seedTenant("family", "family_free");
  const results = await Promise.all(Array.from({ length: 6 }, () => startFamilyTrial({ tenantId: famC, targetPlan: "family_plus", enabled: true })));
  const wins = results.filter((r) => r.ok).length;
  check("★ exactly ONE concurrent start succeeds", wins === 1, `wins=${wins}`);
  check("all other concurrent starts rejected as already_consumed", results.filter((r) => !r.ok && (r as { reason?: string }).reason === "trial_already_consumed").length === 5);

  // ===========================================================================
  // D. startFamilyTrial — conflicting subscription
  // ===========================================================================
  console.log("\nD. startFamilyTrial conflicting subscription");
  const famD = await seedTenant("family", "family_free");
  await ensureStripeCustomer(famD, `cus_${sfx}_D`);
  await systemDb.subscription.update({ where: { tenantId: famD }, data: { status: "active" } });
  check("active paid subscription → subscription_active", ((await startFamilyTrial({ tenantId: famD, targetPlan: "family_plus", enabled: true })) as { reason?: string }).reason === "subscription_active");

  // ===========================================================================
  // E. Workspace-aware webhook apply
  // ===========================================================================
  console.log("\nE. workspace-aware webhook apply");
  process.env.FAMILY_BILLING_ENABLED = "1";
  // E1 — Family price on a Family tenant → Family plan applied.
  const famE = await seedTenant("family", "family_free");
  const cusE = `cus_${sfx}_E`;
  await ensureStripeCustomer(famE, cusE);
  const famActive: StripeSubStateInput = { stripeCustomerId: cusE, stripeSubscriptionId: "sub_E", stripePriceId: "price_fam_plus_m", plan: "family_plus", billingInterval: "monthly", status: "active", currentPeriodEnd: future(20) };
  const e1 = await applyEvent(famActive, "customer.subscription.created");
  const gE1 = await get(famE);
  check("Family active subscription → tenant plan=family_plus, accessState=full_access", e1.outcome === "processed" && gE1?.plan === "family_plus" && gE1?.accessState === "full_access");

  // E2 — Family cancellation past period → family_free / full_access (fallback; data preserved).
  const famCanceled: StripeSubStateInput = { stripeCustomerId: cusE, stripeSubscriptionId: "sub_E", stripePriceId: "price_fam_plus_m", plan: "family_plus", billingInterval: "monthly", status: "canceled", currentPeriodEnd: past(1), canceledAt: past(1) };
  const e2 = await applyEvent(famCanceled, "customer.subscription.deleted");
  const gE2 = await get(famE);
  check("★ Family cancellation → tenant plan=family_free, accessState=full_access (never restricted)", e2.outcome === "processed" && gE2?.plan === "family_free" && gE2?.accessState === "full_access");

  // E3 — cross-workspace: a BUSINESS plan input on a FAMILY tenant → rejected (ignored), no mutation.
  const famE3 = await seedTenant("family", "family_free");
  const cusE3 = `cus_${sfx}_E3`;
  await ensureStripeCustomer(famE3, cusE3);
  const bizOnFamily: StripeSubStateInput = { stripeCustomerId: cusE3, stripeSubscriptionId: "sub_E3", stripePriceId: "price_biz", plan: "starter", billingInterval: "monthly", status: "active", currentPeriodEnd: future(20) };
  const e3 = await applyEvent(bizOnFamily);
  const gE3 = await get(famE3);
  check("★ Business plan on Family tenant → ignored, tenant untouched (still family_free)", e3.outcome === "ignored" && gE3?.plan === "family_free");

  // E4 — cross-workspace: a FAMILY plan input on a BUSINESS tenant → rejected (ignored), no mutation.
  const bizE4 = await seedTenant("business", "free_trial");
  const cusE4 = `cus_${sfx}_E4`;
  await ensureStripeCustomer(bizE4, cusE4);
  const famOnBiz: StripeSubStateInput = { stripeCustomerId: cusE4, stripeSubscriptionId: "sub_E4", stripePriceId: "price_fam", plan: "family_plus", billingInterval: "monthly", status: "active", currentPeriodEnd: future(20) };
  const e4 = await applyEvent(famOnBiz);
  const gE4 = await get(bizE4);
  check("★ Family plan on Business tenant → ignored, tenant untouched (still free_trial)", e4.outcome === "ignored" && gE4?.plan === "free_trial");

  // E5 — flag OFF: a Family plan event is quarantined (ignored), no mutation.
  const famE5 = await seedTenant("family", "family_free");
  const cusE5 = `cus_${sfx}_E5`;
  await ensureStripeCustomer(famE5, cusE5);
  delete process.env.FAMILY_BILLING_ENABLED;
  const e5 = await applyEvent({ stripeCustomerId: cusE5, stripeSubscriptionId: "sub_E5", stripePriceId: "price_fam_plus_m", plan: "family_plus", billingInterval: "monthly", status: "active", currentPeriodEnd: future(20) });
  const gE5 = await get(famE5);
  check("★ flag OFF → Family event quarantined (ignored), tenant untouched", e5.outcome === "ignored" && gE5?.plan === "family_free");
  process.env.FAMILY_BILLING_ENABLED = "1";

  // E6 — Business unchanged: a Business plan on a Business tenant still applies normally.
  const bizE6 = await seedTenant("business", "free_trial");
  const cusE6 = `cus_${sfx}_E6`;
  await ensureStripeCustomer(bizE6, cusE6);
  const e6 = await applyEvent({ stripeCustomerId: cusE6, stripeSubscriptionId: "sub_E6", stripePriceId: "price_biz", plan: "growth", billingInterval: "monthly", status: "active", currentPeriodEnd: future(20) }, "customer.subscription.created");
  const gE6 = await get(bizE6);
  check("Business plan on Business tenant → applies (plan=growth, full_access) [unchanged]", e6.outcome === "processed" && gE6?.plan === "growth" && gE6?.accessState === "full_access");

  // ===========================================================================
  // F. Family trial-expiry sweep
  // ===========================================================================
  console.log("\nF. sweepFamilyTrialExpirations");
  const famExpired = await seedTenant("family", "family_plus", { billingStatus: "trialing", trialStartsAt: past(20), trialEndsAt: past(1), accessState: "full_access", familyTrialConsumedAt: past(20) });
  const famActiveTrial = await seedTenant("family", "family_plus", { billingStatus: "trialing", trialStartsAt: past(1), trialEndsAt: future(10), accessState: "full_access", familyTrialConsumedAt: past(1) });
  const swept = await sweepFamilyTrialExpirations(NOW);
  const gExp = await get(famExpired);
  check("★ expired unconverted trial → family_free / full_access / no_subscription", gExp?.plan === "family_free" && gExp?.accessState === "full_access" && gExp?.billingStatus === "no_subscription");
  check("★ expired sweep clears trial dates but PRESERVES familyTrialConsumedAt", gExp?.trialStartsAt === null && gExp?.trialEndsAt === null && gExp?.familyTrialConsumedAt !== null);
  check("active (future) trial NOT swept", (await get(famActiveTrial))?.plan === "family_plus", "should remain family_plus");
  check("sweep counted the expired one (>=1)", swept >= 1, `swept=${swept}`);

  // ===========================================================================
  // G. Business trial sweep never touches a Family tenant
  // ===========================================================================
  console.log("\nG. Business trial sweep excludes Family");
  const famNoSub = await seedTenant("family", "family_free", { billingStatus: "no_subscription", accessState: "full_access", trialEndsAt: past(5) });
  const bizNoSub = await seedTenant("business", "free_trial", { billingStatus: "no_subscription", accessState: "full_access", trialEndsAt: past(5) });
  await sweepTrialExpirations(NOW);
  check("★ Family tenant NOT restricted by the Business sweep (stays full_access)", (await get(famNoSub))?.accessState === "full_access");
  check("Business tenant IS restricted by the Business sweep (control)", (await get(bizNoSub))?.accessState === "restricted");
}

main()
  .then(async () => {
    for (const id of eventIds) await systemDb.stripeWebhookEvent.deleteMany({ where: { stripeEventId: id } }).catch(() => {});
    for (const id of created) await systemDb.subscription.deleteMany({ where: { tenantId: id } }).catch(() => {});
    for (const id of created) await systemDb.tenant.delete({ where: { id } }).catch(() => {});
    delete process.env.FAMILY_BILLING_ENABLED;
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — FAMILY-BILLING S3 lifecycle: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error("FATAL:", e?.stack ?? e?.message ?? e);
    for (const id of eventIds) await systemDb.stripeWebhookEvent.deleteMany({ where: { stripeEventId: id } }).catch(() => {});
    for (const id of created) await systemDb.subscription.deleteMany({ where: { tenantId: id } }).catch(() => {});
    for (const id of created) await systemDb.tenant.delete({ where: { id } }).catch(() => {});
    delete process.env.FAMILY_BILLING_ENABLED;
    process.exit(1);
  });
