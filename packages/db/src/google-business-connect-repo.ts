/**
 * GOOGLE BUSINESS CONNECTOR — SLICE 1: persist a completed OAuth grant.
 *
 * This is the piece the callback route was missing. Given already-exchanged credentials it:
 *   1. anchors them on the EXISTING per-tenant `BusinessPlatformConnection` (provider = google) —
 *      no second connection or credential table is introduced;
 *   2. writes the refresh AND access tokens through the EXISTING encrypted ProviderCredential vault,
 *      then VERIFIES both decrypt back to the exact plaintext.
 *
 * TWO CLIENTS, DELIBERATELY. `provider_credentials` is owner-only — the migration does
 * `REVOKE ALL PRIVILEGES ON TABLE "provider_credentials" FROM tamanor_app` — so vault writes MUST run on
 * `systemDb`, while the connection row is tenant data written through `withTenantDb` under RLS. They
 * therefore cannot share one transaction, which is why the status is staged (see below) instead.
 *
 * TWO-PHASE LIFECYCLE — THE MODULE NEVER PROMOTES ANYTHING.
 * `persistGoogleBusinessGrant` only ever writes credentials and, for a genuinely NEW tenant, leaves the
 * connection `pending`. Promotion to a connected status is a SEPARATE, EXPLICIT call
 * ({@link activateGoogleBusinessConnection}) that the caller may make only once every prerequisite —
 * exchange, vault write, vault verification, account discovery, location discovery, normalization —
 * has actually succeeded. Splitting the two is what makes "never fake a connected state" structural
 * rather than a matter of call ordering: there is no path through this file that can turn a fresh grant
 * `active` without the caller separately asserting that discovery worked.
 *
 * RECONNECT SAFETY. An EXISTING connection's status is never written by the persist phase, in either
 * direction. A tenant that was already `active` stays `active` across a reconnect whose discovery later
 * fails — its previously working credential set was replaced only after the new one verified, so it is
 * not left claiming more than it has. Nothing here downgrades a working connection.
 *
 * SECRET DISCIPLINE: tokens enter as arguments and leave only inside the vault calls, which encrypt them.
 * They are never returned, logged, audited, or written to a non-vault column.
 *
 * SLICE BOUNDARY: nothing here selects or imports locations, creates a ConnectedAccount, persists reviews
 * or replies, or disconnects.
 */
import { BusinessProvider, BusinessConnectionStatus, ProviderCredentialPurpose } from "@prisma/client";
import { systemDb } from "./index";
import { withTenantDb } from "./tenant-db";
import { storeProviderCredential, resolveProviderCredential } from "./provider-credential-vault";

/** Exactly the credential material the exchange produced. Never persisted outside the vault. */
export interface GoogleGrantCredentials {
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  tokenType: string;
  scopes: string[];
}

/**
 * Bounded outcome vocabulary. `vault_write_failed` covers encrypt/write/verify alike ON PURPOSE — the
 * caller must not be able to distinguish "key mismatch" from "write rejected" from a redirect parameter.
 */
export type GoogleConnectPersistResult =
  | { ok: true; connectionId: string; status: BusinessConnectionStatus; isNew: boolean }
  | { ok: false; reason: "connection_failed" | "vault_write_failed" };

/**
 * PHASE 1 — store the credential. Deliberately takes NO target status: this function cannot promote a
 * connection, so a caller that forgets to run discovery cannot accidentally produce a connected state.
 * Returns the status the connection currently holds (`pending` for a new tenant) so the caller can see
 * exactly what it is dealing with.
 */
export async function persistGoogleBusinessGrant(input: {
  tenantId: string;
  credentials: GoogleGrantCredentials;
  /** Opaque provider subject id of the authorising Google user, if the caller resolved one. */
  authorizingProviderUserId?: string | null;
  displayName?: string | null;
}): Promise<GoogleConnectPersistResult> {
  // --- 1) Anchor row (tenant data, RLS/app role). New rows start `pending`; an existing row's status is
  //        NOT touched here, in either direction.
  let connectionId: string;
  let isNew = false;
  try {
    connectionId = await withTenantDb(input.tenantId, async (db) => {
      const existing = await db.businessPlatformConnection.findFirst({
        where: { tenantId: input.tenantId, provider: BusinessProvider.google },
        select: { id: true },
      });
      if (existing) return existing.id;
      isNew = true;
      const created = await db.businessPlatformConnection.create({
        data: {
          tenantId: input.tenantId,
          provider: BusinessProvider.google,
          status: BusinessConnectionStatus.pending,
          displayName: input.displayName ?? null,
          // Capabilities are asserted in Slice 2, once real locations are imported. Claiming
          // brand_monitoring here would overstate what this grant has been proven to do.
          capabilities: [],
        },
        select: { id: true },
      });
      return created.id;
    });
  } catch {
    return { ok: false, reason: "connection_failed" };
  }

  // --- 2) Vault write + verify (owner/systemDb, ONE transaction so both purposes land together).
  const connection = { businessConnectionId: connectionId } as const;
  const base = {
    tenantId: input.tenantId,
    provider: BusinessProvider.google,
    connection,
    scopes: input.credentials.scopes,
    authorizingProviderUserId: input.authorizingProviderUserId ?? null,
  };
  try {
    await systemDb.$transaction(async (tx) => {
      // Long-lived: the only credential that permits unattended review sync. Refresh tokens carry no
      // fixed expiry — revocation is the terminal event — so `expiresAt` stays null rather than guessed.
      await storeProviderCredential({
        ...base,
        purpose: ProviderCredentialPurpose.refresh_token,
        secret: input.credentials.refreshToken,
        tokenType: input.credentials.tokenType,
        expiresAt: null,
      }, { db: tx });
      // Short-lived: cached with its real expiry so the first sync need not immediately re-refresh.
      await storeProviderCredential({
        ...base,
        purpose: ProviderCredentialPurpose.access_token,
        secret: input.credentials.accessToken,
        tokenType: input.credentials.tokenType,
        expiresAt: input.credentials.accessTokenExpiresAt,
      }, { db: tx });

      // Prove BOTH round-trip. A row that cannot be decrypted back is worse than no row: it would make
      // the connection look live while every future sync fails.
      const rt = await resolveProviderCredential({ ...base, purpose: ProviderCredentialPurpose.refresh_token }, { db: tx });
      const at = await resolveProviderCredential({ ...base, purpose: ProviderCredentialPurpose.access_token }, { db: tx });
      if (rt !== input.credentials.refreshToken || at !== input.credentials.accessToken) {
        throw new Error("vault_verify_failed");
      }
    });
  } catch {
    // Never surface a driver/crypto message. The anchor row stays `pending` (or keeps its prior status
    // on a reconnect) — no connected state is claimed for credentials that were not proven stored.
    return { ok: false, reason: "vault_write_failed" };
  }

  // --- 3) Report the CURRENT status. No promotion happens here; see activateGoogleBusinessConnection.
  try {
    const row = await withTenantDb(input.tenantId, (db) => db.businessPlatformConnection.findFirstOrThrow({
      where: { id: connectionId, tenantId: input.tenantId },
      select: { status: true },
    }));
    return { ok: true, connectionId, status: row.status, isNew };
  } catch {
    return { ok: false, reason: "connection_failed" };
  }
}

/**
 * PHASE 2 — promote a credentialed connection to a connected status.
 *
 * The caller must invoke this ONLY after every prerequisite has succeeded: the token exchange, the vault
 * write, the vault read-back verification, account discovery, location discovery and normalization. If
 * any of those failed, simply never calling this leaves the connection in its existing non-active state
 * — `pending` for a new tenant — which is the honest record of "we hold a credential but have not proven
 * the connector works".
 *
 * `status` is supplied by the caller so the two-axis flag policy (`GOOGLE_BUSINESS_API_ENABLED` /
 * `GOOGLE_BUSINESS_API_APPROVED`) stays in ONE place, the callback route. This function never decides
 * approval on its own.
 */
export async function activateGoogleBusinessConnection(input: {
  tenantId: string;
  connectionId: string;
  status: BusinessConnectionStatus;
  displayName?: string | null;
}): Promise<{ ok: true; status: BusinessConnectionStatus } | { ok: false; reason: "connection_failed" }> {
  try {
    const row = await withTenantDb(input.tenantId, (db) => db.businessPlatformConnection.update({
      // Tenant-pinned: `withTenantDb` applies RLS, and the id is one this tenant just anchored.
      where: { id: input.connectionId },
      data: {
        status: input.status,
        lastVerifiedAt: new Date(),
        lastErrorCode: null,
        ...(input.displayName ? { displayName: input.displayName } : {}),
      },
      select: { status: true },
    }));
    return { ok: true, status: row.status };
  } catch {
    return { ok: false, reason: "connection_failed" };
  }
}

/**
 * Record a bounded, non-secret failure code on the tenant's Google connection. Best-effort: a failure to
 * record the failure must never mask the original one, and it never creates a row that does not exist.
 */
export async function markGoogleBusinessConnectionError(tenantId: string, code: string): Promise<void> {
  try {
    await withTenantDb(tenantId, async (db) => {
      await db.businessPlatformConnection.updateMany({
        where: { tenantId, provider: BusinessProvider.google },
        data: { status: BusinessConnectionStatus.error, lastErrorCode: code.slice(0, 64) },
      });
    });
  } catch {
    /* intentionally silent */
  }
}
