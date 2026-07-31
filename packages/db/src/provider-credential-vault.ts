/**
 * SECURE PROVIDER CREDENTIAL VAULT — service layer (server-only, systemDb/owner ONLY).
 *
 * This is the ONLY sanctioned way to read/write `provider_credentials`. The table has NO app-role grants
 * (REVOKE ALL in the migration), so every query here goes through `systemDb` (owner, BYPASSRLS) with an
 * EXPLICIT tenantId in the where-clause as the isolation mechanism — never `withTenantDb`.
 *
 * Fail-closed invariants:
 *  - Production requires a valid vault KEK (resolveVaultKeyProvider throws otherwise) — never a dev/default key.
 *  - If an active vault row EXISTS but decrypt fails, the resolver throws `VaultDecryptError` — it NEVER returns
 *    plaintext and callers MUST classify this as a security failure (no legacy fallback).
 *  - Only non-secret metadata (ids/provider/purpose/keyVersion/fingerprint/expiry/scopes) ever leaves this module
 *    besides the decrypted plaintext returned to the trusted server caller. Ciphertext/IV/tag/wrapped-key/KEK
 *    are never returned, logged, or surfaced.
 */
import { Prisma, BusinessProvider, ProviderCredentialPurpose } from "@prisma/client";
import { systemDb } from "./index";
import {
  encryptCredential, decryptCredential, credentialFingerprint, resolveVaultKeyProvider,
  type ProviderCredentialKeyProvider, type CredentialAad,
} from "./provider-credential-crypto";

export { ProviderCredentialPurpose } from "@prisma/client";

/** Thrown when an active vault row exists but cannot be decrypted (tamper/key mismatch). SECURITY failure. */
export class VaultDecryptError extends Error {
  constructor(readonly credentialId: string) {
    super("vault_decrypt_failed");
    this.name = "VaultDecryptError";
  }
}

/** Thrown when a vault row EXISTS but is unusable (revoked, or policy-disallowed expired). Fail-closed: the caller
 *  MUST NOT fall back to any legacy plaintext — the credential was explicitly retired/expired, not merely absent. */
export class VaultCredentialUnusableError extends Error {
  constructor(readonly reason: "revoked" | "expired") {
    super(`vault_credential_${reason}`);
    this.name = "VaultCredentialUnusableError";
  }
}

/** The outcome of probing the vault for a credential — distinguishes "no row" from "row exists but unusable". */
export type CredentialOutcome =
  | { state: "present"; plaintext: string; expired: boolean }
  | { state: "revoked" }
  | { state: "absent" };

/** Identifies the connection a credential belongs to — exactly one of the two is set. */
export type CredentialConnection =
  | { connectedAccountId: string; businessConnectionId?: undefined }
  | { businessConnectionId: string; connectedAccountId?: undefined };

export interface StoreCredentialInput {
  tenantId: string;
  provider: BusinessProvider;
  purpose: ProviderCredentialPurpose;
  connection: CredentialConnection;
  /** The plaintext secret. Encrypted immediately; never stored/logged in the clear. */
  secret: string;
  tokenType?: string | null;
  expiresAt?: Date | null;
  scopes?: string[];
}

export interface CredentialQuery {
  tenantId: string;
  provider: BusinessProvider;
  purpose: ProviderCredentialPurpose;
  connection: CredentialConnection;
}

/** Non-secret status view (safe to surface to server callers / audit). */
export interface CredentialStatus {
  exists: boolean;
  revoked: boolean;
  expiresAt: Date | null;
  keyVersion: string | null;
  fingerprint: string | null;
  scopes: string[];
  rotatedAt: Date | null;
}

function connectionId(connection: CredentialConnection): string {
  return connection.connectedAccountId ?? connection.businessConnectionId!;
}
function aadFor(q: CredentialQuery): CredentialAad {
  return { tenantId: q.tenantId, provider: q.provider, connectionId: connectionId(q.connection), purpose: q.purpose };
}
function keyProvider(override?: ProviderCredentialKeyProvider): ProviderCredentialKeyProvider {
  return override ?? resolveVaultKeyProvider(process.env);
}
/** The active-row selector (a single non-revoked credential per tenant/provider/connection/purpose). */
function activeWhere(q: CredentialQuery) {
  const conn = q.connection.connectedAccountId
    ? { connectedAccountId: q.connection.connectedAccountId }
    : { businessConnectionId: q.connection.businessConnectionId };
  return { tenantId: q.tenantId, provider: q.provider, purpose: q.purpose, revokedAt: null, ...conn };
}

/**
 * Store (or rotate) a credential. Encrypts under envelope encryption and keeps exactly ONE active row per
 * (tenant, provider, connection, purpose): an existing active row is rotated in place; otherwise a new row is
 * created. Idempotent under concurrency via the partial unique index (P2002 → re-resolve + update).
 */
export async function storeProviderCredential(input: StoreCredentialInput, key?: ProviderCredentialKeyProvider): Promise<{ id: string; fingerprint: string; rotated: boolean }> {
  const q: CredentialQuery = { tenantId: input.tenantId, provider: input.provider, purpose: input.purpose, connection: input.connection };
  const enc = await encryptCredential(input.secret, aadFor(q), keyProvider(key));
  const data = {
    ciphertext: enc.ciphertext, iv: enc.iv, authTag: enc.authTag, wrappedDataKey: enc.wrappedDataKey,
    keyProvider: enc.keyProvider, keyVersion: enc.keyVersion, formatVersion: enc.formatVersion,
    tokenType: input.tokenType ?? null, expiresAt: input.expiresAt ?? null, scopes: input.scopes ?? [],
    fingerprint: enc.fingerprint,
  };
  const existing = await systemDb.providerCredential.findFirst({ where: activeWhere(q), select: { id: true } });
  if (existing) {
    await systemDb.providerCredential.update({ where: { id: existing.id }, data: { ...data, rotatedAt: new Date() } });
    return { id: existing.id, fingerprint: enc.fingerprint, rotated: true };
  }
  try {
    const created = await systemDb.providerCredential.create({
      data: {
        tenantId: input.tenantId, provider: input.provider, purpose: input.purpose,
        connectedAccountId: input.connection.connectedAccountId ?? null,
        businessConnectionId: input.connection.businessConnectionId ?? null,
        ...data,
      },
      select: { id: true },
    });
    return { id: created.id, fingerprint: enc.fingerprint, rotated: false };
  } catch (e) {
    // Concurrent create lost the race against the partial unique index — rotate the winner instead.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await systemDb.providerCredential.findFirstOrThrow({ where: activeWhere(q), select: { id: true } });
      await systemDb.providerCredential.update({ where: { id: winner.id }, data: { ...data, rotatedAt: new Date() } });
      return { id: winner.id, fingerprint: enc.fingerprint, rotated: true };
    }
    throw e;
  }
}

/** Alias for clarity at call sites — rotation IS a store of a fresh secret over the active row. */
export const rotateProviderCredential = storeProviderCredential;

/**
 * Resolve the plaintext secret for the active credential, or null if there is NO active row. Throws
 * `VaultDecryptError` if a row exists but cannot be decrypted — callers MUST treat that as a security failure and
 * MUST NOT fall back to any legacy plaintext.
 */
export async function resolveProviderCredential(q: CredentialQuery, key?: ProviderCredentialKeyProvider): Promise<string | null> {
  const row = await systemDb.providerCredential.findFirst({ where: activeWhere(q) });
  if (!row) return null;
  try {
    return await decryptCredential(
      {
        ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag, wrappedDataKey: row.wrappedDataKey,
        keyProvider: row.keyProvider, keyVersion: row.keyVersion, formatVersion: row.formatVersion, fingerprint: row.fingerprint,
      },
      aadFor(q), keyProvider(key),
    );
  } catch {
    throw new VaultDecryptError(row.id);
  }
}

/**
 * Probe the vault and return a precise outcome that distinguishes an ABSENT credential (no row ever) from one that
 * EXISTS but is unusable (revoked). An active row is decrypted (fail-closed → `VaultDecryptError` on corruption)
 * and its expiry is reported. This is what lets the canonical resolver fail closed on a revoked/expired row rather
 * than silently falling back to a legacy plaintext column.
 */
export async function resolveProviderCredentialOutcome(q: CredentialQuery, key?: ProviderCredentialKeyProvider, now: Date = new Date()): Promise<CredentialOutcome> {
  const active = await systemDb.providerCredential.findFirst({ where: activeWhere(q) });
  if (active) {
    let plaintext: string;
    try {
      plaintext = await decryptCredential(
        { ciphertext: active.ciphertext, iv: active.iv, authTag: active.authTag, wrappedDataKey: active.wrappedDataKey, keyProvider: active.keyProvider, keyVersion: active.keyVersion, formatVersion: active.formatVersion, fingerprint: active.fingerprint },
        aadFor(q), keyProvider(key),
      );
    } catch {
      throw new VaultDecryptError(active.id);
    }
    return { state: "present", plaintext, expired: Boolean(active.expiresAt && active.expiresAt.getTime() < now.getTime()) };
  }
  // No ACTIVE row — is there a revoked one? (A revoked credential must fail closed, never fall back.)
  const conn = q.connection.connectedAccountId ? { connectedAccountId: q.connection.connectedAccountId } : { businessConnectionId: q.connection.businessConnectionId };
  const revoked = await systemDb.providerCredential.findFirst({ where: { tenantId: q.tenantId, provider: q.provider, purpose: q.purpose, revokedAt: { not: null }, ...conn }, select: { id: true } });
  return revoked ? { state: "revoked" } : { state: "absent" };
}

/** Non-secret status of the active credential (for truthful UI + audit). Never decrypts. */
export async function getProviderCredentialStatus(q: CredentialQuery): Promise<CredentialStatus> {
  const row = await systemDb.providerCredential.findFirst({
    where: activeWhere(q),
    select: { expiresAt: true, keyVersion: true, fingerprint: true, scopes: true, rotatedAt: true },
  });
  if (!row) return { exists: false, revoked: false, expiresAt: null, keyVersion: null, fingerprint: null, scopes: [], rotatedAt: null };
  return { exists: true, revoked: false, expiresAt: row.expiresAt, keyVersion: row.keyVersion, fingerprint: row.fingerprint, scopes: row.scopes, rotatedAt: row.rotatedAt };
}

/** Revoke the active credential (sets revokedAt). Idempotent — returns whether a row was revoked. */
export async function revokeProviderCredential(q: CredentialQuery): Promise<boolean> {
  const row = await systemDb.providerCredential.findFirst({ where: activeWhere(q), select: { id: true } });
  if (!row) return false;
  await systemDb.providerCredential.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  return true;
}

/** Verify a plaintext matches the active credential's fingerprint (non-secret equivalence check for backfill). */
export function credentialMatchesFingerprint(plaintext: string, fingerprint: string): boolean {
  return credentialFingerprint(plaintext) === fingerprint;
}
