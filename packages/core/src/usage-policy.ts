/**
 * V1.44 — CENTRAL usage plan policy. The single server-side source of truth for what a plan may
 * spend on AI. An unknown / invalid / missing plan FAILS SAFE to the Free policy — it can NEVER be
 * granted unlimited paid AI. Only explicitly-defined higher plans may raise (or remove) the caps.
 *
 * `premiumCostLimitMicros` is an integer micros budget (bigint) — never a float. A `null` limit
 * means "no cap for this KNOWN plan" (enterprise), which the reservation layer treats as unbounded.
 */
export type UsagePlan = "free" | "free_trial" | "starter" | "growth" | "agency" | "pro" | "enterprise";
export const USAGE_PLANS: readonly UsagePlan[] = ["free", "free_trial", "starter", "growth", "agency", "pro", "enterprise"];

export type UsagePolicy = {
  plan: UsagePlan;
  basicUnitsPerPeriod: number | null;
  premiumCallsPerPeriod: number | null;
  premiumCostLimitMicros: bigint | null;
  maxInputTokensPerCall: number;
  maxOutputTokensPerCall: number;
  allowRules: boolean;
  allowLocalModel: boolean;
  allowPaidFallback: boolean;
  allowGeneratedReplies: boolean;
};

/**
 * Bump when the classifier/policy semantics change in a way that should invalidate cached AI
 * results and allow a deliberate reprocess. Part of the content-version hash + cache key.
 */
export const POLICY_VERSION = "v1.44";

const FREE: UsagePolicy = {
  plan: "free",
  basicUnitsPerPeriod: 500,
  premiumCallsPerPeriod: 10,
  premiumCostLimitMicros: 200_000n,
  maxInputTokensPerCall: 2_000,
  maxOutputTokensPerCall: 512,
  allowRules: true,
  allowLocalModel: true,
  allowPaidFallback: true, // ONLY within the call quota AND cost budget — enforced by reservation.
  allowGeneratedReplies: false,
};

// V1.50A — a new self-service workspace runs on the Free Trial. It maps to the
// SAME conservative AI quotas as Free (paid AI stays bounded + fail-closed); the
// trial is a time window (Tenant.trialStartsAt/EndsAt), not a paid entitlement.
const FREE_TRIAL: UsagePolicy = { ...FREE, plan: "free_trial" };

// V1.64 — basicUnitsPerPeriod IS the monthly processed-comment allowance shown on pricing. It MUST
// stay equal to entitlements.ts monthlyProcessedItems for the same plan (Starter 4k / Growth 13k /
// Business(agency) 25k). One unique processed comment = one unit (deduped by content version).
const STARTER: UsagePolicy = {
  plan: "starter",
  basicUnitsPerPeriod: 4_000, premiumCallsPerPeriod: 200, premiumCostLimitMicros: 5_000_000n,
  maxInputTokensPerCall: 4_000, maxOutputTokensPerCall: 1_024,
  allowRules: true, allowLocalModel: true, allowPaidFallback: true, allowGeneratedReplies: false,
};

const PRO: UsagePolicy = {
  plan: "pro",
  basicUnitsPerPeriod: 50_000, premiumCallsPerPeriod: 5_000, premiumCostLimitMicros: 100_000_000n,
  maxInputTokensPerCall: 8_000, maxOutputTokensPerCall: 2_048,
  allowRules: true, allowLocalModel: true, allowPaidFallback: true, allowGeneratedReplies: true,
};

// V1.50D — paid tiers used by the billing catalogue (Starter/Growth/Agency). Growth sits
// between Starter and the legacy Pro; Agency mirrors Pro-level headroom with generated replies.
const GROWTH: UsagePolicy = {
  plan: "growth",
  basicUnitsPerPeriod: 13_000, premiumCallsPerPeriod: 1_000, premiumCostLimitMicros: 25_000_000n,
  maxInputTokensPerCall: 6_000, maxOutputTokensPerCall: 1_536,
  allowRules: true, allowLocalModel: true, allowPaidFallback: true, allowGeneratedReplies: false,
};

// Marketed as "Business" (internal id stays `agency`).
const AGENCY: UsagePolicy = {
  plan: "agency",
  basicUnitsPerPeriod: 25_000, premiumCallsPerPeriod: 5_000, premiumCostLimitMicros: 100_000_000n,
  maxInputTokensPerCall: 8_000, maxOutputTokensPerCall: 2_048,
  allowRules: true, allowLocalModel: true, allowPaidFallback: true, allowGeneratedReplies: true,
};

const ENTERPRISE: UsagePolicy = {
  plan: "enterprise",
  basicUnitsPerPeriod: null, premiumCallsPerPeriod: null, premiumCostLimitMicros: null,
  maxInputTokensPerCall: 16_000, maxOutputTokensPerCall: 4_096,
  allowRules: true, allowLocalModel: true, allowPaidFallback: true, allowGeneratedReplies: true,
};

// V1.50D — RESTRICTED policy for a tenant whose trial expired or subscription lapsed past the
// grace period. Rules + local classification still run (no data loss / no lockout), but NO paid
// AI work may start — allowPaidFallback is false and all premium quotas are zero. This is the
// lowest-permitted access; unknown billing state fails safe to it (via resolveEffectiveUsagePolicy).
const RESTRICTED: UsagePolicy = {
  plan: "free",
  basicUnitsPerPeriod: 500, premiumCallsPerPeriod: 0, premiumCostLimitMicros: 0n,
  maxInputTokensPerCall: 2_000, maxOutputTokensPerCall: 512,
  allowRules: true, allowLocalModel: true, allowPaidFallback: false, allowGeneratedReplies: false,
};

const POLICIES: Record<UsagePlan, UsagePolicy> = { free: FREE, free_trial: FREE_TRIAL, starter: STARTER, growth: GROWTH, agency: AGENCY, pro: PRO, enterprise: ENTERPRISE };

export function isKnownPlan(plan: unknown): plan is UsagePlan {
  return typeof plan === "string" && (USAGE_PLANS as readonly string[]).includes(plan);
}

/**
 * The ONLY sanctioned way to turn a stored `Tenant.plan` string into a policy. Fail-safe: anything
 * not in {@link USAGE_PLANS} (typo, null, legacy value like "dev", client-supplied override) →
 * FREE. There is no code path by which an unrecognised plan obtains unbounded paid AI.
 */
export function resolveUsagePolicy(plan: string | null | undefined): UsagePolicy {
  return isKnownPlan(plan) ? POLICIES[plan] : FREE;
}

/**
 * V1.50D — the ONLY sanctioned way to resolve a policy for actual AI work: combines the plan with
 * the tenant's trusted billing access state. A `restricted` / `suspended` tenant (trial expired,
 * subscription lapsed past grace) gets the {@link RESTRICTED} policy — NO paid AI, regardless of
 * plan — so Stripe state can never bypass AI-cost protection. `full_access` / `grace_period` (and an
 * unknown/undefined state, which fails safe to plan-only) use the plan policy. The global paid-AI
 * fuse remains authoritative on top of this.
 */
export function resolveEffectiveUsagePolicy(plan: string | null | undefined, accessState: string | null | undefined): UsagePolicy {
  if (accessState === "restricted" || accessState === "suspended") return RESTRICTED;
  return resolveUsagePolicy(plan);
}
