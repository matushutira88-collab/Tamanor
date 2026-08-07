/**
 * GOOGLE BUSINESS CONNECTOR — SLICE 2: import a selected location into the EXISTING ConnectedAccount.
 *
 * There is deliberately NO Google-specific account model. A Business Profile location becomes an ordinary
 * `ConnectedAccount` with `platform = google_business`, exactly as a Facebook Page becomes one with
 * `platform = facebook_page`, so every existing surface (the Connected Accounts list, disconnect, sync
 * plumbing, audit, entitlements) keeps working with no special-casing.
 *
 * The whole shape mirrors `linkMetaAssets`, which is the established connect path in this codebase:
 *   advisory lock on (brand, platform) → per-brand capacity assert → upsert on the natural key → audit.
 *
 * IDENTITY. `externalId` is the provider location id (the trailing segment of `accounts/X/locations/Y`),
 * which is stable and globally unique in Google's namespace. The existing
 * `@@unique([brandId, platform, externalId])` is therefore the idempotency key: importing the same
 * location twice UPDATES one row, and two concurrent imports converge on it. Tenants stay isolated
 * because a brand belongs to exactly one tenant and every read/write runs under `withTenantDb` RLS —
 * the same provider location id in two tenants yields two unrelated rows.
 *
 * NO SECRETS. Tokens live only in the ProviderCredential vault (Slice 1). Nothing here reads, writes,
 * returns or logs token material, and the legacy `accessToken`/`refreshToken` columns are never touched.
 */
import { ActorKind, BusinessProvider, BusinessConnectionCapability, ConnectorHealth, ConnectorMode, ConnectorStatus } from "@prisma/client";
import { withTenantDb } from "./tenant-db";
import { acquireBrandPlatformLock, assertBrandPlatformCapacity } from "./resource-limits";

const PLATFORM = "google_business";

/** The normalized, non-secret facts about one location that the import is allowed to persist. */
export interface GoogleLocationImportInput {
  /** Trailing segment of the location resource name — the stable provider identity. */
  providerLocationId: string;
  /** Full resource name, kept only to derive identity; never rendered to the browser. */
  providerLocationName: string;
  displayName: string;
  storeCode?: string | null;
  addressSummary?: string | null;
  /** Parent account's provider id, for truthful display grouping. */
  providerAccountId: string;
}

export type GoogleImportOutcome =
  | { ok: true; accountId: string; reconnected: boolean }
  | { ok: false; reason: "brand_platform_limit_reached" | "brand_not_found" | "import_failed" };

/**
 * Import (or reconnect) ONE eligible location as a ConnectedAccount.
 *
 * The caller is responsible for having proven the location is authorized and sync-eligible against a
 * FRESH server-side discovery — this function trusts its input to be server-derived and never accepts a
 * browser-supplied display name or address.
 *
 * Concurrency: `acquireBrandPlatformLock` serialises parallel imports for the same (brand, platform)
 * inside one transaction, and the unique index is the ultimate backstop. Two simultaneous imports of the
 * same location therefore converge on ONE row — the second sees the first's row and updates it.
 */
export async function importGoogleBusinessLocation(input: {
  tenantId: string;
  brandId: string;
  location: GoogleLocationImportInput;
  scopes: string[];
  /** Per-brand cap for google_business from the tenant's plan; null = unbounded. */
  maxPerBrand: number | null;
}): Promise<GoogleImportOutcome> {
  const { tenantId, brandId, location } = input;
  if (!location.providerLocationId) return { ok: false, reason: "import_failed" };

  // Only normalized, non-secret display metadata is persisted. Deliberately NOT stored: the raw Google
  // response, review content, owner/PII fields, or anything not needed to identify and label the location.
  const fields = {
    externalName: location.displayName || location.providerLocationId,
    status: ConnectorStatus.active,
    // Google Business is a READ-ONLY connector in this product — no reply, no hide, no delete.
    mode: ConnectorMode.read_only,
    health: ConnectorHealth.unknown,
    scopes: input.scopes,
    grantedPermissions: input.scopes,
    // The Meta-specific columns (`pageId`, `igBusinessId`) stay null — they are not Google's identity.
    // The parent Google account id is NOT persisted either: the location id alone identifies the
    // resource, and the parent is re-derived from discovery whenever it is needed for display.
    connectionStatus: "connected",
    lastError: null,
    lastErrorAt: null,
  } as const;

  try {
    return await withTenantDb(tenantId, async (db) => {
      const brand = await db.brand.findFirst({ where: { id: brandId, tenantId }, select: { id: true } });
      if (!brand) return { ok: false as const, reason: "brand_not_found" as const };

      // Serialise concurrent connects for this (brand, platform) before counting, exactly as Meta does.
      await acquireBrandPlatformLock(db, brandId, PLATFORM);
      try {
        // A reconnect of the SAME location never counts against its own slot (excludeExternalId).
        await assertBrandPlatformCapacity(db, brandId, PLATFORM, location.providerLocationId, input.maxPerBrand);
      } catch {
        return { ok: false as const, reason: "brand_platform_limit_reached" as const };
      }

      const existing = await db.connectedAccount.findFirst({
        where: { brandId, platform: PLATFORM as never, externalId: location.providerLocationId },
        select: { id: true },
      });
      const account = await db.connectedAccount.upsert({
        where: { brandId_platform_externalId: { brandId, platform: PLATFORM as never, externalId: location.providerLocationId } },
        // CONNECT ≠ MONITOR, the same rule Meta follows: an imported location is connected but not yet
        // watched. Background review sync is Slice 3; claiming monitoring now would be untruthful.
        create: { tenantId, brandId, platform: PLATFORM as never, externalId: location.providerLocationId, monitoringEnabled: false, ...fields },
        // A reconnect refreshes the label/state on the SAME row and never resets monitoring choices.
        update: fields,
        select: { id: true },
      });

      await db.auditLog.create({
        data: {
          tenantId, brandId,
          event: existing ? "google_business.location.reconnected" : "google_business.location.connected",
          actorKind: ActorKind.system,
          targetType: "connected_account",
          targetId: account.id,
          // Bounded, non-secret: provider ids are the same identifiers already stored on the row.
          metadata: { platform: PLATFORM, reconnected: Boolean(existing), locationId: location.providerLocationId, accountId: location.providerAccountId },
        },
      });

      return { ok: true as const, accountId: account.id, reconnected: Boolean(existing) };
    });
  } catch {
    // Never surface a driver message; the caller maps this to a bounded, countable outcome.
    return { ok: false, reason: "import_failed" };
  }
}

/**
 * Assert the capabilities the Google Business connection has ACTUALLY earned, after at least one
 * location was successfully imported.
 *
 * `brand_monitoring` — and ONLY that — is truthful here. The connector reads Business Profile reviews so
 * a tenant can watch what is being said about its brand; the review read path, normalization and
 * Reputation aggregation already exist. It claims nothing about acting on them.
 *
 * Deliberately NOT asserted:
 *   · `comment_moderation` — Google Business is read-only in this product. There is no reply, hide or
 *     delete implementation, and the connector reports `canHideComment === false`.
 *   · `lead_ingestion` — Business Profile reviews are not leads; nothing ingests leads from Google.
 *
 * Additive and idempotent: existing capabilities are preserved and the set is deduped, so repeated
 * imports converge instead of accumulating.
 */
export const GOOGLE_BUSINESS_EARNED_CAPABILITIES: readonly BusinessConnectionCapability[] = [
  BusinessConnectionCapability.brand_monitoring,
];

export async function assertGoogleBusinessCapabilities(tenantId: string): Promise<BusinessConnectionCapability[]> {
  try {
    return await withTenantDb(tenantId, async (db) => {
      const conn = await db.businessPlatformConnection.findFirst({
        where: { tenantId, provider: BusinessProvider.google },
        select: { id: true, capabilities: true },
      });
      if (!conn) return [];
      const merged = Array.from(new Set([...conn.capabilities, ...GOOGLE_BUSINESS_EARNED_CAPABILITIES]));
      if (merged.length === conn.capabilities.length) return conn.capabilities;
      const updated = await db.businessPlatformConnection.update({
        where: { id: conn.id },
        data: { capabilities: merged },
        select: { capabilities: true },
      });
      return updated.capabilities;
    });
  } catch {
    // A capability that fails to record must not fail the import that earned it.
    return [];
  }
}
