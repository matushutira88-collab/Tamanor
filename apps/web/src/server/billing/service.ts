import "server-only";
import type Stripe from "stripe";
import {
  resolveStripePriceId, planForStripePriceId, isSelfServePlan,
  type BillingPlanId, type BillingInterval,
} from "@guardora/core";
import { getStripeCustomerId, ensureStripeCustomer, type StripeSubStateInput } from "@guardora/db";
import { getStripe, portalReturnUrl } from "./stripe";

/**
 * V1.50D — high-level Stripe operations. Checkout/portal are authorized + tenant-scoped by the
 * caller (server action); price IDs are ALWAYS resolved server-side from a trusted (plan, interval)
 * pair — a client-supplied price ID is never accepted. Event normalization fails closed for an
 * unrecognised price (never grants an arbitrary plan).
 */

export type OpResult = { ok: true; url: string } | { ok: false; reason: string };

function toDate(n: unknown): Date | null {
  return typeof n === "number" && n > 0 ? new Date(n * 1000) : null;
}

export async function createCheckout(args: {
  tenantId: string; ownerEmail: string; plan: BillingPlanId; interval: BillingInterval; origin: string;
}): Promise<OpResult> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, reason: "not_configured" };
  if (!isSelfServePlan(args.plan)) return { ok: false, reason: "invalid_plan" };
  const priceId = resolveStripePriceId(args.plan, args.interval);
  if (!priceId) return { ok: false, reason: "price_not_configured" };

  // Reuse the tenant's Stripe customer if one exists; otherwise create + persist the mapping so a
  // later webhook can derive the tenant from the customer.
  let customerId = await getStripeCustomerId(args.tenantId);
  if (!customerId) {
    const customer = await stripe.customers.create({ email: args.ownerEmail, metadata: { tenantId: args.tenantId } });
    customerId = customer.id;
    await ensureStripeCustomer(args.tenantId, customerId);
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${args.origin}/dashboard/billing?checkout=success`,
      cancel_url: `${args.origin}/dashboard/billing?checkout=cancel`,
      subscription_data: { metadata: { tenantId: args.tenantId } },
      metadata: { tenantId: args.tenantId },
      client_reference_id: args.tenantId,
      allow_promotion_codes: true,
    },
    { idempotencyKey: `checkout:${args.tenantId}:${priceId}` },
  );
  return session.url ? { ok: true, url: session.url } : { ok: false, reason: "no_url" };
}

export async function createPortal(args: { tenantId: string; origin: string }): Promise<OpResult> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, reason: "not_configured" };
  const customerId = await getStripeCustomerId(args.tenantId);
  if (!customerId) return { ok: false, reason: "no_customer" };
  const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: portalReturnUrl(args.origin) });
  return { ok: true, url: session.url };
}

/**
 * Normalize a Stripe Subscription into our trusted subscription-state input. Fails closed (null) if
 * the price is not in the catalogue or the customer is missing — the webhook then records the event
 * without granting an arbitrary plan. Scalar timestamps are read defensively (Stripe SDK-version safe).
 */
export function normalizeSubscription(sub: Stripe.Subscription, latestInvoiceStatus?: string | null): StripeSubStateInput | null {
  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const mapped = priceId ? planForStripePriceId(priceId) : null;
  if (!mapped) return null; // unrecognised price → do not grant an arbitrary plan
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) return null;

  const raw = sub as unknown as Record<string, unknown>;
  return {
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    plan: mapped.plan,
    billingInterval: mapped.interval,
    status: sub.status,
    currentPeriodStart: toDate(raw["current_period_start"]),
    currentPeriodEnd: toDate(raw["current_period_end"]),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    canceledAt: toDate(raw["canceled_at"]),
    trialEndsAt: toDate(raw["trial_end"]),
    latestInvoiceStatus: latestInvoiceStatus ?? null,
  };
}

/** Retrieve the subscription referenced by a webhook event (from the object, or by id on invoices). */
export async function subscriptionFromEvent(stripe: Stripe, event: Stripe.Event): Promise<Stripe.Subscription | null> {
  const obj = event.data.object as unknown as Record<string, unknown>;
  if (event.type.startsWith("customer.subscription.")) {
    return obj as unknown as Stripe.Subscription;
  }
  // checkout.session.completed / invoice.* carry a subscription reference.
  const subRef = obj["subscription"];
  const subId = typeof subRef === "string" ? subRef : (subRef as { id?: string } | null)?.id;
  if (!subId) return null;
  return stripe.subscriptions.retrieve(subId);
}
