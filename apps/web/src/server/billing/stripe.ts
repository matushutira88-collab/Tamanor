import "server-only";
import Stripe from "stripe";

/**
 * V1.50D — Stripe client, configured from environment ONLY. Returns null when
 * STRIPE_SECRET_KEY is unset so every caller degrades truthfully (checkout/portal report
 * "billing not available"; the webhook rejects). The secret key is never logged or exposed to
 * the browser. Card data is never handled here — Stripe Checkout/Portal collect it off-site.
 */
let cached: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  cached = key ? new Stripe(key) : null;
  return cached;
}

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY?.trim();
}

export function webhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
}

/** Allowlisted return URL for the billing portal (env override, else same-origin billing page). */
export function portalReturnUrl(origin: string): string {
  const env = process.env.STRIPE_BILLING_PORTAL_RETURN_URL?.trim();
  // Only honor an env override that is an absolute URL; otherwise stay same-origin (no open redirect).
  if (env && /^https?:\/\//.test(env)) return env;
  return `${origin}/dashboard/billing`;
}

/** For test injection: override the cached client (pass null to reset to env resolution). */
export function __setStripeForTest(client: Stripe | null | undefined): void {
  cached = client;
}
