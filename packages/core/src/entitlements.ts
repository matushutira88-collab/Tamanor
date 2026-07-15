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
  maxBrands: number | null;
  maxConnectedAccounts: number | null;
  maxFacebookPages: number | null;
  maxInstagramAccounts: number | null;
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
  export: boolean;              // /dashboard/reports export is "coming soon" — not implemented
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

const BASE: Record<BillingPlanId, PlanEntitlements> = {
  free_trial: {
    plan: "free_trial",
    maxBrands: 1, maxConnectedAccounts: 1, maxFacebookPages: 1, maxInstagramAccounts: 1, maxTeamMembers: 2,
    monthlyProcessedItems: 500, monthlyAiActions: 10,
    reputationAnalytics: false, riskProfiles: false, incidents: false, controlCenter: false, advancedRules: false,
    auditLog: true, prioritySupport: false, multiWorkspace: false, agencyClientManagement: false, export: false,
    providerSync: true, moderationExecution: true, paidAi: true, billingAccess: true, deletionAccess: true, dataRetentionDays: 30,
  },
  starter: {
    plan: "starter",
    maxBrands: 1, maxConnectedAccounts: 1, maxFacebookPages: 1, maxInstagramAccounts: 1, maxTeamMembers: 3,
    monthlyProcessedItems: 5_000, monthlyAiActions: 200,
    reputationAnalytics: false, riskProfiles: false, incidents: false, controlCenter: false, advancedRules: false,
    auditLog: true, prioritySupport: false, multiWorkspace: false, agencyClientManagement: false, export: false,
    providerSync: true, moderationExecution: true, paidAi: true, billingAccess: true, deletionAccess: true, dataRetentionDays: 90,
  },
  growth: {
    plan: "growth",
    maxBrands: 3, maxConnectedAccounts: 3, maxFacebookPages: 3, maxInstagramAccounts: 3, maxTeamMembers: 8,
    monthlyProcessedItems: 20_000, monthlyAiActions: 1_000,
    reputationAnalytics: true, riskProfiles: true, incidents: true, controlCenter: true, advancedRules: true,
    auditLog: true, prioritySupport: false, multiWorkspace: false, agencyClientManagement: false, export: false,
    providerSync: true, moderationExecution: true, paidAi: true, billingAccess: true, deletionAccess: true, dataRetentionDays: 180,
  },
  agency: {
    plan: "agency",
    maxBrands: 10, maxConnectedAccounts: 10, maxFacebookPages: 10, maxInstagramAccounts: 10, maxTeamMembers: 25,
    monthlyProcessedItems: 50_000, monthlyAiActions: 5_000,
    reputationAnalytics: true, riskProfiles: true, incidents: true, controlCenter: true, advancedRules: true,
    auditLog: true, prioritySupport: true, multiWorkspace: false, agencyClientManagement: false, export: false,
    providerSync: true, moderationExecution: true, paidAi: true, billingAccess: true, deletionAccess: true, dataRetentionDays: 365,
  },
  enterprise: {
    plan: "enterprise",
    maxBrands: null, maxConnectedAccounts: null, maxFacebookPages: null, maxInstagramAccounts: null, maxTeamMembers: null,
    monthlyProcessedItems: null, monthlyAiActions: null,
    reputationAnalytics: true, riskProfiles: true, incidents: true, controlCenter: true, advancedRules: true,
    auditLog: true, prioritySupport: true, multiWorkspace: false, agencyClientManagement: false, export: false,
    providerSync: true, moderationExecution: true, paidAi: true, billingAccess: true, deletionAccess: true, dataRetentionDays: null,
  },
};

/** Lowest-access entitlements: no operations, minimal limits. The unknown-plan / suspended fallback. */
const MINIMAL: PlanEntitlements = {
  ...BASE.free_trial,
  maxBrands: 1, maxConnectedAccounts: 0, maxFacebookPages: 0, maxInstagramAccounts: 0,
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
    monthlyAiActions: 0,
    providerSync: false, moderationExecution: false, paidAi: false,
    billingAccess: true, deletionAccess: true,
  };
}

// ---- typed, normalized denials -------------------------------------------

export type EntitlementReason =
  | "plan_upgrade_required" | "trial_expired" | "billing_restricted"
  | "account_limit_reached" | "brand_limit_reached" | "team_limit_reached"
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
