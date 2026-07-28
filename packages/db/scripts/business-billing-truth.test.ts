/**
 * BUSINESS BILLING TRUTH — DB agreement tests (local DB). Proves that the canonical presentation (what the
 * Billing + Usage UIs display) and getTenantEntitlements (what the server ENFORCES) resolve to the SAME
 * effective plan even when Tenant.plan is STALE — and that FAMILY tenants are untouched (never routed through
 * the Business effective-plan authority). Run: pnpm business-billing-truth:test
 */
import { randomBytes } from "node:crypto";
import { prisma, systemDb, registerUser, hashPassword, getTenantBilling, getTenantEntitlements } from "@guardora/db";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const sfx = randomBytes(4).toString("hex");
const tenantIds: string[] = [];

async function mkTenant(email: string): Promise<string> {
  const t = await registerUser({ email, passwordHash: await hashPassword("password truth 1"), workspaceName: "Truth Co", country: "SK" });
  tenantIds.push(t.tenantId);
  return t.tenantId;
}
const future = (d: number) => new Date(Date.now() + d * 86_400_000);
const past = (d: number) => new Date(Date.now() - d * 86_400_000);

async function main() {
  // ── 1. STALE Tenant.plan=free_trial + active paid Growth subscription ──────────────────
  const biz = await mkTenant(`bt-${sfx}@ex.com`);
  await systemDb.tenant.update({ where: { id: biz }, data: { plan: "free_trial", billingStatus: "active", accessState: "full_access", trialEndsAt: future(2) } });
  await systemDb.subscription.create({
    data: { tenantId: biz, stripeCustomerId: `cus_${sfx}`, plan: "growth", status: "active", billingInterval: "monthly", currentPeriodEnd: future(20), cancelAtPeriodEnd: false },
  });

  console.log("\n1. stale Tenant.plan (free_trial) + active Growth subscription");
  const b1 = await getTenantBilling(biz);
  const e1 = await getTenantEntitlements(biz);
  check("★ presentation.effectivePlanId = growth (subscription wins over stale tenant)", b1?.presentation.effectivePlanId === "growth" && b1?.presentation.isPaid === true);
  check("★ presentation NOT a trial despite trialEndsAt in the future", b1?.presentation.isTrial === false && b1?.presentation.lifecycle === "active_paid");
  check("★ ENFORCEMENT (getTenantEntitlements) = growth limits — DISPLAY === ENFORCEMENT", e1.plan === "growth" && e1.maxConnectedAccounts === 12 && e1.reputationAnalytics === true);
  check("★ tenant.plan is still the stale value (we did NOT mutate it here)", (await systemDb.tenant.findUnique({ where: { id: biz }, select: { plan: true } }))?.plan === "free_trial");

  // ── 2. cancel-at-period-end still paid through ─────────────────────────────────────────
  await systemDb.subscription.update({ where: { tenantId: biz }, data: { cancelAtPeriodEnd: true, currentPeriodEnd: future(10) } });
  console.log("\n2. cancel-at-period-end before period end → still paid/current");
  const b2 = await getTenantBilling(biz);
  check("★ isPaid + cancelAtPeriodEnd + growth entitlements still enforced", b2?.presentation.isPaid === true && b2?.presentation.cancelAtPeriodEnd === true && (await getTenantEntitlements(biz)).maxConnectedAccounts === 12);

  // ── 3. canceled after paid period → restricted, entitlements locked (no weakening) ─────
  await systemDb.subscription.update({ where: { tenantId: biz }, data: { status: "canceled", currentPeriodEnd: past(2) } });
  await systemDb.tenant.update({ where: { id: biz }, data: { billingStatus: "canceled" } });
  console.log("\n3. canceled after paid period → restricted + locked entitlements");
  const b3 = await getTenantBilling(biz);
  const e3 = await getTenantEntitlements(biz);
  check("★ lifecycle canceled, not paid", b3?.presentation.lifecycle === "canceled" && b3?.presentation.isPaid === false);
  check("★ entitlements LOCKED (0 accounts, no operations) — access-state precedence intact", e3.maxConnectedAccounts === 0 && e3.providerSync === false && e3.moderationExecution === false);
  check("★ billing + deletion access preserved (not weakened the wrong way)", e3.billingAccess === true && e3.deletionAccess === true);

  // ── 4. FAMILY tenant is untouched by the Business effective-plan routing ───────────────
  const fam = await mkTenant(`bt-fam-${sfx}@ex.com`);
  await systemDb.tenant.update({ where: { id: fam }, data: { workspaceKind: "family", plan: "family_basic", billingStatus: "active", accessState: "full_access" } });
  console.log("\n4. family tenant → Business routing does NOT apply (unchanged)");
  const ef = await getTenantEntitlements(fam);
  // A family tenant is NOT routed through the Business effective-plan authority: resolveEntitlements(family_basic)
  // → MINIMAL (fail-closed, 0 business accounts) exactly as before this change. It is never granted a Business tier.
  check("★ family tenant → MINIMAL business entitlements (0 accounts, no ops); never a Business plan tier", ef.maxConnectedAccounts === 0 && ef.providerSync === false && ef.reputationAnalytics === false);

  // ── 5. no live subscription → Tenant.plan governs (never a downgrade vs prior behavior) ─
  const legacy = await mkTenant(`bt-legacy-${sfx}@ex.com`);
  await systemDb.tenant.update({ where: { id: legacy }, data: { plan: "starter", billingStatus: "active", accessState: "full_access" } });
  console.log("\n5. active-looking tenant with NO subscription row → keeps Tenant.plan (no downgrade)");
  const el = await getTenantEntitlements(legacy);
  const bl = await getTenantBilling(legacy);
  check("★ no live sub → enforcement stays at Tenant.plan (starter=4 accounts), source=tenant", el.plan === "starter" && el.maxConnectedAccounts === 4 && bl?.presentation.source === "tenant");
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    await systemDb.subscription.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
    for (const id of tenantIds) await systemDb.tenant.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Business billing truth (DB): ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
