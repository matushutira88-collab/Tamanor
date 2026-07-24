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

import type { BillingInterval, AccessState, BillingStatus } from "./billing";
import { resolveAccessState } from "./billing";

export type FamilyPlanId = "family_free" | "family_basic" | "family_plus" | "family_premium";

export const FAMILY_PLAN_IDS: readonly FamilyPlanId[] = ["family_free", "family_basic", "family_plus", "family_premium"];

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
  // Public "Family" — the entry paid tier (matches the pricing page's first paid card). `name` is the
  // customer-facing label; the internal id (family_basic) is never shown to customers.
  family_basic: {
    id: "family_basic",
    name: "Family",
    tagline: "Calm protection for one child.",
    features: [
      "Real-time critical safety alerts — always included, never limited",
      "Up to 3 protected profiles",
      "Authorized guardians and consent",
      "Safety signals and internal deliveries",
      "12 months of safety history",
    ],
    selfServeCheckout: true,
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
  // Public "Family Pro" — the highest self-service tier (unlimited). Customer-facing name is
  // "Family Pro"; the internal id (family_premium) is stable and never shown to customers.
  family_premium: {
    id: "family_premium",
    name: "Family Pro",
    tagline: "For big or blended households.",
    features: [
      "Everything in Family Plus",
      "Unlimited protected profiles, guardians and members",
      "Unlimited safety history",
      "Full AI safety analysis and priority signal review",
      "Guardian roles and priority support",
    ],
    selfServeCheckout: true,
  },
};

/** Type guard: a known Family plan id. */
export function isFamilyPlanId(v: unknown): v is FamilyPlanId {
  return typeof v === "string" && v in FAMILY_BILLING_PLANS;
}

/** A Family plan obtainable via self-service Stripe Checkout (family_basic / family_plus / family_premium). */
export type FamilySelfServePlanId = "family_basic" | "family_plus" | "family_premium";

/** Type guard: a Family plan obtainable via self-service checkout. `family_free` is never purchased. */
export function isFamilySelfServePlan(v: unknown): v is FamilySelfServePlanId {
  return isFamilyPlanId(v) && FAMILY_BILLING_PLANS[v].selfServeCheckout;
}

// ─────────────────────────────────────────────────────────────────────────────
// FAMILY-BILLING S3 — Stripe price mapping (env-var NAMES only; NO values here).
//
// Mirrors the Business `resolveStripePriceId` / `planForStripePriceId` contract but for the Family
// catalogue, and stays SEPARATE from it so a Family price can never resolve to a Business plan (or
// vice versa). Only the self-serve Family plans have prices; `family_free` never does. Values are
// read from the environment at call time — none are hard-coded, and a missing/blank value fails closed
// (null), so a caller never invents a price and the build/webhook never crash on absent config.
// ─────────────────────────────────────────────────────────────────────────────

/** The Family plans sold via self-service Stripe Checkout. `family_free` is never purchased. */
export const FAMILY_SELF_SERVE_PLANS: readonly FamilySelfServePlanId[] = ["family_basic", "family_plus", "family_premium"];

/**
 * Env-var NAMES (never values) for each self-serve Family plan's Stripe Price IDs — the SIX-variable
 * Family price contract. The operator sets these in the environment; production values are added only
 * when Family billing is activated.
 */
export const FAMILY_PRICE_ENV: Record<FamilySelfServePlanId, { monthly: string; yearly: string }> = {
  family_basic: { monthly: "STRIPE_FAMILY_BASIC_MONTHLY_PRICE_ID", yearly: "STRIPE_FAMILY_BASIC_YEARLY_PRICE_ID" },
  family_plus: { monthly: "STRIPE_FAMILY_PLUS_MONTHLY_PRICE_ID", yearly: "STRIPE_FAMILY_PLUS_YEARLY_PRICE_ID" },
  family_premium: { monthly: "STRIPE_FAMILY_PREMIUM_MONTHLY_PRICE_ID", yearly: "STRIPE_FAMILY_PREMIUM_YEARLY_PRICE_ID" },
};

/** Whether a Family plan is one of the self-serve, priced plans (narrows to FamilySelfServePlanId). */
function isFamilyPricedPlan(plan: FamilyPlanId): plan is FamilySelfServePlanId {
  return plan === "family_basic" || plan === "family_plus" || plan === "family_premium";
}

/**
 * Server-side Family price-ID resolution. Returns null for `family_free` (no price), an invalid
 * interval, or an unset/blank env var — callers MUST fail closed (never invent a price). A
 * client-supplied price ID is never accepted: the ID is derived here from a trusted (plan, interval).
 */
export function resolveFamilyStripePriceId(
  plan: FamilyPlanId,
  interval: BillingInterval,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!isFamilyPricedPlan(plan)) return null; // family_free has no price
  const entry = FAMILY_PRICE_ENV[plan];
  const key = interval === "monthly" ? entry.monthly : entry.yearly;
  const id = env[key]?.trim();
  return id && id.length > 0 ? id : null;
}

/**
 * Reverse map (webhook): a Stripe Price ID → the FAMILY (plan, interval) it belongs to, matching the
 * configured env price IDs. Fail-closed: an unrecognised price → null (the webhook then never grants an
 * arbitrary Family plan). Only ever returns Family plans, so a Business price can never map here.
 */
export function familyPlanForStripePriceId(
  priceId: string,
  env: Record<string, string | undefined> = process.env,
): { plan: FamilySelfServePlanId; interval: BillingInterval } | null {
  for (const plan of FAMILY_SELF_SERVE_PLANS) {
    if (resolveFamilyStripePriceId(plan, "monthly", env) === priceId) return { plan, interval: "monthly" };
    if (resolveFamilyStripePriceId(plan, "yearly", env) === priceId) return { plan, interval: "yearly" };
  }
  return null;
}

/** Per-plan/interval availability key for the six self-serve Family prices. */
export type FamilyStripePriceKey =
  | "FAMILY_BASIC_MONTHLY" | "FAMILY_BASIC_YEARLY"
  | "FAMILY_PLUS_MONTHLY" | "FAMILY_PLUS_YEARLY"
  | "FAMILY_PREMIUM_MONTHLY" | "FAMILY_PREMIUM_YEARLY";
export type FamilyStripePriceAvailability = Record<FamilyStripePriceKey, boolean>;

const FAMILY_PRICE_KEY_MAP: { key: FamilyStripePriceKey; plan: FamilySelfServePlanId; interval: BillingInterval }[] = [
  { key: "FAMILY_BASIC_MONTHLY", plan: "family_basic", interval: "monthly" },
  { key: "FAMILY_BASIC_YEARLY", plan: "family_basic", interval: "yearly" },
  { key: "FAMILY_PLUS_MONTHLY", plan: "family_plus", interval: "monthly" },
  { key: "FAMILY_PLUS_YEARLY", plan: "family_plus", interval: "yearly" },
  { key: "FAMILY_PREMIUM_MONTHLY", plan: "family_premium", interval: "monthly" },
  { key: "FAMILY_PREMIUM_YEARLY", plan: "family_premium", interval: "yearly" },
];

/**
 * Per-price configured/availability for the six Family prices. A key is `true` only when its env price
 * is present, has the strict Stripe `price_…` shape, and is NOT shared with another Family key (a
 * duplicated Price ID fails BOTH sharers closed — a duplicate would misroute familyPlanForStripePriceId).
 * Returns booleans only — never a Price ID or secret — so it is safe to compute server-side and hand to
 * the client. `duplicatePriceIds` flags the misconfiguration for readiness surfaces.
 */
export function familyStripePriceAvailability(
  env: Record<string, string | undefined> = process.env,
): { available: FamilyStripePriceAvailability; duplicatePriceIds: boolean } {
  const idByKey = new Map<FamilyStripePriceKey, string | null>();
  const counts = new Map<string, number>();
  for (const e of FAMILY_PRICE_KEY_MAP) {
    const id = resolveFamilyStripePriceId(e.plan, e.interval, env);
    idByKey.set(e.key, id);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const available = {} as FamilyStripePriceAvailability;
  for (const e of FAMILY_PRICE_KEY_MAP) {
    const id = idByKey.get(e.key) ?? null;
    available[e.key] = !!id && /^price_[A-Za-z0-9]+$/.test(id) && (counts.get(id) ?? 0) === 1;
  }
  const duplicatePriceIds = [...counts.values()].some((c) => c > 1);
  return { available, duplicatePriceIds };
}

// ─────────────────────────────────────────────────────────────────────────────
// FAMILY-BILLING S3 — central feature-flag reader (single source of truth).
//
// `FAMILY_BILLING_ENABLED` is THE gate for every Family billing capability: checkout, trial start,
// webhook billing mutations, and S2 capacity enforcement. OFF by default so production behaviour is
// unchanged until Family billing is deliberately activated. Read only through this helper.
// ─────────────────────────────────────────────────────────────────────────────
export function familyBillingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.FAMILY_BILLING_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true";
}

// ─────────────────────────────────────────────────────────────────────────────
// FAMILY-BILLING S3 — subscription-lifecycle → effective (plan, access) mapping (PURE).
//
// Family's floor differs fundamentally from Business: Family is NEVER restricted or suspended by
// billing. `family_free` is a fully-usable long-term plan and critical child-safety is always active,
// so whenever a paid subscription/trial stops granting access the tenant falls back to
// `family_free` at `full_access` (data preserved; only future admin-capacity caps tighten). The paid
// plan applies only while the subscription/trial genuinely grants access.
// ─────────────────────────────────────────────────────────────────────────────
export type FamilyBillingResolution = { plan: FamilyPlanId; accessState: AccessState };

export function resolveFamilyBillingState(input: {
  /** The Family plan the Stripe subscription (or explicit trial) is for. */
  paidPlan: FamilyPlanId;
  status: BillingStatus | string | null | undefined;
  trialEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  now?: Date;
}): FamilyBillingResolution {
  // Reuse the central Business mapping ONLY to decide whether the paid subscription/trial still grants
  // access (full_access incl. cancel-at-period-end paid-through, or grace after a failed payment).
  const access = resolveAccessState({
    status: input.status,
    trialEndsAt: input.trialEndsAt ?? null,
    currentPeriodEnd: input.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    now: input.now,
  });
  if (access === "full_access" || access === "grace_period") {
    // Paid subscription/trial is live → the paid plan's caps apply (grace preserved truthfully).
    return { plan: input.paidPlan, accessState: access };
  }
  // Canceled / expired / unpaid / unknown → Family Free floor at full access (never restricted).
  return { plan: "family_free", accessState: "full_access" };
}
