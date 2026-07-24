import "server-only";
import type Stripe from "stripe";
import {
  resolveStripePriceId, planForStripePriceId, isSelfServePlan,
  resolveFamilyStripePriceId, isFamilySelfServePlan, familyBillingEnabled,
  type BillingPlanId, type BillingInterval, type FamilyPlanId,
} from "@guardora/core";
import {
  getStripeCustomerId, ensureStripeCustomer,
  reserveCheckoutAttempt, markCheckoutAttemptOpen, markCheckoutAttemptFailed,
  type StripeSubStateInput,
} from "@guardora/db";
import { getStripe, portalReturnUrl } from "./stripe";
import { invoiceSubscriptionId, normalizeSubscription } from "./stripe-mapping";

// Re-export the pure mappings (single source in ./stripe-mapping) for existing importers (webhook route).
export { normalizeSubscription, familyNormalizeSubscription } from "./stripe-mapping";

/**
 * V1.50D — high-level Stripe operations. Checkout/portal are authorized + tenant-scoped by the
 * caller (server action); price IDs are ALWAYS resolved server-side from a trusted (plan, interval)
 * pair — a client-supplied price ID is never accepted. Event normalization fails closed for an
 * unrecognised price (never grants an arbitrary plan).
 */

export type OpResult = { ok: true; url: string } | { ok: false; reason: string };

/** Where Stripe returns after checkout — the billing surface differs by workspace (Business vs Family). */
type CheckoutSurface = { successPath: string; cancelPath: string };
const BUSINESS_SURFACE: CheckoutSurface = { successPath: "/dashboard/billing", cancelPath: "/dashboard/billing" };
const FAMILY_SURFACE: CheckoutSurface = { successPath: "/family/billing", cancelPath: "/family/billing" };

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
    return driveCheckoutSession(stripe, { ...args, surface: BUSINESS_SURFACE }, priceId, reservation.attemptId, reservation.idempotencyKey);
  }

  // reservation.kind === "reserved" — create EXACTLY ONE Session with the reserved per-attempt key.
  return driveCheckoutSession(stripe, { ...args, surface: BUSINESS_SURFACE }, priceId, reservation.attemptId, reservation.idempotencyKey);
}

/**
 * FAMILY-BILLING S3 — Family Stripe Checkout. Reuses the SAME hardened infrastructure as Business
 * (durable reservation, one-live-checkout partial unique index, subscription guard, per-attempt
 * idempotency key) — only the plan catalogue, price resolution and return surface differ. Family-only:
 *   • gated by FAMILY_BILLING_ENABLED (off → fails safe, no Stripe call);
 *   • only self-serve Family plans (family_plus / family_premium), monthly / yearly;
 *   • price resolved server-side from the trusted (plan, interval) — never a client-supplied price;
 *   • tenantId / ownerEmail come from the authenticated caller, never the browser body.
 * Returns to /family/billing?checkout=success|cancel.
 */
export async function createFamilyCheckout(args: {
  tenantId: string; ownerEmail: string; plan: FamilyPlanId; interval: BillingInterval; origin: string; userId?: string | null;
}): Promise<OpResult> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, reason: "not_configured" };
  if (!familyBillingEnabled()) return { ok: false, reason: "family_billing_disabled" };
  if (!isFamilySelfServePlan(args.plan)) return { ok: false, reason: "invalid_plan" };
  const priceId = resolveFamilyStripePriceId(args.plan, args.interval);
  if (!priceId) return { ok: false, reason: "price_not_configured" };

  const reservation = await reserveCheckoutAttempt({
    tenantId: args.tenantId, userId: args.userId ?? null, plan: args.plan, interval: args.interval, priceId,
  });
  if (reservation.kind === "blocked") return { ok: false, reason: reservation.reason };
  if (reservation.kind === "existing") {
    if (!reservation.samePlan) return { ok: false, reason: "checkout_in_progress" };
    if (reservation.url) return { ok: true, url: reservation.url };
    return driveCheckoutSession(stripe, { ...args, surface: FAMILY_SURFACE }, priceId, reservation.attemptId, reservation.idempotencyKey);
  }
  return driveCheckoutSession(stripe, { ...args, surface: FAMILY_SURFACE }, priceId, reservation.attemptId, reservation.idempotencyKey);
}

/**
 * Create (or idempotently re-create) the Stripe Checkout Session for a reserved attempt and transition
 * it to OPEN. The idempotency key is the attempt's stored key, so a retry after network ambiguity
 * returns the SAME Session (no duplicate). Runs AFTER the reservation transaction has committed.
 */
async function driveCheckoutSession(
  stripe: Stripe, args: { tenantId: string; ownerEmail: string; origin: string; surface: CheckoutSurface }, priceId: string,
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
        success_url: `${args.origin}${args.surface.successPath}?checkout=success`,
        cancel_url: `${args.origin}${args.surface.cancelPath}?checkout=cancel`,
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
 * FAMILY-BILLING S3 — Family Stripe Customer Portal. Same shared Stripe portal service; Family-only
 * (gated by FAMILY_BILLING_ENABLED) and always returns to the Family billing surface (/family/billing),
 * same-origin (never the Business env override). Fails safe when billing is unconfigured or the tenant
 * has no Stripe customer yet.
 */
export async function createFamilyPortal(args: { tenantId: string; origin: string }): Promise<OpResult> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, reason: "not_configured" };
  if (!familyBillingEnabled()) return { ok: false, reason: "family_billing_disabled" };
  const customerId = await getStripeCustomerId(args.tenantId);
  if (!customerId) return { ok: false, reason: "no_customer" };
  const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${args.origin}/family/billing` });
  return { ok: true, url: session.url };
}


/** Retrieve the subscription referenced by a webhook event (from the object, or by id on invoices). */
export async function subscriptionFromEvent(stripe: Stripe, event: Stripe.Event): Promise<Stripe.Subscription | null> {
  if (event.type.startsWith("customer.subscription.")) {
    return event.data.object as unknown as Stripe.Subscription;
  }
  // Resolve the subscription reference per object type (typed, dahlia-correct):
  //  - invoice.*                  → invoice.parent.subscription_details.subscription
  //  - checkout.session.completed → session.subscription (still top-level on the Session)
  let subId: string | null = null;
  if (event.type.startsWith("invoice.")) {
    subId = invoiceSubscriptionId(event.data.object as unknown as Stripe.Invoice);
  } else if (event.type === "checkout.session.completed") {
    const ref = (event.data.object as unknown as Stripe.Checkout.Session).subscription;
    subId = ref ? (typeof ref === "string" ? ref : ref.id) : null;
  }
  if (!subId) return null; // genuinely no subscription reference → caller records it as "ignored"
  return stripe.subscriptions.retrieve(subId);
}
