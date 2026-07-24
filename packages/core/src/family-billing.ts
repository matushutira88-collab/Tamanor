/**
 * FAMILY-BILLING S1 — Family plan catalogue.
 *
 * Family's OWN commercial identity — NOT "Business billing with renamed labels" (approved
 * architecture decision 2). This module holds PUBLIC plan identity only: id, name, tagline,
 * feature copy, and a self-serve flag.
 *
 * DELIBERATELY NO PRICES and NO Stripe price-id env here (approved decision 4 — pricing is out of
 * scope for this phase, and country-specific pricing must stay configurable later; the Stripe wiring
 * arrives in a later sprint). The authoritative numeric CAPS live in `family-entitlements.ts` (the
 * single source of truth, consumed only via `resolveFamilyEntitlements`) — this catalogue never
 * duplicates them.
 *
 * Family Free is a FULLY USABLE long-term plan (approved decision 1) — reasonable everyday limits,
 * not a demo tier. Paid plans extend capacity, convenience and advanced functionality; they NEVER
 * gate critical child-safety (see `family-entitlements.ts`).
 */

export type FamilyPlanId = "family_free" | "family_plus" | "family_premium";

export const FAMILY_PLAN_IDS: readonly FamilyPlanId[] = ["family_free", "family_plus", "family_premium"];

export type FamilyPlanCatalogueEntry = {
  id: FamilyPlanId;
  name: string;
  tagline: string;
  /** Ordered marketing feature bullets. Localization is handled in the UI layer, never here. */
  features: string[];
  /** Whether this plan is obtained via self-service checkout. Free is never purchased. */
  selfServeCheckout: boolean;
};

export const FAMILY_BILLING_PLANS: Record<FamilyPlanId, FamilyPlanCatalogueEntry> = {
  family_free: {
    id: "family_free",
    name: "Family Free",
    tagline: "Everyday family safety, free for as long as you need it.",
    features: [
      "Real-time critical safety alerts — always included, never limited",
      "Protected profiles for your children",
      "Authorized guardians and a private family space",
      "Safety signals and internal deliveries",
      "90 days of safety history",
    ],
    selfServeCheckout: false,
  },
  family_plus: {
    id: "family_plus",
    name: "Family Plus",
    tagline: "More capacity and everyday convenience for a growing family.",
    features: [
      "Everything in Family Free",
      "More protected profiles and guardians",
      "Email + push alerts for all safety signals",
      "12 months of safety history",
      "Standard AI safety analysis, reporting and data export",
    ],
    selfServeCheckout: true,
  },
  family_premium: {
    id: "family_premium",
    name: "Family Premium",
    tagline: "Unlimited capacity and advanced protection for the whole family.",
    features: [
      "Everything in Family Plus",
      "Unlimited protected profiles, guardians and members",
      "Unlimited safety history",
      "Full AI safety analysis and priority signal review",
      "Priority support",
    ],
    selfServeCheckout: true,
  },
};

/** Type guard: a known Family plan id. */
export function isFamilyPlanId(v: unknown): v is FamilyPlanId {
  return typeof v === "string" && v in FAMILY_BILLING_PLANS;
}
