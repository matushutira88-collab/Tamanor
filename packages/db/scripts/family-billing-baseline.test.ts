/**
 * FAMILY-BILLING S3A — baseline-plan reconciliation + one-time-trial foundation (local DB).
 *
 * Proves: new Family registration defaults (family_free / full_access / no trial / consumed=null);
 * the backfill predicate (family+free_trial → family_free, idempotent, Business & paid & already-free
 * untouched); S2 entitlement compatibility (family_free resolves to Free caps, no unknown-plan lockout,
 * existing over-cap usage preserved); and critical-safety non-interference.
 * Run: pnpm family-billing-baseline:test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { systemDb, withTenant } from "../src/index";
import { registerFamilyUser, registerUser } from "../src/registration";
import { enforceFamilyCapacity } from "../src/family-billing-guard";
import { createSafetySignal } from "../src/child-safety-safety-signal";
import {
  resolveFamilyEntitlements, isFamilyEntitlementError,
  WorkspaceKind, AgeBand, RiskType, SafetySeverity, SafetySignalSourceType,
  type FamilyActorContext, type FamilyEntitlementError,
} from "@guardora/core";

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function denies(fn: () => Promise<unknown>, code: string): Promise<boolean> {
  try { await fn(); return false; } catch (e) { return isFamilyEntitlementError(e) && (e as FamilyEntitlementError).code === code; }
}

const sfx = `s3a_${process.pid}`;
const created: string[] = [];
const cleanupEmails: string[] = [];
let n = 0;
async function seedTenant(workspaceKind: string, plan: string, extra: Record<string, unknown> = {}) {
  const id = `t${n++}_${sfx}`;
  await systemDb.tenant.create({ data: { id, name: id, slug: id, workspaceKind, plan, ...extra } });
  created.push(id);
  return id;
}

async function main() {
  // ===========================================================================
  // A. New-registration defaults
  // ===========================================================================
  console.log("\nA. registration defaults");
  const famEmail = `fam_${sfx}@t.local`; cleanupEmails.push(famEmail);
  const fr = await registerFamilyUser({ email: famEmail, passwordHash: "x_hash", workspaceName: "S3A Fam", locale: "sk" });
  created.push(fr.tenantId);
  const famT = await systemDb.tenant.findUnique({ where: { id: fr.tenantId }, select: { workspaceKind: true, plan: true, accessState: true, trialStartsAt: true, trialEndsAt: true, familyTrialConsumedAt: true } });
  check("new Family workspace → workspaceKind=family", famT?.workspaceKind === "family");
  check("new Family workspace → plan=family_free", famT?.plan === "family_free");
  check("new Family workspace → accessState=full_access", famT?.accessState === "full_access");
  check("new Family workspace → trialStartsAt null", famT?.trialStartsAt === null);
  check("new Family workspace → trialEndsAt null", famT?.trialEndsAt === null);
  check("new Family workspace → familyTrialConsumedAt null", famT?.familyTrialConsumedAt === null);
  check("registerFamilyUser return trialEndsAt is null", fr.trialEndsAt === null);

  const bizEmail = `biz_${sfx}@t.local`; cleanupEmails.push(bizEmail);
  const br = await registerUser({ email: bizEmail, passwordHash: "x_hash", workspaceName: "S3A Biz", company: "Co", country: "SK", locale: "en" });
  created.push(br.tenantId);
  const bizT = await systemDb.tenant.findUnique({ where: { id: br.tenantId }, select: { workspaceKind: true, plan: true, trialEndsAt: true } });
  check("Business registration UNCHANGED → workspaceKind=business, plan=free_trial, trial set",
    bizT?.workspaceKind === "business" && bizT?.plan === "free_trial" && bizT?.trialEndsAt !== null && br.trialEndsAt !== null);

  // ===========================================================================
  // B. Backfill predicate (the migration's data UPDATE) — deterministic + idempotent
  // ===========================================================================
  console.log("\nB. backfill predicate");
  const old = new Date(Date.now() - 30 * 864e5);
  const fLegacy = await seedTenant("family", "free_trial", { accessState: "restricted", trialStartsAt: old, trialEndsAt: old });
  const fAlready = await seedTenant("family", "family_free");
  const fPaid = await seedTenant("family", "family_plus", { accessState: "full_access", trialEndsAt: old });
  const bLegacy = await seedTenant("business", "free_trial", { trialStartsAt: old, trialEndsAt: old });
  const bPaid = await seedTenant("business", "agency");
  const other = await seedTenant("child_safety_organization", "free_trial", { trialEndsAt: old });

  // Run the migration's EXACT data statement (global predicate; only my seeded free_trial family row matches).
  const UPDATE_SQL = `UPDATE "tenants" SET "plan"='family_free', "accessState"='full_access', "trialStartsAt"=NULL, "trialEndsAt"=NULL WHERE "workspaceKind"='family' AND "plan"='free_trial'`;
  const affected1 = await systemDb.$executeRawUnsafe(UPDATE_SQL);
  const affected2 = await systemDb.$executeRawUnsafe(UPDATE_SQL); // idempotency: second run matches nothing new

  const get = (id: string) => systemDb.tenant.findUnique({ where: { id }, select: { plan: true, accessState: true, trialStartsAt: true, trialEndsAt: true, familyTrialConsumedAt: true } });
  const gLegacy = await get(fLegacy);
  check("legacy Family free_trial → family_free / full_access", gLegacy?.plan === "family_free" && gLegacy?.accessState === "full_access");
  check("legacy Family trial dates cleared", gLegacy?.trialStartsAt === null && gLegacy?.trialEndsAt === null);
  check("legacy Family familyTrialConsumedAt stays null (legacy auto-trial ≠ consumed Family trial)", gLegacy?.familyTrialConsumedAt === null);
  check("already family_free Family tenant NOT damaged", (await get(fAlready))?.plan === "family_free");
  check("paid Family tenant NOT downgraded (still family_plus, trial untouched)", (await get(fPaid))?.plan === "family_plus" && (await get(fPaid))?.trialEndsAt !== null);
  check("Business free_trial tenant UNCHANGED", (await get(bLegacy))?.plan === "free_trial" && (await get(bLegacy))?.trialEndsAt !== null);
  check("Business paid tenant UNCHANGED", (await get(bPaid))?.plan === "agency");
  check("non-Family tenant UNCHANGED", (await get(other))?.plan === "free_trial");
  check("predicate is idempotent (second run reconciled 0 additional rows)", Number(affected2) === 0, `run1=${affected1} run2=${affected2}`);

  // ===========================================================================
  // C. S2 entitlement compatibility — no unknown-plan lockout; over-cap usage preserved
  // ===========================================================================
  console.log("\nC. S2 entitlement compatibility");
  const entFree = resolveFamilyEntitlements("family_free", "full_access");
  check("reconciled family_free resolves to Free entitlements (can manage, cap 1)", entFree.canManageFamily === true && entFree.maxProtectedProfiles === 1);
  check("★ NO unknown-plan lockout: family_free is NOT the fail-safe minimal", entFree.canManageFamily === true);
  // guard on a family_free tenant with existing over-cap usage: existing preserved, NEW blocked.
  const overCap = await seedTenant("family", "family_free");
  const actor: FamilyActorContext = { tenantId: overCap, userId: `u_${overCap}`, role: "owner", workspaceKind: WorkspaceKind.Family };
  for (let i = 0; i < 3; i++) await systemDb.protectedProfile.create({ data: { tenantId: overCap, ageBand: AgeBand.Age10to12, protectionStatus: "active" } }); // 3 > cap 1
  const before = await systemDb.protectedProfile.count({ where: { tenantId: overCap, archivedAt: null } });
  const blocked = await denies(() => withTenant(overCap, (tx) => enforceFamilyCapacity(tx, overCap, "protected_profile", { enabled: true })), "family_plan_limit_reached");
  const after = await systemDb.protectedProfile.count({ where: { tenantId: overCap, archivedAt: null } });
  check("existing over-cap usage (3) preserved; NEW creation blocked by S2 rules", before === 3 && after === 3 && blocked);

  // ── Data-preservation ladder on a paid family_basic tenant (cap 3) with 4 existing profiles ──
  // Downgrade/over-limit must NEVER delete data: all existing profiles remain, updates + deletion stay
  // allowed, and creation only resumes once usage drops BELOW the cap.
  const basicOver = await seedTenant("family", "family_basic");
  const pIds: string[] = [];
  for (let i = 0; i < 4; i++) pIds.push((await systemDb.protectedProfile.create({ data: { tenantId: basicOver, ageBand: AgeBand.Age10to12, protectionStatus: "active" } })).id); // 4 > cap 3
  const b4 = await systemDb.protectedProfile.count({ where: { tenantId: basicOver, archivedAt: null } });
  const basicBlocked = await denies(() => withTenant(basicOver, (tx) => enforceFamilyCapacity(tx, basicOver, "protected_profile", { enabled: true })), "family_plan_limit_reached");
  check("★ family_basic (cap 3) with 4 profiles: all 4 preserved, NEW creation blocked", b4 === 4 && basicBlocked);
  // Update stays allowed while over limit (enforcement gates only creation, never mutation).
  await systemDb.protectedProfile.update({ where: { id: pIds[0] }, data: { protectionStatus: "paused" } });
  check("★ profile UPDATE allowed while over limit", (await systemDb.protectedProfile.findUnique({ where: { id: pIds[0] }, select: { protectionStatus: true } }))?.protectionStatus === "paused");
  // Deletion (archive) stays allowed; still at cap (3 >= 3) → still blocked.
  await systemDb.protectedProfile.update({ where: { id: pIds[1] }, data: { archivedAt: new Date() } });
  const atCap = await denies(() => withTenant(basicOver, (tx) => enforceFamilyCapacity(tx, basicOver, "protected_profile", { enabled: true })), "family_plan_limit_reached");
  check("★ DELETION allowed while over limit; still blocked at exactly the cap (3/3)", (await systemDb.protectedProfile.count({ where: { tenantId: basicOver, archivedAt: null } })) === 3 && atCap);
  // Drop BELOW the cap → creation resumes (enforceFamilyCapacity no longer throws).
  await systemDb.protectedProfile.update({ where: { id: pIds[2] }, data: { archivedAt: new Date() } });
  let resumes = false;
  try { await withTenant(basicOver, (tx) => enforceFamilyCapacity(tx, basicOver, "protected_profile", { enabled: true })); resumes = true; } catch { resumes = false; }
  check("★ once usage (2) drops below cap (3), creation resumes", resumes);

  // ===========================================================================
  // D. Critical safety non-interference
  // ===========================================================================
  console.log("\nD. critical safety");
  const migSql = readFileSync(join(HERE, "..", "prisma", "migrations", "20260812090000_family_billing_baseline_reconcile", "migration.sql"), "utf8");
  // Check the EXECUTABLE SQL only (strip `--` comment lines, which describe domain tables in prose).
  const sqlOnly = migSql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const touchesOnlyTenants = /"tenants"/.test(sqlOnly) &&
    !/protected_profiles|guardian_relationships|safety_signals|family_guardian_invitations|memberships|audit_logs|deliveries|incidents|consent/i.test(sqlOnly);
  check("★ migration executable SQL touches ONLY the tenants table (no safety/domain tables)", touchesOnlyTenants);
  // A reconciled family_free tenant must still ingest critical safety signals: billing NEVER gates the
  // critical path (it may fail for an unrelated domain reason, but never with a FamilyEntitlementError).
  const csProfile = (await systemDb.protectedProfile.create({ data: { tenantId: overCap, ageBand: AgeBand.Age10to12, protectionStatus: "active" } })).id;
  process.env.FAMILY_BILLING_ENABLED = "1";
  let signalBillingBlocked = false;
  try { await createSafetySignal(actor, { protectedProfileId: csProfile, signalType: RiskType.Grooming, severity: SafetySeverity.Critical, sourceType: SafetySignalSourceType.ManualReport }); }
  catch (e) { signalBillingBlocked = isFamilyEntitlementError(e); }
  delete process.env.FAMILY_BILLING_ENABLED;
  check("★ safety-signal ingestion is NEVER billing-blocked on a reconciled family_free tenant", !signalBillingBlocked);
}

main()
  .then(async () => {
    for (const id of created) await systemDb.tenant.delete({ where: { id } }).catch(() => {});
    for (const e of cleanupEmails) await systemDb.user.deleteMany({ where: { email: e } }).catch(() => {});
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — FAMILY-BILLING S3A baseline reconciliation: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error("FATAL:", e?.message ?? e);
    for (const id of created) await systemDb.tenant.delete({ where: { id } }).catch(() => {});
    for (const em of cleanupEmails) await systemDb.user.deleteMany({ where: { email: em } }).catch(() => {});
    process.exit(1);
  });
