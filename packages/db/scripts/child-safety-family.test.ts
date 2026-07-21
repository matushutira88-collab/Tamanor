/**
 * CS-C1 — Child Safety Family Domain Foundation (local DB, RLS via tamanor_app).
 * Verifies tenant scoping, workspace separation (Business can't touch Family), FamilyRole
 * read/mutate gating, cross-tenant rejection (profile + membership), the guardian≠safe-recipient
 * invariant, soft-archive history preservation, revoked≠active, RLS isolation, and the absence of
 * any prohibited raw-content field in the schema and DTOs. Run: pnpm child-safety-family:test
 */
import { Prisma } from "@prisma/client";
import { systemDb, withTenant } from "../src/index";
import {
  createProtectedProfile, listProtectedProfiles, getProtectedProfile, archiveProtectedProfile,
  createGuardianRelationship, listRelationshipsForProfile, revokeGuardianRelationship,
  isActiveGuardianRelationship, FamilyForbiddenError, FamilyNotFoundError,
} from "../src/child-safety-family";
import {
  WorkspaceKind, FamilyAction, authorizeFamilyAction, familyRoleForMembershipRole, FamilyRole, familyRoleCan,
  CHILD_SAFETY_FORBIDDEN_FIELDS, validateChildSafetyInput, PROTECTED_PROFILE_CREATE_FIELDS,
  AgeBand, GuardianRelationshipType, GuardianAuthorityLevel, SafetyRecipientEligibility, GuardianRelationshipStatus,
  type FamilyActorContext,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throws(fn: () => Promise<unknown>, pred: (e: unknown) => boolean): Promise<boolean> {
  try { await fn(); return false; } catch (e) { return pred(e); }
}

const sfx = `csc1_${process.pid}`;
const fam = (tenantId: string, userId: string, role: string): FamilyActorContext => ({ tenantId, userId, role, workspaceKind: WorkspaceKind.Family });

async function main() {
  // ---- Fixtures: two FAMILY tenants + one BUSINESS tenant, users + memberships -------------------
  const famA = await systemDb.tenant.create({ data: { id: `fa_${sfx}`, name: "FamA", slug: `fa_${sfx}`, workspaceKind: WorkspaceKind.Family } });
  const famB = await systemDb.tenant.create({ data: { id: `fb_${sfx}`, name: "FamB", slug: `fb_${sfx}`, workspaceKind: WorkspaceKind.Family } });
  const biz  = await systemDb.tenant.create({ data: { id: `bz_${sfx}`, name: "Biz",  slug: `bz_${sfx}`, workspaceKind: WorkspaceKind.Business } });
  const uOwner = (await systemDb.user.create({ data: { id: `uo_${sfx}`, email: `uo_${sfx}@t.local` } })).id;
  const uView  = (await systemDb.user.create({ data: { id: `uv_${sfx}`, email: `uv_${sfx}@t.local` } })).id;
  const uB     = (await systemDb.user.create({ data: { id: `ub_${sfx}`, email: `ub_${sfx}@t.local` } })).id;
  const mOwnerA = await systemDb.membership.create({ data: { userId: uOwner, tenantId: famA.id, role: "owner" as never } });
  const mViewA  = await systemDb.membership.create({ data: { userId: uView,  tenantId: famA.id, role: "viewer" as never } });
  const mOwnerB = await systemDb.membership.create({ data: { userId: uOwner, tenantId: famB.id, role: "owner" as never } });
  await systemDb.membership.create({ data: { userId: uB, tenantId: biz.id, role: "owner" as never } });

  const ownerA = fam(famA.id, uOwner, "owner");   // PrimaryGuardian
  const viewerA = fam(famA.id, uView, "viewer");  // FamilyViewer
  const ownerB = fam(famB.id, uOwner, "owner");
  const bizActor: FamilyActorContext = { tenantId: biz.id, userId: uB, role: "owner", workspaceKind: WorkspaceKind.Business };

  // ---- Authorization model (pure) --------------------------------------------------------------
  check("owner→PrimaryGuardian, viewer→FamilyViewer mapping", familyRoleForMembershipRole("owner") === FamilyRole.PrimaryGuardian && familyRoleForMembershipRole("viewer") === FamilyRole.FamilyViewer);
  check("guardian role may MANAGE, viewer may only VIEW", familyRoleCan(FamilyRole.PrimaryGuardian, FamilyAction.ProtectedProfileManage) && !familyRoleCan(FamilyRole.FamilyViewer, FamilyAction.ProtectedProfileManage) && familyRoleCan(FamilyRole.FamilyViewer, FamilyAction.ProtectedProfileView));
  check("Business workspace fails family authorization (not tenant-only)", authorizeFamilyAction(bizActor, FamilyAction.ProtectedProfileView).ok === false);

  // ---- Family create + list; ProtectedProfile is not a User ------------------------------------
  const p1 = await createProtectedProfile(ownerA, { guardianLabel: "Younger child", ageBand: AgeBand.Age10to12 });
  check("Family guardian can CREATE a protected profile", !!p1.id && p1.ageBand === AgeBand.Age10to12 && p1.protectionStatus === "inactive");
  check("ProtectedProfile does NOT require a User (no userId link)", !("userId" in (p1 as Record<string, unknown>)));
  const listA = await listProtectedProfiles(ownerA);
  check("Family guardian can LIST its own profiles", listA.some((p) => p.id === p1.id));

  // ---- Business cannot create or read Family records -------------------------------------------
  check("Business workspace CANNOT create a family record", await throws(() => createProtectedProfile(bizActor, { ageBand: AgeBand.Age13to15 }), (e) => e instanceof FamilyForbiddenError && (e as FamilyForbiddenError).reason === "not_family_workspace"));
  check("Business workspace CANNOT list family records", await throws(() => listProtectedProfiles(bizActor), (e) => e instanceof FamilyForbiddenError));

  // ---- Tenant scoping + cross-tenant rejection -------------------------------------------------
  check("cross-tenant profile access is rejected (famB actor, famA profile)", await throws(() => getProtectedProfile(ownerB, p1.id), (e) => e instanceof FamilyNotFoundError));
  check("profile is tenant-scoped (famB lists none of famA's)", (await listProtectedProfiles(ownerB)).every((p) => p.id !== p1.id));

  // ---- Viewer cannot mutate; guardian can ------------------------------------------------------
  check("read-only Family role CANNOT create", await throws(() => createProtectedProfile(viewerA, { ageBand: AgeBand.Under10 }), (e) => e instanceof FamilyForbiddenError && (e as FamilyForbiddenError).reason === "role_forbidden"));
  check("read-only Family role CAN list (view)", (await listProtectedProfiles(viewerA)).some((p) => p.id === p1.id));

  // ---- GuardianRelationship: same-tenant only, no auto safe-recipient ---------------------------
  const r1 = await createGuardianRelationship(ownerA, { guardianMembershipId: mOwnerA.id, protectedProfileId: p1.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full });
  check("guardian relationship created", !!r1.id && r1.status === GuardianRelationshipStatus.Pending);
  check("guardian relationship does NOT imply safe-recipient eligibility", r1.safeRecipientEligibility === SafetyRecipientEligibility.NotVerified && r1.safeRecipientEligibility !== "eligible");
  check("consent is separate + not auto-granted", r1.consentStatus === "not_requested");
  check("cross-tenant Membership relationship creation is rejected", await throws(() => createGuardianRelationship(ownerA, { guardianMembershipId: mOwnerB.id, protectedProfileId: p1.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full }), (e) => e instanceof FamilyNotFoundError));

  // ---- Revoked ≠ active ------------------------------------------------------------------------
  const revoked = await revokeGuardianRelationship(ownerA, r1.id);
  check("revoked relationship has status=revoked + revokedAt", revoked.status === GuardianRelationshipStatus.Revoked && revoked.revokedAt !== null);
  check("revoked relationship is NOT treated as active", !isActiveGuardianRelationship(revoked));
  check("active list excludes revoked", (await listRelationshipsForProfile(ownerA, p1.id)).every((r) => r.id !== r1.id));
  check("includeInactive list still shows revoked (history)", (await listRelationshipsForProfile(ownerA, p1.id, { includeInactive: true })).some((r) => r.id === r1.id));

  // ---- Archived profile remains historically referencable --------------------------------------
  const archived = await archiveProtectedProfile(ownerA, p1.id);
  check("archived profile has archivedAt set", archived.archivedAt !== null);
  check("archived profile excluded from default list", (await listProtectedProfiles(ownerA)).every((p) => p.id !== p1.id));
  check("archived profile still referencable (includeArchived)", (await listProtectedProfiles(ownerA, { includeArchived: true })).some((p) => p.id === p1.id));
  check("archiving did NOT delete historical relationships", (await listRelationshipsForProfile(ownerA, p1.id, { includeInactive: true })).some((r) => r.id === r1.id));

  // ---- RLS isolation on the fresh local DB (app role) ------------------------------------------
  const seenByB = await withTenant(famB.id, (db) => db.protectedProfile.count({ where: {} }));
  const seenByA = await withTenant(famA.id, (db) => db.protectedProfile.count({ where: {} }));
  check("RLS: famB app-context sees NONE of famA's profiles", seenByB === 0 && seenByA >= 1);
  check("RLS: famB app-context cannot read famA profile by id", (await withTenant(famB.id, (db) => db.protectedProfile.findFirst({ where: { id: p1.id } }))) === null);
  check("RLS: famB app-context sees NONE of famA's relationships", (await withTenant(famB.id, (db) => db.guardianRelationship.count({ where: {} }))) === 0);

  // ---- No prohibited raw-content fields in schema or DTOs ---------------------------------------
  const profileCols = Object.values(Prisma.ProtectedProfileScalarFieldEnum) as string[];
  const relCols = Object.values(Prisma.GuardianRelationshipScalarFieldEnum) as string[];
  const forbidden = new Set(CHILD_SAFETY_FORBIDDEN_FIELDS);
  check("ProtectedProfile schema has NO forbidden field", !profileCols.some((c) => forbidden.has(c)), profileCols.filter((c) => forbidden.has(c)).join(","));
  check("GuardianRelationship schema has NO forbidden field", !relCols.some((c) => forbidden.has(c)), relCols.filter((c) => forbidden.has(c)).join(","));
  check("DTO/VM keys carry no forbidden field", !Object.keys(archived).some((k) => forbidden.has(k)) && !Object.keys(revoked).some((k) => forbidden.has(k)));
  check("input validator rejects a forbidden raw-content field", !validateChildSafetyInput({ ageBand: AgeBand.Under10, message: "hi" }, PROTECTED_PROFILE_CREATE_FIELDS).ok);
  check("input validator rejects an unknown field", !validateChildSafetyInput({ ageBand: AgeBand.Under10, mystery: 1 }, PROTECTED_PROFILE_CREATE_FIELDS).ok);

  // ---- Cleanup (owner role; app role cannot DELETE by design) -----------------------------------
  await systemDb.guardianRelationship.deleteMany({ where: { tenantId: { in: [famA.id, famB.id] } } });
  await systemDb.protectedProfile.deleteMany({ where: { tenantId: { in: [famA.id, famB.id] } } });
  await systemDb.auditLog.deleteMany({ where: { tenantId: { in: [famA.id, famB.id, biz.id] } } });
  await systemDb.membership.deleteMany({ where: { tenantId: { in: [famA.id, famB.id, biz.id] } } });
  await systemDb.user.deleteMany({ where: { id: { in: [uOwner, uView, uB] } } });
  await systemDb.tenant.deleteMany({ where: { id: { in: [famA.id, famB.id, biz.id] } } });

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — CS-C1 Family domain foundation: ${pass} passed, ${fail} failed`);
  await systemDb.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
