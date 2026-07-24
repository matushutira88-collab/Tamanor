/**
 * FAMILY-BILLING S3 — the explicit, one-time Family trial.
 *
 * Unlike the legacy Business registration (which granted an automatic 14-day trial to every workspace),
 * a Family workspace registers on `family_free` with NO trial (S3A). The introductory Family trial is
 * granted ONCE, explicitly, by this function — never automatically, and never again after it has been
 * consumed (the authoritative marker `Tenant.familyTrialConsumedAt` is set forever on first grant and
 * is preserved through expiry/cancellation).
 *
 * ── ATOMICITY & CONCURRENCY ──────────────────────────────────────────────────────────────────────
 * Eligibility check and mutation happen in ONE transaction. A per-tenant transaction-scoped advisory
 * lock serializes concurrent calls, and the mutation's WHERE additionally requires
 * `familyTrialConsumedAt = null`, so even under a race exactly ONE call can win (the loser's UPDATE
 * matches zero rows). No trial can ever be granted twice.
 *
 * ── SAFETY ───────────────────────────────────────────────────────────────────────────────────────
 * Gated by `FAMILY_BILLING_ENABLED` (OFF in production → every call fails safe). Never touches Stripe,
 * subscriptions, prices, or any Family domain/safety data. Never deletes data.
 */
import { isFamilySelfServePlan, familyBillingEnabled, type FamilyPlanId, type FamilySelfServePlanId } from "@guardora/core";
import { systemDb } from "./index";

/** Statuses of an EXISTING paid subscription that make a fresh introductory trial invalid. */
const CONFLICTING_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

/** Default introductory Family trial length (days). Configurable per call. */
export const DEFAULT_FAMILY_TRIAL_DAYS = 14;

export type StartFamilyTrialReason =
  | "family_billing_disabled" // FAMILY_BILLING_ENABLED off
  | "tenant_missing" // no such tenant
  | "not_family_workspace" // workspaceKind !== "family"
  | "invalid_plan" // target not family_plus / family_premium
  | "trial_already_consumed" // the one-time Family trial was already used
  | "subscription_active"; // a conflicting active/recoverable paid subscription exists

export type StartFamilyTrialResult =
  | { ok: true; plan: FamilySelfServePlanId; trialStartsAt: Date; trialEndsAt: Date }
  | { ok: false; reason: StartFamilyTrialReason };

/**
 * Grant the one-time introductory Family trial for `targetPlan` (family_plus | family_premium).
 *
 * Preconditions (all enforced atomically): FAMILY_BILLING_ENABLED on; tenant exists and is a Family
 * workspace; the one-time trial has never been consumed; no conflicting active/recoverable paid
 * subscription; an explicit self-serve target plan.
 *
 * On success (exactly one winner under concurrency) atomically sets:
 *   familyTrialConsumedAt = now      (permanent — never cleared, so the trial is never grantable again)
 *   trialStartsAt         = now
 *   trialEndsAt           = now + durationDays
 *   plan                  = targetPlan
 *   billingStatus         = "trialing"
 *   accessState           = "full_access"
 */
export async function startFamilyTrial(args: {
  tenantId: string;
  targetPlan: FamilyPlanId;
  durationDays?: number;
  now?: Date;
  /** Test/override hook; defaults to the central FAMILY_BILLING_ENABLED reader. */
  enabled?: boolean;
}): Promise<StartFamilyTrialResult> {
  const enabled = args.enabled ?? familyBillingEnabled();
  if (!enabled) return { ok: false, reason: "family_billing_disabled" };
  if (!isFamilySelfServePlan(args.targetPlan)) return { ok: false, reason: "invalid_plan" };

  const now = args.now ?? new Date();
  const days = args.durationDays && args.durationDays > 0 ? args.durationDays : DEFAULT_FAMILY_TRIAL_DAYS;
  const trialEndsAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const targetPlan = args.targetPlan as FamilySelfServePlanId;

  return systemDb.$transaction(async (tx) => {
    // Serialize concurrent trial starts for THIS tenant (different tenants never block).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`family_trial:${args.tenantId}`}, 0))`;

    const t = await tx.tenant.findUnique({
      where: { id: args.tenantId },
      select: { workspaceKind: true, familyTrialConsumedAt: true, subscription: { select: { status: true } } },
    });
    if (!t) return { ok: false, reason: "tenant_missing" as const };
    if (t.workspaceKind !== "family") return { ok: false, reason: "not_family_workspace" as const };
    if (t.familyTrialConsumedAt !== null) return { ok: false, reason: "trial_already_consumed" as const };
    if (t.subscription?.status && CONFLICTING_SUBSCRIPTION_STATUSES.has(t.subscription.status)) {
      return { ok: false, reason: "subscription_active" as const };
    }

    // Atomic + race-safe: only the still-un-consumed Family row is updated (the `familyTrialConsumedAt:
    // null` predicate makes a second concurrent winner impossible).
    const upd = await tx.tenant.updateMany({
      where: { id: args.tenantId, workspaceKind: "family", familyTrialConsumedAt: null },
      data: {
        familyTrialConsumedAt: now,
        trialStartsAt: now,
        trialEndsAt,
        plan: targetPlan,
        billingStatus: "trialing",
        accessState: "full_access",
      },
    });
    if (upd.count !== 1) return { ok: false, reason: "trial_already_consumed" as const };
    return { ok: true as const, plan: targetPlan, trialStartsAt: now, trialEndsAt };
  });
}
