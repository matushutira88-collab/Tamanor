import "server-only";
import type Stripe from "stripe";
import {
  resolveStripePriceId, planForStripePriceId, isSelfServePlan,
  type BillingPlanId, type BillingInterval,
} from "@guardora/core";
import {
  getStripeCustomerId, ensureStripeCustomer,
  reserveCheckoutAttempt, markCheckoutAttemptOpen, markCheckoutAttemptFailed,
  type StripeSubStateInput,
} from "@guardora/db";
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
  tenantId: string; ownerEmail: string; plan: BillingPlanId; interval: BillingInterval; origin: string; userId?: string | null;
}): Promise<OpResult> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, reason: "not_configured" };
  if (!isSelfServePlan(args.plan)) return { ok: false, reason: "invalid_plan" };
  const priceId = resolveStripePriceId(args.plan, args.interval);
  if (!priceId) return { ok: false, reason: "price_not_configured" };

  // V1.57.3A — durable, tenant-scoped reservation BEFORE any Stripe call. A CREATING row + a
  // DB-enforced partial unique index (one live attempt per tenant, any plan/interval) hold the tenant
  // across the entire gap until the Stripe Session exists — closing the different-plan race that the
  // advisory-lock-only guard could not. Also runs the subscription guard; never trusts the browser.
  const reservation = await reserveCheckoutAttempt({
    tenantId: args.tenantId, userId: args.userId ?? null, plan: args.plan, interval: args.interval, priceId,
  });
  if (reservation.kind === "blocked") return { ok: false, reason: reservation.reason };
  if (reservation.kind === "existing") {
    // A checkout is already in flight for this tenant. Only the SAME plan may continue it — a
    // different plan is never allowed to open a parallel session (returns the in-progress message).
    if (!reservation.samePlan) return { ok: false, reason: "checkout_in_progress" };
    // Same plan: reuse the open Session URL if usable; otherwise RE-DRIVE Stripe with the SAME stored
    // key. Stripe deduplicates on that key, so an ambiguous earlier failure (session may already
    // exist) resolves to the SAME Session — never a duplicate.
    if (reservation.url) return { ok: true, url: reservation.url };
    return driveCheckoutSession(stripe, args, priceId, reservation.attemptId, reservation.idempotencyKey);
  }

  // reservation.kind === "reserved" — create EXACTLY ONE Session with the reserved per-attempt key.
  return driveCheckoutSession(stripe, args, priceId, reservation.attemptId, reservation.idempotencyKey);
}

/**
 * Create (or idempotently re-create) the Stripe Checkout Session for a reserved attempt and transition
 * it to OPEN. The idempotency key is the attempt's stored key, so a retry after network ambiguity
 * returns the SAME Session (no duplicate). Runs AFTER the reservation transaction has committed.
 */
async function driveCheckoutSession(
  stripe: Stripe, args: { tenantId: string; ownerEmail: string; origin: string }, priceId: string,
  attemptId: string, idempotencyKey: string,
): Promise<OpResult> {
  try {
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
        subscription_data: { metadata: { tenantId: args.tenantId, checkoutAttemptId: attemptId } },
        metadata: { tenantId: args.tenantId, checkoutAttemptId: attemptId },
        client_reference_id: args.tenantId,
        allow_promotion_codes: true,
      },
      { idempotencyKey },
    );

    await markCheckoutAttemptOpen({
      attemptId, tenantId: args.tenantId, sessionId: session.id,
      url: session.url ?? null, sessionExpiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
    });
    return session.url ? { ok: true, url: session.url } : { ok: false, reason: "no_url" };
  } catch (err) {
    // Only a DEFINITIVE Stripe error (the Session certainly was not created) fails the attempt so a
    // fresh one may start. An AMBIGUOUS network error leaves the attempt CREATING, so a retry resumes
    // with the SAME key (Stripe dedupes → no duplicate); the short CREATING TTL prevents any lockout.
    const type = (err as { type?: string } | null)?.type ?? "";
    const definitive = type === "StripeInvalidRequestError" || type === "StripeAuthenticationError";
    if (definitive) await markCheckoutAttemptFailed({ attemptId, tenantId: args.tenantId, failureCode: type });
    return { ok: false, reason: "checkout_failed" };
  }
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
