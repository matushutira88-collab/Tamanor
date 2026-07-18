/**
 * V1.38 — Unified Meta connector (Facebook Page + linked Instagram Professional).
 *
 * Facebook Pages and their linked Instagram Business accounts are normalized into ONE
 * connector model: two ConnectedAccount rows (platform facebook_page / instagram_business)
 * sharing a canonical `pageId`, joined by an explicit `parentAccountId` FK (IG → Page).
 *
 * All persistence is tenant-scoped (RLS via withTenantDb) and idempotent (upsert on the
 * `(brandId, platform, externalId)` unique) — discovery, reconnect and re-sync NEVER
 * duplicate a Meta asset. Provider I/O is injected (real Graph in prod, mock in tests)
 * and runs strictly BETWEEN short tenant transactions: read → provider HTTP → write.
 * A provider failure is classified as transient and never corrupts local state.
 */
import {
  withTenantDb, decryptToken, encryptToken, metaConnectedAccountFields, ActorKind,
  getTenantEntitlements, acquireBrandPlatformLock, assertBrandPlatformCapacity,
} from "@guardora/db";
import { maxPerBrandForPlatform } from "@guardora/core";
import {
  GraphMetaConnectorTransport,
  type MetaConnectorTransport,
  type MetaDiscoveredPage,
} from "@guardora/connectors";

// ---------------------------------------------------------------------------
// Normalized connector state
// ---------------------------------------------------------------------------

export type MetaAccountStatus =
  | "healthy"
  | "token_expired"
  | "permission_revoked"
  | "page_deleted"
  | "instagram_disconnected"
  | "ownership_changed"
  | "missing_business_asset"
  | "transient_error"
  | "not_applicable";

export interface MetaSyncStateResult {
  accountId: string;
  platform: string;
  status: MetaAccountStatus;
  connectionStatus: string;
  tokenHealth: string;
  /** True when the sync changed the stored connection/token state. */
  changed: boolean;
  /** True for transient provider failures where local state was deliberately preserved. */
  transient?: boolean;
}

const META_PLATFORMS = new Set(["facebook_page", "instagram_business"]);

// ---------------------------------------------------------------------------
// Discovery + canonical persistence (idempotent, reconnect-safe)
// ---------------------------------------------------------------------------

export interface MetaLinkInput {
  tenantId: string;
  brandId: string;
  page: MetaDiscoveredPage;
  connectIg: boolean;
  scopes: string[];
  grantedPermissions: string[];
  /** Already-encrypted page token (via token-crypto). */
  encryptedToken: string;
  tokenType: string | null;
  tokenExpiresAt: Date | null;
  /** DEPRECATED (V1.59): the legacy bundle connection-limit. IGNORED — the monitored-account limit is
   *  now enforced per-account at monitoring activation (enableAccountMonitoringWithinLimit). Kept only
   *  for source compatibility with existing callers; passing it has no effect. */
  enforceLimit?: { max: number | null };
}

export interface MetaLinkResult {
  pageAccountId: string;
  igAccountId: string | null;
  pageReconnected: boolean;
  igReconnected: boolean;
}

/**
 * Persist a discovered Page (+ optionally its linked IG account) as canonical
 * ConnectedAccounts. Idempotent upsert → a reconnect refreshes tokens/scopes on the
 * SAME rows (never a duplicate) and (re)establishes the IG → Page `parentAccountId` link.
 */
export async function linkMetaAssets(input: MetaLinkInput): Promise<MetaLinkResult> {
  const { tenantId, brandId, page } = input;
  const fields = metaConnectedAccountFields({
    externalName: page.name,
    pageId: page.pageId,
    igBusinessId: page.igBusinessId ?? null,
    scopes: input.scopes,
    grantedPermissions: input.grantedPermissions,
    encryptedToken: input.encryptedToken,
    tokenType: input.tokenType,
    tokenExpiresAt: input.tokenExpiresAt,
  });

  // V1.64 — resolve the per-brand platform caps ONCE (outside the tx) so the connect can enforce that
  // this brand holds at most one ACTIVE account of each type. Reconnecting the SAME external asset
  // (same externalId) is always allowed (it never counts against its own slot).
  const ent = await getTenantEntitlements(tenantId);
  const fbPerBrand = maxPerBrandForPlatform(ent, "facebook_page");
  const igPerBrand = maxPerBrandForPlatform(ent, "instagram_business");

  return withTenantDb(tenantId, async (db) => {
    // V1.59 — CONNECT ≠ MONITOR. Connecting an account no longer enforces (or bundles) the tenant-total
    // monitored limit; that is enforced ATOMICALLY when monitoring is activated
    // (enableAccountMonitoringWithinLimit). Reconnect (upsert UPDATE) NEVER changes monitoring state.
    // V1.64 — but the STRUCTURAL per-brand rule (max 1 active FB + 1 active IG per brand) IS enforced
    // here at connect: advisory-locked per (brand, platform) so two parallel connects can't both pass,
    // with the DB partial-unique index as the ultimate backstop. `input.enforceLimit` stays ignored.
    await acquireBrandPlatformLock(db, brandId, "facebook_page");
    await assertBrandPlatformCapacity(db, brandId, "facebook_page", page.pageId, fbPerBrand);
    const existingPage = await db.connectedAccount.findFirst({
      where: { brandId, platform: "facebook_page" as never, externalId: page.pageId },
      select: { id: true },
    });
    const pageAcc = await db.connectedAccount.upsert({
      where: { brandId_platform_externalId: { brandId, platform: "facebook_page" as never, externalId: page.pageId } },
      create: { tenantId, brandId, platform: "facebook_page" as never, externalId: page.pageId, monitoringEnabled: false, ...fields },
      update: fields,
    });
    await db.auditLog.create({
      data: {
        tenantId, brandId, event: existingPage ? "meta.page.reconnected" : "meta.page.connected",
        actorKind: ActorKind.system, targetType: "connected_account", targetId: pageAcc.id,
        metadata: { platform: "facebook_page", reconnected: Boolean(existingPage), hasInstagram: Boolean(page.igBusinessId), scopes: input.scopes.length },
      },
    });

    let igAccountId: string | null = null;
    let igReconnected = false;
    if (input.connectIg && page.igBusinessId) {
      await acquireBrandPlatformLock(db, brandId, "instagram_business");
      await assertBrandPlatformCapacity(db, brandId, "instagram_business", page.igBusinessId, igPerBrand);
      const existingIg = await db.connectedAccount.findFirst({
        where: { brandId, platform: "instagram_business" as never, externalId: page.igBusinessId },
        select: { id: true },
      });
      igReconnected = Boolean(existingIg);
      const igAcc = await db.connectedAccount.upsert({
        where: { brandId_platform_externalId: { brandId, platform: "instagram_business" as never, externalId: page.igBusinessId } },
        create: {
          tenantId, brandId, platform: "instagram_business" as never, externalId: page.igBusinessId, parentAccountId: pageAcc.id,
          monitoringEnabled: false, ...fields, externalName: page.igUsername ? `@${page.igUsername}` : page.name,
        },
        // Re-establish the canonical Page link on every reconnect.
        update: { ...fields, externalName: page.igUsername ? `@${page.igUsername}` : page.name, parentAccountId: pageAcc.id },
      });
      igAccountId = igAcc.id;
      await db.auditLog.create({
        data: {
          tenantId, brandId, event: existingIg ? "meta.instagram.reconnected" : "meta.instagram.connected",
          actorKind: ActorKind.system, targetType: "connected_account", targetId: igAcc.id,
          metadata: { platform: "instagram_business", reconnected: igReconnected, linkedPage: page.pageId },
        },
      });
    }

    return { pageAccountId: pageAcc.id, igAccountId, pageReconnected: Boolean(existingPage), igReconnected };
  });
}

// ---------------------------------------------------------------------------
// Health / capability sync (read → provider HTTP → write) with detection
// ---------------------------------------------------------------------------

const REQUIRED_PAGE_PERMISSION = "pages_manage_engagement";

/**
 * Verify + normalize one Meta account's live state. read → provider HTTP (OUTSIDE any
 * tx) → write. Detects: expired/invalid token, revoked moderation permission, deleted
 * Page, disconnected Instagram, page ownership change (rename/transfer), and missing
 * business asset. A transient provider failure preserves local state (never a false
 * downgrade). Tokens are never logged. Fully audited.
 */
export async function syncMetaAccountState(
  tenantId: string,
  accountId: string,
  opts?: { transport?: MetaConnectorTransport; now?: Date },
): Promise<MetaSyncStateResult> {
  const now = opts?.now ?? new Date();

  // Phase 1 — tenant read.
  const acct = await withTenantDb(tenantId, (db) => db.connectedAccount.findFirst({ where: { id: accountId } }));
  if (!acct || !META_PLATFORMS.has(acct.platform)) {
    return { accountId, platform: acct?.platform ?? "unknown", status: "not_applicable", connectionStatus: acct?.connectionStatus ?? "disconnected", tokenHealth: acct?.tokenHealth ?? "unknown", changed: false };
  }
  const platform = acct.platform;
  const token = decryptToken(acct.longLivedToken ?? acct.accessToken) ?? null;

  const finish = async (
    status: MetaAccountStatus,
    write: { connectionStatus: string; tokenHealth: string; health: string; reason: string | null; extra?: Record<string, unknown> },
    audit: { event: string; metadata: Record<string, unknown> },
    transient = false,
  ): Promise<MetaSyncStateResult> => {
    const wrote = await withTenantDb(tenantId, async (db) => {
      // V1.45B — guard against overwriting a disconnected account: a stale health check that
      // completes after the user disconnects updates ZERO rows (never restores connected/
      // healthy state). No-op writes are not audited.
      const res = await db.connectedAccount.updateMany({
        where: { id: acct.id, status: { not: "disconnected" as never } },
        data: {
          connectionStatus: write.connectionStatus,
          tokenHealth: write.tokenHealth,
          health: write.health as never,
          requiresReconnectReason: write.reason,
          lastTokenCheckAt: now,
          lastTokenCheckResult: status,
          ...(status === "healthy" ? { lastSuccessfulGraphCheckAt: now, lastError: null, lastErrorAt: null } : {}),
          ...(write.extra ?? {}),
        },
      });
      if (res.count === 0) return false;
      await db.auditLog.create({
        data: {
          tenantId, brandId: acct.brandId, event: audit.event, actorKind: ActorKind.system,
          targetType: "connected_account", targetId: acct.id,
          // No token material — only classified fields.
          metadata: { platform, status, ...audit.metadata },
        },
      });
      return true;
    });
    return { accountId, platform, status, connectionStatus: write.connectionStatus, tokenHealth: write.tokenHealth, changed: wrote, transient };
  };

  if (!token) {
    return finish("token_expired",
      { connectionStatus: "needs_reconnect", tokenHealth: "invalid", health: "error", reason: "no_token" },
      { event: "meta.connector.needs_reconnect", metadata: { reason: "no_token" } });
  }

  const transport = opts?.transport ?? new GraphMetaConnectorTransport();

  // Phase 2 — provider HTTP (NO open transaction).
  if (platform === "instagram_business") {
    const st = await transport.getInstagramState(acct.externalId, token);
    if (st.ok) {
      return finish("healthy",
        { connectionStatus: "connected", tokenHealth: "ok", health: "healthy", reason: null, extra: st.username ? { externalName: `@${st.username}` } : {} },
        { event: "meta.connector.healthy", metadata: {} });
    }
    if (st.errorCode === "token_expired") {
      return finish("token_expired", { connectionStatus: "needs_reconnect", tokenHealth: "expired", health: "error", reason: "token_expired" }, { event: "meta.connector.needs_reconnect", metadata: { reason: "token_expired" } });
    }
    if (st.errorCode === "permission") {
      return finish("permission_revoked", { connectionStatus: "missing_permission", tokenHealth: "ok", health: "degraded", reason: "missing_permission" }, { event: "meta.connector.permission_revoked", metadata: {} });
    }
    if (st.errorCode === "not_found") {
      return finish("instagram_disconnected", { connectionStatus: "disconnected", tokenHealth: "invalid", health: "error", reason: "instagram_disconnected" }, { event: "meta.instagram.disconnected", metadata: {} });
    }
    // Transient — do NOT downgrade.
    return finishTransient(tenantId, acct, now, st.errorCode, platform);
  }

  // facebook_page
  const st = await transport.getPageState(acct.pageId ?? acct.externalId, token);
  if (!st.ok) {
    if (st.errorCode === "token_expired") {
      return finish("token_expired", { connectionStatus: "needs_reconnect", tokenHealth: "expired", health: "error", reason: "token_expired" }, { event: "meta.connector.needs_reconnect", metadata: { reason: "token_expired" } });
    }
    if (st.errorCode === "not_found") {
      return finish("page_deleted", { connectionStatus: "disconnected", tokenHealth: "invalid", health: "error", reason: "page_deleted" }, { event: "meta.page.deleted", metadata: {} });
    }
    if (st.errorCode === "permission") {
      return finish("permission_revoked", { connectionStatus: "missing_permission", tokenHealth: "ok", health: "degraded", reason: "missing_permission" }, { event: "meta.connector.permission_revoked", metadata: {} });
    }
    return finishTransient(tenantId, acct, now, st.errorCode, platform);
  }

  // Live page reachable — evaluate capability + IG linkage + ownership.
  const permsOk = acct.grantedPermissions.includes(REQUIRED_PAGE_PERMISSION) && st.canManage;
  if (!permsOk) {
    return finish("permission_revoked", { connectionStatus: "missing_permission", tokenHealth: "ok", health: "degraded", reason: "missing_permission" }, { event: "meta.connector.permission_revoked", metadata: { canManage: st.canManage } });
  }

  // Ownership/rename change: the live Page name differs from what we stored.
  if (st.pageName && acct.externalName && st.pageName !== acct.externalName) {
    return finish("ownership_changed",
      { connectionStatus: "connected", tokenHealth: "ok", health: "healthy", reason: null, extra: { externalName: st.pageName } },
      { event: "meta.page.ownership_changed", metadata: { previousName: acct.externalName } });
  }

  // Instagram linkage: the Page had an IG account that is no longer linked.
  if (acct.igBusinessId && st.igBusinessId == null) {
    // Mark the linked IG ConnectedAccount disconnected too (detect disconnected IG).
    await withTenantDb(tenantId, (db) => db.connectedAccount.updateMany({
      // V1.45B — never resurrect/rewrite a row the user already disconnected.
      where: { brandId: acct.brandId, platform: "instagram_business" as never, externalId: acct.igBusinessId!, status: { not: "disconnected" as never } },
      data: { connectionStatus: "disconnected", tokenHealth: "invalid", health: "error" as never, requiresReconnectReason: "instagram_disconnected" },
    }));
    return finish("instagram_disconnected",
      { connectionStatus: "connected", tokenHealth: "ok", health: "degraded", reason: "instagram_disconnected", extra: { igBusinessId: null } },
      { event: "meta.instagram.disconnected", metadata: { previousIg: acct.igBusinessId } });
  }

  // A Page that never had an IG but now exposes one is a newly-available business asset.
  if (!acct.igBusinessId && st.igBusinessId) {
    return finish("healthy",
      { connectionStatus: "connected", tokenHealth: "ok", health: "healthy", reason: null, extra: { igBusinessId: st.igBusinessId } },
      { event: "meta.instagram.available", metadata: { igBusinessId: st.igBusinessId } });
  }

  return finish("healthy", { connectionStatus: "connected", tokenHealth: "ok", health: "healthy", reason: null }, { event: "meta.connector.healthy", metadata: {} });
}

/** Transient provider failure — record the check ONLY; never downgrade a healthy row. */
async function finishTransient(
  tenantId: string,
  acct: { id: string; brandId: string; connectionStatus: string; tokenHealth: string },
  now: Date,
  errorCode: string,
  platform: string,
): Promise<MetaSyncStateResult> {
  await withTenantDb(tenantId, (db) => db.connectedAccount.updateMany({
    where: { id: acct.id, status: { not: "disconnected" as never } },
    data: { lastTokenCheckAt: now, lastTokenCheckResult: errorCode },
  }));
  return { accountId: acct.id, platform, status: "transient_error", connectionStatus: acct.connectionStatus, tokenHealth: acct.tokenHealth, changed: false, transient: true };
}

export { encryptToken };
