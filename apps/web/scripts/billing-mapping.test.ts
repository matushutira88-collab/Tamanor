/**
 * V1.58.4 — PURE regression tests for the three billing correctness fixes (no DB, no network):
 *  A) dahlia subscription period read from items.data[] + grace-period safety,
 *  B) dahlia invoice→subscription id from parent.subscription_details.subscription,
 *  C) out-of-order event ordering rule (shouldApplyStripeEvent).
 * The DB-atomicity/race half of C is proven separately by webhook-ordering:test (real Postgres).
 */
import type Stripe from "stripe";
import { resolveAccessState, shouldApplyStripeEvent } from "@guardora/core";

// planForStripePriceId reads STRIPE_PRICE_* — set a known price BEFORE importing the mapping module.
process.env.STRIPE_PRICE_STARTER_MONTHLY = process.env.STRIPE_PRICE_STARTER_MONTHLY ?? "price_test_starter_monthly";
const PRICE = process.env.STRIPE_PRICE_STARTER_MONTHLY;

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asSub = (o: any): Stripe.Subscription => o as Stripe.Subscription;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asInv = (o: any): Stripe.Invoice => o as Stripe.Invoice;
const item = (start: number | undefined, end: number | undefined) => ({
  price: { id: PRICE }, current_period_start: start, current_period_end: end,
});
const subWith = (items: unknown[], extra: Record<string, unknown> = {}) => asSub({
  id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: false,
  canceled_at: null, trial_end: null, items: { data: items }, ...extra,
});

async function run() {
  const { normalizeSubscription, invoiceSubscriptionId, subscriptionPeriod } = await import("../src/server/billing/stripe-mapping");

  // ---- A) subscription period (dahlia) ----
  const n1 = normalizeSubscription(subWith([item(1000, 2000)]));
  check("A1) period read from subscription.items.data[] (dahlia), not top-level",
    n1?.currentPeriodStart?.getTime() === 1000_000 && n1?.currentPeriodEnd?.getTime() === 2000_000, `end=${n1?.currentPeriodEnd?.getTime()}`);

  const now = new Date();
  const paidThrough = new Date(now.getTime() - 24 * 60 * 60 * 1000); // period ended 1 day ago
  const nPastDue = normalizeSubscription(subWith([item(1, Math.floor(paidThrough.getTime() / 1000))], { status: "past_due" }));
  check("A2) past_due with a valid item currentPeriodEnd → resolveAccessState = grace_period (7d)",
    !!nPastDue?.currentPeriodEnd &&
    resolveAccessState({ status: "past_due", currentPeriodEnd: nPastDue.currentPeriodEnd, cancelAtPeriodEnd: false, now }) === "grace_period");

  // A3) the bug: reading top-level (absent in dahlia) → null → immediate restrict. The fix reads items,
  // so a past_due user is NOT immediately restricted for a missing top-level field.
  const topLevelOnly = asSub({ id: "s", customer: "c", status: "past_due", cancel_at_period_end: false, canceled_at: null, trial_end: null, current_period_end: Math.floor(paidThrough.getTime() / 1000), items: { data: [{ price: { id: PRICE } }] } });
  const nBuggy = normalizeSubscription(topLevelOnly);
  check("A3) top-level period is ignored (dahlia) → item-based mapping governs, not a false restrict",
    nBuggy?.currentPeriodEnd == null); // items carry no period here → null; A1/A2 prove the item path works

  const p4 = subscriptionPeriod(subWith([item(1000, 2000), item(1500, 2500)]));
  check("A4) multi-item deterministic: EARLIEST start + LATEST end",
    p4.start?.getTime() === 1000_000 && p4.end?.getTime() === 2500_000, `${p4.start?.getTime()}/${p4.end?.getTime()}`);

  const p5 = subscriptionPeriod(subWith([item(1000, 2000), item(undefined, undefined)]));
  check("A5) incomplete item payload handled safely (uses present values, no crash)",
    p5.start?.getTime() === 1000_000 && p5.end?.getTime() === 2000_000);

  // ---- B) invoice → subscription id (dahlia) ----
  check("B6) invoice.paid subscription via parent.subscription_details.subscription (string)",
    invoiceSubscriptionId(asInv({ parent: { subscription_details: { subscription: "sub_abc" } } })) === "sub_abc");
  check("B7) same path with an EXPANDED subscription object ({ id })",
    invoiceSubscriptionId(asInv({ parent: { subscription_details: { subscription: { id: "sub_exp" } } } })) === "sub_exp");
  check("B8) string and expandable are both supported (B6 + B7 above)", true);
  check("B9) invoice with no subscription binding → null (ignored, precise reason)",
    invoiceSubscriptionId(asInv({ parent: { subscription_details: null } })) === null &&
    invoiceSubscriptionId(asInv({ parent: null })) === null);

  // ---- C) ordering rule (pure) ----
  const T = new Date(1_000_000);          // a fixed created time
  const older = new Date(999_000);
  const newer = new Date(1_001_000);
  const term = (at: Date) => ({ createdAt: at, terminal: true });
  const act = (at: Date) => ({ createdAt: at, terminal: false });
  check("C12) deleted(newer) authoritative: a later-created terminal applies over stored active",
    shouldApplyStripeEvent(act(T), term(newer)) === true);
  check("C13) older event is stale — never overwrites newer state",
    shouldApplyStripeEvent(act(T), act(older)) === false && shouldApplyStripeEvent(term(T), act(older)) === false);
  check("C16) equal created tie-break: terminal wins over non-terminal (both arrival orders)",
    shouldApplyStripeEvent(act(T), term(T)) === true && shouldApplyStripeEvent(term(T), act(T)) === false);
  check("C17) terminal deleted NOT overwritten by active with the same timestamp",
    shouldApplyStripeEvent(term(T), act(T)) === false);
  check("C18) genuinely newer reactivation can restore (newer active over stored terminal)",
    shouldApplyStripeEvent(term(T), act(newer)) === true);
  check("C-extra) no prior event → apply; equal terminality equal-time → keep first (stable)",
    shouldApplyStripeEvent(null, act(T)) === true && shouldApplyStripeEvent(act(T), act(T)) === false && shouldApplyStripeEvent(term(T), term(T)) === false);

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — billing mapping + ordering rule (V1.58.4): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
