/**
 * Recovery VERIFY (post-`prisma migrate resolve --rolled-back`). Confirms the target is no longer blocking-failed
 * and is now PENDING (ready for `prisma migrate deploy` to re-apply), is NOT applied, and that no other failed
 * migration remains. Prints only migration names. Non-zero exit on any regression. This step does NOT deploy —
 * re-run the production-prisma-migrate workflow to apply the backlog.
 *
 * Env (never printed): DATABASE_URL, RECOVER_TARGET.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appliedMigrationNames, pendingMigrations } from "./family-activation-counts";
import { failedMigrationNames } from "./production-prisma-migrate";
import { evaluateRecoveryResult } from "./production-prisma-migrate-recover";
import { systemDb } from "../src/index";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "prisma", "migrations");

async function main() {
  const targetMigration = process.env.RECOVER_TARGET;
  if (!targetMigration) { console.error("✗ RECOVER_TARGET is not set — cannot verify."); process.exit(1); }

  const onDisk = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const [applied, failed, pending] = await Promise.all([appliedMigrationNames(), failedMigrationNames(), pendingMigrations(onDisk)]);

  const evalR = evaluateRecoveryResult({ failed, applied, pending, targetMigration });
  console.log(JSON.stringify({
    targetMigration,
    stillFailed: failed.includes(targetMigration),
    isPending: pending.includes(targetMigration),
    otherFailed: failed.filter((f) => f !== targetMigration),
    pendingCount: pending.length,
  }, null, 2));

  if (!evalR.ok) {
    console.error("✗ Recovery verification FAILED:\n" + evalR.errors.map((e) => `  - ${e}`).join("\n"));
    await systemDb.$disconnect();
    process.exit(1);
  }
  console.log(`✓ "${targetMigration}" is recovered — no longer failed and now pending. Re-run production-prisma-migrate to apply the backlog.`);
  await systemDb.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error("✗ Recovery verify failed:", (e as Error)?.name ?? "unknown"); await systemDb.$disconnect(); process.exit(1); });
