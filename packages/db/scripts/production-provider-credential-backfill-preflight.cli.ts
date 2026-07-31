/**
 * CI-only READ-ONLY preflight for the manual production provider-credential backfill workflow. Fail-closed: a
 * non-zero exit aborts before any backfill runs. Validates (never printing a secret or the DATABASE_URL):
 *   - arming inputs (mode-specific confirmation phrase, environment, host fingerprint) via the pure `armBackfill`;
 *   - a DEDICATED PROVIDER_VAULT_KEK is configured and decodes to EXACTLY 32 bytes (no TOKEN_ENCRYPTION_KEY fallback);
 *   - PROVIDER_VAULT_KEY_VERSION is set;
 *   - the vault migration is APPLIED (not pending) and the `provider_credentials` table exists;
 *   - the production database host fingerprint matches.
 * Prints only a redacted step summary (mode + fingerprint + boolean checks).
 */
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { systemDb } from "../src/index";
import { armBackfill } from "./provider-credential-backfill-arming";
import { databaseHostFingerprint } from "./family-activation";
import { pendingMigrations, writeStepSummary } from "./family-activation-counts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "prisma", "migrations");
const EXPECTED_MIGRATION = "20260827100000_business_provider_credential_vault_meta_leads_v1";

/** Validate the KEK decodes to exactly 32 bytes WITHOUT ever printing it. */
function kekIs32Bytes(raw: string | undefined): boolean {
  if (!raw) return false;
  try { return Buffer.from(raw.trim(), "base64").length === 32; } catch { return false; }
}

async function main(): Promise<number> {
  const env = process.env;
  const mode = (env.BACKFILL_MODE ?? "dry-run").trim();
  const apply = mode === "apply";
  const errors: string[] = [];

  // 1) Arming (mode-specific phrase, environment, fingerprint, bounds). DEDICATED KEK only — NOT the fallback.
  const armed = armBackfill({
    apply,
    environment: env.BACKFILL_ENVIRONMENT,
    confirmation: env.BACKFILL_CONFIRMATION,
    batchSize: Number(env.BACKFILL_BATCH_SIZE ?? "") || undefined,
    maxBatches: Number(env.BACKFILL_MAX_BATCHES ?? "") || undefined,
    cursor: env.BACKFILL_CURSOR || null,
    databaseUrl: env.DATABASE_URL,
    expectedFingerprint: env.PRODUCTION_DATABASE_HOST_FINGERPRINT || null,
    vaultKeyConfigured: kekIs32Bytes(env.PROVIDER_VAULT_KEK), // dedicated KEK only
  });
  if (!armed.ok) errors.push(...armed.errors.map((e) => `arming: ${e}`));

  // 2) Dedicated KEK + key version (fail if missing / wrong size / no version).
  const kekOk = kekIs32Bytes(env.PROVIDER_VAULT_KEK);
  if (!kekOk) errors.push("PROVIDER_VAULT_KEK missing or not a base64 32-byte key (dedicated KEK required)");
  if (!env.PROVIDER_VAULT_KEY_VERSION) errors.push("PROVIDER_VAULT_KEY_VERSION is not set");

  // 3) Production target fingerprint present + matches (never prints the URL).
  if (!env.DATABASE_URL) errors.push("DATABASE_URL (PRODUCTION_DATABASE_URL) is missing");
  const fingerprint = databaseHostFingerprint(env.DATABASE_URL);
  if (!env.PRODUCTION_DATABASE_HOST_FINGERPRINT) errors.push("PRODUCTION_DATABASE_HOST_FINGERPRINT is not set");
  else if (fingerprint !== env.PRODUCTION_DATABASE_HOST_FINGERPRINT) errors.push("database host fingerprint mismatch");

  // 4) Vault migration applied + table exists (read-only).
  let migrationApplied = false, tableExists = false;
  try {
    const onDisk = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    const pending = await pendingMigrations(onDisk);
    migrationApplied = onDisk.includes(EXPECTED_MIGRATION) && !pending.includes(EXPECTED_MIGRATION);
    if (!migrationApplied) errors.push(`expected migration ${EXPECTED_MIGRATION} is not applied`);
    const rows = await systemDb.$queryRawUnsafe<{ ok: boolean }[]>("SELECT (to_regclass('public.provider_credentials') IS NOT NULL) AS ok");
    tableExists = rows[0]?.ok === true;
    if (!tableExists) errors.push("provider_credentials table not found");
  } catch (e) {
    errors.push(`schema check failed (${(e as Error).name})`);
  }

  writeStepSummary("Provider credential backfill — preflight", {
    mode, hostFingerprint: fingerprint ?? "n/a", armed: armed.ok, kek32Bytes: kekOk,
    keyVersionSet: Boolean(env.PROVIDER_VAULT_KEY_VERSION), migrationApplied, tableExists,
    batchSize: armed.batchSize, maxBatches: armed.maxBatches, cursor: armed.cursor ?? null, ok: errors.length === 0,
  });

  if (errors.length) {
    console.error("✗ Preflight refused:\n" + errors.map((e) => `  - ${e}`).join("\n"));
    return 1;
  }
  console.log(`✓ Preflight passed (mode: ${mode}, host fingerprint ${fingerprint ?? "n/a"}).`);
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => { console.error("✗ Preflight error:", (e as Error).name); process.exit(1); })
  .finally(() => { void systemDb.$disconnect(); });
