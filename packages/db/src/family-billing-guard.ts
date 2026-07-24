/**
 * FAMILY-BILLING S2 — the single, centralized server-side Family capacity guard.
 *
 * The one enforced flow (no other layer decides billing capability):
 *
 *   Tenant.plan + Tenant.accessState  →  resolveFamilyEntitlements(...)  →  this guard  →  repo mutation
 *
 * This module is the ONLY place a Family repository consults billing. It NEVER touches Stripe,
 * subscriptions, prices or commercial pricing — it reads only the tenant's persisted `plan`,
 * `accessState` and `deletionState` (mirroring the Business `getTenantEntitlements` pattern) and feeds
 * them to the core resolver. The resolved {@link FamilyEntitlements} is the sole capability authority.
 *
 * ── CRITICAL SAFETY ─────────────────────────────────────────────────────────────────────────────
 * This guard is called ONLY from administrative-capacity mutations (profiles / guardians / members /
 * invitations). It is NEVER called from the critical safety pipeline (signal ingestion, detection,
 * classification, evidence, incident, escalation, critical alert dispatch/visibility/ack). Billing
 * must never gate child safety.
 *
 * ── CONCURRENCY ─────────────────────────────────────────────────────────────────────────────────
 * `withTenant`/`withTenantDb` runs the caller inside one Postgres transaction (READ COMMITTED), so a
 * naive count-then-create races: two concurrent creates could both read count < cap. Before counting a
 * FINITE cap we take a transaction-scoped advisory lock keyed by (tenantId, resource) — concurrent
 * enforced creates of the same resource for the same tenant serialize, and the second sees the first's
 * committed row. The lock auto-releases at commit/rollback. Unlimited plans skip the lock (no cap to
 * race). No schema change is required.
 */
import { Prisma } from "@prisma/client";
import {
  resolveFamilyEntitlements,
  familyResourceLimit,
  familyBillingEnabled,
  FamilyEntitlementError,
  type FamilyEntitlements,
  type FamilyLimitedResource,
} from "@guardora/core";
import { systemDb } from "./index";
import type { TenantTx } from "./tenant-db";

/**
 * Central feature flag. Enforcement is OFF by default so production behaviour is unchanged until later
 * sprints ship checkout + the billing UI — enabling caps before a family can upgrade would be an
 * accidental lockout. Read ONLY here; repos never read the env directly.
 *   FAMILY_BILLING_ENABLED = "1" | "true"  → enforce resolved caps
 *   unset / anything else                  → no enforcement (current behaviour preserved)
 */
export function familyBillingEnforcementEnabled(env: Record<string, string | undefined> = process.env): boolean {
  // Delegates to the single core reader — one source of truth for the FAMILY_BILLING_ENABLED gate
  // (checkout, trial start, webhook mutations, and this capacity enforcement all read the same flag).
  return familyBillingEnabled(env);
}

/**
 * Load the tenant's persisted plan + accessState + deletionState (read-only, via systemDb like the
 * Business `getTenantEntitlements`) and resolve Family entitlements. A missing tenant fails closed
 * (resolver returns the locked minimal — critical safety still on). Never reads Stripe.
 */
export async function resolveFamilyEntitlementsForTenant(tenantId: string): Promise<FamilyEntitlements> {
  const t = await systemDb.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: true, accessState: true, deletionState: true },
  });
  if (!t) return resolveFamilyEntitlements(null, null); // unknown → fail-safe locked
  const deleting = t.deletionState !== "active";
  return resolveFamilyEntitlements(t.plan, t.accessState, { deletingTenant: deleting });
}

/** Count the CURRENT applicable usage of a capacity resource for the tenant, inside the given tx. */
async function countFamilyResource(tx: TenantTx, tenantId: string, resource: FamilyLimitedResource, now: Date): Promise<number> {
  switch (resource) {
    // Active protected profiles (archived ones do not consume capacity).
    case "protected_profile":
      return tx.protectedProfile.count({ where: { tenantId, archivedAt: null } });
    // Live guardian relationships: not revoked, not archived, status not 'revoked'. Suspended/pending/
    // verified count as live capacity; revoked and archived do not.
    case "guardian":
      return tx.guardianRelationship.count({ where: { tenantId, revokedAt: null, archivedAt: null, status: { not: "revoked" } } });
    // All memberships (owner + members). The cap only blocks NEW membership creation; the primary owner
    // is never removed by enforcement.
    case "family_member":
      return tx.membership.count({ where: { tenantId } });
    // Valid pending invitations only: still 'pending' AND not yet expired. accepted / declined / revoked /
    // expired do not consume capacity.
    case "invitation":
      return tx.familyGuardianInvitation.count({ where: { tenantId, status: "pending", expiresAt: { gt: now } } });
  }
}

/**
 * Authoritatively enforce a Family capacity cap for `resource` before a create. Throws
 * {@link FamilyEntitlementError} (a safe, typed contract — no Stripe/secrets/child data) when denied.
 *
 * Order:
 *   1. Flag off → return (current behaviour preserved).
 *   2. Resolve entitlements from the tenant's persisted plan + accessState (+ deletion).
 *      - `canManageFamily` false (restricted / suspended / deleting / unknown state) → deny
 *        `family_access_restricted`. Existing records are untouched — this only blocks NEW capacity.
 *   3. Unlimited cap (null) → allow (no lock, no count).
 *   4. Finite cap → take the (tenant, resource) advisory lock, count, and reject at/over the cap
 *      (`family_plan_limit_reached`) — race-safe against concurrent creates.
 *
 * MUST be called INSIDE the caller's `withTenant` transaction (so the lock + count + create are one
 * atomic unit). Never call from the critical safety pipeline.
 */
export async function enforceFamilyCapacity(
  tx: TenantTx,
  tenantId: string,
  resource: FamilyLimitedResource,
  opts: { enabled?: boolean; now?: Date } = {},
): Promise<void> {
  const enabled = opts.enabled ?? familyBillingEnforcementEnabled();
  if (!enabled) return; // flag off → preserve current Family runtime behaviour

  const now = opts.now ?? new Date();
  const ent = await resolveFamilyEntitlementsForTenant(tenantId);

  // Access-state gate: restricted / suspended / deleting / unknown → no new capacity mutations.
  if (!ent.canManageFamily) {
    throw new FamilyEntitlementError("family_access_restricted", resource);
  }

  const max = familyResourceLimit(ent, resource);
  if (max === null) return; // unlimited → allowed (skip lock + count)

  // Race-safe: serialize concurrent enforced creates of this resource for this tenant, then count.
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${resource}))`);
  const current = await countFamilyResource(tx, tenantId, resource, now);
  if (current >= max) {
    throw new FamilyEntitlementError("family_plan_limit_reached", resource, current, max);
  }
}
