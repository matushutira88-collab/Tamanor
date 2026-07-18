import { EntitlementError, isWithinLimit, type EntitlementReason } from "@guardora/core";
import type { TenantTx } from "./tenant-db";
import { withTenant } from "./repositories";
import { getTenantEntitlements } from "./billing-repo";

/**
 * V1.50F — race-safe resource limits + canonical counting. The account/brand limit check and the
 * creation are serialized per (tenant, resource) with a PostgreSQL ADVISORY TRANSACTION LOCK inside
 * the same tenant-scoped transaction, so two concurrent creates can never exceed the plan limit.
 * The lock is DB-native (survives multiple web instances) and auto-released at transaction end.
 * Unrelated tenants use different keys → they never block one another.
 *
 * COUNTING RULES (the single source used by BOTH enforcement and dashboard display):
 *  - Connected accounts: a commercial "connection bundle" = a top-level connected account
 *    (`parentAccountId IS NULL`) that is NOT disconnected. A Facebook Page + its linked Instagram
 *    Business account count as ONE bundle (the IG is a child via `parentAccountId`, not counted).
 *    Disconnected accounts free their slot (not counted). A reconnect reuses the existing row.
 *  - Brands: every persisted brand for the tenant counts (there is no archive/soft-delete that frees
 *    a slot); a deleted brand row is gone and no longer counts.
 */

export type ResourceKind = "connections" | "brands";

/** Acquire a tenant+resource advisory lock for the current transaction (released at commit/rollback). */
export async function acquireTenantResourceLock(tx: TenantTx, tenantId: string, resource: ResourceKind): Promise<void> {
  const key = `tamanor:limit:${resource}:${tenantId}`;
  // hashtext(text) → int4; ::bigint selects the single-arg pg_advisory_xact_lock overload. The key
  // includes the tenant id, so distinct tenants take distinct locks (no cross-tenant serialization).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`;
}

/** Count commercial connection bundles (top-level, non-disconnected). Used for enforcement + display. */
export async function countCommercialConnections(tx: TenantTx, tenantId: string): Promise<number> {
  return tx.connectedAccount.count({
    where: { tenantId, parentAccountId: null, status: { not: "disconnected" } },
  });
}

/** Count the tenant's persisted brands. Used for enforcement + display. */
export async function countPlanBrands(tx: TenantTx, tenantId: string): Promise<number> {
  return tx.brand.count({ where: { tenantId } });
}

// ---------------------------------------------------------------------------------------------------
// V1.64 — PER-BRAND per-platform capacity. The sold model gives each brand at most one ACTIVE account
// of each platform (FB/IG/Google Business/YouTube). This is enforced server-side at every connect/
// import/reconnect path (advisory-locked count-under-lock, below) AND backed by a DB partial-unique
// index (migration v1_64) so a direct DB write can never bypass it either. A DISCONNECTED account
// frees the slot; a RECONNECT of the same external account (same externalId) never counts against
// itself. Enterprise (maxPerBrand = null) is unbounded per contract.
// ---------------------------------------------------------------------------------------------------

/** Advisory lock for the (brand, platform) slot — serializes concurrent connects of the same type. */
export async function acquireBrandPlatformLock(tx: TenantTx, brandId: string, platform: string): Promise<void> {
  const key = `tamanor:brandslot:${brandId}:${platform}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`;
}

/** Count ACTIVE (non-disconnected) accounts of `platform` in a brand, excluding one externalId (the
 *  incoming account, so a reconnect never counts against itself). */
export async function countActiveBrandPlatformAccounts(
  tx: TenantTx, brandId: string, platform: string, excludeExternalId?: string,
): Promise<number> {
  return tx.connectedAccount.count({
    where: {
      brandId, platform: platform as never, status: { not: "disconnected" },
      ...(excludeExternalId ? { externalId: { not: excludeExternalId } } : {}),
    },
  });
}

/**
 * Assert (inside the caller's tenant transaction) that connecting `incomingExternalId` of `platform`
 * to `brandId` stays within the per-brand cap. Call {@link acquireBrandPlatformLock} first so parallel
 * connects can't both pass. `maxPerBrand` null → unbounded (no-op). Throws
 * `brand_platform_limit_reached` when a DIFFERENT active account of the same type already occupies the
 * brand's slot.
 */
export async function assertBrandPlatformCapacity(
  tx: TenantTx, brandId: string, platform: string, incomingExternalId: string, maxPerBrand: number | null,
): Promise<void> {
  if (maxPerBrand === null) return;
  const current = await countActiveBrandPlatformAccounts(tx, brandId, platform, incomingExternalId);
  if (!isWithinLimit(current, maxPerBrand)) throw new EntitlementError("brand_platform_limit_reached");
}

/** Canonical resource usage for the dashboard (same helpers as enforcement). */
export async function getTenantResourceUsage(tenantId: string): Promise<{ connections: number; brands: number }> {
  return withTenant(tenantId, async (tx) => ({
    connections: await countCommercialConnections(tx, tenantId),
    brands: await countPlanBrands(tx, tenantId),
  }));
}

/**
 * Serialize a resource creation against its plan limit. Runs `create(tx)` ONLY if, under the
 * advisory lock, the current count is below the plan limit — otherwise throws a normalized
 * {@link EntitlementError}. `isNew` lets a reconnect (existing slot) bypass the count. Restricted
 * tenants have their limit forced to 0 by the central resolver, so they are denied here too.
 * The whole thing (lock → count → create) is ONE transaction: a failed create consumes no slot and
 * leaves no partial row.
 */
export async function createWithinResourceLimit<T>(
  tenantId: string,
  resource: ResourceKind,
  create: (tx: TenantTx) => Promise<T>,
  opts: { isNew?: boolean } = {},
): Promise<T> {
  const ent = await getTenantEntitlements(tenantId);
  const max = resource === "connections" ? ent.maxConnectedAccounts : ent.maxBrands;
  const reason: EntitlementReason = resource === "connections" ? "account_limit_reached" : "brand_limit_reached";
  return withTenant(tenantId, async (tx) => {
    await acquireTenantResourceLock(tx, tenantId, resource);
    if (opts.isNew !== false) {
      const current = resource === "connections" ? await countCommercialConnections(tx, tenantId) : await countPlanBrands(tx, tenantId);
      if (!isWithinLimit(current, max)) throw new EntitlementError(reason);
    }
    return create(tx);
  });
}
