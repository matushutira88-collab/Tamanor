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
    features: ["1 protected brand", "Connect one channel to try it", "AI-assisted risk scoring", "Human approval workflow"],
    selfServeCheckout: false, env: null,
  },
  // V1.64 — packages are sold by PROTECTED BRAND. One brand = 1 Facebook Page + 1 Instagram account +
  // 1 Google Business Profile + 1 YouTube channel (YouTube ships later; not presented as live).
  starter: {
    id: "starter", name: "Starter", tagline: "For a small brand, creator or local business.",
    priceMonthly: 59, priceYearly: 590, currency: "EUR", aiPlan: "starter",
    limits: { connectedAccounts: 4, teamMembers: 3 },
    features: ["1 protected brand", "4,000 comments / month", "1 Facebook Page + 1 Instagram", "1 Google Business Profile", "Comments, reviews & action queue"],
    selfServeCheckout: true, env: { monthly: "STRIPE_PRICE_STARTER_MONTHLY", yearly: "STRIPE_PRICE_STARTER_YEARLY" },
  },
  growth: {
    id: "growth", name: "Growth", tagline: "For an active e-shop, brand or agency client.",
    priceMonthly: 189, priceYearly: 1890, currency: "EUR", aiPlan: "growth",
    limits: { connectedAccounts: 12, teamMembers: 8 },
    features: ["3 protected brands", "13,000 comments / month", "Facebook, Instagram & Google Business per brand", "Reputation analytics & actor risk", "Control Center rules"],
    selfServeCheckout: true, env: { monthly: "STRIPE_PRICE_GROWTH_MONTHLY", yearly: "STRIPE_PRICE_GROWTH_YEARLY" },
  },
  // The internal id stays `agency` (stable key for existing subscribers, env vars and Stripe mapping);
  // the plan is MARKETED as "Business". See entitlements.ts BASE.agency for the matching note.
  agency: {
    id: "agency", name: "Business", tagline: "For brands and agencies protecting many channels.",
    priceMonthly: 499, priceYearly: 4990, currency: "EUR", aiPlan: "agency",
    limits: { connectedAccounts: 40, teamMembers: 25 },
    features: ["10 protected brands", "25,000 comments / month", "Facebook, Instagram & Google Business per brand", "Reputation + actor risk", "Priority support"],
    selfServeCheckout: true, env: { monthly: "STRIPE_PRICE_AGENCY_MONTHLY", yearly: "STRIPE_PRICE_AGENCY_YEARLY" },
  },
  enterprise: {
    id: "enterprise", name: "Enterprise / Custom", tagline: "For media, public figures and larger brands.",
    priceMonthly: null, priceYearly: null, currency: "EUR", aiPlan: "enterprise",
    limits: { connectedAccounts: null, teamMembers: null },
    features: ["Custom brand & comment volume", "Multiple brands by agreement", "Advanced controls & roles", "Onboarding & dedicated support"],
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

// ---- Stripe billing configuration readiness (V1.57.2) ----------------------

/** Safe status of one Stripe config component. Never carries a secret value. */
export type StripeConfigStatus = "healthy" | "misconfigured" | "billing_unavailable";

export type StripeBillingReadiness = {
  apiConfig: StripeConfigStatus;      // STRIPE_SECRET_KEY present (sk_ shape; sk_live_ when requireLive)
  prices: StripeConfigStatus;         // all 6 self-serve prices present, price_ shape, no duplicates
  webhookConfig: StripeConfigStatus;  // STRIPE_WEBHOOK_SECRET present (whsec_ shape)
  portalConfig: StripeConfigStatus;   // STRIPE_BILLING_PORTAL_RETURN_URL is https (optional)
  duplicatePriceIds: boolean;         // Phase 2: two plans sharing a Stripe Price ID is a config error
  configured: boolean;                // billing is usable (api + prices + webhook all healthy)
};

/**
 * Pure, secret-free readiness of the Stripe billing configuration. Returns only statuses/booleans —
 * never a key or a raw value — so it is safe to surface in /api/ready. Fails closed: any missing or
 * malformed value degrades billing (not the whole app), and duplicate Price IDs across plans (which
 * would misroute planForStripePriceId) are reported as misconfigured.
 */
export function stripeBillingReadiness(
  env: Record<string, string | undefined> = process.env,
  opts: { requireLive?: boolean } = {},
): StripeBillingReadiness {
  const secret = env.STRIPE_SECRET_KEY?.trim();
  const secretOk = !!secret && secret.startsWith("sk_") && (!opts.requireLive || secret.startsWith("sk_live_"));
  const apiConfig: StripeConfigStatus = secretOk ? "healthy" : secret ? "misconfigured" : "billing_unavailable";

  const ids: string[] = [];
  let allPresent = true;
  let allFormatOk = true;
  for (const plan of SELF_SERVE_PLANS) {
    for (const interval of ["monthly", "yearly"] as const) {
      const id = resolveStripePriceId(plan, interval, env);
      if (!id) { allPresent = false; continue; }
      if (!id.startsWith("price_")) allFormatOk = false;
      ids.push(id);
    }
  }
  const duplicatePriceIds = new Set(ids).size !== ids.length;
  const prices: StripeConfigStatus =
    ids.length === 0 ? "billing_unavailable" : (!allPresent || !allFormatOk || duplicatePriceIds) ? "misconfigured" : "healthy";

  const wh = env.STRIPE_WEBHOOK_SECRET?.trim();
  const webhookConfig: StripeConfigStatus = wh ? (wh.startsWith("whsec_") ? "healthy" : "misconfigured") : "billing_unavailable";

  const ret = env.STRIPE_BILLING_PORTAL_RETURN_URL?.trim();
  const portalConfig: StripeConfigStatus = !ret ? "billing_unavailable" : /^https:\/\/[^\s]+$/.test(ret) ? "healthy" : "misconfigured";

  const configured = apiConfig === "healthy" && prices === "healthy" && webhookConfig === "healthy";
  return { apiConfig, prices, webhookConfig, portalConfig, duplicatePriceIds, configured };
}

// ---- V1.57.4A: PER-PLAN checkout availability ------------------------------
// The Billing UI must enable each configured plan/interval INDEPENDENTLY, so the operator can add
// Stripe Prices gradually. This is the per-key counterpart of the aggregate `stripeBillingReadiness`
// — it returns ONLY booleans (never a Price ID or secret), safe to compute in a server component and
// pass to the client. A key is available only when the minimum-safe checkout chain is ready AND that
// specific Price is validly configured.

export type StripePriceKey =
  | "STARTER_MONTHLY" | "STARTER_YEARLY"
  | "GROWTH_MONTHLY" | "GROWTH_YEARLY"
  | "AGENCY_MONTHLY" | "AGENCY_YEARLY";
export type StripePriceAvailability = Record<StripePriceKey, boolean>;

const PRICE_KEY_MAP: { key: StripePriceKey; plan: BillingPlanId; interval: BillingInterval }[] = [
  { key: "STARTER_MONTHLY", plan: "starter", interval: "monthly" },
  { key: "STARTER_YEARLY", plan: "starter", interval: "yearly" },
  { key: "GROWTH_MONTHLY", plan: "growth", interval: "monthly" },
  { key: "GROWTH_YEARLY", plan: "growth", interval: "yearly" },
  { key: "AGENCY_MONTHLY", plan: "agency", interval: "monthly" },
  { key: "AGENCY_YEARLY", plan: "agency", interval: "yearly" },
];

/** Map a self-serve (plan, interval) to its availability key. Null for Enterprise / non-self-serve. */
export function stripePriceKeyFor(plan: BillingPlanId, interval: BillingInterval): StripePriceKey | null {
  if (!isSelfServePlan(plan)) return null;
  return PRICE_KEY_MAP.find((e) => e.plan === plan && e.interval === interval)?.key ?? null;
}

/**
 * Per-plan/interval checkout availability. A key is `true` ONLY when:
 *   • the minimum-safe checkout chain is ready — Stripe secret valid (live when requireLive), webhook
 *     secret configured, portal return URL configured (Phase 7); AND
 *   • that specific Price is validly configured — env present, begins with `price_`, and NOT shared
 *     with another plan/interval (a duplicate fails BOTH sharers closed).
 * A single configured Price + the chain activates that one plan — it never requires the other five.
 * Returns booleans only; no Price ID or secret is exposed.
 */
export function stripePriceAvailability(
  env: Record<string, string | undefined> = process.env,
  opts: { requireLive?: boolean } = {},
): StripePriceAvailability {
  const secret = env.STRIPE_SECRET_KEY?.trim();
  const apiOk = !!secret && secret.startsWith("sk_") && (!opts.requireLive || secret.startsWith("sk_live_"));
  const wh = env.STRIPE_WEBHOOK_SECRET?.trim();
  const webhookOk = !!wh && wh.startsWith("whsec_");
  const ret = env.STRIPE_BILLING_PORTAL_RETURN_URL?.trim();
  const portalOk = !!ret && /^https:\/\/[^\s]+$/.test(ret);
  const chainReady = apiOk && webhookOk && portalOk;

  // Resolve each key's id, then count occurrences so a duplicated id fails ALL sharers closed.
  const idByKey = new Map<StripePriceKey, string | null>();
  const counts = new Map<string, number>();
  for (const e of PRICE_KEY_MAP) {
    const id = resolveStripePriceId(e.plan, e.interval, env);
    idByKey.set(e.key, id);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const out = {} as StripePriceAvailability;
  for (const e of PRICE_KEY_MAP) {
    const id = idByKey.get(e.key) ?? null;
    // Strict Stripe Price ID shape (rejects `prod_…`, stray text like "price_x was created", spaces).
    const priceValid = !!id && /^price_[A-Za-z0-9]+$/.test(id) && (counts.get(id) ?? 0) === 1;
    out[e.key] = chainReady && priceValid;
  }
  return out;
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

// ---- V1.58.4: Stripe webhook event ordering (out-of-order protection) --------
/**
 * Ordering position of a Stripe billing event: its `created` time plus whether it is TERMINAL
 * (the subscription ended — customer.subscription.deleted or a resulting `canceled` status).
 */
export type StripeEventOrder = { createdAt: Date; terminal: boolean };

/**
 * Deterministically decide whether an INCOMING Stripe billing event should be applied over the
 * LAST-APPLIED one for the same subscription aggregate. Rules:
 *  - no prior event → apply.
 *  - strictly newer `created` → apply (a genuinely newer event, incl. a legitimate reactivation).
 *  - strictly older `created` → stale (never let an older event overwrite newer billing state).
 *  - EQUAL `created` (Stripe timestamps are second-resolution) → a TERMINAL event wins and is never
 *    overwritten by a non-terminal one; equal terminality keeps the first-applied (stable/idempotent).
 * This is the single source of the ordering rule; the DB guard expresses the same predicate atomically.
 */
export function shouldApplyStripeEvent(stored: StripeEventOrder | null, incoming: StripeEventOrder): boolean {
  if (!stored) return true;
  const a = incoming.createdAt.getTime();
  const b = stored.createdAt.getTime();
  if (a > b) return true;
  if (a < b) return false;
  return incoming.terminal && !stored.terminal;
}

/**
 * V1.57.3 — Duplicate-subscription guard (PURE, no DB/network). Decides, from a tenant's
 * synchronized subscription row, whether it is safe to START a new Stripe Checkout. Fail-safe: an
 * unknown/unexpected status BLOCKS (a tenant is never allowed to open a second subscription on a
 * doubtful state). The decision is Stripe-status-driven only — never trusts client input.
 *
 * blockReason maps 1:1 to a localized billing UI state:
 *   subscription_active   → "Subscription already active" → Manage (Customer Portal)
 *   payment_update_needed → past_due/unpaid → "Update payment method" → Customer Portal
 *   complete_payment      → recoverable incomplete → "Complete your payment" → Customer Portal
 */
export type CheckoutGuardReason = "subscription_active" | "payment_update_needed" | "complete_payment";
export type CheckoutGuardDecision =
  | { allowed: true }
  | { allowed: false; reason: CheckoutGuardReason };

/** Minimal, DB-agnostic view of the tenant's current subscription (null = none exists). */
export type CheckoutGuardSubscription = { status: string | null; currentPeriodEnd: Date | null } | null;

export function evaluateCheckoutGuard(sub: CheckoutGuardSubscription, now: Date = new Date()): CheckoutGuardDecision {
  if (!sub || !sub.status) return { allowed: true }; // no subscription → free to purchase
  const periodStillActive = sub.currentPeriodEnd ? sub.currentPeriodEnd.getTime() > now.getTime() : false;
  switch (sub.status) {
    // A Stripe customer row exists (created at checkout start) but no real subscription has ever
    // formed → purchasing is safe. NB: this is our own sentinel, never a Stripe status.
    case "no_subscription":
      return { allowed: true };
    // Live, billable, or paused-but-recoverable → a second subscription would double-bill. Block.
    // (cancel-at-period-end keeps Stripe status "active"/"trialing" until the period ends → covered here.)
    case "active":
    case "trialing":
    case "paused":
      return { allowed: false, reason: "subscription_active" };
    // Payment problem on an existing subscription → fix it in the Portal, never open a new one.
    case "past_due":
    case "unpaid":
      return { allowed: false, reason: "payment_update_needed" };
    // First payment not yet settled but the SAME subscription can still be completed. Block a duplicate.
    case "incomplete":
      return { allowed: false, reason: "complete_payment" };
    // Dead first attempt → no recoverable subscription remains → a fresh purchase is safe.
    case "incomplete_expired":
      return { allowed: true };
    // Canceled: block only while paid access still remains (cancel-at-period-end); once the period has
    // ended (or is absent) the tenant has no usable subscription → allow a new purchase.
    case "canceled":
      return periodStillActive ? { allowed: false, reason: "subscription_active" } : { allowed: true };
    // Unknown/future Stripe status → fail safe: block and route to Manage rather than risk a duplicate.
    default:
      return { allowed: false, reason: "subscription_active" };
  }
}
