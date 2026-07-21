/**
 * Release A / A5 — READ-ONLY Stripe production smoke-test VERIFIER.
 *
 * The operator runs this after each step of the live billing lifecycle (see the runbook
 * STRIPE_PRODUCTION_SMOKE_TEST.md) to confirm the resulting DB state — plan, subscription, entitlement,
 * webhook idempotency, checkout attempts and audit trail — WITHOUT touching Stripe or the browser.
 *
 * It is strictly read-only: only findUnique/findMany/count/aggregate. It NEVER writes, and it derives
 * the tenant from the trusted Stripe customer id (never a browser value). Run:
 *   pnpm stripe-smoke-verify -- --customer cus_XXXX
 *   pnpm stripe-smoke-verify -- --tenant <tenantId>
 * With no target it prints the secret-free config readiness only.
 */
import { systemDb, getTenantBilling, getTenantEntitlements, findTenantIdByStripeCustomer } from "@guardora/db";
import { stripeBillingReadiness } from "@guardora/core";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}

async function main(): Promise<void> {
  // 1) Secret-free config readiness — the same predicate /api/ready surfaces (requireLive in production).
  const readiness = stripeBillingReadiness(process.env, { requireLive: process.env.NODE_ENV === "production" });
  console.log("── Stripe config readiness (secret-free) ──");
  console.log(JSON.stringify(readiness, null, 2));

  const customer = arg("customer");
  let tenantId = arg("tenant");
  if (!tenantId && customer) tenantId = await findTenantIdByStripeCustomer(customer);
  if (!tenantId) {
    console.log("\nNo --tenant or resolvable --customer supplied → config check only.");
    console.log("Pass --customer cus_… or --tenant <id> to verify a specific tenant's lifecycle state.");
    await systemDb.$disconnect();
    return;
  }

  const billing = await getTenantBilling(tenantId);
  const ent = await getTenantEntitlements(tenantId);
  const [brands, monitored, webhookTotal, webhookProcessed, webhookStale, webhookFailed, lastEvents, attempts, audit] = await Promise.all([
    systemDb.brand.count({ where: { tenantId } }),
    systemDb.connectedAccount.count({ where: { tenantId, monitoringEnabled: true, status: { not: "disconnected" } } }),
    systemDb.stripeWebhookEvent.count(),
    systemDb.stripeWebhookEvent.count({ where: { result: "processed" } }),
    systemDb.stripeWebhookEvent.count({ where: { result: "stale" } }),
    systemDb.stripeWebhookEvent.count({ where: { result: "failed" } }),
    systemDb.stripeWebhookEvent.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { eventType: true, result: true, processedAt: true } }),
    systemDb.stripeCheckoutAttempt.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 5, select: { status: true, requestedPlan: true, createdAt: true } }),
    systemDb.auditLog.findMany({
      where: { tenantId, OR: [{ event: { startsWith: "billing." } }, { event: "monitoring.limit_enforced" }] },
      orderBy: { createdAt: "desc" }, take: 10, select: { event: true, createdAt: true },
    }),
  ]);

  console.log(`\n── Tenant ${tenantId} ──`);
  console.log(`plan=${billing?.plan}  billingStatus=${billing?.billingStatus}  lifecycle=${billing?.lifecycle}  effectiveAccess=${billing?.effectiveAccessState}  trialDaysRemaining=${billing?.trialDaysRemaining}`);
  console.log("subscription:", JSON.stringify(billing?.subscription));
  console.log(`entitlements: maxBrands=${ent.maxBrands} maxConnectedAccounts=${ent.maxConnectedAccounts} providerSync=${ent.providerSync} moderationExecution=${ent.moderationExecution} paidAi=${ent.paidAi}`);
  console.log(`usage: brands=${brands}  monitoredAccounts=${monitored}`);
  console.log(`webhook idempotency: total=${webhookTotal} processed=${webhookProcessed} stale=${webhookStale} failed=${webhookFailed}  (failed>0 → Stripe will retry; investigate)`);
  console.log("last 5 webhook events:", JSON.stringify(lastEvents));
  console.log("checkout attempts:", JSON.stringify(attempts));
  console.log("recent billing/enforcement audit:", JSON.stringify(audit));
  console.log("\nNOTE: this verifier is read-only. It proves DB state; it does not create payments. The live");
  console.log("lifecycle (checkout → payment → webhook) must be driven by the operator per the runbook.");

  await systemDb.$disconnect();
}

main().catch(async (e) => { console.error(String(e).slice(0, 500)); await systemDb.$disconnect(); process.exit(1); });
