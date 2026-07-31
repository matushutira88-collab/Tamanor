/**
 * PROVIDER-CREDENTIAL BACKFILL — PURE arming/guard logic (no DB, network, fs, secrets, or process.env side
 * effects). Deterministically unit-testable. The thin CLI + the manual workflow feed it real inputs. It decides
 * whether a run is a safe DRY-RUN, a LOCAL apply, or a PRODUCTION apply, validates the mode-specific confirmation
 * phrase, bounds batch-size and max-batches, validates the resume cursor, and enumerates every refusal reason.
 *
 * Fail-closed: dry-run is the default; a production apply requires the exact APPLY phrase, the explicit
 * `production` environment, a genuinely non-local host, an optional host-fingerprint match, and a configured
 * vault key. Never prints a URL — only a non-reversible host fingerprint.
 */
import { hostOf } from "./assert-local-db";
import { databaseHostFingerprint, NON_PRODUCTION_HOSTS } from "./family-activation";

/** DISTINCT mode-specific confirmation phrases (a dry-run phrase can never arm an apply, and vice-versa). */
export const BACKFILL_DRYRUN_PHRASE = "INVENTORY_PROVIDER_CREDENTIALS";
export const BACKFILL_APPLY_PHRASE = "MIGRATE_PROVIDER_CREDENTIALS_TO_VAULT";
/** Back-compat alias for the apply phrase. */
export const BACKFILL_CONFIRMATION_PHRASE = BACKFILL_APPLY_PHRASE;

export const BACKFILL_ACCEPTED_ENVIRONMENT = "production";
export const BACKFILL_DEFAULT_BATCH = 100;
export const BACKFILL_MAX_BATCH = 1000;
export const BACKFILL_DEFAULT_MAX_BATCHES = 1;
export const BACKFILL_MAX_MAX_BATCHES = 25;
/** A cursor is an opaque ConnectedAccount id (cuid) — bounded, alphanumeric only. */
const CURSOR_RE = /^[a-z0-9]{20,40}$/i;

export interface BackfillArmingInputs {
  apply: boolean;
  environment?: string;
  confirmation?: string;
  batchSize?: number;
  maxBatches?: number;
  cursor?: string | null;
  databaseUrl?: string | null;
  expectedFingerprint?: string | null;
  vaultKeyConfigured: boolean;
}

export type BackfillMode = "dry-run" | "apply-local" | "apply-production";

export interface BackfillArmingResult {
  ok: boolean;
  mode: BackfillMode;
  batchSize: number;
  maxBatches: number;
  cursor: string | null;
  fingerprint: string | null;
  errors: string[];
}

function clampBatch(n: number | undefined): number {
  if (!n || !Number.isFinite(n)) return BACKFILL_DEFAULT_BATCH;
  return Math.max(1, Math.min(Math.floor(n), BACKFILL_MAX_BATCH));
}
function clampMaxBatches(n: number | undefined): number {
  if (!n || !Number.isFinite(n)) return BACKFILL_DEFAULT_MAX_BATCHES;
  return Math.max(1, Math.min(Math.floor(n), BACKFILL_MAX_MAX_BATCHES));
}

/** Decide the safe run mode + collect every refusal reason. Pure. */
export function armBackfill(input: BackfillArmingInputs): BackfillArmingResult {
  const errors: string[] = [];
  const batchSize = clampBatch(input.batchSize);
  const maxBatches = clampMaxBatches(input.maxBatches);
  const fingerprint = databaseHostFingerprint(input.databaseUrl ?? undefined);

  // Cursor: optional; if present it MUST be a bounded opaque id — a malformed cursor fails closed.
  let cursor: string | null = null;
  if (input.cursor != null && input.cursor !== "") {
    if (CURSOR_RE.test(input.cursor)) cursor = input.cursor;
    else errors.push("cursor is malformed (expected an opaque account id)");
  }

  if (!input.vaultKeyConfigured) errors.push("vault key not configured (PROVIDER_VAULT_KEK or TOKEN_ENCRYPTION_KEY)");

  // DRY-RUN — read-only. A confirmation, when supplied, MUST be the dry-run phrase (never the apply phrase or an
  // arbitrary string). Absent confirmation is allowed locally; the workflow always supplies it.
  if (!input.apply) {
    if (input.confirmation !== undefined && input.confirmation !== BACKFILL_DRYRUN_PHRASE) {
      errors.push("dry-run confirmation must exactly equal the dry-run phrase");
    }
    return { ok: errors.length === 0, mode: "dry-run", batchSize, maxBatches, cursor, fingerprint, errors };
  }

  // APPLY — always requires the exact APPLY phrase (a dry-run phrase can NOT arm an apply).
  if (input.confirmation !== BACKFILL_APPLY_PHRASE) errors.push("apply confirmation must exactly equal the apply phrase");

  const host = hostOf(input.databaseUrl ?? undefined);
  const isLocal = host === null ? false : NON_PRODUCTION_HOSTS.has(host) || !host.includes(".");
  if (host === null) errors.push("DATABASE_URL is missing or unparseable");

  if (isLocal) {
    return { ok: errors.length === 0, mode: "apply-local", batchSize, maxBatches, cursor, fingerprint, errors };
  }

  // PRODUCTION apply — the strict gates.
  if (input.environment !== BACKFILL_ACCEPTED_ENVIRONMENT) errors.push(`environment must be "${BACKFILL_ACCEPTED_ENVIRONMENT}"`);
  if (input.expectedFingerprint) {
    if (fingerprint !== input.expectedFingerprint) errors.push("database host fingerprint mismatch");
  }
  return { ok: errors.length === 0, mode: "apply-production", batchSize, maxBatches, cursor, fingerprint, errors };
}
