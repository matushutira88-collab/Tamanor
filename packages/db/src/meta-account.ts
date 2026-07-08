import { ConnectorStatus, ConnectorMode, ConnectorHealth } from "@prisma/client";

/**
 * The full set of mutable ConnectedAccount fields written when a Meta Page/IG
 * account is connected OR reconnected.
 *
 * This is the single source of truth used by BOTH the create and update branches
 * of the confirm/reconnect upsert, so a reconnect can NEVER keep stale
 * scopes / grantedPermissions / tokens. `scopes`, `grantedPermissions` and all
 * token fields are always present here — the reconnect regression check asserts
 * exactly that.
 *
 * Pure and secret-free at the type level: `encryptedToken` is already encrypted
 * by the caller; nothing here logs or returns plaintext.
 */
export interface MetaAccountFieldsInput {
  externalName: string;
  pageId: string;
  igBusinessId: string | null;
  scopes: string[];
  grantedPermissions: string[];
  /** Already encrypted via the token-crypto seam. */
  encryptedToken: string;
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
    accessToken: input.encryptedToken,
    longLivedToken: input.encryptedToken,
    tokenType: input.tokenType,
    tokenExpiresAt: input.tokenExpiresAt,
    // Reconnect clears prior error/backoff state.
    lastError: null,
    lastErrorAt: null,
    syncAttempts: 0,
    nextRetryAt: null,
  };
}
