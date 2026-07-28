/**
 * TEST-ONLY seam: stage a BUSINESS billing-truth scenario on the primary E2E fixture tenant so the browser
 * suite can prove the Billing/Usage pages show the EFFECTIVE (subscription) plan, not a stale Tenant.plan.
 * Fail-closed: 404 unless E2E_TEST_MODE === "true". The spec RESTORES the tenant to its Family baseline in
 * teardown. Never changes authorization, price mapping, or the webhook; it only writes fixture billing rows.
 *
 * scenario "stale-growth": workspaceKind=business, Tenant.plan=free_trial (STALE) + billingStatus=active, and a
 *                          trusted active Growth subscription (monthly) → effective plan must resolve to Growth.
 * scenario "restore":      workspaceKind=family, Tenant.plan=family_free, no subscription (baseline).
 */
import { listDevLoginUsers, systemDb } from "@guardora/db";
import { e2eSeamEnabled } from "@/lib/e2e-seam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!e2eSeamEnabled()) return new Response("Not found", { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { scenario?: string };
  const scenario = body.scenario;
  if (scenario !== "stale-growth" && scenario !== "restore") return Response.json({ error: "bad_scenario" }, { status: 400 });

  const users = await listDevLoginUsers();
  const tenantId = users[0]?.memberships?.[0]?.tenantId;
  if (!tenantId) return Response.json({ error: "no_fixture_tenant" }, { status: 500 });

  if (scenario === "restore") {
    await systemDb.subscription.deleteMany({ where: { tenantId } });
    await systemDb.tenant.update({
      where: { id: tenantId },
      data: { workspaceKind: "family", plan: "family_free", billingStatus: "no_subscription", accessState: "full_access", trialStartsAt: null, trialEndsAt: null },
    });
    return Response.json({ ok: true, scenario });
  }

  // stale-growth: a stale Tenant.plan (free_trial) with a trusted active Growth subscription.
  const periodEnd = new Date(Date.now() + 20 * 86_400_000);
  await systemDb.tenant.update({
    where: { id: tenantId },
    data: { workspaceKind: "business", plan: "free_trial", billingStatus: "active", accessState: "full_access", trialStartsAt: null, trialEndsAt: null },
  });
  await systemDb.subscription.upsert({
    where: { tenantId },
    create: { tenantId, stripeCustomerId: `cus_e2e_${tenantId}`, plan: "growth", status: "active", billingInterval: "monthly", currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false },
    update: { plan: "growth", status: "active", billingInterval: "monthly", currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false, canceledAt: null },
  });
  return Response.json({ ok: true, scenario, effectivePlan: "growth" });
}
