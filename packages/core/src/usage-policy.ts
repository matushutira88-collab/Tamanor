/**
 * V1.44 — CENTRAL usage plan policy. The single server-side source of truth for what a plan may
 * spend on AI. An unknown / invalid / missing plan FAILS SAFE to the Free policy — it can NEVER be
 * granted unlimited paid AI. Only explicitly-defined higher plans may raise (or remove) the caps.
 *
 * `premiumCostLimitMicros` is an integer micros budget (bigint) — never a float. A `null` limit
 * means "no cap for this KNOWN plan" (enterprise), which the reservation layer treats as unbounded.
 */
export type UsagePlan = "free" | "starter" | "pro" | "enterprise";
export const USAGE_PLANS: readonly UsagePlan[] = ["free", "starter", "pro", "enterprise"];

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

const STARTER: UsagePolicy = {
  plan: "starter",
  basicUnitsPerPeriod: 5_000, premiumCallsPerPeriod: 200, premiumCostLimitMicros: 5_000_000n,
  maxInputTokensPerCall: 4_000, maxOutputTokensPerCall: 1_024,
  allowRules: true, allowLocalModel: true, allowPaidFallback: true, allowGeneratedReplies: false,
};

const PRO: UsagePolicy = {
  plan: "pro",
  basicUnitsPerPeriod: 50_000, premiumCallsPerPeriod: 5_000, premiumCostLimitMicros: 100_000_000n,
  maxInputTokensPerCall: 8_000, maxOutputTokensPerCall: 2_048,
  allowRules: true, allowLocalModel: true, allowPaidFallback: true, allowGeneratedReplies: true,
};

const ENTERPRISE: UsagePolicy = {
  plan: "enterprise",
  basicUnitsPerPeriod: null, premiumCallsPerPeriod: null, premiumCostLimitMicros: null,
  maxInputTokensPerCall: 16_000, maxOutputTokensPerCall: 4_096,
  allowRules: true, allowLocalModel: true, allowPaidFallback: true, allowGeneratedReplies: true,
};

const POLICIES: Record<UsagePlan, UsagePolicy> = { free: FREE, starter: STARTER, pro: PRO, enterprise: ENTERPRISE };

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
