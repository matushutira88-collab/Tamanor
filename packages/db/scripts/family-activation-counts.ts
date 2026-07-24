/**
 * FAMILY-BILLING ACTIVATION — read-only DB collectors used by the migration workflow scripts and the
 * readiness validator. These are the ONLY DB-touching pieces; all decision logic lives in the pure
 * `family-activation.ts` module. Every query is read-only (counts / information_schema); nothing here
 * mutates, and nothing prints a URL or a secret.
 */
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { systemDb } from "../src/index";
import { EXPECTED_PRODUCTION_MIGRATION, EXPECTED_FAMILY_PLANS, type TenantCounts } from "./family-activation";

const BUSINESS_PLANS = ["free_trial", "starter", "growth", "agency", "enterprise"] as const;

/** Non-sensitive pre-migration count snapshot handed from the preflight step to the verify step. */
export const PREFLIGHT_COUNTS_FILE = join(dirname(fileURLToPath(import.meta.url)), ".preflight-counts.json");

/** The full non-sensitive count snapshot used for the ceiling gate + pre/post preservation compare. */
export async function collectTenantCounts(): Promise<TenantCounts> {
  const fam = (plan: string) => systemDb.tenant.count({ where: { workspaceKind: "family", plan } });
  const [familyFreeTrial, familyFree, familyBasic, familyPlus, familyPremium] = await Promise.all([
    fam("free_trial"), fam("family_free"), fam("family_basic"), fam("family_plus"), fam("family_premium"),
  ]);
  const bizGroups = await systemDb.tenant.groupBy({ by: ["plan"], where: { workspaceKind: "business" }, _count: { _all: true } });
  const businessByPlan: Record<string, number> = {};
  for (const g of bizGroups) businessByPlan[g.plan] = g._count._all;
  const [protectedProfiles, guardianRelationships, familyInvitations, familyMemberships, safetySignals, subscriptions, stripeCustomerMappings] = await Promise.all([
    systemDb.protectedProfile.count(),
    systemDb.guardianRelationship.count(),
    systemDb.familyGuardianInvitation.count(),
    systemDb.membership.count(),
    systemDb.safetySignal.count(),
    systemDb.subscription.count(),
    systemDb.subscription.count({ where: { stripeCustomerId: { not: null } } }),
  ]);
  return {
    familyFreeTrial, familyFree, familyBasic, familyPlus, familyPremium, businessByPlan,
    protectedProfiles, guardianRelationships, familyInvitations, familyMemberships, safetySignals, subscriptions, stripeCustomerMappings,
  };
}

/** Grouped tenant snapshot (workspaceKind × plan × accessState) for the redacted operator summary. */
export async function collectTenantGroups(): Promise<{ workspaceKind: string; plan: string; accessState: string; count: number }[]> {
  const groups = await systemDb.tenant.groupBy({ by: ["workspaceKind", "plan", "accessState"], _count: { _all: true } });
  return groups.map((g) => ({ workspaceKind: g.workspaceKind, plan: g.plan, accessState: g.accessState, count: g._count._all }));
}

/** Names of migrations recorded as applied in Prisma's `_prisma_migrations` table. */
export async function appliedMigrationNames(): Promise<string[]> {
  const rows = await systemDb.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`,
  );
  return rows.map((r) => r.migration_name);
}

/** Whether the additive `familyTrialConsumedAt` column exists on the tenants table. */
export async function familyTrialConsumedColumnExists(): Promise<boolean> {
  const rows = await systemDb.$queryRawUnsafe<{ present: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'familyTrialConsumedAt') AS present`,
  );
  return rows[0]?.present === true;
}

/** Reconciled family_free tenants whose one-time-trial marker is (wrongly) non-null. Should be 0. */
export async function reconciledConsumedNotNullCount(): Promise<number> {
  return systemDb.tenant.count({ where: { workspaceKind: "family", plan: "family_free", familyTrialConsumedAt: { not: null } } });
}

/** family_free tenants that still carry an active trial window (should be 0 after reconcile). */
export async function familyFreeWithTrialDatesCount(): Promise<number> {
  return systemDb.tenant.count({
    where: { workspaceKind: "family", plan: "family_free", OR: [{ trialStartsAt: { not: null } }, { trialEndsAt: { not: null } }] },
  });
}

/** Family workspaces whose plan is NOT one of the four expected Family plans. Should be 0. */
export async function unexpectedFamilyPlanCount(): Promise<number> {
  return systemDb.tenant.count({ where: { workspaceKind: "family", plan: { notIn: [...EXPECTED_FAMILY_PLANS] } } });
}

/** Family workspaces persisted on a Business billing plan. Should be 0. */
export async function familyOnBusinessPlanCount(): Promise<number> {
  return systemDb.tenant.count({ where: { workspaceKind: "family", plan: { in: [...BUSINESS_PLANS] } } });
}

/** The DB half of the readiness facts (read-only). */
export async function collectReadinessDbFacts(): Promise<{
  migrationApplied: boolean;
  familyTrialConsumedColumnExists: boolean;
  zeroFamilyFreeTrial: boolean;
  onlyExpectedFamilyPlans: boolean;
  noFamilyOnBusinessPlan: boolean;
}> {
  const [applied, columnExists, freeTrial, unexpected, familyOnBiz] = await Promise.all([
    appliedMigrationNames(),
    familyTrialConsumedColumnExists(),
    systemDb.tenant.count({ where: { workspaceKind: "family", plan: "free_trial" } }),
    unexpectedFamilyPlanCount(),
    familyOnBusinessPlanCount(),
  ]);
  return {
    migrationApplied: applied.includes(EXPECTED_PRODUCTION_MIGRATION),
    familyTrialConsumedColumnExists: columnExists,
    zeroFamilyFreeTrial: freeTrial === 0,
    onlyExpectedFamilyPlans: unexpected === 0,
    noFamilyOnBusinessPlan: familyOnBiz === 0,
  };
}

/** Compute pending migrations = (dirs on disk) − (applied), sorted. */
export async function pendingMigrations(onDiskDirs: string[]): Promise<string[]> {
  const applied = new Set(await appliedMigrationNames());
  return onDiskDirs.filter((m) => !applied.has(m)).sort();
}

/** Append a fenced JSON block to the GitHub Actions job summary, when running in CI. */
export function writeStepSummary(title: string, obj: unknown): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  try {
    appendFileSync(path, `\n### ${title}\n\n\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`);
  } catch {
    /* summary is best-effort */
  }
}
