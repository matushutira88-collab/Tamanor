/**
 * CI-only: POST-migration verification. Re-collects the counts, compares against the pre-migration
 * snapshot, and asserts the reconcile did exactly what it should and nothing else: the accepted
 * migration is recorded applied, zero Family tenants remain on free_trial, the reconciled rows became
 * family_free with cleared trial dates, familyTrialConsumedAt exists and is null for reconciled rows,
 * and Business + all Family domain-data / subscription / Stripe-mapping counts are unchanged.
 * Fails the job (non-zero) on any regression. Never rolls back — a failure is surfaced for an operator.
 */
import { readFileSync } from "node:fs";
import { comparePreservation, EXPECTED_PRODUCTION_MIGRATION, type TenantCounts } from "./family-activation";
import {
  collectTenantCounts, appliedMigrationNames, familyTrialConsumedColumnExists,
  reconciledConsumedNotNullCount, familyFreeWithTrialDatesCount, writeStepSummary, PREFLIGHT_COUNTS_FILE,
} from "./family-activation-counts";

async function main() {
  const pre = JSON.parse(readFileSync(PREFLIGHT_COUNTS_FILE, "utf8")) as TenantCounts;
  const post = await collectTenantCounts();
  const applied = await appliedMigrationNames();

  const failures: string[] = [];
  if (!applied.includes(EXPECTED_PRODUCTION_MIGRATION)) failures.push("expected migration is not recorded as applied");
  if (!(await familyTrialConsumedColumnExists())) failures.push("familyTrialConsumedAt column is missing");
  const consumedNotNull = await reconciledConsumedNotNullCount();
  if (consumedNotNull > 0) failures.push(`familyTrialConsumedAt is non-null on ${consumedNotNull} reconciled family_free tenants`);
  const freeWithTrial = await familyFreeWithTrialDatesCount();
  if (freeWithTrial > 0) failures.push(`${freeWithTrial} family_free tenants still carry trial dates (should be cleared)`);
  const preserve = comparePreservation(pre, post);
  failures.push(...preserve.failures);

  const summary = {
    migrationApplied: applied.includes(EXPECTED_PRODUCTION_MIGRATION),
    zeroFamilyFreeTrial: post.familyFreeTrial === 0,
    reconciledConsumedNull: consumedNotNull === 0,
    reconciledTrialDatesCleared: freeWithTrial === 0,
    preservationOk: preserve.ok,
    pre: { familyFree: pre.familyFree, familyFreeTrial: pre.familyFreeTrial },
    post: { familyFree: post.familyFree, familyFreeTrial: post.familyFreeTrial },
    failures,
  };
  console.log(JSON.stringify(summary, null, 2));
  writeStepSummary("Post-migration verification", summary);

  if (failures.length) {
    console.error("✗ Post-migration verification FAILED:\n" + failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
  console.log("✓ Post-migration verification passed — reconcile correct; Business + domain data preserved.");
  process.exit(0);
}

main().catch((e) => { console.error("✗ Verification failed:", (e as Error).message); process.exit(1); });
