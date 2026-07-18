/**
 * V1.50E — Plans, entitlements & restricted-access tests. Central catalogue truth, access-state
 * precedence, limit helpers, and the server-side tenant resolver (getTenantEntitlements +
 * tenantAllowsOperations) against real fixture tenants.
 *
 * Run via: pnpm entitlements:test
 */
import { randomBytes } from "node:crypto";
import { prisma, systemDb, registerUser, hashPassword } from "@guardora/db";
import { getTenantEntitlements, tenantAllowsOperations } from "@guardora/db";
import {
  planEntitlements, resolveEntitlements, hasEntitlement, isWithinLimit, assertWithinLimit,
  getUsageRemaining, canPerformOperation, EntitlementError, BILLING_PLANS,
} from "@guardora/core";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
function throwsEnt(fn: () => void, reason: string): boolean {
  try { fn(); return false; } catch (e) { return e instanceof EntitlementError && e.reason === reason; }
}

async function run() {
  const sfx = randomBytes(5).toString("hex");
  const tenantIds: string[] = [];
  const userIds: string[] = [];

  // ---- A. Catalogue truth ---------------------------------------------------
  const plans = ["free_trial", "starter", "growth", "agency", "enterprise"] as const;
  check("every self-serve plan in the entitlement catalogue matches the billing catalogue plan id",
    plans.every((p) => planEntitlements(p).plan === p));
  check("unimplemented capabilities are FALSE for every plan (not advertised)",
    plans.every((p) => { const e = planEntitlements(p); return e.export === false && e.multiWorkspace === false && e.agencyClientManagement === false; }));
  check("Starter does NOT claim analytics/risk/incidents (not shipped for Starter)",
    !planEntitlements("starter").reputationAnalytics && !planEntitlements("starter").riskProfiles && !planEntitlements("starter").incidents);
  check("Growth ships analytics + risk + incidents + control center",
    planEntitlements("growth").reputationAnalytics && planEntitlements("growth").riskProfiles && planEntitlements("growth").incidents && planEntitlements("growth").controlCenter);
  check("audit log is available on all plans", plans.every((p) => planEntitlements(p).auditLog));
  check("unknown plan → MINIMAL (0 accounts, no paid AI, no operations)", (() => {
    const e = planEntitlements("banana");
    return e.maxConnectedAccounts === 0 && e.paidAi === false && e.providerSync === false && e.moderationExecution === false;
  })());
  check("enterprise = unlimited limits", planEntitlements("enterprise").maxConnectedAccounts === null && planEntitlements("enterprise").maxBrands === null);
  check("entitlement account limits match the billing catalogue limits",
    planEntitlements("starter").maxConnectedAccounts === BILLING_PLANS.starter.limits.connectedAccounts &&
    planEntitlements("growth").maxConnectedAccounts === BILLING_PLANS.growth.limits.connectedAccounts &&
    planEntitlements("agency").maxConnectedAccounts === BILLING_PLANS.agency.limits.connectedAccounts);

  // ---- B. Access-state precedence ------------------------------------------
  check("restricted → operations OFF + creation blocked (agency downgraded)", (() => {
    const e = resolveEntitlements("agency", "restricted");
    return e.providerSync === false && e.moderationExecution === false && e.paidAi === false && e.maxConnectedAccounts === 0 && e.maxBrands === 0;
  })());
  check("restricted KEEPS billing + deletion access", (() => {
    const e = resolveEntitlements("agency", "restricted");
    return e.billingAccess === true && e.deletionAccess === true;
  })());
  check("suspended behaves like restricted (operations off)", resolveEntitlements("growth", "suspended").providerSync === false);
  check("deleting tenant → operations off regardless of plan/access", resolveEntitlements("agency", "full_access", { deletingTenant: true }).moderationExecution === false);
  check("full_access agency (Business) honors the plan (operations on, limit 40)", (() => {
    const e = resolveEntitlements("agency", "full_access");
    return e.providerSync && e.moderationExecution && e.paidAi && e.maxConnectedAccounts === 40;
  })());
  check("grace_period keeps plan operations", resolveEntitlements("growth", "grace_period").providerSync === true);
  check("unknown plan + full access → still MINIMAL (fail safe)", resolveEntitlements("banana", "full_access").maxConnectedAccounts === 0);

  // ---- C. Limit + operation helpers ----------------------------------------
  check("isWithinLimit: below cap yes, at cap no, unlimited yes", isWithinLimit(2, 3) && !isWithinLimit(3, 3) && isWithinLimit(999, null));
  check("assertWithinLimit throws normalized reason at cap", throwsEnt(() => assertWithinLimit(3, 3, "account_limit_reached"), "account_limit_reached"));
  check("getUsageRemaining computes remaining / Infinity", getUsageRemaining(1, 3) === 2 && getUsageRemaining(5, null) === Infinity && getUsageRemaining(9, 3) === 0);
  check("canPerformOperation: restricted denies with billing_restricted", (() => {
    const e = resolveEntitlements("agency", "restricted");
    const s = canPerformOperation(e, "paid_ai");
    return s.ok === false && s.reason === "billing_restricted";
  })());
  check("canPerformOperation: full access allows", canPerformOperation(resolveEntitlements("starter", "full_access"), "connect_account").ok === true);

  // ---- D. Server-side tenant resolver (real fixtures) ----------------------
  const t = await registerUser({ email: `ent-${sfx}@ex.com`, passwordHash: await hashPassword("password ent 1"), workspaceName: "Ent Co", country: "SK" });
  tenantIds.push(t.tenantId); userIds.push(t.userId);
  // A fresh trial tenant → free_trial entitlements, operations allowed.
  const ent0 = await getTenantEntitlements(t.tenantId);
  check("fresh trial tenant resolves free_trial entitlements", ent0.plan === "free_trial" && ent0.maxConnectedAccounts === 1);
  check("fresh trial tenant allows operations", (await tenantAllowsOperations(t.tenantId)) === true);

  // Restrict the tenant → operations denied, creation blocked, billing/deletion kept.
  await systemDb.tenant.update({ where: { id: t.tenantId }, data: { accessState: "restricted", billingStatus: "canceled" } });
  const entR = await getTenantEntitlements(t.tenantId);
  check("restricted tenant → 0 account limit + no operations", entR.maxConnectedAccounts === 0 && entR.providerSync === false && entR.moderationExecution === false && entR.paidAi === false);
  check("restricted tenant still has billing + deletion access", entR.billingAccess && entR.deletionAccess);
  check("restricted tenant DENIES new operations (server gate)", (await tenantAllowsOperations(t.tenantId)) === false);

  // A paid tenant → plan entitlements.
  await systemDb.tenant.update({ where: { id: t.tenantId }, data: { plan: "growth", accessState: "full_access", billingStatus: "active" } });
  const entG = await getTenantEntitlements(t.tenantId);
  check("active growth tenant → growth limits + analytics", entG.plan === "growth" && entG.maxConnectedAccounts === 12 && entG.reputationAnalytics === true);
  check("active growth tenant allows operations", (await tenantAllowsOperations(t.tenantId)) === true);

  // Cleanup.
  for (const id of tenantIds) await prisma.tenant.delete({ where: { id } }).catch(() => {});
  for (const id of userIds) await prisma.user.delete({ where: { id } }).catch(() => {});

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — plans, entitlements & restricted access (V1.50E)`);
  await prisma.$disconnect();
  if (failures > 0) process.exit(1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
