/**
 * CANONICAL Meta token resolver + writer — the staged legacy-cutover seam (server-only).
 *
 * READ (`resolveMetaAccessToken`): vault-FIRST. If an active vault credential exists it is decrypted and returned;
 * a decrypt failure throws `VaultDecryptError` (a SECURITY failure) and is NEVER downgraded to a legacy read.
 * Only when NO vault row exists do we fall back to the legacy encrypted `ConnectedAccount` columns
 * (`longLivedToken ?? accessToken`) — and only while the staged-fallback policy is enabled (default on; set
 * `PROVIDER_VAULT_LEGACY_FALLBACK=false` after backfill to make the vault the sole source).
 *
 * WRITE (`writeMetaCredentialToVault`): vault-ONLY. New OAuth/reconnect writes store the token in the encrypted
 * vault and DO NOT populate the legacy plaintext token columns.
 */
import { BusinessProvider } from "@prisma/client";
import { decryptToken } from "./token-crypto";
import {
  resolveProviderCredentialOutcome, storeProviderCredential, getProviderCredentialStatus,
  VaultCredentialUnusableError, ProviderCredentialPurpose, type CredentialConnection,
} from "./provider-credential-vault";

/** The minimal ConnectedAccount shape needed to resolve a usable Meta token. */
export interface MetaTokenAccount {
  id: string;
  tenantId: string;
  longLivedToken: string | null;
  accessToken: string | null;
}

export type MetaTokenSource = "vault" | "legacy";
export interface ResolvedMetaToken {
  token: string;
  source: MetaTokenSource;
}

/** Staged policy: is the legacy plaintext-column fallback still permitted? Default TRUE (pre-backfill). One central
 *  switch — set PROVIDER_VAULT_LEGACY_FALLBACK=false after backfill to make the vault the sole credential source. */
export function legacyFallbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.PROVIDER_VAULT_LEGACY_FALLBACK ?? "true").trim().toLowerCase() !== "false";
}

/** Policy: is a still-present-but-EXPIRED vault credential allowed to be used? Default TRUE (the existing
 *  token-health/reconnect path governs expiry). Set PROVIDER_VAULT_DISALLOW_EXPIRED=true to fail closed on expiry. */
function expiredAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.PROVIDER_VAULT_DISALLOW_EXPIRED ?? "").trim().toLowerCase() !== "true";
}

function connectionFor(account: { id: string }): CredentialConnection {
  return { connectedAccountId: account.id };
}

/**
 * Resolve a usable Meta access token for a moderation ConnectedAccount. Vault-first, fail-closed on vault
 * corruption, legacy-column fallback only when no vault row exists (and only under the staged policy). Returns
 * null when neither source yields a token (caller should surface reauth_required, not a silent failure).
 *
 * NOTE: a `VaultDecryptError` PROPAGATES — the caller must classify it as a security failure and MUST NOT retry
 * against the legacy columns.
 */
export async function resolveMetaAccessToken(account: MetaTokenAccount): Promise<ResolvedMetaToken | null> {
  // Vault-first: try the long-lived token, then a short-lived access token. A vault row that EXISTS but is
  // unusable (corrupt → VaultDecryptError; revoked/policy-expired → VaultCredentialUnusableError) FAILS CLOSED —
  // it is NEVER downgraded to a legacy read. Only a truly ABSENT row (no vault credential ever) may fall back.
  for (const purpose of [ProviderCredentialPurpose.long_lived_token, ProviderCredentialPurpose.access_token]) {
    const outcome = await resolveProviderCredentialOutcome({
      tenantId: account.tenantId, provider: BusinessProvider.meta, purpose, connection: connectionFor(account),
    }); // VaultDecryptError propagates.
    if (outcome.state === "present") {
      if (outcome.expired && !expiredAllowed()) throw new VaultCredentialUnusableError("expired");
      return { token: outcome.plaintext, source: "vault" };
    }
    if (outcome.state === "revoked") throw new VaultCredentialUnusableError("revoked");
    // state === "absent" → try the next purpose.
  }
  // No vault row for EITHER purpose → staged legacy fallback (existing encrypted columns), under the policy switch.
  if (!legacyFallbackEnabled()) return null;
  const legacy = decryptToken(account.longLivedToken ?? account.accessToken);
  return legacy ? { token: legacy, source: "legacy" } : null;
}

/**
 * Convenience read for the moderation/sync sites that only need "a usable token, or none". Vault-first with the
 * staged legacy fallback, but FAIL-CLOSED: a corrupt/revoked/policy-expired vault row (or any resolver error) maps
 * to `null` (→ the caller degrades to needs_reconnect) — never a plaintext leak, never a legacy read past a bad
 * vault row, never an unhandled throw at the call site.
 */
export async function resolveMetaAccessTokenSafe(account: MetaTokenAccount): Promise<string | null> {
  try {
    return (await resolveMetaAccessToken(account))?.token ?? null;
  } catch {
    return null;
  }
}

/** True when the account already has an active vault credential (either purpose). Never decrypts. */
export async function hasVaultCredential(account: { id: string; tenantId: string }): Promise<boolean> {
  for (const purpose of [ProviderCredentialPurpose.long_lived_token, ProviderCredentialPurpose.access_token]) {
    const status = await getProviderCredentialStatus({
      tenantId: account.tenantId, provider: BusinessProvider.meta, purpose, connection: connectionFor(account),
    });
    if (status.exists) return true;
  }
  return false;
}

export interface WriteMetaCredentialInput {
  account: { id: string; tenantId: string };
  token: string;
  tokenType?: string | null;
  expiresAt?: Date | null;
  scopes?: string[];
  /** The token kind. Meta page tokens are long-lived; default long_lived_token. */
  purpose?: ProviderCredentialPurpose;
}

/**
 * Store a Meta credential in the vault ONLY (no legacy columns). Used by the OAuth confirm/reconnect path so new
 * writes never (re)introduce plaintext provider tokens. Returns the vault row id + non-secret fingerprint.
 */
export async function writeMetaCredentialToVault(input: WriteMetaCredentialInput): Promise<{ id: string; fingerprint: string }> {
  const res = await storeProviderCredential({
    tenantId: input.account.tenantId,
    provider: BusinessProvider.meta,
    purpose: input.purpose ?? ProviderCredentialPurpose.long_lived_token,
    connection: connectionFor(input.account),
    secret: input.token,
    tokenType: input.tokenType ?? null,
    expiresAt: input.expiresAt ?? null,
    scopes: input.scopes ?? [],
  });
  return { id: res.id, fingerprint: res.fingerprint };
}
