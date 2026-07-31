/**
 * PROVIDER CREDENTIAL VAULT — envelope encryption (server-only). Mirrors the token-crypto node:crypto shape
 * (AES-256-GCM, 12-byte IV, explicit auth tag) but adds: a random per-record 256-bit data-encryption key (DEK)
 * wrapped by a key-versioned master key (KEK), and Additional Authenticated Data (AAD) binding the ciphertext to
 * tenant + provider + connection + purpose + key/format version. Copying a record to another
 * tenant/provider/connection/purpose fails GCM authentication on decrypt.
 *
 * Fail-closed: production REQUIRES a valid 32-byte KEK — it NEVER silently uses a dev/default key and NEVER
 * generates a random master key at startup. Deterministic/test key providers exist ONLY for tests.
 *
 * NOTE: real crypto only — AES-256-GCM authenticated encryption. Never base64/hash/XOR/ECB/custom crypto.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const PCV_FORMAT_VERSION = "pcv1";

/** A wrapped data key: the DEK sealed by a KEK, tagged with the provider id + key version that produced it. */
export interface WrappedDataKey {
  keyProvider: string;
  keyVersion: string;
  /** base64 of the KEK-sealed DEK (self-describing AES-GCM: iv:tag:ct). */
  wrapped: string;
}

/** The provider-neutral key interface. Real deployments back this with a KMS; here it is a local AES-KEK. */
export interface ProviderCredentialKeyProvider {
  readonly id: string;
  currentKeyVersion(): string;
  wrapDataKey(dek: Buffer): Promise<WrappedDataKey>;
  unwrapDataKey(input: WrappedDataKey): Promise<Buffer>;
}

/** The AAD-binding context. Every field is authenticated — a mismatch on decrypt throws. */
export interface CredentialAad {
  tenantId: string;
  provider: string;
  /** The connection this credential belongs to (connectedAccountId or businessPlatformConnectionId). */
  connectionId: string;
  purpose: string;
}

/** The encrypted record (all base64 except the version/provider strings). Contains NO plaintext, NO KEK. */
export interface EncryptedCredential {
  ciphertext: string;
  iv: string;
  authTag: string;
  wrappedDataKey: string; // JSON of WrappedDataKey (base64-safe)
  keyProvider: string;
  keyVersion: string;
  formatVersion: string;
  /** Non-secret fingerprint (sha256 of the plaintext, hex, truncated) — for equivalence checks, never reversible. */
  fingerprint: string;
}

/** Canonical, delimited AAD string. Deterministic; binds ciphertext to its full context + versions. */
function canonicalAad(aad: CredentialAad, keyVersion: string): string {
  return [PCV_FORMAT_VERSION, keyVersion, aad.tenantId, aad.provider, aad.connectionId, aad.purpose].join("|");
}

/** Non-secret, non-reversible fingerprint of a plaintext credential (for backfill equivalence checks). */
export function credentialFingerprint(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex").slice(0, 32);
}

/** Encrypt a credential under envelope encryption. Returns the sealed record (no plaintext, no KEK material). */
export async function encryptCredential(plaintext: string, aad: CredentialAad, key: ProviderCredentialKeyProvider): Promise<EncryptedCredential> {
  const keyVersion = key.currentKeyVersion();
  const dek = randomBytes(32); // per-record 256-bit data key
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dek, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(canonicalAad(aad, keyVersion), "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wrapped = await key.wrapDataKey(dek);
  dek.fill(0); // best-effort scrub
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    authTag: tag.toString("base64"),
    wrappedDataKey: JSON.stringify(wrapped),
    keyProvider: key.id,
    keyVersion,
    formatVersion: PCV_FORMAT_VERSION,
    fingerprint: credentialFingerprint(plaintext),
  };
}

/**
 * Decrypt a sealed record. Throws on ANY mismatch — wrong key/version, tampered ciphertext/tag/wrapped key, or an
 * AAD that does not match the supplied tenant/provider/connection/purpose. Never partially returns.
 */
export async function decryptCredential(rec: EncryptedCredential, aad: CredentialAad, key: ProviderCredentialKeyProvider): Promise<string> {
  if (rec.formatVersion !== PCV_FORMAT_VERSION) throw new Error("pcv_unsupported_format");
  const wrapped = JSON.parse(rec.wrappedDataKey) as WrappedDataKey;
  const dek = await key.unwrapDataKey(wrapped); // throws on wrong key/version/tamper
  try {
    const decipher = createDecipheriv("aes-256-gcm", dek, Buffer.from(rec.iv, "base64"), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(canonicalAad(aad, rec.keyVersion), "utf8"));
    decipher.setAuthTag(Buffer.from(rec.authTag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(rec.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } finally {
    dek.fill(0);
  }
}

// ---- Key providers ------------------------------------------------------------------------------------------

/** A local AES-256-GCM key-encryption-key provider (KEK wraps the DEK). Not a KMS — but a real authenticated wrap. */
export class LocalKekKeyProvider implements ProviderCredentialKeyProvider {
  constructor(readonly id: string, private readonly keyVersion: string, private readonly kek: Buffer) {
    if (kek.length !== 32) throw new Error("pcv_kek_must_be_256_bit");
  }
  currentKeyVersion(): string { return this.keyVersion; }
  async wrapDataKey(dek: Buffer): Promise<WrappedDataKey> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.kek, iv, { authTagLength: 16 });
    // Bind the wrap to the key version so a cross-version unwrap fails.
    cipher.setAAD(Buffer.from(`${this.id}|${this.keyVersion}`, "utf8"));
    const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { keyProvider: this.id, keyVersion: this.keyVersion, wrapped: [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":") };
  }
  async unwrapDataKey(input: WrappedDataKey): Promise<Buffer> {
    if (input.keyProvider !== this.id) throw new Error("pcv_key_provider_mismatch");
    if (input.keyVersion !== this.keyVersion) throw new Error("pcv_key_version_mismatch");
    const [ivB64, tagB64, ctB64] = input.wrapped.split(":");
    if (!ivB64 || !tagB64 || !ctB64) throw new Error("pcv_wrapped_key_malformed");
    const decipher = createDecipheriv("aes-256-gcm", this.kek, Buffer.from(ivB64, "base64"), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(`${this.id}|${this.keyVersion}`, "utf8"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
  }
}

/** DETERMINISTIC key provider — TEST ONLY. Fixed KEK derived from a label; never used outside tests. */
export function testKeyProvider(label = "pcv-test", version = "v1"): ProviderCredentialKeyProvider {
  const kek = createHash("sha256").update(`test-kek:${label}`).digest(); // 32 bytes, deterministic
  return new LocalKekKeyProvider("kek-test", version, kek);
}

export interface VaultKeyEnv {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  PROVIDER_VAULT_KEK?: string;    // base64, 32 bytes (preferred, dedicated vault key)
  TOKEN_ENCRYPTION_KEY?: string;  // base64, 32 bytes (fallback — the existing token-crypto key)
  PROVIDER_VAULT_KEY_VERSION?: string;
}
function isProdEnv(env: VaultKeyEnv): boolean {
  return (env.VERCEL_ENV ?? "").trim().toLowerCase() === "production" || (env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}
function loadKek(env: VaultKeyEnv): Buffer | null {
  const raw = (env.PROVIDER_VAULT_KEK ?? env.TOKEN_ENCRYPTION_KEY ?? "").trim();
  if (!raw) return null;
  let buf: Buffer;
  try { buf = Buffer.from(raw, "base64"); } catch { return null; }
  return buf.length === 32 ? buf : null;
}

/**
 * Resolve the production/dev key provider from env. Fail-closed: in production a valid 32-byte KEK MUST be
 * configured (PROVIDER_VAULT_KEK or TOKEN_ENCRYPTION_KEY) or this throws — it NEVER falls back to a dev/default
 * or a random startup key. In non-production, a configured key is used (loud) if present; absent → throws (the
 * vault is opt-in and must be configured to use — it never silently no-ops).
 */
export function resolveVaultKeyProvider(env: VaultKeyEnv): ProviderCredentialKeyProvider {
  const kek = loadKek(env);
  const version = (env.PROVIDER_VAULT_KEY_VERSION ?? "v1").trim() || "v1";
  if (!kek) {
    throw new Error(isProdEnv(env)
      ? "pcv_production_key_missing: PROVIDER_VAULT_KEK (or TOKEN_ENCRYPTION_KEY) must be a base64 32-byte key in production"
      : "pcv_key_missing: configure PROVIDER_VAULT_KEK (or TOKEN_ENCRYPTION_KEY) as a base64 32-byte key");
  }
  return new LocalKekKeyProvider("kek-local", version, kek);
}

/** Non-throwing status for readiness (never exposes key material). */
export function vaultKeyStatus(env: VaultKeyEnv): { keyConfigured: boolean; productionSafe: boolean } {
  const configured = loadKek(env) !== null;
  return { keyConfigured: configured, productionSafe: !isProdEnv(env) || configured };
}
