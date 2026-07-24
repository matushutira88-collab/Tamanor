/**
 * CI-only: read-only PRE-migration gate. Confirms the accepted migration is the ONLY pending one,
 * collects the required read-only counts, and enforces the operator legacy-tenant ceiling. Writes a
 * redacted summary + persists the pre-counts (non-sensitive) for the post-migration verify step.
 * Hard-stops (non-zero exit) on any unexpected pending migration, an over-ceiling legacy count, or a
 * query failure — so `prisma migrate deploy` never runs on a surprising database.
 */
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePendingMigrations, evaluateLegacyCeiling, DEFAULT_MAX_LEGACY_FAMILY_TENANTS } from "./family-activation";
import { collectTenantCounts, collectTenantGroups, pendingMigrations, writeStepSummary, PREFLIGHT_COUNTS_FILE } from "./family-activation-counts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "prisma", "migrations");

async function main() {
  const rawCeiling = Number(process.env.MAX_LEGACY_FAMILY_TENANTS ?? DEFAULT_MAX_LEGACY_FAMILY_TENANTS);
  const ceiling = Number.isFinite(rawCeiling) && rawCeiling >= 0 ? rawCeiling : DEFAULT_MAX_LEGACY_FAMILY_TENANTS;

  const onDisk = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const pending = await pendingMigrations(onDisk);
  const pendCheck = evaluatePendingMigrations(pending);

  const counts = await collectTenantCounts();
  const ceilingCheck = evaluateLegacyCeiling(counts.familyFreeTrial, ceiling);
  const groups = await collectTenantGroups();

  const summary = {
    pending,
    onlyExpectedPending: pendCheck.ok,
    legacyFamilyFreeTrial: counts.familyFreeTrial,
    ceiling,
    ceilingOk: ceilingCheck.ok,
    familyCounts: { family_free: counts.familyFree, family_basic: counts.familyBasic, family_plus: counts.familyPlus, family_premium: counts.familyPremium },
    businessByPlan: counts.businessByPlan,
    domain: {
      protectedProfiles: counts.protectedProfiles, guardianRelationships: counts.guardianRelationships,
      familyInvitations: counts.familyInvitations, familyMemberships: counts.familyMemberships,
      safetySignals: counts.safetySignals, subscriptions: counts.subscriptions, stripeCustomerMappings: counts.stripeCustomerMappings,
    },
    tenantGroups: groups,
  };
  console.log(JSON.stringify(summary, null, 2));
  writeStepSummary("Pre-migration preflight", summary);
  writeFileSync(PREFLIGHT_COUNTS_FILE, JSON.stringify(counts));

  const hardStops = [pendCheck.reason, ceilingCheck.reason].filter((r): r is string => !!r);
  if (hardStops.length) {
    console.error("✗ HARD STOP — refusing to apply:\n" + hardStops.map((h) => `  - ${h}`).join("\n"));
    process.exit(1);
  }
  console.log("✓ Preflight passed — the accepted migration is the only pending one; legacy count within ceiling.");
  process.exit(0);
}

main().catch((e) => { console.error("✗ Preflight failed:", (e as Error).message); process.exit(1); });
