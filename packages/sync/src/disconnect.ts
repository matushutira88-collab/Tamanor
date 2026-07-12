/**
 * V1.37.4 — safe connector disconnect lifecycle (I/J). read → best-effort provider
 * revoke (HTTP, OUTSIDE any DB tx) → tenant-scoped local credential removal. Local
 * tokens are ALWAYS removed, even if the provider revoke fails — a failed revoke never
 * blocks the local disconnect and never produces a fake "revoked". Reconnect requires a
 * fresh OAuth flow (the stored token is gone). Tokens are never logged or returned.
 */
import { withTenantDb, decryptToken } from "@guardora/db";
import { revokeProviderCredentials, type RevokeResult, type RevokeTransport } from "./provider-revoke";

export type DisconnectStatus = "disconnected_local" | "revoked_provider" | "revoke_failed" | "revoke_unsupported";

export interface DisconnectResult {
  account: { id: string; brandId: string; platform: string } | null;
  /** Normalized revoke outcome (for audit + truthful UI copy). */
  revoke: RevokeResult;
  status: DisconnectStatus;
}

/**
 * Disconnect a connected account. Tenant-scoped (RLS). A foreign/absent id returns
 * `account: null` (not_found — never enumerated).
 */
export async function disconnectAccount(
  tenantId: string,
  accountId: string,
  opts?: { transport?: RevokeTransport },
): Promise<DisconnectResult> {
  // Phase 1 — tenant read (short tx). Only fields needed for revoke + identity.
  const acct = await withTenantDb(tenantId, (db) => db.connectedAccount.findFirst({
    where: { id: accountId },
    select: { id: true, brandId: true, platform: true, externalId: true, pageId: true, accessToken: true, longLivedToken: true },
  }));
  if (!acct) return { account: null, revoke: "already_invalid", status: "disconnected_local" };

  // Decrypt ONLY here, only to revoke; never logged, never returned. A malformed/
  // invalid ciphertext must NOT reach the provider — treat as no usable token (the
  // revoke then reports already_invalid) while local removal still proceeds.
  let token: string | null = null;
  try {
    token = decryptToken(acct.longLivedToken ?? acct.accessToken) ?? null;
  } catch {
    token = null;
  }

  // Phase 2 — provider HTTP (NO open DB transaction). Best-effort.
  const revoke = await revokeProviderCredentials(
    { platform: acct.platform, accessToken: token, externalAccountId: acct.pageId ?? acct.externalId },
    { transport: opts?.transport },
  );

  // Phase 3 — tenant write (short tx). Remove local credentials ALWAYS, regardless of
  // the revoke outcome. Reconnect must mint new credentials via a fresh OAuth flow.
  await withTenantDb(tenantId, (db) => db.connectedAccount.update({
    where: { id: acct.id },
    data: {
      accessToken: null,
      longLivedToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      status: "disconnected",
      connectionStatus: "disconnected",
      tokenHealth: revoke === "revoked" ? "revoked" : "invalid",
      requiresReconnectReason: "disconnected",
      lastError: null,
      lastErrorAt: null,
    },
  }));

  const status: DisconnectStatus =
    revoke === "revoked" ? "revoked_provider"
      : revoke === "failed" ? "revoke_failed"
        : revoke === "unsupported" ? "revoke_unsupported"
          : "disconnected_local";

  return { account: { id: acct.id, brandId: acct.brandId, platform: acct.platform }, revoke, status };
}
