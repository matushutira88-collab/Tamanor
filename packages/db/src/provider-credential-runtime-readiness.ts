/**
 * PROVIDER CREDENTIAL — Vercel-runtime cutover readiness (server-only). The credential cutover must run INSIDE the
 * Vercel Production runtime because that is the ONLY place both key sets are present at once: the legacy
 * `TOKEN_ENCRYPTION_KEY` (which decrypts the old `aesgcm:v1:*` ConnectedAccount columns) and the new
 * `PROVIDER_VAULT_KEK`. GitHub Actions intentionally does NOT hold the Sensitive legacy key, so the cutover cannot
 * decrypt legacy values there.
 *
 * This module NEVER returns or logs a secret value — only booleans, enumerated safe reason codes, the (public)
 * deployment SHA, and a non-reversible database host fingerprint. `evaluate…` is PURE (env in → result out) and
 * fully unit-testable; the DB preflight is a separate async check.
 */
import { createHash } from "node:crypto";
import { systemDb } from "./index";

export const EXPECTED_VAULT_MIGRATION = "20260827100000_business_provider_credential_vault_meta_leads_v1";

/** Enumerated, secret-free reason codes for a NOT-ready runtime. Unit-tested exhaustively. */
export type CutoverReadinessReason =
  | "not_vercel_production"
  | "not_node_production"
  | "deployment_sha_missing"
  | "deployment_sha_invalid"
  | "legacy_mode_not_aes_gcm"
  | "legacy_decryption_key_unavailable"
  | "vault_kek_unavailable"
  | "vault_key_version_missing"
  | "legacy_and_vault_keys_identical";

export interface RuntimeReadinessEnv {
  VERCEL_ENV?: string;
  NODE_ENV?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
  TOKEN_ENCRYPTION_MODE?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  PROVIDER_VAULT_KEK?: string;
  PROVIDER_VAULT_KEY_VERSION?: string;
}

export interface RuntimeReadinessResult {
  ready: boolean;
  reasons: CutoverReadinessReason[];
  deploymentSha: string | null; // public git SHA (bounded to 40 hex) — never a secret
  checks: {
    vercelProduction: boolean;
    nodeProduction: boolean;
    deploymentShaValid: boolean;
    legacyModeAesGcm: boolean;
    legacyKey32Bytes: boolean;
    vaultKek32Bytes: boolean;
    keyVersionSet: boolean;
    keysDistinct: boolean;
  };
}

/** base64 → exactly 32 bytes, without ever exposing the value. */
function decodes32(raw: string | undefined): boolean {
  if (!raw) return false;
  try { return Buffer.from(raw.trim(), "base64").length === 32; } catch { return false; }
}
/** True when two base64 keys decode to the identical bytes (compared, never returned). */
function sameKey(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  try {
    const ba = Buffer.from(a.trim(), "base64"); const bb = Buffer.from(b.trim(), "base64");
    return ba.length === bb.length && ba.length > 0 && ba.equals(bb);
  } catch { return false; }
}
const SHA_RE = /^[0-9a-f]{7,40}$/i;

/**
 * PURE evaluation of the runtime env. Ready ONLY when: Vercel+Node production; a valid deployment SHA; the legacy
 * seam is aes-gcm with a 32-byte TOKEN_ENCRYPTION_KEY (so old columns can be decrypted); a distinct 32-byte
 * PROVIDER_VAULT_KEK + key version. Never falls back to the vault KEK for legacy decryption.
 */
export function evaluateProviderCredentialRuntimeCutoverReadiness(env: RuntimeReadinessEnv): RuntimeReadinessResult {
  const shaRaw = (env.VERCEL_GIT_COMMIT_SHA ?? "").trim();
  const deploymentShaValid = SHA_RE.test(shaRaw);
  const checks = {
    vercelProduction: (env.VERCEL_ENV ?? "").trim().toLowerCase() === "production",
    nodeProduction: (env.NODE_ENV ?? "").trim().toLowerCase() === "production",
    deploymentShaValid,
    legacyModeAesGcm: (env.TOKEN_ENCRYPTION_MODE ?? "").trim().toLowerCase() === "aes-gcm",
    legacyKey32Bytes: decodes32(env.TOKEN_ENCRYPTION_KEY),
    vaultKek32Bytes: decodes32(env.PROVIDER_VAULT_KEK),
    keyVersionSet: Boolean((env.PROVIDER_VAULT_KEY_VERSION ?? "").trim()),
    keysDistinct: !sameKey(env.TOKEN_ENCRYPTION_KEY, env.PROVIDER_VAULT_KEK),
  };
  const reasons: CutoverReadinessReason[] = [];
  if (!checks.vercelProduction) reasons.push("not_vercel_production");
  if (!checks.nodeProduction) reasons.push("not_node_production");
  if (!shaRaw) reasons.push("deployment_sha_missing");
  else if (!deploymentShaValid) reasons.push("deployment_sha_invalid");
  if (!checks.legacyModeAesGcm) reasons.push("legacy_mode_not_aes_gcm");
  if (!checks.legacyKey32Bytes) reasons.push("legacy_decryption_key_unavailable");
  if (!checks.vaultKek32Bytes) reasons.push("vault_kek_unavailable");
  if (!checks.keyVersionSet) reasons.push("vault_key_version_missing");
  // Only assert distinctness when both keys are present + valid (avoid a duplicate/confusing reason otherwise).
  if (checks.legacyKey32Bytes && checks.vaultKek32Bytes && !checks.keysDistinct) reasons.push("legacy_and_vault_keys_identical");
  return { ready: reasons.length === 0, reasons, deploymentSha: deploymentShaValid ? shaRaw.slice(0, 40) : null, checks };
}

/** Non-reversible host fingerprint (sha256 hex prefix of the host) — never the URL/credentials. */
export function databaseHostFingerprintSafe(url: string | undefined): string | null {
  if (!url) return null;
  let host: string | null = null;
  try { host = new URL(url).host || null; } catch { const m = url.match(/@([^/?#]+)/); host = m?.[1] ?? null; }
  if (!host) return null;
  return createHash("sha256").update(host).digest("hex").slice(0, 16);
}

export type CutoverDbReason = "migration_not_applied" | "vault_table_missing" | "pending_or_failed_migrations" | "database_not_production";

export interface CutoverDbReadiness {
  ready: boolean;
  reasons: CutoverDbReason[];
  hostFingerprint: string | null;
}

/**
 * Async DB preflight (owner/systemDb, read-only): the vault migration is applied, the table exists, no
 * pending/failed migration state, and the target is a non-local (production-shaped) host. Returns only booleans +
 * a safe host fingerprint.
 */
export async function checkProviderCredentialCutoverDbReadiness(env: NodeJS.ProcessEnv = process.env): Promise<CutoverDbReadiness> {
  const reasons: CutoverDbReason[] = [];
  const hostFingerprint = databaseHostFingerprintSafe(env.DATABASE_URL);

  // Non-local target (production-shaped host: has a dot, not a loopback name).
  let host: string | null = null;
  try { host = env.DATABASE_URL ? new URL(env.DATABASE_URL).hostname : null; } catch { host = null; }
  const isLocal = !host || ["localhost", "127.0.0.1", "::1", "host.docker.internal"].includes(host) || !host.includes(".");
  if (isLocal) reasons.push("database_not_production");

  try {
    const applied = await systemDb.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
      EXPECTED_VAULT_MIGRATION,
    );
    if ((applied[0]?.n ?? 0) < 1) reasons.push("migration_not_applied");
    // A genuinely-unsafe state is a migration that STARTED but never FINISHED and was not rolled back (a crashed /
    // in-progress apply). A resolved `rolled_back_at` row is a SAFE, closed state (e.g. a superseded rename) and is
    // NOT a pending failure.
    const failed = await systemDb.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
    );
    if ((failed[0]?.n ?? 0) > 0) reasons.push("pending_or_failed_migrations");
    const table = await systemDb.$queryRawUnsafe<{ ok: boolean }[]>("SELECT (to_regclass('public.provider_credentials') IS NOT NULL) AS ok");
    if (table[0]?.ok !== true) reasons.push("vault_table_missing");
  } catch {
    reasons.push("vault_table_missing");
  }
  return { ready: reasons.length === 0, reasons, hostFingerprint };
}
