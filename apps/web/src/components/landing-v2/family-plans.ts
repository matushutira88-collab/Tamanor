/**
 * FAMILY-BILLING — the public Family pricing cards (the approved commercial catalogue) and their
 * mapping to internal billing plan ids. This is the single source of truth the landing pricing grid
 * uses for Family prices and the card→plan correspondence, and it is unit-tested against the backend
 * catalogue so the customer-facing names can never drift from `FAMILY_BILLING_PLANS`.
 *
 * Rules encoded here:
 *   • customer-facing names are exactly Family / Family Plus / Family Pro / Custom (never internal ids);
 *   • each paid card maps to a self-serve internal plan (family_basic / family_plus / family_premium);
 *   • Custom has NO self-service plan id (contact-only) — planId null, selfServe false;
 *   • `family_free` is NEVER a card here — it is the no-subscription fallback, never sold via checkout.
 * Yearly = 10× monthly (~2 months free).
 */
import type { FamilyPlanId } from "@guardora/core";

export type FamilyPublicCard = {
  /** Customer-facing name — MUST equal FAMILY_BILLING_PLANS[planId].name for paid cards (test-enforced). */
  name: string;
  /** Internal self-serve plan a card's checkout uses; null = Custom (contact-only). Never family_free. */
  planId: FamilyPlanId | null;
  /** Monthly EUR; null = Custom (contact-only). */
  monthly: number | null;
  /** Whether this card is purchasable via self-service Stripe Checkout. */
  selfServe: boolean;
};

export const FAMILY_PUBLIC_CARDS: readonly FamilyPublicCard[] = [
  { name: "Family", planId: "family_basic", monthly: 7.99, selfServe: true },
  { name: "Family Plus", planId: "family_plus", monthly: 14.99, selfServe: true },
  { name: "Family Pro", planId: "family_premium", monthly: 24.99, selfServe: true },
  { name: "Custom", planId: null, monthly: null, selfServe: false },
];

/** Yearly price for a monthly amount: 10 months charged (~2 months free), rounded to cents. */
export const familyYearlyPrice = (monthly: number): number => Math.round(monthly * 10 * 100) / 100;

/** Monthly prices in card order (null = Custom) — the landing grid consumes this directly. */
export const FAMILY_CARD_MONTHLY_PRICES: readonly (number | null)[] = FAMILY_PUBLIC_CARDS.map((c) => c.monthly);
