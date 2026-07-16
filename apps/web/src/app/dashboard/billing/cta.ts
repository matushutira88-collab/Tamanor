/**
 * V1.57.1 — pure billing CTA routing decision (no side effects, no next/server imports so it is
 * unit-testable). Given the plan's shape and the viewer's state, returns which CTA to render.
 *
 * Routing contract:
 *   - current plan            → "current"            (disabled, informative)
 *   - Enterprise / Custom     → "contact_sales"      (ALWAYS — the only plan that talks to sales)
 *   - paid plan, owner, price configured  → "checkout"            (opens Stripe Checkout)
 *   - paid plan, owner, price NOT configured → "checkout_unavailable" (truthful billing-specific state,
 *                                              NEVER a silent redirect to the generic /contact page)
 *   - paid plan, not owner    → "owner_only"         (disabled)
 *
 * `canBuy` MUST be derived server-side from resolveStripePriceId(plan, interval) — a paid plan whose
 * exact (plan, interval) Stripe price env var is set. Enterprise is never self-serve, so it never
 * reaches "checkout" / "checkout_unavailable".
 */
export type BillingCta = "current" | "contact_sales" | "checkout" | "checkout_unavailable" | "owner_only";

export function resolveBillingCta(opts: {
  isEnterprise: boolean;
  isCurrent: boolean;
  isOwner: boolean;
  canBuy: boolean;
}): BillingCta {
  if (opts.isCurrent) return "current";
  if (opts.isEnterprise) return "contact_sales";
  if (!opts.isOwner) return "owner_only";
  return opts.canBuy ? "checkout" : "checkout_unavailable";
}
