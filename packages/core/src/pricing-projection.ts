import { BILLING_PLANS, SELF_SERVE_PLANS, resolveStripePriceId, type BillingPlanId, type BillingInterval } from "./billing";
import { planEntitlements } from "./entitlements";

/**
 * V1.50F — the CANONICAL projections. Both the public pricing page and the authenticated billing
 * page derive their plan cards from HERE, which itself derives from the single commercial catalogue
 * (BILLING_PLANS) + entitlement catalogue (planEntitlements). There are no parallel plan arrays:
 * names, prices, limits and capability flags all come from one source. Translation dictionaries
 * hold only labels/descriptions — never numeric commercial rules (those live in the catalogue).
 */
export type PricingCard = {
  id: BillingPlanId;
  name: string;
  tagline: string;
  priceMonthly: number | null;
  priceYearly: number | null;
  currency: string;
  /** Canonical, truthful limits pulled from the entitlement catalogue (not marketing copy). */
  limits: {
    connectedAccounts: number | null; brands: number | null; monthlyProcessedItems: number | null;
    /** V1.64 — per-brand platform caps (accounts of each type allowed within ONE brand). */
    perBrand: { facebook: number | null; instagram: number | null; googleBusiness: number | null; youtube: number | null };
  };
  /** Capability flags (from entitlements) — the UI derives feature bullets from these + the catalogue. */
  capabilities: {
    reputationAnalytics: boolean; riskProfiles: boolean; incidents: boolean; controlCenter: boolean;
    advancedRules: boolean; auditLog: boolean; prioritySupport: boolean;
    // Explicitly surfaced as FALSE so no UI can advertise them as shipped:
    export: boolean; multiWorkspace: boolean; agencyClientManagement: boolean;
  };
  features: string[];
  selfServeCheckout: boolean;
};

function cardFor(id: BillingPlanId): PricingCard {
  const p = BILLING_PLANS[id];
  const e = planEntitlements(id);
  return {
    id, name: p.name, tagline: p.tagline, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly, currency: p.currency,
    limits: {
      connectedAccounts: e.maxConnectedAccounts, brands: e.maxBrands, monthlyProcessedItems: e.monthlyProcessedItems,
      perBrand: { facebook: e.maxFacebookPerBrand, instagram: e.maxInstagramPerBrand, googleBusiness: e.maxGoogleBusinessPerBrand, youtube: e.maxYouTubePerBrand },
    },
    capabilities: {
      reputationAnalytics: e.reputationAnalytics, riskProfiles: e.riskProfiles, incidents: e.incidents,
      controlCenter: e.controlCenter, advancedRules: e.advancedRules, auditLog: e.auditLog, prioritySupport: e.prioritySupport,
      export: e.export, multiWorkspace: e.multiWorkspace, agencyClientManagement: e.agencyClientManagement,
    },
    features: p.features,
    selfServeCheckout: p.selfServeCheckout,
  };
}

/** Public pricing cards (self-serve plans + enterprise). No secrets, no Stripe config. */
export function publicPricingProjection(): { plans: PricingCard[]; enterprise: PricingCard } {
  return {
    plans: SELF_SERVE_PLANS.map(cardFor),
    enterprise: cardFor("enterprise"),
  };
}

/**
 * Billing projection: the public cards PLUS whether checkout is actually available for each plan at
 * a given interval (a Stripe price must be configured). Unconfigured price → not purchasable
 * (checkout fails closed / is disabled truthfully). Server-side only (reads env price IDs).
 */
export function billingProjection(
  interval: BillingInterval,
  env: Record<string, string | undefined> = process.env,
): { plans: (PricingCard & { purchasable: boolean })[]; enterprise: PricingCard } {
  const base = publicPricingProjection();
  return {
    plans: base.plans.map((c) => ({ ...c, purchasable: resolveStripePriceId(c.id, interval, env) !== null })),
    enterprise: base.enterprise,
  };
}
