/**
 * PROVIDER-CREDENTIAL BACKFILL — PURE arming/guard logic (no DB, network, fs, secrets, or process.env side
 * effects). Deterministically unit-testable. The thin CLI feeds it real inputs. It decides whether a run is a
 * safe DRY-RUN, a LOCAL apply, or a PRODUCTION apply, and enumerates every reason a run must be refused.
 *
 * Fail-closed: dry-run is the default; a production apply requires the exact confirmation phrase, the explicit
 * `production` environment, a genuinely non-local host, an optional host-fingerprint match, and a configured
 * vault key. Never prints a URL — only a non-reversible host fingerprint.
 */
import { hostOf } from "./assert-local-db";
import { databaseHostFingerprint, NON_PRODUCTION_HOSTS } from "./family-activation";

/** The exact phrase an operator must supply to arm an APPLY (local or production). */
export const BACKFILL_CONFIRMATION_PHRASE = "MIGRATE_PROVIDER_CREDENTIALS_TO_VAULT";
/** The only accepted `environment` value for a PRODUCTION apply. */
export const BACKFILL_ACCEPTED_ENVIRONMENT = "production";
export const BACKFILL_DEFAULT_BATCH = 100;
export const BACKFILL_MAX_BATCH = 1000;

export interface BackfillArmingInputs {
  apply: boolean;
  environment?: string;
  confirmation?: string;
  batchSize?: number;
  databaseUrl?: string | null;
  expectedFingerprint?: string | null;
  vaultKeyConfigured: boolean;
}

export type BackfillMode = "dry-run" | "apply-local" | "apply-production";

export interface BackfillArmingResult {
  ok: boolean;
  mode: BackfillMode;
  batchSize: number;
  fingerprint: string | null;
  errors: string[];
}

function clampBatch(n: number | undefined): number {
  if (!n || !Number.isFinite(n)) return BACKFILL_DEFAULT_BATCH;
  return Math.max(1, Math.min(Math.floor(n), BACKFILL_MAX_BATCH));
}

/** Decide the safe run mode + collect every refusal reason. Pure. */
export function armBackfill(input: BackfillArmingInputs): BackfillArmingResult {
  const errors: string[] = [];
  const batchSize = clampBatch(input.batchSize);
  const fingerprint = databaseHostFingerprint(input.databaseUrl ?? undefined);

  if (!input.vaultKeyConfigured) errors.push("vault key not configured (PROVIDER_VAULT_KEK or TOKEN_ENCRYPTION_KEY)");

  // DRY-RUN — read-only, safe anywhere (still needs a vault key to decrypt/verify).
  if (!input.apply) return { ok: errors.length === 0, mode: "dry-run", batchSize, fingerprint, errors };

  // APPLY — always requires the exact confirmation phrase.
  if (input.confirmation !== BACKFILL_CONFIRMATION_PHRASE) errors.push("confirmation must exactly equal the required phrase");

  const host = hostOf(input.databaseUrl ?? undefined);
  const isLocal = host === null ? false : NON_PRODUCTION_HOSTS.has(host) || !host.includes(".");
  if (host === null) errors.push("DATABASE_URL is missing or unparseable");

  if (isLocal) {
    return { ok: errors.length === 0, mode: "apply-local", batchSize, fingerprint, errors };
  }

  // PRODUCTION apply — the strict gates.
  if (input.environment !== BACKFILL_ACCEPTED_ENVIRONMENT) errors.push(`environment must be "${BACKFILL_ACCEPTED_ENVIRONMENT}"`);
  if (input.expectedFingerprint) {
    if (fingerprint !== input.expectedFingerprint) errors.push("database host fingerprint mismatch");
  }
  return { ok: errors.length === 0, mode: "apply-production", batchSize, fingerprint, errors };
}
