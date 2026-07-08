import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

/**
 * Token encryption seam.
 *
 * OAuth tokens are persisted through this seam so the storage format is
 * centralized. Three modes, selected by TOKEN_ENCRYPTION_MODE:
 *
 *   - "plaintext" (default in DEV): tokens are stored with a `plain:v1:` tag,
 *     NOT encrypted — for local development only. FORBIDDEN in production.
 *   - "aes-gcm": real AES-256-GCM encryption using TOKEN_ENCRYPTION_KEY
 *     (base64, 32 bytes). Suitable for a single-key production deployment.
 *   - "kms": envelope encryption backed by a KMS provider. Skeleton — throws a
 *     clear error until a provider is wired in.
 *
 * PRODUCTION INVARIANT: in NODE_ENV=production, plaintext storage is blocked —
 * `encryptToken` throws rather than persist an unencrypted token.
 *
 * Nothing here logs token material. Callers must never render decrypted tokens
 * in the UI or write them to logs/audit.
 */

const PLAINTEXT_PREFIX = "plain:v1:";
const AES_PREFIX = "aesgcm:v1:";
const KMS_PREFIX = "kms:v1:";

export type TokenEncryptionMode = "plaintext" | "aes-gcm" | "kms";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function resolveMode(): TokenEncryptionMode {
  const raw = (process.env.TOKEN_ENCRYPTION_MODE ?? "plaintext").trim();
  if (raw === "aes-gcm" || raw === "kms" || raw === "plaintext") return raw;
  throw new Error(
    `Invalid TOKEN_ENCRYPTION_MODE "${raw}". Use "plaintext", "aes-gcm", or "kms".`,
  );
}

function getKey(): Buffer {
  const b64 = process.env.TOKEN_ENCRYPTION_KEY;
  if (!b64) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is required for aes-gcm token storage (base64-encoded 32 bytes).",
    );
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).");
  }
  return key;
}

function aesEncrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    AES_PREFIX +
    [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":")
  );
}

function aesDecrypt(stored: string): string {
  const parts = stored.slice(AES_PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Malformed aes-gcm token payload.");
  const [ivB64, tagB64, ctB64] = parts as [string, string, string];
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Encrypt a token for storage. Enforces the production plaintext ban. */
export function encryptToken(plaintext: string): string {
  const mode = resolveMode();
  if (mode === "plaintext") {
    if (isProduction()) {
      throw new Error(
        "Plaintext token storage is not allowed in production. Set TOKEN_ENCRYPTION_MODE=aes-gcm (with TOKEN_ENCRYPTION_KEY) or =kms.",
      );
    }
    return PLAINTEXT_PREFIX + plaintext;
  }
  if (mode === "aes-gcm") return aesEncrypt(plaintext);
  // kms
  throw new Error(
    "KMS token encryption is not yet implemented. Configure TOKEN_ENCRYPTION_MODE=aes-gcm with TOKEN_ENCRYPTION_KEY, or provide a KMS envelope-encryption provider.",
  );
}

/** Decrypt a stored token. Returns undefined for null/empty. */
export function decryptToken(stored: string | null | undefined): string | undefined {
  if (!stored) return undefined;
  if (stored.startsWith(PLAINTEXT_PREFIX)) return stored.slice(PLAINTEXT_PREFIX.length);
  if (stored.startsWith(AES_PREFIX)) return aesDecrypt(stored);
  if (stored.startsWith(KMS_PREFIX)) {
    throw new Error("KMS-encrypted token found but no KMS provider is configured.");
  }
  // Legacy / untagged value — pass through.
  return stored;
}

/** True when a stored token is dev-plaintext (not encrypted at rest). */
export function isDevPlaintextToken(stored: string | null | undefined): boolean {
  return Boolean(stored && stored.startsWith(PLAINTEXT_PREFIX));
}

/** Status for the production checklist (never exposes the key value). */
export function tokenStorageStatus(): {
  mode: TokenEncryptionMode;
  keyConfigured: boolean;
  productionSafe: boolean;
} {
  const mode = resolveMode();
  const keyConfigured = Boolean(process.env.TOKEN_ENCRYPTION_KEY);
  const productionSafe =
    mode === "aes-gcm" ? keyConfigured : mode === "kms" ? true : false;
  return { mode, keyConfigured, productionSafe };
}
