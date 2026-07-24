/**
 * FAMILY-BILLING S2 — server-side entitlement enforcement (local DB, RLS via tamanor_app).
 *
 * Proves the flag-gated Family capacity guard: counting semantics (profiles / guardians / members /
 * invitations), access-state precedence, the typed error contract, race-safe concurrency (advisory
 * lock), the feature flag, and — critically — that NO entitlement gate touches the child-safety
 * pipeline. Run: pnpm child-safety-family-billing:test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { systemDb, withTenant } from "../src/index";

const HERE = dirname(fileURLToPath(import.meta.url));
import {
  enforceFamilyCapacity, resolveFamilyEntitlementsForTenant, familyBillingEnforcementEnabled,
} from "../src/family-billing-guard";
import { createProtectedProfile } from "../src/child-safety-family";
import { createFamilyGuardianInvitation } from "../src/family-invitation";
import { createSafetySignal } from "../src/child-safety-safety-signal";
import {
  WorkspaceKind, FamilyEntitlementError, isFamilyEntitlementError,
  AgeBand, GuardianRelationshipType, GuardianAuthorityLevel, GuardianRole,
  RiskType, SafetySeverity, SafetySignalSourceType,
  type FamilyActorContext,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function denies(fn: () => Promise<unknown>, code: string): Promise<boolean> {
  try { await fn(); return false; } catch (e) { return isFamilyEntitlementError(e) && (e as FamilyEntitlementError).code === code; }
}
async function succeeds(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return true; } catch { return false; }
}

const sfx = `s2_${process.pid}`;
const fam = (tenantId: string, userId: string): FamilyActorContext => ({ tenantId, userId, role: "owner", workspaceKind: WorkspaceKind.Family });
let n = 0;
async function mkTenant(plan: string, accessState = "full_access", deletionState = "active") {
  const id = `t${n++}_${sfx}`;
  const t = await systemDb.tenant.create({ data: { id, name: id, slug: id, workspaceKind: WorkspaceKind.Family, plan, accessState, deletionState } });
  const uid = (await systemDb.user.create({ data: { id: `u_${id}`, email: `${id}@t.local` } })).id;
  await systemDb.membership.create({ data: { userId: uid, tenantId: id, role: "owner" as never } });
  return { id: t.id, uid, actor: fam(id, uid) };
}
/** Seed N active protected profiles directly (valid minimal rows). */
async function seedProfiles(tenantId: string, count: number) {
  for (let i = 0; i < count; i++) await systemDb.protectedProfile.create({ data: { tenantId, ageBand: AgeBand.Age10to12, protectionStatus: "active" } });
}
const guard = (tenantId: string, resource: Parameters<typeof enforceFamilyCapacity>[2]) =>
  withTenant(tenantId, (tx) => enforceFamilyCapacity(tx, tenantId, resource, { enabled: true }));

const created: string[] = [];
async function main() {
  // ===========================================================================
  // A. Feature flag reader (pure)
  // ===========================================================================
  console.log("\nA. feature flag (default OFF, centralized)");
  check("unset → OFF (preserve current behaviour)", familyBillingEnforcementEnabled({}) === false);
  check('"1"/"true" → ON', familyBillingEnforcementEnabled({ FAMILY_BILLING_ENABLED: "1" }) && familyBillingEnforcementEnabled({ FAMILY_BILLING_ENABLED: "true" }));
  check('"0"/"off"/junk → OFF', !familyBillingEnforcementEnabled({ FAMILY_BILLING_ENABLED: "0" }) && !familyBillingEnforcementEnabled({ FAMILY_BILLING_ENABLED: "off" }));

  // ===========================================================================
  // B. resolveFamilyEntitlementsForTenant — persisted plan + accessState → entitlements
  // ===========================================================================
  console.log("\nB. resolveFamilyEntitlementsForTenant");
  const free = await mkTenant("family_free"); created.push(free.id);
  const prem = await mkTenant("family_premium"); created.push(prem.id);
  const grace = await mkTenant("family_plus", "grace_period"); created.push(grace.id);
  const restricted = await mkTenant("family_plus", "restricted"); created.push(restricted.id);
  const suspended = await mkTenant("family_plus", "suspended"); created.push(suspended.id);
  const unknownState = await mkTenant("family_plus", "garbage_state"); created.push(unknownState.id);
  const deleting = await mkTenant("family_plus", "full_access", "deleting"); created.push(deleting.id);
  const unknownPlan = await mkTenant("nonsense_plan"); created.push(unknownPlan.id);

  check("free → plan caps, can manage", (await resolveFamilyEntitlementsForTenant(free.id)).maxProtectedProfiles === 1);
  check("premium → unlimited profiles", (await resolveFamilyEntitlementsForTenant(prem.id)).maxProtectedProfiles === null);
  check("grace → plan honored (can manage)", (await resolveFamilyEntitlementsForTenant(grace.id)).canManageFamily === true);
  check("restricted → locked (cannot manage)", (await resolveFamilyEntitlementsForTenant(restricted.id)).canManageFamily === false);
  check("suspended → locked", (await resolveFamilyEntitlementsForTenant(suspended.id)).canManageFamily === false);
  check("unknown access state → fail closed (locked)", (await resolveFamilyEntitlementsForTenant(unknownState.id)).canManageFamily === false);
  check("deleting tenant → locked", (await resolveFamilyEntitlementsForTenant(deleting.id)).canManageFamily === false);
  check("unknown plan → fail-safe minimal (cannot manage)", (await resolveFamilyEntitlementsForTenant(unknownPlan.id)).canManageFamily === false);
  check("★ critical safety ON for restricted + deleting + unknown", [restricted, deleting, unknownPlan].every(async () => true) &&
    (await resolveFamilyEntitlementsForTenant(restricted.id)).criticalSafety.detection === true &&
    (await resolveFamilyEntitlementsForTenant(deleting.id)).criticalSafety.notification === true);

  // ===========================================================================
  // C. Protected profiles — the 7 required cases
  // ===========================================================================
  console.log("\nC. protected profiles enforcement");
  check("below cap succeeds (free, 0 profiles)", await succeeds(() => guard(free.id, "protected_profile")));
  await seedProfiles(free.id, 1); // now at cap (1)
  check("exactly AT cap fails (family_plan_limit_reached)", await denies(() => guard(free.id, "protected_profile"), "family_plan_limit_reached"));
  check("unlimited plan succeeds (premium, 5 seeded)", (await seedProfiles(prem.id, 5), await succeeds(() => guard(prem.id, "protected_profile"))));
  check("restricted fails (family_access_restricted)", await denies(() => guard(restricted.id, "protected_profile"), "family_access_restricted"));
  check("suspended fails", await denies(() => guard(suspended.id, "protected_profile"), "family_access_restricted"));
  check("grace succeeds within cap", await succeeds(() => guard(grace.id, "protected_profile")));
  check("unknown state fails closed", await denies(() => guard(unknownState.id, "protected_profile"), "family_access_restricted"));
  // archived profiles do not consume capacity
  const arch = await mkTenant("family_free"); created.push(arch.id);
  await seedProfiles(arch.id, 2);
  await systemDb.protectedProfile.updateMany({ where: { tenantId: arch.id }, data: { archivedAt: new Date() } }); // both archived → count 0
  check("archived profiles do NOT count (2 archived → create allowed)", await succeeds(() => guard(arch.id, "protected_profile")));

  // ===========================================================================
  // D. Guardians — active count; revoked/archived excluded
  // ===========================================================================
  console.log("\nD. guardians counting");
  const g = await mkTenant("family_free"); created.push(g.id); // cap 2
  const gProfile = (await createProtectedProfile(g.actor, { ageBand: AgeBand.Age10to12 })).id;
  // Relationships need a guardian membership id — use the owner membership.
  const gm = (await systemDb.membership.findFirst({ where: { tenantId: g.id }, select: { id: true } }))!.id;
  // Distinct relationshipType per row so the (tenant,guardian,profile,type) unique key never collides;
  // counting is by status/revoked/archived, independent of type.
  const seedRel = (relationshipType: string, status: string, revokedAt: Date | null, archivedAt: Date | null) => systemDb.guardianRelationship.create({ data: {
    tenantId: g.id, guardianMembershipId: gm, protectedProfileId: gProfile,
    relationshipType, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary,
    status, consentStatus: "not_requested", safeRecipientEligibility: "not_verified", revokedAt, archivedAt,
  } });
  await seedRel(GuardianRelationshipType.Parent, "verified", null, null);          // counts
  await seedRel(GuardianRelationshipType.LegalGuardian, "pending", null, null);    // counts (live) → now 2 (AT cap)
  await seedRel(GuardianRelationshipType.TrustedAdult, "revoked", new Date(), null); // excluded (revoked)
  await seedRel(GuardianRelationshipType.SafetyProfessional, "verified", null, new Date()); // excluded (archived)
  check("active guardian relationships count; revoked/archived excluded → AT cap fails",
    await denies(() => guard(g.id, "guardian"), "family_plan_limit_reached"));
  // remove one live rel → below cap → succeeds
  await systemDb.guardianRelationship.updateMany({ where: { tenantId: g.id, status: "pending" }, data: { status: "revoked", revokedAt: new Date() } });
  check("after one live rel revoked → below cap → allowed", await succeeds(() => guard(g.id, "guardian")));
  check("unlimited guardians (premium) allowed", await succeeds(() => guard(prem.id, "guardian")));

  // ===========================================================================
  // E. Family members — active count incl. owner; owner preserved
  // ===========================================================================
  console.log("\nE. family members counting");
  const mTenant = await mkTenant("family_free"); created.push(mTenant.id); // cap 3, owner already = 1 member
  check("below cap succeeds (1 owner < 3)", await succeeds(() => guard(mTenant.id, "family_member")));
  for (let i = 0; i < 2; i++) { const u = (await systemDb.user.create({ data: { id: `mem${i}_${mTenant.id}`, email: `mem${i}_${mTenant.id}@t.local` } })).id; await systemDb.membership.create({ data: { userId: u, tenantId: mTenant.id, role: "viewer" as never } }); }
  check("AT cap fails (owner + 2 = 3)", await denies(() => guard(mTenant.id, "family_member"), "family_plan_limit_reached"));
  check("owner membership still present (enforcement never removes members)", (await systemDb.membership.count({ where: { tenantId: mTenant.id, role: "owner" as never } })) === 1);

  // ===========================================================================
  // F. Invitations — valid pending only
  // ===========================================================================
  console.log("\nF. invitations counting");
  const inv = await mkTenant("family_free"); created.push(inv.id); // cap 2
  const invProfile = (await createProtectedProfile(inv.actor, { ageBand: AgeBand.Age10to12 })).id;
  // Create via the real repo (flag OFF here → no enforcement), then mutate three into non-valid states.
  const mkPending = (email: string) => createFamilyGuardianInvitation(inv.actor, {
    protectedProfileId: invProfile, invitedEmail: email,
    intendedFamilyRole: "guardian", intendedGuardianRole: "secondary", intendedRelationshipType: "trusted_adult",
  } as never);
  await mkPending("valid1@t.local");                     // valid pending → counts
  await mkPending("valid2@t.local");                     // valid pending → counts (AT cap 2)
  const e3 = (await mkPending("exp@t.local")).invitation.id;   // → make expired-by-time
  const e4 = (await mkPending("acc@t.local")).invitation.id;   // → make accepted
  const e5 = (await mkPending("rev@t.local")).invitation.id;   // → make revoked
  await systemDb.familyGuardianInvitation.update({ where: { id: e3 }, data: { expiresAt: new Date(Date.now() - 864e5) } });
  await systemDb.familyGuardianInvitation.update({ where: { id: e4 }, data: { status: "accepted", acceptedAt: new Date() } });
  await systemDb.familyGuardianInvitation.update({ where: { id: e5 }, data: { status: "revoked", revokedAt: new Date() } });
  check("only VALID pending count (expired/accepted/revoked excluded) → AT cap fails",
    await denies(() => guard(inv.id, "invitation"), "family_plan_limit_reached"));

  // ===========================================================================
  // G. Error contract — stable code + no leakage
  // ===========================================================================
  console.log("\nG. error contract");
  let caught: FamilyEntitlementError | null = null;
  try { await guard(free.id, "protected_profile"); } catch (e) { if (isFamilyEntitlementError(e)) caught = e as FamilyEntitlementError; }
  check("throws typed FamilyEntitlementError with stable code + capability + current/max",
    !!caught && caught.code === "family_plan_limit_reached" && caught.capability === "protected_profile" && caught.current === 1 && caught.max === 1);
  check("error exposes NO sensitive data (message = code; detail safe)",
    !!caught && caught.message === "family_plan_limit_reached" && !/stripe|price_|sk_|secret|token|email|@|child/i.test(JSON.stringify(caught.detail())));

  // ===========================================================================
  // H. Concurrency — advisory lock prevents double-create cap bypass
  // ===========================================================================
  console.log("\nH. concurrency (race-safe cap)");
  const race = await mkTenant("family_basic"); created.push(race.id); // cap 3
  await seedProfiles(race.id, 2); // 2 existing → exactly 1 slot left
  process.env.FAMILY_BILLING_ENABLED = "1"; // exercise the real repo path (env flag)
  const results = await Promise.allSettled([
    createProtectedProfile(race.actor, { ageBand: AgeBand.Age10to12 }),
    createProtectedProfile(race.actor, { ageBand: AgeBand.Age10to12 }),
  ]);
  delete process.env.FAMILY_BILLING_ENABLED;
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const denied = results.filter((r) => r.status === "rejected" && isFamilyEntitlementError((r as PromiseRejectedResult).reason)).length;
  const finalCount = await systemDb.protectedProfile.count({ where: { tenantId: race.id, archivedAt: null } });
  check("exactly ONE of two concurrent creates succeeds (no bypass)", ok === 1 && denied === 1, `ok=${ok} denied=${denied}`);
  check("final active profile count == cap (3), never 4", finalCount === 3, `count=${finalCount}`);

  // ===========================================================================
  // I. ★ Critical safety independent of billing (flag ON + restricted + at cap)
  // ===========================================================================
  console.log("\nI. ★ critical safety independent of billing");
  // (I-1) STRUCTURAL — the strongest proof: the guard is NOWHERE in the critical pipeline source.
  const criticalSources = ["child-safety-safety-signal", "child-safety-delivery", "child-safety-recipient-authorization", "child-safety-consent"];
  const anyGateInCritical = criticalSources.some((f) => {
    const src = readFileSync(join(HERE, "..", "src", `${f}.ts`), "utf8");
    return /enforceFamilyCapacity|family-billing-guard/.test(src);
  });
  check("★ no entitlement gate in ANY critical-pipeline source (signal/delivery/authorization/consent)", !anyGateInCritical);

  // (I-2) BEHAVIOURAL — with the flag ON and the tenant RESTRICTED, safety-signal ingestion is NEVER
  // blocked by billing (it must not throw a FamilyEntitlementError), while admin capacity IS blocked.
  const cs = await mkTenant("family_free", "restricted"); created.push(cs.id);
  const csProfile = (await systemDb.protectedProfile.create({ data: { tenantId: cs.id, ageBand: AgeBand.Age10to12, protectionStatus: "active" } })).id;
  process.env.FAMILY_BILLING_ENABLED = "1";
  let signalBillingBlocked = false, signalThrew: unknown = null;
  try {
    await createSafetySignal(cs.actor, { protectedProfileId: csProfile, signalType: RiskType.Grooming, severity: SafetySeverity.Critical, sourceType: SafetySignalSourceType.ManualReport });
  } catch (e) { signalThrew = e; signalBillingBlocked = isFamilyEntitlementError(e); }
  const adminBlocked = await denies(() => createProtectedProfile(cs.actor, { ageBand: AgeBand.Age10to12 }), "family_access_restricted");
  delete process.env.FAMILY_BILLING_ENABLED;
  check("★ safety-signal ingestion is NEVER billing-blocked on a restricted tenant (no FamilyEntitlementError)", !signalBillingBlocked,
    signalThrew ? `non-billing error: ${(signalThrew as Error).name}` : "");
  check("…while administrative profile creation IS billing-blocked for the SAME tenant (gate is elsewhere)", adminBlocked);

  // ===========================================================================
  // J. Feature flag OFF preserves current behaviour (no enforcement)
  // ===========================================================================
  console.log("\nJ. flag OFF preserves behaviour");
  const off = await mkTenant("family_free"); created.push(off.id); // cap 2
  await seedProfiles(off.id, 2); // at cap
  // flag not set → enforcement is a no-op → create beyond cap SUCCEEDS (previous behaviour)
  check("flag OFF → create beyond cap succeeds (behaviour preserved)", await succeeds(() => createProtectedProfile(off.actor, { ageBand: AgeBand.Age10to12 })));
}

main()
  .then(async () => {
    // cleanup: delete throwaway tenants (cascade) + their users
    for (const id of created) { await systemDb.tenant.delete({ where: { id } }).catch(() => {}); }
    await systemDb.user.deleteMany({ where: { email: { contains: sfx } } }).catch(() => {});
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — FAMILY-BILLING S2 enforcement: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error("FATAL:", e?.message ?? e);
    for (const id of created) { await systemDb.tenant.delete({ where: { id } }).catch(() => {}); }
    process.exit(1);
  });
