/**
 * CI-only: assert the production migration is safe to run — arming inputs are valid AND the target is
 * the intended production database — WITHOUT ever printing the DATABASE_URL. Chained as the FIRST step
 * of the production-database-migrate workflow; a non-zero exit aborts before any migration runs.
 *
 * Reads (never prints): DATABASE_URL, MIGRATE_ENVIRONMENT, EXPECTED_MIGRATION, MIGRATE_CONFIRMATION,
 * PRODUCTION_DATABASE_HOST_FINGERPRINT (optional). Only a non-sensitive host fingerprint is echoed.
 */
import { validateMigrationInputs, assertProductionTarget } from "./family-activation";
import { systemDb } from "../src/index";

async function main() {
  const env = process.env;
  const inputs = validateMigrationInputs({
    environment: env.MIGRATE_ENVIRONMENT,
    expectedMigration: env.EXPECTED_MIGRATION,
    confirmation: env.MIGRATE_CONFIRMATION,
  });
  const target = assertProductionTarget({
    url: env.DATABASE_URL,
    environment: env.MIGRATE_ENVIRONMENT,
    expectedFingerprint: env.PRODUCTION_DATABASE_HOST_FINGERPRINT || null,
  });
  const errors = [...inputs.errors, ...target.errors];
  if (errors.length) {
    console.error("✗ Refusing to proceed:\n" + errors.map((e) => `  - ${e}`).join("\n"));
    process.exit(1);
  }
  // Read-only connectivity + Tamanor schema markers (never prints connection details).
  try {
    await systemDb.$queryRawUnsafe("SELECT 1");
    const rows = await systemDb.$queryRawUnsafe<{ ok: boolean }[]>(
      `SELECT (to_regclass('public.tenants') IS NOT NULL AND to_regclass('public._prisma_migrations') IS NOT NULL) AS ok`,
    );
    if (rows[0]?.ok !== true) {
      console.error("✗ Target is missing expected Tamanor schema markers (tenants / _prisma_migrations).");
      process.exit(1);
    }
  } catch (e) {
    console.error(`✗ Could not connect to / verify the target database (${(e as Error).name}).`);
    process.exit(1);
  }
  console.log(`✓ Arming inputs valid; production target verified (host fingerprint ${target.fingerprint ?? "n/a"}).`);
  process.exit(0);
}

main().catch((e) => { console.error("✗ Unexpected error:", (e as Error).name); process.exit(1); });
