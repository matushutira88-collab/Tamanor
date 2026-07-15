/**
 * V1.50D — CENTRAL billing model. The single source of truth for the plan catalogue and for
 * mapping Stripe subscription state → application access. NO secrets live here: Stripe price IDs
 * are resolved from environment variables by name (server-side only); the catalogue holds only
 * public info (names, display prices, limits, features). Security-critical decisions use these
 * typed enums — never free-text plan strings.
 */

export type BillingPlanId = "free_trial" | "starter" | "growth" | "agency" | "enterprise";
export type BillingInterval = "monthly" | "yearly";

/** Truthful Stripe-aligned subscription status (+ our own "no_subscription"). */
export type BillingStatus =
  | "trialing" | "active" | "past_due" | "unpaid" | "canceled"
  | "incomplete" | "incomplete_expired" | "paused" | "no_subscription";

export const BILLING_STATUSES: readonly BillingStatus[] = [
  "trialing", "active", "past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused", "no_subscription",
];

/** Application access state — derived centrally from billing state, never inferred ad hoc. */
export type AccessState = "full_access" | "grace_period" | "restricted" | "suspended";
export const ACCESS_STATES: readonly AccessState[] = ["full_access", "grace_period", "restricted", "suspended"];

export type PlanCatalogueEntry = {
  id: BillingPlanId;
  name: string;
  tagline: string;
  /** Display prices (public marketing figures; the machine price ID comes from env). */
  priceMonthly: number | null;
  priceYearly: number | null;
  currency: string;
  /** The usage-policy plan key this billing plan maps to (AI limits live in usage-policy). */
  aiPlan: string;
  limits: { connectedAccounts: number | null; teamMembers: number | null };
  features: string[];
  /** Whether this plan is purchasable via self-service Stripe Checkout. */
  selfServeCheckout: boolean;
  /** Env var NAMES (not values) for the Stripe price IDs. Null for non-self-serve plans. */
  env: { monthly: string; yearly: string } | null;
};

/**
 * The catalogue. Display prices are the product's intended EUR prices; the actual charge is
 * governed by the Stripe price whose ID is read from the named env var at checkout time.
 */
export const BILLING_PLANS: Record<BillingPlanId, PlanCatalogueEntry> = {
  free_trial: {
    id: "free_trial", name: "Free Trial", tagline: "14 days, no card required.",
    priceMonthly: 0, priceYearly: 0, currency: "EUR", aiPlan: "free_trial",
    limits: { connectedAccounts: 1, teamMembers: 2 },
    features: ["1 connected account", "Full trial access", "AI-assisted risk scoring", "Human approval workflow"],
    selfServeCheckout: false, env: null,
  },
  starter: {
    id: "starter", name: "Starter", tagline: "For a small brand, creator or local business.",
    priceMonthly: 49, priceYearly: 490, currency: "EUR", aiPlan: "starter",
    limits: { connectedAccounts: 1, teamMembers: 3 },
    features: ["1 Facebook Page", "Comments & reviews", "Action queue", "Basic reputation", "Manual review"],
    selfServeCheckout: true, env: { monthly: "STRIPE_PRICE_STARTER_MONTHLY", yearly: "STRIPE_PRICE_STARTER_YEARLY" },
  },
  growth: {
    id: "growth", name: "Growth", tagline: "For an active e-shop, brand or agency client.",
    priceMonthly: 149, priceYearly: 1490, currency: "EUR", aiPlan: "growth",
    limits: { connectedAccounts: 3, teamMembers: 8 },
    features: ["Up to 3 connected accounts", "Facebook + Instagram", "Reputation analytics", "Actor risk", "Control Center rules"],
    selfServeCheckout: true, env: { monthly: "STRIPE_PRICE_GROWTH_MONTHLY", yearly: "STRIPE_PRICE_GROWTH_YEARLY" },
  },
  agency: {
    id: "agency", name: "Agency", tagline: "For agencies managing multiple clients.",
    priceMonthly: 399, priceYearly: 3990, currency: "EUR", aiPlan: "agency",
    limits: { connectedAccounts: 10, teamMembers: 25 },
    features: ["Multiple brands/clients", "Multi-account monitoring", "Reputation + Actor Risk", "Priority support", "Dedicated contact"],
    selfServeCheckout: true, env: { monthly: "STRIPE_PRICE_AGENCY_MONTHLY", yearly: "STRIPE_PRICE_AGENCY_YEARLY" },
  },
  enterprise: {
    id: "enterprise", name: "Enterprise / Custom", tagline: "For media, public figures and larger brands.",
    priceMonthly: null, priceYearly: null, currency: "EUR", aiPlan: "enterprise",
    limits: { connectedAccounts: null, teamMembers: null },
    features: ["Custom volume & scale", "Multiple brands by agreement", "Advanced controls & roles", "Onboarding & support"],
    selfServeCheckout: false, env: null,
  },
};

export const SELF_SERVE_PLANS: readonly BillingPlanId[] = ["starter", "growth", "agency"];

export function isBillingPlanId(v: unknown): v is BillingPlanId {
  return typeof v === "string" && v in BILLING_PLANS;
}
export function isSelfServePlan(v: unknown): v is BillingPlanId {
  return isBillingPlanId(v) && BILLING_PLANS[v].selfServeCheckout;
}
export function isBillingInterval(v: unknown): v is BillingInterval {
  return v === "monthly" || v === "yearly";
}

/**
 * Server-side price-ID resolution. Reads the Stripe price ID from the plan's named env var.
 * Returns null when the plan is not self-serve, the interval is invalid, or the env is unset —
 * callers MUST fail closed (never invent a price). Rejects any client-supplied price ID by design:
 * the ID is derived here from a trusted (plan, interval) pair, never accepted from the browser.
 */
export function resolveStripePriceId(
  plan: BillingPlanId,
  interval: BillingInterval,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const entry = BILLING_PLANS[plan];
  if (!entry.selfServeCheckout || !entry.env) return null;
  const key = interval === "monthly" ? entry.env.monthly : entry.env.yearly;
  const id = env[key]?.trim();
  return id && id.length > 0 ? id : null;
}

/**
 * Reverse map: given a Stripe price ID (from a webhook), find the (plan, interval) it belongs to
 * by matching the CONFIGURED env price IDs. Fail-closed: an unrecognised price ID → null (the
 * webhook then classifies it and does not grant an arbitrary plan).
 */
export function planForStripePriceId(
  priceId: string,
  env: Record<string, string | undefined> = process.env,
): { plan: BillingPlanId; interval: BillingInterval } | null {
  for (const plan of SELF_SERVE_PLANS) {
    if (resolveStripePriceId(plan, "monthly", env) === priceId) return { plan, interval: "monthly" };
    if (resolveStripePriceId(plan, "yearly", env) === priceId) return { plan, interval: "yearly" };
  }
  return null;
}

// ---- access-state mapping (the single central function) --------------------

export type AccessInput = {
  status: BillingStatus | string | null | undefined;
  /** Our own trial window (used when there is no Stripe subscription). */
  trialEndsAt?: Date | null;
  /** Stripe current period end (paid-through date). */
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  now?: Date;
  /** Grace period (days) after a failed payment before access is restricted. */
  graceDays?: number;
};

export const DEFAULT_GRACE_DAYS = 7;

/**
 * Map billing state → application access. This is the ONLY place product access is derived; the
 * rest of the app reads {@link AccessState}. Fail-safe: an unknown status → `restricted` (lowest
 * permitted). Never grants access from a single raw Stripe field in isolation.
 */
export function resolveAccessState(input: AccessInput): AccessState {
  const now = input.now ?? new Date();
  const graceMs = (input.graceDays ?? DEFAULT_GRACE_DAYS) * 24 * 60 * 60 * 1000;
  const periodEnd = input.currentPeriodEnd ?? null;
  const trialEnds = input.trialEndsAt ?? null;

  switch (input.status) {
    case "active":
      // Paid & current (incl. "cancel at period end" — still full access until the period ends).
      return "full_access";
    case "trialing":
      return trialEnds && trialEnds.getTime() > now.getTime() ? "full_access" : "restricted";
    case "past_due":
      // Payment failed; grace window keyed off the paid-through date.
      if (periodEnd && now.getTime() <= periodEnd.getTime() + graceMs) return "grace_period";
      return "restricted";
    case "canceled":
      // Ended subscription. If somehow still within a paid period, honor it; else restricted.
      return periodEnd && periodEnd.getTime() > now.getTime() ? "full_access" : "restricted";
    case "no_subscription":
      // Never subscribed → our own trial governs access.
      return trialEnds && trialEnds.getTime() > now.getTime() ? "full_access" : "restricted";
    case "unpaid":
    case "incomplete":
    case "incomplete_expired":
    case "paused":
      return "restricted";
    default:
      // Unknown / missing status → lowest permitted access.
      return "restricted";
  }
}

/** Whether new paid AI / high-cost work may START in this access state. */
export function accessAllowsPaidWork(state: AccessState): boolean {
  return state === "full_access" || state === "grace_period";
}
/** Whether normal operational writes (new sync, moderation execution) are allowed. */
export function accessAllowsOperations(state: AccessState): boolean {
  return state === "full_access" || state === "grace_period";
}
