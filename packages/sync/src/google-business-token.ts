/**
 * GOOGLE BUSINESS CONNECTOR — SLICE 3A: the vault-backed access-token resolver.
 *
 * Every Google Business API call in the product goes through {@link resolveGoogleBusinessAccessToken}.
 * It returns a token that is valid RIGHT NOW, refreshing through Google's OAuth endpoint only when the
 * stored one is expired or inside the safety window — never on every sync.
 *
 * WHY A LOCK. Several workers can tick the same tenant at once. Without serialisation they would each
 * POST a refresh, and the loser of the race would overwrite the winner's newer access token with its own
 * (already older) one — or, worse, write a stale expiry that makes a live token look dead. A PostgreSQL
 * advisory lock keyed on the connection makes refresh single-flight: the second caller waits, then finds
 * the freshly stored token inside the lock and uses it without a second network call. This is the same
 * `pg_advisory_xact_lock(hashtext(key))` pattern `acquireBrandPlatformLock` already uses.
 *
 * WHY systemDb. `provider_credentials` is owner-only (`REVOKE ALL … FROM tamanor_app`), so both the read
 * and the write run on the owner client, exactly as Slice 1's persistence does. Tenant scoping is
 * explicit in every query rather than delegated to RLS.
 *
 * SECRET DISCIPLINE. The plaintext token exists only as a local and as the return value to a server-side
 * caller. It is never logged, audited, returned to a browser, or written outside the vault. Failures are
 * reported as a bounded classification with no provider text.
 */
import { getGoogleBusinessConfig } from "@guardora/config";
import {
  systemDb, withTenantDb, storeProviderCredential, resolveProviderCredentialOutcome, VaultDecryptError,
  enableAccountMonitoringWithinLimit,
  BusinessProvider, BusinessConnectionStatus, ProviderCredentialPurpose,
  type VaultExecutor,
} from "@guardora/db";
import { EntitlementError, emitOpsEvent } from "@guardora/core";
import {
  refreshGoogleAccessToken, googleAccessTokenNeedsRefresh, isRetryableRefreshFailure,
  type GoogleRefreshFailure, type GoogleTokenFetch,
} from "./google-business-connector";

/** Why a token could not be produced. Bounded, non-secret, and actionable. */
export type GoogleTokenFailure =
  | "not_configured"
  | "api_disabled"
  | "api_access_unconfirmed"
  | "not_connected"
  | GoogleRefreshFailure;

export type GoogleTokenResolution =
  | { ok: true; accessToken: string; connectionId: string; refreshed: boolean }
  | { ok: false; failure: GoogleTokenFailure; retryable: boolean };

/** True when the failure means the USER must reconnect (as opposed to us retrying or fixing config). */
export function isReconnectRequiredFailure(f: GoogleTokenFailure): boolean {
  return f === "reconnect_required" || f === "not_connected";
}

function terminal(failure: GoogleTokenFailure): GoogleTokenResolution {
  return { ok: false, failure, retryable: false };
}

/** Advisory lock keyed on the Google connection — the single-flight boundary for refresh. */
async function lockConnection(tx: VaultExecutor, connectionId: string): Promise<void> {
  const key = `tamanor:gbp_refresh:${connectionId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`;
}

/**
 * Resolve a usable Google access token for a tenant, refreshing if needed.
 *
 * `fetchImpl`/`now` are injectable so the whole refresh path is deterministically testable without a
 * network or a clock; production passes neither.
 */
export async function resolveGoogleBusinessAccessToken(
  tenantId: string,
  opts: { fetchImpl?: GoogleTokenFetch; now?: () => number; source?: NodeJS.ProcessEnv } = {},
): Promise<GoogleTokenResolution> {
  // Both feature axes fail closed BEFORE any credential read or network call, exactly as every other
  // Google entry point does. Neither substitutes for the other.
  const cfg = getGoogleBusinessConfig(opts.source);
  if (!cfg.configured) return terminal("not_configured");
  if (!cfg.apiEnabled) return terminal("api_disabled");
  if (!cfg.apiApproved) return terminal("api_access_unconfirmed");

  const nowMs = opts.now ? opts.now() : Date.now();

  // The connection anchor is tenant data, so it is read under RLS.
  const connection = await withTenantDb(tenantId, (db) => db.businessPlatformConnection.findFirst({
    where: { tenantId, provider: BusinessProvider.google },
    select: { id: true, status: true },
  }));
  if (!connection || connection.status === BusinessConnectionStatus.disconnected) return terminal("not_connected");
  const connectionId = connection.id;

  const query = (purpose: ProviderCredentialPurpose) =>
    ({ tenantId, provider: BusinessProvider.google, purpose, connection: { businessConnectionId: connectionId } });

  // --- Fast path: a still-valid access token is reused with NO network call and NO lock. This is what
  //     keeps routine syncs from hammering Google's token endpoint.
  try {
    const access = await resolveProviderCredentialOutcome(query(ProviderCredentialPurpose.access_token), { now: new Date(nowMs) });
    if (access.state === "present" && !googleAccessTokenNeedsRefresh(await accessExpiry(connectionId, tenantId), nowMs)) {
      return { ok: true, accessToken: access.plaintext, connectionId, refreshed: false };
    }
  } catch (e) {
    // A corrupt vault row is a security failure, never a soft fallback to "just refresh".
    if (e instanceof VaultDecryptError) return terminal("reconnect_required");
    return { ok: false, failure: "transient_failure", retryable: true };
  }

  // --- Slow path: refresh, serialised per connection so concurrent workers cannot clobber each other.
  try {
    return await systemDb.$transaction(async (tx) => {
      await lockConnection(tx, connectionId);

      // RE-CHECK INSIDE THE LOCK. A concurrent worker may have refreshed while we waited; if so we
      // simply use its result and perform no second network call.
      const fresh = await resolveProviderCredentialOutcome(query(ProviderCredentialPurpose.access_token), { db: tx, now: new Date(nowMs) });
      if (fresh.state === "present") {
        const expiry = await accessExpiry(connectionId, tenantId, tx);
        if (!googleAccessTokenNeedsRefresh(expiry, nowMs)) {
          return { ok: true as const, accessToken: fresh.plaintext, connectionId, refreshed: false };
        }
      }

      const stored = await resolveProviderCredentialOutcome(query(ProviderCredentialPurpose.refresh_token), { db: tx });
      // Absent or revoked refresh token ⇒ there is nothing to refresh with. The user must reconnect.
      if (stored.state !== "present") return terminal("reconnect_required");

      const result = await refreshGoogleAccessToken({
        refreshToken: stored.plaintext,
        clientId: cfg.clientId!,
        clientSecret: (opts.source ?? process.env).GOOGLE_BUSINESS_CLIENT_SECRET!,
        fetchImpl: opts.fetchImpl,
        now: () => nowMs,
      });
      if (!result.ok) {
        // NOTE: the refresh credential is deliberately NOT deleted or revoked here, even on
        // `reconnect_required`. Destroying it on a provider answer we cannot fully trust would make a
        // transient Google fault indistinguishable from a real revocation. The connection is marked
        // instead (see markGoogleBusinessReconnectRequired), which is reversible.
        return { ok: false as const, failure: result.failure, retryable: isRetryableRefreshFailure(result.failure) };
      }

      // Persist the NEW access token with its truthful expiry, in place, through the vault.
      await storeProviderCredential({
        tenantId,
        provider: BusinessProvider.google,
        purpose: ProviderCredentialPurpose.access_token,
        connection: { businessConnectionId: connectionId },
        secret: result.accessToken,
        tokenType: result.tokenType,
        expiresAt: result.accessTokenExpiresAt,
        scopes: result.scopes,
      }, { db: tx });

      // ROTATION: only when Google actually issued a replacement. An absent `refresh_token` means
      // "keep the one you have" — overwriting it with anything here would destroy a working grant.
      if (result.rotatedRefreshToken) {
        await storeProviderCredential({
          tenantId,
          provider: BusinessProvider.google,
          purpose: ProviderCredentialPurpose.refresh_token,
          connection: { businessConnectionId: connectionId },
          secret: result.rotatedRefreshToken,
          tokenType: result.tokenType,
          expiresAt: null,
          scopes: result.scopes,
        }, { db: tx });
      }

      return { ok: true as const, accessToken: result.accessToken, connectionId, refreshed: true };
    });
  } catch (e) {
    if (e instanceof VaultDecryptError) return terminal("reconnect_required");
    return { ok: false, failure: "transient_failure", retryable: true };
  }
}

/** Non-secret expiry of the active access-token row. Never decrypts anything. */
async function accessExpiry(connectionId: string, tenantId: string, db: VaultExecutor = systemDb): Promise<Date | null> {
  const row = await db.providerCredential.findFirst({
    where: {
      tenantId, provider: BusinessProvider.google,
      purpose: ProviderCredentialPurpose.access_token,
      businessConnectionId: connectionId, revokedAt: null,
    },
    select: { expiresAt: true },
  });
  return row?.expiresAt ?? null;
}

/**
 * Mark the tenant's Google connection as needing re-authorization, using the EXISTING status vocabulary.
 * Reversible by definition: a later successful refresh/reconnect moves it back to `active`. The stored
 * credentials are left untouched.
 */
export async function markGoogleBusinessReconnectRequired(tenantId: string, code: string): Promise<void> {
  try {
    await withTenantDb(tenantId, (db) => db.businessPlatformConnection.updateMany({
      where: { tenantId, provider: BusinessProvider.google, status: { not: BusinessConnectionStatus.disconnected } },
      data: { status: BusinessConnectionStatus.reauth_required, lastErrorCode: code.slice(0, 64) },
    }));
  } catch {
    // Best-effort: failing to record the failure must not mask the original one.
  }
}

/** Clear a previous reauth flag after a genuinely successful token resolution. */
export async function clearGoogleBusinessReconnectRequired(tenantId: string): Promise<void> {
  try {
    await withTenantDb(tenantId, (db) => db.businessPlatformConnection.updateMany({
      where: { tenantId, provider: BusinessProvider.google, status: BusinessConnectionStatus.reauth_required },
      data: { status: BusinessConnectionStatus.active, lastErrorCode: null, lastVerifiedAt: new Date() },
    }));
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// SLICE 3A — monitoring activation.
// ---------------------------------------------------------------------------

/** Why monitoring was or was not turned on. Bounded and safe to render/audit. */
export type MonitoringActivation =
  | { enabled: true; alreadyEnabled: boolean }
  | { enabled: false; reason: "not_google" | "account_unavailable" | "sync_not_proven" | "plan_limit_reached" | "failed" };

/**
 * Turn monitoring ON for a Google Business ConnectedAccount — but ONLY once it has been PROVEN capable
 * of review sync.
 *
 * Slice 2 deliberately imported these accounts with `monitoringEnabled = false`, because an import only
 * proves the location exists, not that we can actually read it. The activation rule here is that every
 * one of the following must already be true, and the last one is the one that cannot be faked:
 *   1. the ConnectedAccount is `active` and read-only (not disconnected, not placeholder);
 *   2. the tenant's Google connection is `active` (not reauth_required / disconnected);
 *   3. a credential exists that produced a valid access token — the caller proved this by syncing;
 *   4. at least one REAL sync completed successfully — i.e. `lastSuccessfulSyncAt` is set.
 *
 * Condition 4 is checked against the database rather than trusted from an argument, so a failed or
 * interrupted first sync can never flip monitoring on.
 *
 * ENTITLEMENTS ARE NOT BYPASSED. Activation goes through the existing
 * `enableAccountMonitoringWithinLimit`, which takes the tenant resource lock and refuses beyond the
 * plan's monitored-account cap. Hitting the cap is NOT an error: the connection and the imported
 * location stay exactly as they are, monitoring simply stays off, and the caller reports that truthfully.
 */
export async function activateGoogleBusinessMonitoring(tenantId: string, accountId: string): Promise<MonitoringActivation> {
  try {
    const account = await withTenantDb(tenantId, (db) => db.connectedAccount.findFirst({
      where: { id: accountId, tenantId },
      select: { platform: true, status: true, monitoringEnabled: true, lastSuccessfulSyncAt: true },
    }));
    if (!account) return { enabled: false, reason: "account_unavailable" };
    if (String(account.platform) !== "google_business") return { enabled: false, reason: "not_google" };
    if (String(account.status) !== "active") return { enabled: false, reason: "account_unavailable" };
    if (account.monitoringEnabled) return { enabled: true, alreadyEnabled: true };
    // THE non-fakeable condition: a real sync must already have succeeded.
    if (!account.lastSuccessfulSyncAt) return { enabled: false, reason: "sync_not_proven" };

    const connection = await withTenantDb(tenantId, (db) => db.businessPlatformConnection.findFirst({
      where: { tenantId, provider: BusinessProvider.google },
      select: { status: true },
    }));
    if (!connection || connection.status !== BusinessConnectionStatus.active) return { enabled: false, reason: "account_unavailable" };

    try {
      await enableAccountMonitoringWithinLimit(tenantId, accountId);
    } catch (e) {
      // A plan cap is a truthful product state, not a failure of the connection.
      if (e instanceof EntitlementError) {
        emitOpsEvent("subscription.account_limit_reached", { operation: "google_monitoring_activate" });
        return { enabled: false, reason: "plan_limit_reached" };
      }
      return { enabled: false, reason: "failed" };
    }
    emitOpsEvent("account.monitoring_enabled", { operation: "google_first_sync" });
    return { enabled: true, alreadyEnabled: false };
  } catch {
    return { enabled: false, reason: "failed" };
  }
}
