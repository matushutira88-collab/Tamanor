/**
 * V1.58.7 — FAIL-CLOSED worker configuration validator. Pure and unit-testable: it takes an env
 * record and returns a structured verdict WITHOUT ever throwing and WITHOUT ever placing a secret
 * VALUE in an error (only variable names + safe reasons). The worker runs it BEFORE the scheduler,
 * the first DB job, and the readiness signal; on `ok === false` the worker refuses to start.
 *
 * Production must never silently: default into demo mode, disable sync, run an unsafe token-encryption
 * mode, or continue with a non-positive interval/TTL/heartbeat/shutdown timeout. Dev has explicitly
 * milder secret-presence rules but the SAME numeric invariants (they are correctness, not policy).
 */

export interface WorkerConfigResolved {
  nodeEnv: string;
  dataMode: string | undefined;
  autoSyncEnabled: boolean;
  liveSync: boolean;
  metaConfigured: boolean;
  tokenEncryptionMode: string;
  syncIntervalMs: number;
  leaseTtlMs: number;
  heartbeatMs: number;
  shutdownGraceMs: number;
}

export interface WorkerConfigResult {
  ok: boolean;
  /** Human-readable failure reasons. NEVER contains a secret value — only names + safe descriptions. */
  errors: string[];
  resolved: WorkerConfigResolved;
}

const isTrue = (v: string | undefined) => v === "true" || v === "1";
const present = (v: string | undefined) => typeof v === "string" && v.trim().length > 0;

/** Defaults MUST match @guardora/config so an UNSET var is treated as its valid default, not an error. */
const DEFAULTS = { syncIntervalMs: 60_000, leaseTtlMs: 300_000, heartbeatMs: 75_000, shutdownGraceMs: 25_000 };

/**
 * Parse a positive-integer env var. Returns `{ value, error? }`. UNSET → the default (valid). SET but
 * not a positive integer → the default value plus a clear error naming the var (no value echoed).
 */
function positiveInt(env: NodeJS.ProcessEnv, key: string, def: number): { value: number; error?: string } {
  const raw = env[key];
  if (raw === undefined || raw === "") return { value: def };
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return { value: def, error: `${key} must be a positive integer.` };
  }
  return { value: n };
}

export function validateWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfigResult {
  const errors: string[] = [];
  const isProd = env.NODE_ENV === "production";

  // --- Numeric runtime invariants (enforced in ALL environments — correctness, not policy). ---
  const iv = positiveInt(env, "WORKER_SYNC_INTERVAL_MS", DEFAULTS.syncIntervalMs);
  const ttl = positiveInt(env, "SYNC_LEASE_TTL_MS", DEFAULTS.leaseTtlMs);
  const hb = positiveInt(env, "SYNC_LEASE_HEARTBEAT_MS", DEFAULTS.heartbeatMs);
  const sd = positiveInt(env, "WORKER_SHUTDOWN_GRACE_MS", DEFAULTS.shutdownGraceMs);
  for (const p of [iv, ttl, hb, sd]) if (p.error) errors.push(p.error);

  // Heartbeat must renew SAFELY inside the TTL: require at least two heartbeats to fit before expiry,
  // so a single slow/failed beat cannot let the lease lapse and be taken over mid-run.
  if (!hb.error && !ttl.error && hb.value * 2 > ttl.value) {
    errors.push("SYNC_LEASE_HEARTBEAT_MS must be at most half of SYNC_LEASE_TTL_MS (safe renew reserve).");
  }

  const dataMode = env.GUARDORA_DATA_MODE;
  const autoSyncEnabled = isTrue(env.AUTO_SYNC_ENABLED);
  const liveSync = isTrue(env.META_LIVE_SYNC);
  const tokenEncryptionMode = env.TOKEN_ENCRYPTION_MODE ?? "plaintext";
  const metaConfigured = present(env.META_APP_ID) && present(env.META_APP_SECRET);

  // --- Production-only fail-closed policy (dev is intentionally milder for these). ---
  if (isProd) {
    // Database: the worker needs BOTH the owner client (systemDb: cross-tenant discovery) and the
    // RLS-enforcing app role (appDb). Names only — never the URLs.
    if (!present(env.DATABASE_URL)) errors.push("DATABASE_URL is required in production (owner/systemDb client).");
    if (!present(env.APP_DATABASE_URL)) errors.push("APP_DATABASE_URL is required in production (RLS-enforcing tamanor_app role).");
    if (present(env.APP_DATABASE_URL) && env.APP_DATABASE_URL === env.DATABASE_URL) {
      errors.push("APP_DATABASE_URL must differ from DATABASE_URL (it must be the non-superuser tamanor_app role).");
    }

    // Token encryption must be safe. plaintext is rejected; aes-gcm/kms require a key.
    if (tokenEncryptionMode === "plaintext") {
      errors.push("TOKEN_ENCRYPTION_MODE=plaintext is not allowed in production (use aes-gcm or kms).");
    } else if ((tokenEncryptionMode === "aes-gcm" || tokenEncryptionMode === "kms") && !present(env.TOKEN_ENCRYPTION_KEY)) {
      errors.push(`TOKEN_ENCRYPTION_KEY is required when TOKEN_ENCRYPTION_MODE=${tokenEncryptionMode}.`);
    } else if (!["aes-gcm", "kms"].includes(tokenEncryptionMode)) {
      errors.push("TOKEN_ENCRYPTION_MODE must be aes-gcm or kms in production.");
    }

    // Data mode must be EXPLICIT — never silently default to demo.
    if (!present(dataMode)) {
      errors.push("GUARDORA_DATA_MODE must be set explicitly in production (real or demo) — it must not silently default to demo.");
    } else if (dataMode !== "real" && dataMode !== "demo") {
      errors.push("GUARDORA_DATA_MODE must be 'real' or 'demo'.");
    }

    // Sync must not be silently broken: if autosync is enabled for REAL data, the connector must be
    // able to actually sync (Meta credentials present AND live sync on). Otherwise it is a silent no-op.
    if (autoSyncEnabled && dataMode === "real") {
      if (!metaConfigured) errors.push("AUTO_SYNC_ENABLED with GUARDORA_DATA_MODE=real requires META_APP_ID and META_APP_SECRET.");
      if (!liveSync) errors.push("AUTO_SYNC_ENABLED with GUARDORA_DATA_MODE=real requires META_LIVE_SYNC=true (otherwise real sync silently does nothing).");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    resolved: {
      nodeEnv: env.NODE_ENV ?? "development",
      dataMode,
      autoSyncEnabled,
      liveSync,
      metaConfigured,
      tokenEncryptionMode,
      syncIntervalMs: iv.value,
      leaseTtlMs: ttl.value,
      heartbeatMs: hb.value,
      shutdownGraceMs: sd.value,
    },
  };
}
