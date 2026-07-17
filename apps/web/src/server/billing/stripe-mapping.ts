import type Stripe from "stripe";
import { planForStripePriceId } from "@guardora/core";
import type { StripeSubStateInput } from "@guardora/db";

/**
 * V1.58.4 — PURE Stripe→internal mapping (no `server-only`, no network) so it is directly unit-testable.
 * Correct for Stripe API 2026-06-24.dahlia, where the subscription current-period fields moved onto
 * `subscription.items.data[]` and the invoice→subscription reference moved to
 * `invoice.parent.subscription_details.subscription`.
 */

export function toDate(n: unknown): Date | null {
  return typeof n === "number" && n > 0 ? new Date(n * 1000) : null;
}

/**
 * Subscription current-period for dahlia. Multi-item policy: Stripe aligns item billing periods by
 * default; we take the EARLIEST start and the LATEST end so the whole subscription's current paid
 * window is represented and access is never cut before the last item's paid period ends
 * (customer-safe). No item carries the field → null (never restrict solely for a missing period).
 */
export function subscriptionPeriod(sub: Stripe.Subscription): { start: Date | null; end: Date | null } {
  const items = sub.items?.data ?? [];
  const starts: number[] = [];
  const ends: number[] = [];
  for (const it of items) {
    if (typeof it.current_period_start === "number" && it.current_period_start > 0) starts.push(it.current_period_start);
    if (typeof it.current_period_end === "number" && it.current_period_end > 0) ends.push(it.current_period_end);
  }
  return {
    start: starts.length ? toDate(Math.min(...starts)) : null,
    end: ends.length ? toDate(Math.max(...ends)) : null,
  };
}

/**
 * Subscription id from a Stripe Invoice (dahlia): `invoice.parent.subscription_details.subscription`
 * (a `string | Subscription`). Null for a genuinely non-subscription invoice → caller treats as ignored.
 */
export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const ref = invoice.parent?.subscription_details?.subscription;
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

/**
 * Normalize a Stripe Subscription into our trusted subscription-state input. Fails closed (null) if
 * the price is not in the catalogue or the customer is missing — the webhook then records the event
 * without granting an arbitrary plan. Period comes from the items (dahlia); trial_end / canceled_at
 * remain top-level (typed).
 */
export function normalizeSubscription(sub: Stripe.Subscription, latestInvoiceStatus?: string | null): StripeSubStateInput | null {
  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const mapped = priceId ? planForStripePriceId(priceId) : null;
  if (!mapped) return null; // unrecognised price → do not grant an arbitrary plan
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) return null;

  const period = subscriptionPeriod(sub);
  return {
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    plan: mapped.plan,
    billingInterval: mapped.interval,
    status: sub.status,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    canceledAt: toDate(sub.canceled_at),
    trialEndsAt: toDate(sub.trial_end),
    latestInvoiceStatus: latestInvoiceStatus ?? null,
  };
}
