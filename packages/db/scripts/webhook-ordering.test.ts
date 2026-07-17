/**
 * V1.58.4 — EXECUTABLE, DATABASE-BACKED out-of-order webhook guard tests. Runs recordAndApplyStripeEvent
 * against a REAL Postgres (the atomic conditional UPDATE + row-lock serialization can't be proven with
 * mocks). SAFETY: refuses unless DATABASE_URL is local. Run: scripts/run-webhook-ordering.sh
 */
import { systemDb, ensureStripeCustomer, recordAndApplyStripeEvent, getTenantBilling, type StripeSubStateInput } from "../src/index";

const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:\/]/.test(DB)) {
  console.error("✗ REFUSING TO RUN: webhook-ordering.test.ts requires a LOCAL Postgres (localhost/127.0.0.1).");
  process.exit(2);
}

let pass = 0, fail = 0;
function assert(cond: boolean, label: string, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
}

const NOW = new Date("2026-07-01T00:00:00Z");
const FUTURE = new Date(NOW.getTime() + 30 * 864e5);
const PAST = new Date(NOW.getTime() - 864e5);

const created: string[] = [];
async function tenantWithCustomer(tag: string): Promise<{ tenantId: string; cus: string }> {
  const t = await systemDb.tenant.create({ data: { name: `wo ${tag}`, slug: `wo-${tag}-${Math.floor(Math.random() * 1e9)}` }, select: { id: true } });
  created.push(t.id);
  const cus = `cus_${tag}_${Math.floor(Math.random() * 1e9)}`;
  await ensureStripeCustomer(t.id, cus);
  return { tenantId: t.id, cus };
}
const input = (cus: string, status: string, periodEnd: Date | null): StripeSubStateInput => ({
  stripeCustomerId: cus, stripeSubscriptionId: `sub_${cus}`, stripePriceId: "price_x",
  plan: status === "canceled" ? "starter" : "starter", billingInterval: "monthly", status,
  currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false, canceledAt: status === "canceled" ? NOW : undefined,
});
const status = async (tenantId: string) => (await getTenantBilling(tenantId))?.billingStatus;
const access = async (tenantId: string) => (await getTenantBilling(tenantId))?.accessState;

async function run() {
  console.log(`\nDatabase: LOCAL (${DB.replace(/:\/\/[^@]*@/, "://***@").split("?")[0]})\n`);
  try {
    // 12/13) deleted(newer) stays authoritative; a later-delivered OLDER active is stale.
    {
      const { tenantId, cus } = await tenantWithCustomer("ord");
      const a = await recordAndApplyStripeEvent("evt_ord_active", "customer.subscription.updated", input(cus, "active", FUTURE), 100, NOW);
      const d = await recordAndApplyStripeEvent("evt_ord_deleted", "customer.subscription.deleted", input(cus, "canceled", PAST), 200, NOW);
      const late = await recordAndApplyStripeEvent("evt_ord_active_late", "customer.subscription.updated", input(cus, "active", FUTURE), 150, NOW);
      assert(a.outcome === "processed" && d.outcome === "processed", "12a) active then deleted both applied in created order");
      assert(late.outcome === "stale", "13) an OLDER (created 150 < 200) active is recorded stale", late.outcome);
      assert((await status(tenantId)) === "canceled" && (await access(tenantId)) === "restricted", "12b) deleted stays authoritative — tenant restricted after the late older active");
    }
    // 14) duplicate event id → idempotent.
    {
      const { tenantId, cus } = await tenantWithCustomer("dup");
      await recordAndApplyStripeEvent("evt_dup", "customer.subscription.updated", input(cus, "active", FUTURE), 100, NOW);
      const dup = await recordAndApplyStripeEvent("evt_dup", "customer.subscription.updated", input(cus, "canceled", PAST), 300, NOW);
      assert(dup.outcome === "duplicate", "14) replaying the same event id is idempotent (duplicate)");
      assert((await status(tenantId)) === "active", "14b) duplicate did not mutate state");
    }
    // 15) concurrent conflicting events → final state deterministic (terminal wins), only one authoritative.
    {
      const { tenantId, cus } = await tenantWithCustomer("race");
      const [r1, r2] = await Promise.all([
        recordAndApplyStripeEvent("evt_race_active", "customer.subscription.updated", input(cus, "active", FUTURE), 500, NOW),
        recordAndApplyStripeEvent("evt_race_deleted", "customer.subscription.deleted", input(cus, "canceled", PAST), 500, NOW),
      ]);
      assert((await status(tenantId)) === "canceled" && (await access(tenantId)) === "restricted",
        "15) two concurrent same-timestamp events → terminal (deleted) wins deterministically", `final=${await status(tenantId)}`);
      assert([r1.outcome, r2.outcome].filter((o) => o === "processed" || o === "stale").length === 2 && [r1.outcome, r2.outcome].includes("processed"),
        "15b) both resolved (one processed, the other stale/processed) — no error, no double terminal loss");
    }
    // 16/17) equal created tie-break: terminal wins regardless of arrival order.
    {
      const { tenantId, cus } = await tenantWithCustomer("tie1");
      await recordAndApplyStripeEvent("evt_tie1_a", "customer.subscription.updated", input(cus, "active", FUTURE), 700, NOW);
      const dTerm = await recordAndApplyStripeEvent("evt_tie1_d", "customer.subscription.deleted", input(cus, "canceled", PAST), 700, NOW);
      assert(dTerm.outcome === "processed" && (await status(tenantId)) === "canceled", "16) active then deleted@same-created → deleted applies (terminal wins)");

      const { tenantId: t2, cus: c2 } = await tenantWithCustomer("tie2");
      await recordAndApplyStripeEvent("evt_tie2_d", "customer.subscription.deleted", input(c2, "canceled", PAST), 700, NOW);
      const aStale = await recordAndApplyStripeEvent("evt_tie2_a", "customer.subscription.updated", input(c2, "active", FUTURE), 700, NOW);
      assert(aStale.outcome === "stale" && (await status(t2)) === "canceled", "17) deleted then active@same-created → active is stale (terminal not overwritten)");
    }
    // 18) genuinely newer reactivation restores access.
    {
      const { tenantId, cus } = await tenantWithCustomer("react");
      await recordAndApplyStripeEvent("evt_react_d", "customer.subscription.deleted", input(cus, "canceled", PAST), 800, NOW);
      const react = await recordAndApplyStripeEvent("evt_react_a", "customer.subscription.updated", input(cus, "active", FUTURE), 900, NOW);
      assert(react.outcome === "processed" && (await status(tenantId)) === "active" && (await access(tenantId)) === "full_access",
        "18) newer (created 900 > 800) active reactivation restores full_access");
    }
    // 19) ordering domain is per-subscription — an unrelated tenant's events are never blocked.
    {
      const A = await tenantWithCustomer("isoA"); const B = await tenantWithCustomer("isoB");
      await recordAndApplyStripeEvent("evt_isoA", "customer.subscription.updated", input(A.cus, "active", FUTURE), 5000, NOW);
      const b = await recordAndApplyStripeEvent("evt_isoB", "customer.subscription.updated", input(B.cus, "active", FUTURE), 100, NOW);
      assert(b.outcome === "processed" && (await status(B.tenantId)) === "active",
        "19) tenant B's low-timestamp event is NOT blocked by tenant A's high-timestamp event (separate aggregate)");
    }
    // 20) retry of the same event after an earlier apply is idempotent — no inconsistent middle state.
    {
      const { tenantId, cus } = await tenantWithCustomer("retry");
      await recordAndApplyStripeEvent("evt_retry", "invoice.payment_failed", input(cus, "past_due", NOW), 1000, NOW);
      const retry = await recordAndApplyStripeEvent("evt_retry", "invoice.payment_failed", input(cus, "past_due", NOW), 1000, NOW);
      assert(retry.outcome === "duplicate" && (await status(tenantId)) === "past_due", "20) webhook retry of a processed event → duplicate, consistent state");
    }
  } finally {
    for (const id of created) await systemDb.tenant.delete({ where: { id } }).catch(() => {});
    await systemDb.$disconnect();
  }
  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — webhook ordering guard (V1.58.4): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
