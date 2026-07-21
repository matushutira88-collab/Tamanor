import type { TokenEncryptionFact } from "@guardora/core";

/**
 * Pure builders for explicit security facts consumed by the Security Score engine.
 * NO "server-only" import and NO direct process.env read at module scope — every
 * function takes its inputs as arguments so it is deterministic and unit-testable.
 * The loader passes `process.env` + `tokenStorageStatus()` in.
 */

/** The non-secret token-storage status from @guardora/db's central token-crypto seam. */
export type TokenStorageStatus = {
  mode: "plaintext" | "aes-gcm" | "kms";
  keyConfigured: boolean;
  productionSafe: boolean;
};

/**
 * Classify the runtime as a REAL deployed environment vs local/dev — using ONLY
 * explicit signals, never NODE_ENV (a local `next build`/`next start` sets
 * NODE_ENV=production but is not a deployment).
 *
 * - "deployed": a real Vercel deployment (`VERCEL_ENV` = production|preview) OR an
 *   explicit opt-in `TOKEN_STORAGE_REQUIRE_ENCRYPTION=true` (the same flag
 *   @guardora/db's token-crypto uses to require encryption on self-hosted prod).
 * - "local": Vercel `development`, or off-Vercel with no explicit require flag
 *   (VERCEL_ENV unset) — local/dev/test.
 * - "unknown": an unexpected VERCEL_ENV value — never guessed as production.
 */
export function resolveEncryptionEnvironment(env: NodeJS.ProcessEnv): "deployed" | "local" | "unknown" {
  const vercel = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  const requireEnc = (env.TOKEN_STORAGE_REQUIRE_ENCRYPTION ?? "").trim() === "true";
  if (vercel === "production" || vercel === "preview" || requireEnc) return "deployed";
  if (vercel === "development" || vercel === "") return "local";
  return "unknown";
}

/**
 * Build the explicit {@link TokenEncryptionFact} from the central token-storage
 * status + the runtime environment. `status = null` (e.g. an invalid
 * TOKEN_ENCRYPTION_MODE that made tokenStorageStatus() throw) → unknown, never a
 * guessed penalty. Never includes the key value — only mode/keyConfigured.
 */
export function buildTokenEncryptionFact(status: TokenStorageStatus | null, env: NodeJS.ProcessEnv): TokenEncryptionFact {
  const environment = resolveEncryptionEnvironment(env);
  if (!status) return { state: "unknown", mode: "unknown", keyConfigured: false, environment };
  const { mode, keyConfigured, productionSafe } = status;
  if (productionSafe) return { state: "secure", mode, keyConfigured, environment };
  // Not secure at rest (plaintext, or aes-gcm without a key):
  if (environment === "deployed") return { state: "insecure", mode, keyConfigured, environment }; // CRITICAL
  if (environment === "local") return { state: "unavailable", mode, keyConfigured, environment }; // dev, no penalty
  return { state: "unknown", mode, keyConfigured, environment }; // never guessed
}
