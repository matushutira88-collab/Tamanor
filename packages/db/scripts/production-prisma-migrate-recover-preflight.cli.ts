/**
 * Recovery PREFLIGHT (read-only). Asserts a real production target (never prints the URL), validates the arming
 * inputs, and verifies the named migration is ACTUALLY in a blocking failed state and NOT already applied, before
 * the workflow runs `prisma migrate resolve --rolled-back`. Prints ONLY migration names. A non-zero exit aborts
 * the workflow before any resolve runs.
 *
 * Env (never printed): DATABASE_URL, MIGRATE_ENVIRONMENT, RECOVER_TARGET, RECOVER_RESOLUTION, MIGRATE_CONFIRMATION,
 * PRODUCTION_DATABASE_HOST_FINGERPRINT (optional).
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertProductionTarget } from "./family-activation";
import { appliedMigrationNames } from "./family-activation-counts";
import { failedMigrationNames } from "./production-prisma-migrate";
import { validateRecoveryInputs, evaluateRecovery } from "./production-prisma-migrate-recover";
import { systemDb } from "../src/index";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "prisma", "migrations");

async function main() {
  const env = process.env;

  // 1. Arming inputs + production-target guard (fail-closed; never prints the URL).
  const inputs = validateRecoveryInputs({ environment: env.MIGRATE_ENVIRONMENT, targetMigration: env.RECOVER_TARGET, resolution: env.RECOVER_RESOLUTION, confirmation: env.MIGRATE_CONFIRMATION });
  const target = assertProductionTarget({ url: env.DATABASE_URL, environment: env.MIGRATE_ENVIRONMENT, expectedFingerprint: env.PRODUCTION_DATABASE_HOST_FINGERPRINT || null });
  const armErrors = [...inputs.errors, ...target.errors];
  if (armErrors.length) { console.error("✗ Refusing to proceed:\n" + armErrors.map((e) => `  - ${e}`).join("\n")); process.exit(1); }
  console.log(`Target host fingerprint: ${target.fingerprint ?? "n/a"} (URL never printed).`);

  // 2. Read-only migration state.
  let applied: string[] = [], failed: string[] = [], repoMigrations: string[] = [];
  try {
    repoMigrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    [applied, failed] = await Promise.all([appliedMigrationNames(), failedMigrationNames()]);
  } catch (e) {
    console.error(`✗ Could not read production migration state (${(e as Error).name}).`);
    await systemDb.$disconnect();
    process.exit(1);
  }

  // 3. Recovery pre-check.
  const evalR = evaluateRecovery({ repoMigrations, failed, applied, targetMigration: env.RECOVER_TARGET! });
  console.log(JSON.stringify({ targetMigration: env.RECOVER_TARGET, resolution: env.RECOVER_RESOLUTION, appliedCount: applied.length, failed }, null, 2));

  if (!evalR.ok) {
    console.error("✗ HARD STOP — refusing `prisma migrate resolve`:\n" + evalR.errors.map((e) => `  - ${e}`).join("\n"));
    await systemDb.$disconnect();
    process.exit(1);
  }
  console.log(`✓ Preflight passed — "${env.RECOVER_TARGET}" is in a failed state; will mark it rolled back so the next migrate deploy re-applies it.`);
  await systemDb.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error("✗ Recovery preflight failed:", (e as Error)?.name ?? "unknown"); await systemDb.$disconnect(); process.exit(1); });
