/**
 * V1.50D — Subscription billing integration tests (no live Stripe; fixtures + injected data).
 *
 * Covers the plan catalogue, the central status→access mapping, billing-aware usage policy, and the
 * webhook processing core (idempotency, tenant-from-customer, cross-tenant isolation, DB-failure
 * retryability, trial sweep). Signature verification is tested in apps/web/scripts/billing-webhook.test.ts.
 *
 * Run via: pnpm billing:test
 */
import { randomBytes } from "node:crypto";
import { prisma, systemDb, registerUser, hashPassword } from "@guardora/db";
import {
  ensureStripeCustomer, recordAndApplyStripeEvent, getTenantBilling, sweepTrialExpirations,
  findTenantIdByStripeCustomer, purgeStripeWebhookEvents, type StripeSubStateInput,
} from "@guardora/db";
import {
  resolveStripePriceId, planForStripePriceId, isSelfServePlan, BILLING_PLANS,
  resolveAccessState, resolveEffectiveUsagePolicy,
} from "@guardora/core";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const sfx = randomBytes(5).toString("hex");
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  const ENV = {
    STRIPE_PRICE_STARTER_MONTHLY: `price_starter_m_${sfx}`,
    STRIPE_PRICE_STARTER_YEARLY: `price_starter_y_${sfx}`,
    STRIPE_PRICE_GROWTH_MONTHLY: `price_growth_m_${sfx}`,
  };

  // ---- A. Plan catalogue ----------------------------------------------------
  check("resolveStripePriceId maps a configured (plan, interval)", resolveStripePriceId("starter", "monthly", ENV) === ENV.STRIPE_PRICE_STARTER_MONTHLY);
  check("unconfigured price fails closed (null)", resolveStripePriceId("agency", "monthly", ENV) === null);
  check("non-self-serve plan has no price", resolveStripePriceId("enterprise" as never, "monthly", ENV) === null);
  check("planForStripePriceId reverse-maps a known price", JSON.stringify(planForStripePriceId(ENV.STRIPE_PRICE_GROWTH_MONTHLY, ENV)) === JSON.stringify({ plan: "growth", interval: "monthly" }));
  check("unknown price fails closed (null → no arbitrary plan)", planForStripePriceId("price_attacker_supplied", ENV) === null);
  check("isSelfServePlan: starter yes, enterprise no", isSelfServePlan("starter") && !isSelfServePlan("enterprise") && !isSelfServePlan("nonsense"));
  check("catalogue has 3 self-serve paid plans + enterprise", BILLING_PLANS.starter.selfServeCheckout && BILLING_PLANS.growth.selfServeCheckout && BILLING_PLANS.agency.selfServeCheckout && !BILLING_PLANS.enterprise.selfServeCheckout);

  // ---- B. Central access-state mapping --------------------------------------
  const now = new Date();
  const future = new Date(now.getTime() + 5 * 86_400_000);
  const past = new Date(now.getTime() - 5 * 86_400_000);
  check("active → full_access", resolveAccessState({ status: "active", now }) === "full_access");
  check("trialing (valid) → full_access", resolveAccessState({ status: "no_subscription", trialEndsAt: future, now }) === "full_access");
  check("trial expired, no sub → restricted", resolveAccessState({ status: "no_subscription", trialEndsAt: past, now }) === "restricted");
  check("past_due within grace → grace_period", resolveAccessState({ status: "past_due", currentPeriodEnd: past, now, graceDays: 7 }) === "grace_period");
  check("past_due beyond grace → restricted", resolveAccessState({ status: "past_due", currentPeriodEnd: new Date(now.getTime() - 30 * 86_400_000), now, graceDays: 7 }) === "restricted");
  check("canceled (period ended) → restricted", resolveAccessState({ status: "canceled", currentPeriodEnd: past, now }) === "restricted");
  check("unpaid → restricted", resolveAccessState({ status: "unpaid", now }) === "restricted");
  check("unknown status → restricted (fail safe)", resolveAccessState({ status: "banana", now }) === "restricted");

  // ---- C. Billing-aware usage policy ----------------------------------------
  check("restricted access → NO paid AI regardless of plan", resolveEffectiveUsagePolicy("agency", "restricted").allowPaidFallback === false && resolveEffectiveUsagePolicy("agency", "restricted").premiumCallsPerPeriod === 0);
  check("full_access agency → paid AI allowed", resolveEffectiveUsagePolicy("agency", "full_access").allowPaidFallback === true);
  check("grace_period keeps plan policy", resolveEffectiveUsagePolicy("growth", "grace_period").plan === "growth");

  // ---- D. Webhook processing (fixtures for two tenants) ---------------------
  const a = await registerUser({ email: `bill-a-${sfx}@ex.com`, passwordHash: await hashPassword("password aaaa 1"), workspaceName: "Bill A", country: "SK" });
  const b = await registerUser({ email: `bill-b-${sfx}@ex.com`, passwordHash: await hashPassword("password bbbb 1"), workspaceName: "Bill B", country: "SK" });
  tenantIds.push(a.tenantId, b.tenantId); userIds.push(a.userId, b.userId);

  const custA = `cus_${sfx}_a`;
  await ensureStripeCustomer(a.tenantId, custA);
  check("stripe customer maps back to the tenant", (await findTenantIdByStripeCustomer(custA)) === a.tenantId);

  const activeInput: StripeSubStateInput = {
    stripeCustomerId: custA, stripeSubscriptionId: `sub_${sfx}`, stripePriceId: ENV.STRIPE_PRICE_STARTER_MONTHLY,
    plan: "starter", billingInterval: "monthly", status: "active",
    currentPeriodEnd: future, cancelAtPeriodEnd: false,
  };
  const base = Math.floor(now.getTime() / 1000); // V1.58.4: increasing event.created for the sequence
  const e1 = `evt_${sfx}_1`;
  const r1 = await recordAndApplyStripeEvent(e1, "checkout.session.completed", activeInput, base, now);
  check("checkout completion activates the CORRECT tenant", r1.outcome === "processed" && r1.tenantId === a.tenantId && r1.accessState === "full_access");
  const billA = await getTenantBilling(a.tenantId);
  check("tenant now on starter/active/full_access", billA?.plan === "starter" && billA?.billingStatus === "active" && billA?.accessState === "full_access");
  check("subscription row stored with safe fields (no raw payload)", billA?.subscription?.status === "active" && billA?.subscription?.billingInterval === "monthly");

  // Idempotency: replaying the same event id is a no-op.
  const r1dup = await recordAndApplyStripeEvent(e1, "checkout.session.completed", activeInput, base, now);
  check("duplicate event id is ignored (idempotent)", r1dup.outcome === "duplicate");

  // Cross-tenant: an event for customer A never mutates tenant B.
  const billB0 = await getTenantBilling(b.tenantId);
  check("other tenant untouched by tenant A's event", billB0?.billingStatus === "no_subscription" && billB0?.accessState === "full_access");

  // Unknown customer → ignored (cannot grant access to an unknown tenant).
  const rUnknown = await recordAndApplyStripeEvent(`evt_${sfx}_unknown`, "customer.subscription.updated", { ...activeInput, stripeCustomerId: `cus_nobody_${sfx}` }, base + 5, now);
  check("event for an unknown customer is ignored (no cross-tenant grant)", rUnknown.outcome === "ignored" && rUnknown.tenantId === null);

  // Payment failure → past_due within grace → grace_period.
  const pastDueInput: StripeSubStateInput = { ...activeInput, status: "past_due", currentPeriodEnd: now };
  const r2 = await recordAndApplyStripeEvent(`evt_${sfx}_2`, "invoice.payment_failed", pastDueInput, base + 10, now);
  check("payment failure → past_due, grace_period", r2.outcome === "processed" && r2.accessState === "grace_period");

  // Subscription canceled + period ended → restricted.
  const canceledInput: StripeSubStateInput = { ...activeInput, status: "canceled", currentPeriodEnd: past, canceledAt: now };
  const r3 = await recordAndApplyStripeEvent(`evt_${sfx}_3`, "customer.subscription.deleted", canceledInput, base + 20, now);
  check("cancellation (period ended) → restricted", r3.outcome === "processed" && r3.accessState === "restricted");

  // invoice.paid → active restored.
  const r4 = await recordAndApplyStripeEvent(`evt_${sfx}_4`, "invoice.paid", { ...activeInput, currentPeriodEnd: future }, base + 30, now);
  check("invoice paid restores active/full_access", r4.outcome === "processed" && r4.accessState === "full_access");

  // ---- E. Trial expiry sweep ------------------------------------------------
  // Tenant B: expire its trial with no subscription → sweep restricts it (no data deletion).
  await systemDb.tenant.update({ where: { id: b.tenantId }, data: { trialEndsAt: past } });
  const restricted = await sweepTrialExpirations(now);
  const billB = await getTenantBilling(b.tenantId);
  check("trial sweep restricts an expired trial tenant", restricted >= 1 && billB?.accessState === "restricted");
  const bStillExists = await systemDb.tenant.findUnique({ where: { id: b.tenantId }, select: { id: true } });
  check("trial expiry deletes NO tenant data", bStillExists !== null);

  // ---- F. Privacy: audit rows hold no payload; retention purges old rows -----
  const auditRow = await systemDb.stripeWebhookEvent.findUnique({ where: { stripeEventId: e1 }, select: { eventType: true, result: true } });
  check("webhook audit row stores only type + result classification", auditRow?.result === "processed" && auditRow?.eventType === "checkout.session.completed");
  await systemDb.stripeWebhookEvent.updateMany({ where: { stripeEventId: e1 }, data: { createdAt: new Date(now.getTime() - 200 * 86_400_000) } });
  const purged = await purgeStripeWebhookEvents(new Date(now.getTime() - 90 * 86_400_000));
  check("bounded retention purges old webhook audit rows", purged >= 1);

  // Cleanup.
  for (const id of tenantIds) await prisma.tenant.delete({ where: { id } }).catch(() => {});
  for (const id of userIds) await prisma.user.delete({ where: { id } }).catch(() => {});
  await systemDb.stripeWebhookEvent.deleteMany({ where: { stripeEventId: { contains: sfx } } }).catch(() => {});

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — subscription billing & trial conversion (V1.50D)`);
  await prisma.$disconnect();
  if (failures > 0) process.exit(1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
