/**
 * GENERIC production migration PREFLIGHT (read-only). Asserts a real production target (never prints the URL),
 * validates the arming inputs, reads `_prisma_migrations` + the repo migrations dir, and fail-closes on any
 * failed/in-progress migration, an expected_last mismatch, or a surprising pending set. Prints ONLY migration
 * NAMES. A non-zero exit aborts the workflow before `prisma migrate deploy` runs.
 *
 * Env (never printed): DATABASE_URL, MIGRATE_ENVIRONMENT, EXPECTED_LAST_MIGRATION, MIGRATE_CONFIRMATION,
 * PRODUCTION_DATABASE_HOST_FINGERPRINT (optional).
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertProductionTarget } from "./family-activation";
import { appliedMigrationNames, pendingMigrations } from "./family-activation-counts";
import { validateBacklogInputs, evaluateMigrationBacklog, failedMigrationNames } from "./production-prisma-migrate";
import { systemDb } from "../src/index";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "prisma", "migrations");

async function main() {
  const env = process.env;

  // 1. Arming inputs + production-target guard (fail-closed; never prints the URL).
  const inputs = validateBacklogInputs({ environment: env.MIGRATE_ENVIRONMENT, expectedLast: env.EXPECTED_LAST_MIGRATION, confirmation: env.MIGRATE_CONFIRMATION });
  const target = assertProductionTarget({ url: env.DATABASE_URL, environment: env.MIGRATE_ENVIRONMENT, expectedFingerprint: env.PRODUCTION_DATABASE_HOST_FINGERPRINT || null });
  const armErrors = [...inputs.errors, ...target.errors];
  if (armErrors.length) { console.error("✗ Refusing to proceed:\n" + armErrors.map((e) => `  - ${e}`).join("\n")); process.exit(1); }
  console.log(`Target host fingerprint: ${target.fingerprint ?? "n/a"} (URL never printed).`);

  // 2. Read-only migration state.
  let applied: string[] = [], failed: string[] = [], pending: string[] = [], repoMigrations: string[] = [];
  try {
    repoMigrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    [applied, failed, pending] = await Promise.all([appliedMigrationNames(), failedMigrationNames(), pendingMigrations(repoMigrations)]);
  } catch (e) {
    console.error(`✗ Could not read production migration state (${(e as Error).name}).`);
    await systemDb.$disconnect();
    process.exit(1);
  }

  // 3. Backlog evaluation.
  const evalR = evaluateMigrationBacklog({ repoMigrations, pending, failed, applied, expectedLast: env.EXPECTED_LAST_MIGRATION! });
  console.log(JSON.stringify({ expectedLast: env.EXPECTED_LAST_MIGRATION, appliedCount: applied.length, failed, pending: evalR.pending, willApply: evalR.pending.length }, null, 2));

  if (!evalR.ok) {
    console.error("✗ HARD STOP — refusing `prisma migrate deploy`:\n" + evalR.errors.map((e) => `  - ${e}`).join("\n"));
    await systemDb.$disconnect();
    process.exit(1);
  }
  console.log(evalR.pending.length ? `✓ Preflight passed — ${evalR.pending.length} pending migration(s) to apply, ending exactly at ${env.EXPECTED_LAST_MIGRATION}.` : "✓ Preflight passed — already up to date (idempotent no-op).");
  await systemDb.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error("✗ Preflight failed:", (e as Error)?.name ?? "unknown"); await systemDb.$disconnect(); process.exit(1); });
