/**
 * V1.50F — atomic resource limits, canonical counting, single-source projections, operation gate.
 * Run via: pnpm entitlement-limits:test
 */
import { randomBytes } from "node:crypto";
import { prisma, systemDb, registerUser, hashPassword } from "@guardora/db";
import {
  createWithinResourceLimit, countCommercialConnections, getTenantResourceUsage,
  getTenantOperationGate, withTenant,
} from "@guardora/db";
import {
  EntitlementError, publicPricingProjection, billingProjection, BILLING_PLANS, planEntitlements,
} from "@guardora/core";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
async function isEnt(fn: () => Promise<unknown>, reason: string): Promise<boolean> {
  try { await fn(); return false; } catch (e) { return e instanceof EntitlementError && e.reason === reason; }
}

async function run() {
  const sfx = randomBytes(5).toString("hex");
  const tenantIds: string[] = [];
  const userIds: string[] = [];

  // ---- Single-source projections --------------------------------------------
  const pub = publicPricingProjection();
  check("public projection has starter/growth/agency + enterprise", pub.plans.length === 3 && pub.enterprise.id === "enterprise");
  check("projection names + prices come from the catalogue", pub.plans.every((c) => c.name === BILLING_PLANS[c.id].name && c.priceMonthly === BILLING_PLANS[c.id].priceMonthly));
  check("projection limits come from the entitlement catalogue", pub.plans.every((c) => c.limits.connectedAccounts === planEntitlements(c.id).maxConnectedAccounts && c.limits.brands === planEntitlements(c.id).maxBrands));
  check("unimplemented features absent (export/multiWorkspace/agency-client = false)", pub.plans.every((c) => !c.capabilities.export && !c.capabilities.multiWorkspace && !c.capabilities.agencyClientManagement));
  check("Starter projection does NOT advertise analytics", pub.plans.find((c) => c.id === "starter")?.capabilities.reputationAnalytics === false);
  const bpUnconfigured = billingProjection("monthly", {});
  check("billing projection: unconfigured Stripe price → not purchasable (fail closed)", bpUnconfigured.plans.every((c) => c.purchasable === false));
  const bpConfigured = billingProjection("monthly", { STRIPE_PRICE_STARTER_MONTHLY: "price_x" });
  check("billing projection: configured price → purchasable", bpConfigured.plans.find((c) => c.id === "starter")?.purchasable === true);

  // ---- Fixtures: two tenants (free_trial → maxConnectedAccounts 1, maxBrands 1) ----
  const a = await registerUser({ email: `lim-a-${sfx}@ex.com`, passwordHash: await hashPassword("password a 1"), workspaceName: "Lim A", country: "SK" });
  const b = await registerUser({ email: `lim-b-${sfx}@ex.com`, passwordHash: await hashPassword("password b 1"), workspaceName: "Lim B", country: "SK" });
  tenantIds.push(a.tenantId, b.tenantId); userIds.push(a.userId, b.userId);
  const brandA = await withTenant(a.tenantId, (db) => db.brand.findFirst({ where: { tenantId: a.tenantId }, select: { id: true } }));

  const mkAccount = (tenantId: string, brandId: string, ext: string, extra: Record<string, unknown> = {}) => (db: typeof systemDb) =>
    db.connectedAccount.create({ data: { tenantId, brandId, platform: "facebook_page" as never, status: "active", mode: "read_only", externalId: ext, ...extra } });

  // ---- Counting rules -------------------------------------------------------
  // Page (parent null) + linked IG (parent set) + disconnected → commercial count = 1.
  const page = await withTenant(a.tenantId, (db) => db.connectedAccount.create({ data: { tenantId: a.tenantId, brandId: brandA!.id, platform: "facebook_page" as never, status: "active", mode: "read_only", externalId: `pg_${sfx}` } }));
  await withTenant(a.tenantId, (db) => db.connectedAccount.create({ data: { tenantId: a.tenantId, brandId: brandA!.id, platform: "instagram_business" as never, status: "active", mode: "read_only", externalId: `ig_${sfx}`, parentAccountId: page.id } }));
  await withTenant(a.tenantId, (db) => db.connectedAccount.create({ data: { tenantId: a.tenantId, brandId: brandA!.id, platform: "facebook_page" as never, status: "disconnected", mode: "read_only", externalId: `dc_${sfx}` } }));
  const commercial = await withTenant(a.tenantId, (db) => countCommercialConnections(db, a.tenantId));
  check("Page + linked IG = ONE bundle; disconnected not counted", commercial === 1, String(commercial));

  // Tenant A is now AT its free_trial connection limit (1). A new connect is denied.
  const overCap = await isEnt(() => createWithinResourceLimit(a.tenantId, "connections", mkAccount(a.tenantId, brandA!.id, `x_${sfx}`)), "account_limit_reached");
  check("over the connection limit → account_limit_reached", overCap);

  // Unrelated tenant B proceeds independently (its own limit).
  const brandB = await withTenant(b.tenantId, (db) => db.brand.findFirst({ where: { tenantId: b.tenantId }, select: { id: true } }));
  const bOk = await createWithinResourceLimit(b.tenantId, "connections", mkAccount(b.tenantId, brandB!.id, `b1_${sfx}`)).then(() => true).catch(() => false);
  check("unrelated tenant creates independently (own limit)", bOk);

  // ---- Concurrency: two simultaneous connects on a limit-1 tenant → only ONE wins ----
  const c = await registerUser({ email: `lim-c-${sfx}@ex.com`, passwordHash: await hashPassword("password c 1"), workspaceName: "Lim C", country: "SK" });
  tenantIds.push(c.tenantId); userIds.push(c.userId);
  const brandC = await withTenant(c.tenantId, (db) => db.brand.findFirst({ where: { tenantId: c.tenantId }, select: { id: true } }));
  const results = await Promise.allSettled([
    createWithinResourceLimit(c.tenantId, "connections", mkAccount(c.tenantId, brandC!.id, `cc1_${sfx}`)),
    createWithinResourceLimit(c.tenantId, "connections", mkAccount(c.tenantId, brandC!.id, `cc2_${sfx}`)),
  ]);
  const wins = results.filter((r) => r.status === "fulfilled").length;
  const finalCount = await withTenant(c.tenantId, (db) => countCommercialConnections(db, c.tenantId));
  check("two concurrent connects cannot exceed the limit (advisory lock serializes)", wins === 1 && finalCount === 1, `wins=${wins} count=${finalCount}`);

  // ---- Concurrency: brands (free_trial maxBrands 1; the fixture already has 1) ----
  const brandWins = await Promise.allSettled([
    createWithinResourceLimit(c.tenantId, "brands", (db) => db.brand.create({ data: { tenantId: c.tenantId, name: `B1_${sfx}` } })),
    createWithinResourceLimit(c.tenantId, "brands", (db) => db.brand.create({ data: { tenantId: c.tenantId, name: `B2_${sfx}` } })),
  ]);
  const brandFulfilled = brandWins.filter((r) => r.status === "fulfilled").length;
  check("concurrent brand creation cannot exceed maxBrands", brandFulfilled === 0, `fulfilled=${brandFulfilled}`); // already at limit 1

  // ---- Restricted tenant → limit 0 (denied) + billing/deletion preserved ----
  await systemDb.tenant.update({ where: { id: b.tenantId }, data: { accessState: "restricted", billingStatus: "canceled" } });
  const restrictedDenied = await isEnt(() => createWithinResourceLimit(b.tenantId, "brands", (db) => db.brand.create({ data: { tenantId: b.tenantId, name: `R_${sfx}` } })), "brand_limit_reached");
  check("restricted tenant denied new creation (limit 0)", restrictedDenied);

  // ---- Operation gate (sync-pause precedence) -------------------------------
  check("active tenant → operations allowed", (await getTenantOperationGate(a.tenantId)).allowed === true);
  check("restricted tenant → billing_restricted", (await getTenantOperationGate(b.tenantId)).reason === "billing_restricted");
  await systemDb.tenant.update({ where: { id: b.tenantId }, data: { accessState: "suspended" } });
  check("suspended tenant → suspended reason", (await getTenantOperationGate(b.tenantId)).reason === "suspended");
  check("unknown tenant → not allowed (fail closed)", (await getTenantOperationGate("nope")).allowed === false);

  // ---- getTenantResourceUsage (same helpers as enforcement) -----------------
  const usage = await getTenantResourceUsage(a.tenantId);
  check("resource usage uses the canonical counting helpers", usage.connections === 1 && usage.brands >= 1);

  // Cleanup.
  for (const id of tenantIds) await prisma.tenant.delete({ where: { id } }).catch(() => {});
  for (const id of userIds) await prisma.user.delete({ where: { id } }).catch(() => {});

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — route locking, atomic limits & single-source pricing (V1.50F)`);
  await prisma.$disconnect();
  if (failures > 0) process.exit(1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
