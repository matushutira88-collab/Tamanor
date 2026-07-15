import "server-only";
import Stripe from "stripe";
import { isPreviewDeployment } from "@guardora/config";

/**
 * V1.50D — Stripe client, configured from environment ONLY. Returns null when
 * STRIPE_SECRET_KEY is unset so every caller degrades truthfully (checkout/portal report
 * "billing not available"; the webhook rejects). The secret key is never logged or exposed to
 * the browser. Card data is never handled here — Stripe Checkout/Portal collect it off-site.
 *
 * V1.51 — preview kill-switch: a Vercel PREVIEW deployment must NEVER transact on the LIVE
 * Stripe account (a real charge from a throwaway preview). If a `sk_live_` key is present in a
 * preview, treat billing as unconfigured (null → truthful "not available"); `sk_test_` still
 * works for preview verification. Production and self-hosted are unaffected.
 */
let cached: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (key && isPreviewDeployment() && key.startsWith("sk_live_")) {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({ ops: "billing.live_key_blocked_in_preview" }));
    cached = null;
    return cached;
  }
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
