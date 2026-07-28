/**
 * GENERIC production migration VERIFY (post-`prisma migrate deploy`). Confirms the database is UP TO DATE (no
 * pending migrations), the `expected_last_migration` is applied, the platform-admin migration
 * `20260824090000_platform_admin_privacy_analytics` is applied, and its schema markers exist. Prints only
 * bounded, non-sensitive facts (never the URL, never user/analytics data). Non-zero exit on any regression.
 *
 * Env (never printed): DATABASE_URL, EXPECTED_LAST_MIGRATION.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appliedMigrationNames, pendingMigrations } from "./family-activation-counts";
import { failedMigrationNames } from "./production-prisma-migrate";
import { systemDb } from "../src/index";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "prisma", "migrations");
const PLATFORM_MIGRATION = "20260824090000_platform_admin_privacy_analytics";

async function main() {
  const expectedLast = process.env.EXPECTED_LAST_MIGRATION || PLATFORM_MIGRATION;
  const onDisk = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const [applied, failed, pending] = await Promise.all([appliedMigrationNames(), failedMigrationNames(), pendingMigrations(onDisk)]);

  // Schema markers proving the platform-admin migration really landed (additive, non-sensitive checks).
  const markers = await systemDb.$queryRawUnsafe<Array<{ has_audit: boolean; has_col: boolean; has_owner: boolean; has_events: boolean }>>(
    `SELECT to_regclass('public.platform_admin_audit_events') IS NOT NULL AS has_audit,
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='platformAccessRevokedAt') AS has_col,
            EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='PlatformRole' AND e.enumlabel='owner') AS has_owner,
            to_regclass('public.website_analytics_events') IS NOT NULL AS has_events`,
  );
  const m = markers[0];

  const upToDate = pending.length === 0 && failed.length === 0;
  const expectedApplied = applied.includes(expectedLast);
  const platformApplied = applied.includes(PLATFORM_MIGRATION);
  const schemaOk = m?.has_audit === true && m?.has_col === true && m?.has_owner === true && m?.has_events === true;
  const ok = upToDate && expectedApplied && platformApplied && schemaOk;

  console.log(JSON.stringify({
    upToDate, pending, failed, expectedLast, expectedApplied,
    platformMigrationApplied: platformApplied,
    schema: { platform_admin_audit_events: m?.has_audit ?? false, users_platformAccessRevokedAt: m?.has_col ?? false, PlatformRole_owner: m?.has_owner ?? false, website_analytics_events: m?.has_events ?? false },
    appliedCount: applied.length,
  }, null, 2));

  if (!ok) {
    console.error("✗ Post-migration verification FAILED — database is not in the expected up-to-date platform-admin state.");
    await systemDb.$disconnect();
    process.exit(1);
  }
  console.log("✓ Database is UP TO DATE; platform-admin migration applied and schema markers present.");
  await systemDb.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error("✗ Verify failed:", (e as Error)?.name ?? "unknown"); await systemDb.$disconnect(); process.exit(1); });
