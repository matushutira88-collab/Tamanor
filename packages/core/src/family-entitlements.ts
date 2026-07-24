import type { AccessState } from "./billing";
import { isFamilyPlanId, type FamilyPlanId } from "./family-billing";

/**
 * FAMILY-BILLING S1 — Family entitlement engine.
 *
 * The SINGLE source of truth for Family plan caps and capabilities. The approved architecture is a
 * strict one-way flow:
 *
 *     Billing → AccessState → FamilyEntitlements → Feature Gates → Repositories → UI
 *
 * Family repositories/services consume ONLY {@link resolveFamilyEntitlements}. They NEVER read Stripe,
 * subscriptions, or plans directly. The UI is advisory; the server remains authoritative.
 *
 * ── PERMANENT INVARIANT (approved decision 2) ─────────────────────────────────────────────────────
 * The critical child-safety pipeline is COMPLETELY independent of billing. detection / classification /
 * evidence / incident / escalation / critical notification ALWAYS run — on Free, in grace, restricted,
 * suspended, or a deleting tenant. This is enforced at the TYPE level: every field of
 * {@link CriticalSafetyGuarantee} is the literal `true`, so it is a COMPILE ERROR to construct a
 * FamilyEntitlements value with any critical-safety stage disabled, in any plan or any access state.
 * Billing may extend history / AI / reporting / convenience / capacity — NEVER this.
 */

/**
 * The critical child-safety guarantee. Every stage is the literal `true`; the type system forbids ever
 * turning one off. The complete critical pipeline runs regardless of plan or billing access-state.
 */
export type CriticalSafetyGuarantee = {
  readonly detection: true;
  readonly classification: true;
  readonly evidence: true;
  readonly incident: true;
  readonly escalation: true;
  readonly notification: true;
};

/** The one, frozen, always-on critical-safety guarantee shared by every FamilyEntitlements value. */
export const CRITICAL_SAFETY_ALWAYS: CriticalSafetyGuarantee = Object.freeze({
  detection: true,
  classification: true,
  evidence: true,
  incident: true,
  escalation: true,
  notification: true,
});

/** NON-critical alert delivery channels. Critical alerts are always delivered, governed above. */
export type FamilyAlertChannel = "inapp" | "email" | "email_push";
/** AI safety-analysis tier for NON-critical enrichment. Critical detection never depends on this. */
export type FamilyAiTier = "none" | "standard" | "full";

export type FamilyEntitlements = {
  plan: FamilyPlanId;
  // Capacity limits (hard caps; null = unlimited).
  maxProtectedProfiles: number | null;
  maxGuardians: number | null;
  maxFamilyMembers: number | null;
  maxPendingInvitations: number | null;
  // History / retention — the VIEW window for NON-critical safety history (null = unlimited).
  // Retention never prunes audit-mandated or critical-incident records (enforced by later work).
  historyRetentionDays: number | null;
  // Convenience / advanced — extendable by paid plans; NEVER the critical pipeline.
  nonCriticalAlerts: FamilyAlertChannel;
  aiAnalysis: FamilyAiTier;
  reporting: boolean;
  export: boolean;
  integrations: boolean;
  prioritySupport: boolean;
  // Console write access — frozen by restricted/suspended. Does NOT affect the critical pipeline.
  canManageFamily: boolean;
  // Always-available controls (never blocked, even when restricted/suspended).
  billingAccess: boolean;
  deletionAccess: boolean;
  // ── PERMANENT INVARIANT: critical child-safety, independent of billing (always on). ──
  criticalSafety: CriticalSafetyGuarantee;
};

/**
 * Authoritative per-plan caps. Family Free is a FULLY USABLE long-term plan (approved decision 1):
 * room for a real family's everyday use, not a demo. Paid plans extend capacity and convenience.
 */
const FAMILY_BASE: Record<FamilyPlanId, FamilyEntitlements> = {
  family_free: {
    plan: "family_free",
    maxProtectedProfiles: 2,
    maxGuardians: 2,
    maxFamilyMembers: 3,
    maxPendingInvitations: 2,
    historyRetentionDays: 90,
    nonCriticalAlerts: "email",
    aiAnalysis: "none",
    reporting: false,
    export: false,
    integrations: false,
    prioritySupport: false,
    canManageFamily: true,
    billingAccess: true,
    deletionAccess: true,
    criticalSafety: CRITICAL_SAFETY_ALWAYS,
  },
  family_plus: {
    plan: "family_plus",
    maxProtectedProfiles: 5,
    maxGuardians: 8,
    maxFamilyMembers: 10,
    maxPendingInvitations: 10,
    historyRetentionDays: 365,
    nonCriticalAlerts: "email_push",
    aiAnalysis: "standard",
    reporting: true,
    export: true,
    integrations: true,
    prioritySupport: false,
    canManageFamily: true,
    billingAccess: true,
    deletionAccess: true,
    criticalSafety: CRITICAL_SAFETY_ALWAYS,
  },
  family_premium: {
    plan: "family_premium",
    maxProtectedProfiles: null,
    maxGuardians: null,
    maxFamilyMembers: null,
    maxPendingInvitations: null,
    historyRetentionDays: null,
    nonCriticalAlerts: "email_push",
    aiAnalysis: "full",
    reporting: true,
    export: true,
    integrations: true,
    prioritySupport: true,
    canManageFamily: true,
    billingAccess: true,
    deletionAccess: true,
    criticalSafety: CRITICAL_SAFETY_ALWAYS,
  },
};

/**
 * Fail-safe minimal entitlements for an unknown/unrecognised plan: NO console management and NO new
 * resource creation, but billing + deletion access preserved and — unconditionally — the full
 * critical-safety guarantee. Never grants capacity from a doubtful state.
 */
const FAMILY_MINIMAL: FamilyEntitlements = {
  plan: "family_free",
  maxProtectedProfiles: 0,
  maxGuardians: 0,
  maxFamilyMembers: 0,
  maxPendingInvitations: 0,
  historyRetentionDays: 90,
  nonCriticalAlerts: "inapp",
  aiAnalysis: "none",
  reporting: false,
  export: false,
  integrations: false,
  prioritySupport: false,
  canManageFamily: false,
  billingAccess: true,
  deletionAccess: true,
  criticalSafety: CRITICAL_SAFETY_ALWAYS,
};

/** Raw plan entitlements BEFORE access-state precedence. Unknown plan → FAMILY_MINIMAL (fail safe). */
export function familyPlanEntitlements(plan: string | null | undefined): FamilyEntitlements {
  return isFamilyPlanId(plan) ? FAMILY_BASE[plan] : FAMILY_MINIMAL;
}

/**
 * The ONLY sanctioned resolver: Family plan entitlements with ACCESS-STATE PRECEDENCE applied. Mirrors
 * the Business `resolveEntitlements` precedence and reuses the shared {@link AccessState}:
 *
 *   deletion (deletingTenant) > suspended > restricted > grace_period > full_access (plan) > unknown.
 *
 * Only two access states honor the plan: `full_access` and `grace_period` (payment failed but still
 * in the dunning window — a family is never degraded the moment a card fails). EVERYTHING else —
 * `restricted`, `suspended`, a deleting tenant, OR an unknown/absent access state — FREEZES management:
 * no new profiles / guardians / members / invitations, and convenience/advanced features
 * (reporting / export / AI / integrations) turn OFF, while KEEPING billing + deletion access AND,
 * unconditionally, the full critical-safety guarantee.
 *
 * This is an allowlist (fail-safe) — intentionally stricter than the Business resolver, which locks
 * only on an explicit suspended/restricted and otherwise honors the plan. For a child-safety product,
 * an unrecognised or missing access state must never silently grant management capacity. The access
 * state passed here is always the tenant's centrally-derived {@link AccessState}; the extra strictness
 * is defence in depth, not a normal path.
 *
 * The critical-safety pipeline is NEVER reduced by plan or access state: the returned value always
 * carries {@link CRITICAL_SAFETY_ALWAYS} (also guaranteed structurally by the literal-`true` types).
 */
export function resolveFamilyEntitlements(
  plan: string | null | undefined,
  accessState: AccessState | string | null | undefined,
  opts: { deletingTenant?: boolean } = {},
): FamilyEntitlements {
  const base = familyPlanEntitlements(plan);

  // Locked = deleting / restricted / suspended / unknown: freeze management + convenience; keep billing,
  // deletion and — always — critical safety. Existing non-critical alert delivery is not a mutation, so
  // it is preserved (a family in dunning/suspension still hears about safety signals).
  const locked: FamilyEntitlements = {
    ...base,
    maxProtectedProfiles: 0,
    maxGuardians: 0,
    maxFamilyMembers: 0,
    maxPendingInvitations: 0,
    aiAnalysis: "none",
    reporting: false,
    export: false,
    integrations: false,
    canManageFamily: false,
    billingAccess: true,
    deletionAccess: true,
    criticalSafety: CRITICAL_SAFETY_ALWAYS,
  };

  if (opts.deletingTenant) return locked;
  // Allowlist the two plan-honoring states; everything else fails safe to locked.
  if (accessState === "full_access" || accessState === "grace_period") return base;
  return locked;
}

// ── S2 — capacity accessors consumed by server-side enforcement (pure) ──

/** The administrative-capacity resources that carry a plan cap. Critical safety is NOT here. */
export type FamilyLimitedResource = "protected_profile" | "guardian" | "family_member" | "invitation";

export const FAMILY_LIMITED_RESOURCES: readonly FamilyLimitedResource[] = [
  "protected_profile", "guardian", "family_member", "invitation",
];

/** The cap for a Family capacity resource from resolved entitlements (null = unlimited). */
export function familyResourceLimit(ent: FamilyEntitlements, resource: FamilyLimitedResource): number | null {
  switch (resource) {
    case "protected_profile": return ent.maxProtectedProfiles;
    case "guardian": return ent.maxGuardians;
    case "family_member": return ent.maxFamilyMembers;
    case "invitation": return ent.maxPendingInvitations;
  }
}
