import type { BillingPlanId } from "./billing";

/**
 * V1.50E — the SINGLE central entitlement catalogue. Backend services (connection/brand creation,
 * moderation execution, provider sync, AI) AND the presentation layer both read from here — there
 * is exactly one source of truth. Entitlements are code-driven and derived from the REAL product
 * inventory (not marketing copy). Access-state precedence (deletion > suspended > restricted >
 * grace > active > trial) is applied centrally in {@link resolveEntitlements}; an unknown plan
 * fails safe to the lowest access.
 *
 * Numeric limits: a number is a hard cap; `null` means unlimited (Enterprise only).
 */
export type PlanEntitlements = {
  plan: BillingPlanId;
  // Resource limits (hard caps; null = unlimited).
  // V1.64 — the commercial unit is the PROTECTED BRAND (`maxBrands`). Each brand may hold at most one
  // ACTIVE account of each platform type (the per-brand caps below), so the tenant-total account caps
  // are a derived belt-and-suspenders ceiling (= maxBrands × platforms), never the primary sold unit.
  maxBrands: number | null;
  maxConnectedAccounts: number | null;
  maxFacebookPages: number | null;
  maxInstagramAccounts: number | null;
  // V1.64 — PER-BRAND platform caps. A brand may contain at most this many ACTIVE accounts of each
  // platform. Sold model = 1 of each per brand; Enterprise (null) is configured per contract. Enforced
  // server-side at every connect/import/reconnect path AND by a DB partial-unique-index backstop.
  maxFacebookPerBrand: number | null;
  maxInstagramPerBrand: number | null;
  maxGoogleBusinessPerBrand: number | null;
  maxYouTubePerBrand: number | null;
  // Future-ready: team management (invitations) is NOT shipped yet — see NOTE below.
  maxTeamMembers: number | null;
  // Usage windows (per billing period / calendar month).
  monthlyProcessedItems: number | null;
  monthlyAiActions: number | null;
  // Capability flags — each maps to a REAL, shipped dashboard route/service.
  reputationAnalytics: boolean; // /dashboard/reputation trends + /dashboard/insights
  riskProfiles: boolean;        // /dashboard/actor-risk
  incidents: boolean;           // /dashboard/incidents
  controlCenter: boolean;       // /dashboard/control-center
  advancedRules: boolean;       // /dashboard/rules advanced policies
  auditLog: boolean;            // /dashboard/audit
  prioritySupport: boolean;     // support tier (operational commitment, not a gated code path)
  // NOT shipped today → false for every plan (never advertised as available):
  multiWorkspace: boolean;
  agencyClientManagement: boolean;
  export: boolean;              // V1.69 (B3): tenant-scoped CSV export — a PAID feature (all paid plans)
  // Operation gates (turned OFF by restricted/suspended access — see resolveEntitlements).
  providerSync: boolean;
  moderationExecution: boolean;
  paidAi: boolean;
  // Always-available controls (never blocked, even when restricted).
  billingAccess: boolean;
  deletionAccess: boolean;
  dataRetentionDays: number | null;
};

// NOTE (team): production team invitations/member management are NOT implemented (the team page's
// invite form is a disabled no-op). `maxTeamMembers` is kept future-ready but is NOT enforced and
// MUST NOT be presented on pricing as a shipped "seats" capability.

// V1.64 — per-brand model. Each paid brand holds 1 of each platform (FB/IG/Google Business/YouTube),
// so the tenant-total account ceiling = maxBrands × 4. Comment (monthlyProcessedItems) MUST equal the
// metering cap in usage-policy.ts (basicUnitsPerPeriod) — both are the same product number.
const PER_BRAND_ONE = { maxFacebookPerBrand: 1, maxInstagramPerBrand: 1, maxGoogleBusinessPerBrand: 1, maxYouTubePerBrand: 1 } as const;

const BASE: Record<BillingPlanId, PlanEntitlements> = {
  free_trial: {
    plan: "free_trial",
    // Trial stays conservative: 1 brand, ONE connected account total (upgrade unlocks the full brand's
    // four platform slots). Per-brand structural caps are still 1 each.
    maxBrands: 1, maxConnectedAccounts: 1, maxFacebookPages: 1, maxInstagramAccounts: 1, ...PER_BRAND_ONE, maxTeamMembers: 2,
    monthlyProcessedItems: 500, monthlyAiActions: 10,
    reputationAnalytics: false, riskProfiles: false, incidents: false, controlCenter: false, advancedRules: false,
    auditLog: true, prioritySupport: false, multiWorkspace: false, agencyClientManagement: false, export: false,
    providerSync: true, moderationExecution: true, paidAi: true, billingAccess: true, deletionAccess: true, dataRetentionDays: 30,
  },
  starter: {
    plan: "starter",
    maxBrands: 1, maxConnectedAccounts: 4, maxFacebookPages: 1, maxInstagramAccounts: 1, ...PER_BRAND_ONE, maxTeamMembers: 3,
    monthlyProcessedItems: 4_000, monthlyAiActions: 200,
    reputationAnalytics: false, riskProfiles: false, incidents: false, controlCenter: false, advancedRules: false,
    auditLog: true, prioritySupport: false, multiWorkspace: false, agencyClientManagement: false, export: true,
    providerSync: true, moderationExecution: true, paidAi: true, billingAccess: true, deletionAccess: true, dataRetentionDays: 90,
  },
  growth: {
    plan: "growth",
    maxBrands: 3, maxConnectedAccounts: 12, maxFacebookPages: 3, maxInstagramAccounts: 3, ...PER_BRAND_ONE, maxTeamMembers: 8,
    monthlyProcessedItems: 13_000, monthlyAiActions: 1_000,
    reputationAnalytics: true, riskProfiles: true, incidents: true, controlCenter: true, advancedRules: true,
    auditLog: true, prioritySupport: false, multiWorkspace: false, agencyClientManagement: false, export: true,
    providerSync: true, moderationExecution: true, paidAi: true, billingAccess: true, deletionAccess: true, dataRetentionDays: 180,
  },
  // NOTE (V1.64): the `agency` id is the STABLE internal key for the plan marketed as "Business".
  // Kept as-is to preserve existing subscribers (Tenant.plan="agency"), env var names
  // (STRIPE_PRICE_AGENCY_*) and the Stripe price→plan reverse map. Only the display name/price/limits
  // changed. See BILLING_PLANS.agency.name = "Business".
  agency: {
    plan: "agency",
    maxBrands: 10, maxConnectedAccounts: 40, maxFacebookPages: 10, maxInstagramAccounts: 10, ...PER_BRAND_ONE, maxTeamMembers: 25,
    monthlyProcessedItems: 25_000, monthlyAiActions: 5_000,
    reputationAnalytics: true, riskProfiles: true, incidents: true, controlCenter: true, advancedRules: true,
    auditLog: true, prioritySupport: true, multiWorkspace: false, agencyClientManagement: false, export: true,
    providerSync: true, moderationExecution: true, paidAi: true, billingAccess: true, deletionAccess: true, dataRetentionDays: 365,
  },
  enterprise: {
    plan: "enterprise",
    maxBrands: null, maxConnectedAccounts: null, maxFacebookPages: null, maxInstagramAccounts: null,
    maxFacebookPerBrand: null, maxInstagramPerBrand: null, maxGoogleBusinessPerBrand: null, maxYouTubePerBrand: null, maxTeamMembers: null,
    monthlyProcessedItems: null, monthlyAiActions: null,
    reputationAnalytics: true, riskProfiles: true, incidents: true, controlCenter: true, advancedRules: true,
    auditLog: true, prioritySupport: true, multiWorkspace: false, agencyClientManagement: false, export: true,
    providerSync: true, moderationExecution: true, paidAi: true, billingAccess: true, deletionAccess: true, dataRetentionDays: null,
  },
};

/** Lowest-access entitlements: no operations, minimal limits. The unknown-plan / suspended fallback. */
const MINIMAL: PlanEntitlements = {
  ...BASE.free_trial,
  maxBrands: 1, maxConnectedAccounts: 0, maxFacebookPages: 0, maxInstagramAccounts: 0,
  maxFacebookPerBrand: 0, maxInstagramPerBrand: 0, maxGoogleBusinessPerBrand: 0, maxYouTubePerBrand: 0,
  monthlyProcessedItems: 0, monthlyAiActions: 0,
  providerSync: false, moderationExecution: false, paidAi: false,
  reputationAnalytics: false, riskProfiles: false, incidents: false, controlCenter: false, advancedRules: false,
  billingAccess: true, deletionAccess: true,
};

function isKnownBillingPlan(plan: unknown): plan is BillingPlanId {
  return typeof plan === "string" && plan in BASE;
}

/** The raw plan entitlements (before access-state precedence). Unknown → MINIMAL. */
export function planEntitlements(plan: string | null | undefined): PlanEntitlements {
  return isKnownBillingPlan(plan) ? BASE[plan] : MINIMAL;
}

export type EntAccessState = "full_access" | "grace_period" | "restricted" | "suspended" | string;

/**
 * The ONLY sanctioned resolver: plan entitlements with ACCESS-STATE PRECEDENCE applied.
 *   deletion (deletingTenant) > suspended > restricted > grace_period > active/trial (plan) > unknown.
 * Restricted/suspended (or a deleting tenant) turn OFF every operation gate (providerSync,
 * moderationExecution, paidAi) and block new resource creation (limits → 0), while KEEPING
 * billing + deletion access. Grace and full access honor the plan. Unknown plan → MINIMAL.
 */
export function resolveEntitlements(
  plan: string | null | undefined,
  accessState: EntAccessState | null | undefined,
  opts: { deletingTenant?: boolean } = {},
): PlanEntitlements {
  const base = planEntitlements(plan);
  const locked = opts.deletingTenant || accessState === "suspended" || accessState === "restricted";
  if (!locked) return base;
  // Restricted/suspended/deleting: preserve viewing + billing + deletion, block all operations + creation.
  return {
    ...base,
    maxConnectedAccounts: 0, maxFacebookPages: 0, maxInstagramAccounts: 0, maxBrands: 0,
    maxFacebookPerBrand: 0, maxInstagramPerBrand: 0, maxGoogleBusinessPerBrand: 0, maxYouTubePerBrand: 0,
    monthlyAiActions: 0,
    providerSync: false, moderationExecution: false, paidAi: false,
    billingAccess: true, deletionAccess: true,
  };
}

// ---- typed, normalized denials -------------------------------------------

export type EntitlementReason =
  | "plan_upgrade_required" | "trial_expired" | "billing_restricted"
  | "account_limit_reached" | "brand_limit_reached" | "team_limit_reached"
  // V1.64 — a brand already holds an ACTIVE account of the platform being connected (per-brand cap = 1).
  | "brand_platform_limit_reached"
  | "usage_limit_reached" | "feature_not_in_plan" | "operation_not_allowed";

export class EntitlementError extends Error {
  constructor(public reason: EntitlementReason) { super(reason); this.name = "EntitlementError"; }
}

export type BooleanFeature = keyof Pick<PlanEntitlements,
  "reputationAnalytics" | "riskProfiles" | "incidents" | "controlCenter" | "advancedRules" |
  "auditLog" | "export" | "multiWorkspace" | "agencyClientManagement" | "prioritySupport" |
  "providerSync" | "moderationExecution" | "paidAi" | "billingAccess" | "deletionAccess">;

export function hasEntitlement(ent: PlanEntitlements, feature: BooleanFeature): boolean {
  return ent[feature] === true;
}
export function assertEntitlement(ent: PlanEntitlements, feature: BooleanFeature, reason: EntitlementReason = "feature_not_in_plan"): void {
  if (!hasEntitlement(ent, feature)) throw new EntitlementError(reason);
}

/** Whether `current` is BELOW the cap (so one more may be created). null cap = unlimited. */
export function isWithinLimit(current: number, max: number | null): boolean {
  return max === null || current < max;
}
export function assertWithinLimit(current: number, max: number | null, reason: EntitlementReason): void {
  if (!isWithinLimit(current, max)) throw new EntitlementError(reason);
}

/** Remaining allowance (Infinity for unlimited; never negative). */
export function getUsageRemaining(current: number, max: number | null): number {
  return max === null ? Infinity : Math.max(0, max - current);
}

/**
 * V1.64 — the PER-BRAND cap for a given platform (how many active accounts of this type one brand may
 * hold). Unknown platform → 0 (fail safe: a platform without a modelled cap cannot be connected). The
 * platform key is the DB `Platform` enum value (facebook_page | instagram_business | google_business |
 * youtube | …). Used by server-side connect enforcement alongside the DB partial-unique backstop.
 */
export function maxPerBrandForPlatform(ent: PlanEntitlements, platform: string): number | null {
  switch (platform) {
    case "facebook_page": return ent.maxFacebookPerBrand;
    case "instagram_business": return ent.maxInstagramPerBrand;
    case "google_business": return ent.maxGoogleBusinessPerBrand;
    case "youtube": return ent.maxYouTubePerBrand;
    default: return 0; // unmodelled platform → cannot connect (fail safe)
  }
}

// ---------------------------------------------------------------------------------------------------
// V1.68 (Release A / A2) — retroactive "keep oldest" reconciliation. Enable-time limits are already
// enforced at connect/monitor; this is the RETROACTIVE counterpart for events that lower the effective
// headroom WITHOUT a create: a plan downgrade, a trial expiry, or a reconnect that re-activates a
// previously-monitored account. The rule NEVER deletes data or accounts — it only DISABLES monitoring
// on the accounts beyond the plan's structural caps, keeping the OLDEST. Pure + deterministic:
//   1) brand cap  — keep the oldest `maxBrands` brands; disable monitoring on accounts of the rest.
//   2) account cap — among the survivors, keep the oldest `maxConnectedAccounts`; disable the rest.
// null cap = unlimited (no reconciliation for that dimension).
// ---------------------------------------------------------------------------------------------------

export type MonitoredAccountRef = { id: string; brandId: string | null; createdAt: Date };
export type BrandRef = { id: string; createdAt: Date };
export type MonitoringCaps = { maxBrands: number | null; maxConnectedAccounts: number | null };

/** Deterministic oldest-first order (createdAt asc, id asc tiebreak) so "keep oldest" is stable. */
function byOldest<T extends { createdAt: Date; id: string }>(a: T, b: T): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Which monitored account ids must have monitoring DISABLED to satisfy the plan's structural caps. */
export function selectMonitoringToDisable(
  accounts: MonitoredAccountRef[],
  brands: BrandRef[],
  caps: MonitoringCaps,
): string[] {
  const disable = new Set<string>();

  // 1) Brand cap — keep the oldest `maxBrands` brands; disable monitoring on accounts of the rest.
  let survivors = accounts;
  if (caps.maxBrands !== null) {
    const keep = new Set([...brands].sort(byOldest).slice(0, Math.max(0, caps.maxBrands)).map((b) => b.id));
    survivors = [];
    for (const a of accounts) {
      if (a.brandId !== null && !keep.has(a.brandId)) disable.add(a.id);
      else survivors.push(a);
    }
  }

  // 2) Account cap — among the survivors, keep the oldest `maxConnectedAccounts`; disable the rest.
  if (caps.maxConnectedAccounts !== null) {
    const ordered = [...survivors].sort(byOldest);
    for (const a of ordered.slice(Math.max(0, caps.maxConnectedAccounts))) disable.add(a.id);
  }

  return [...disable];
}

export type GatedOperation =
  | "provider_sync" | "moderation_execution" | "paid_ai"
  | "connect_account" | "create_brand";

/** Central operation gate used by backend services. Returns a normalized denial, never throws. */
export function canPerformOperation(ent: PlanEntitlements, op: GatedOperation): { ok: true } | { ok: false; reason: EntitlementReason } {
  switch (op) {
    case "provider_sync": return ent.providerSync ? { ok: true } : { ok: false, reason: "billing_restricted" };
    case "moderation_execution": return ent.moderationExecution ? { ok: true } : { ok: false, reason: "billing_restricted" };
    case "paid_ai": return ent.paidAi ? { ok: true } : { ok: false, reason: "billing_restricted" };
    case "connect_account": return (ent.maxConnectedAccounts ?? 1) > 0 ? { ok: true } : { ok: false, reason: "billing_restricted" };
    case "create_brand": return (ent.maxBrands ?? 1) > 0 ? { ok: true } : { ok: false, reason: "billing_restricted" };
    default: return { ok: false, reason: "operation_not_allowed" };
  }
}
