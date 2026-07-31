import { ConnectorStatus, ConnectorMode, ConnectorHealth } from "@prisma/client";

/**
 * The full set of mutable ConnectedAccount fields written when a Meta Page/IG
 * account is connected OR reconnected.
 *
 * BUSINESS-VAULT-V1 — VAULT-ONLY: this NO LONGER writes the raw/encrypted token into the legacy
 * `accessToken`/`longLivedToken`/`refreshToken` columns. The credential is persisted ONLY in the encrypted
 * `ProviderCredential` vault by the caller (`linkMetaAssets`). This builder returns SAFE metadata only —
 * status/mode/health, canonical ids, current scopes + granted permissions, token type + expiry, and reset
 * connection/health state. It contains NO secret and NEVER touches a legacy token column.
 */
export interface MetaAccountFieldsInput {
  externalName: string;
  pageId: string;
  igBusinessId: string | null;
  scopes: string[];
  grantedPermissions: string[];
  tokenType: string | null;
  tokenExpiresAt: Date | null;
}

export function metaConnectedAccountFields(input: MetaAccountFieldsInput) {
  return {
    status: ConnectorStatus.active,
    mode: ConnectorMode.read_only,
    health: ConnectorHealth.healthy,
    externalName: input.externalName,
    pageId: input.pageId,
    igBusinessId: input.igBusinessId,
    // Always overwritten with the CURRENT OAuth result.
    scopes: input.scopes,
    grantedPermissions: input.grantedPermissions,
    // SAFE metadata only — the actual token lives ONLY in the encrypted vault (ProviderCredential).
    tokenType: input.tokenType,
    tokenExpiresAt: input.tokenExpiresAt,
    // Reconnect clears prior error/backoff state.
    lastError: null,
    lastErrorAt: null,
    syncAttempts: 0,
    nextRetryAt: null,
    // V1.27C — reconnect resets connection state; the token is verified right after
    // (checkAccountToken) which flips tokenHealth to ok/invalid.
    connectionStatus: "connected",
    tokenHealth: "unknown",
    requiresReconnectReason: null,
  };
}
