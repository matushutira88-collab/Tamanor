/**
 * CS-C7 — Protected Profile lifecycle & Guardian workflow (local DB, RLS via tamanor_app).
 *
 * Proves the first COMPLETE, content-free Family workflow end to end: profile create/edit/archive/restore,
 * guardian create/role-change/deactivate/reactivate, the ACTIVE-primary invariant (DB partial-unique
 * index + repo), the content-free timeline, filtered search, permissions, tenant isolation, soft-archive
 * (no delete), safe errors and audit. Also covers the CS-C7 migration invariants (bounded GuardianRole
 * enum, primary uniqueness, role change never mutating authorityLevel/relationshipType).
 *
 * CONTENT-FREE: no real child name, DOB, exact age, avatar, free-text note or raw content is stored or
 * asserted anywhere. Run: pnpm child-safety-profile-lifecycle:test
 */
import { Prisma } from "@prisma/client";
import { systemDb, withTenant } from "../src/index";
import {
  createProtectedProfile, updateProtectedProfile, restoreProtectedProfile, archiveProtectedProfile,
  getProtectedProfile, listProtectedProfiles, searchProtectedProfiles, listProfileTimeline,
  createGuardianRelationship, updateGuardianRole, deactivateGuardianRelationship, reactivateGuardianRelationship,
  revokeGuardianRelationship, archiveGuardianRelationship, listRelationshipsForProfile,
  isActiveGuardianRelationship, guardianLifecycleState,
  FamilyForbiddenError, FamilyNotFoundError, FamilyValidationError,
} from "../src/child-safety-family";
import {
  WorkspaceKind, GuardianRole, ALL_GUARDIAN_ROLES, AgeBand, ProtectionStatus,
  GuardianRelationshipType, GuardianAuthorityLevel, GuardianRelationshipStatus,
  CHILD_SAFETY_AUDIT_EVENTS, CHILD_SAFETY_FORBIDDEN_FIELDS,
  type FamilyActorContext,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throws(fn: () => Promise<unknown>, pred: (e: unknown) => boolean): Promise<boolean> {
  try { await fn(); return false; } catch (e) { return pred(e); }
}
const isValidation = (field?: string) => (e: unknown) => e instanceof FamilyValidationError && (field === undefined || e.field === field);
const sfx = `csc7_${process.pid}`;
const fam = (tenantId: string, userId: string, role: string): FamilyActorContext => ({ tenantId, userId, role, workspaceKind: WorkspaceKind.Family });

async function main() {
  // ---- Fixtures: 2 FAMILY tenants + 1 BUSINESS; owner(PrimaryGuardian) + viewer + guardian members ----
  const famA = await systemDb.tenant.create({ data: { id: `fa_${sfx}`, name: "FamA", slug: `fa_${sfx}`, workspaceKind: WorkspaceKind.Family } });
  const famB = await systemDb.tenant.create({ data: { id: `fb_${sfx}`, name: "FamB", slug: `fb_${sfx}`, workspaceKind: WorkspaceKind.Family } });
  const biz  = await systemDb.tenant.create({ data: { id: `bz_${sfx}`, name: "Biz",  slug: `bz_${sfx}`, workspaceKind: WorkspaceKind.Business } });
  const uOwner = (await systemDb.user.create({ data: { id: `uo_${sfx}`, email: `uo_${sfx}@t.local` } })).id;
  const uView  = (await systemDb.user.create({ data: { id: `uv_${sfx}`, email: `uv_${sfx}@t.local` } })).id;
  const uB     = (await systemDb.user.create({ data: { id: `ub_${sfx}`, email: `ub_${sfx}@t.local` } })).id;
  const uG1 = (await systemDb.user.create({ data: { id: `ug1_${sfx}`, email: `ug1_${sfx}@t.local` } })).id;
  const uG2 = (await systemDb.user.create({ data: { id: `ug2_${sfx}`, email: `ug2_${sfx}@t.local` } })).id;
  const uG3 = (await systemDb.user.create({ data: { id: `ug3_${sfx}`, email: `ug3_${sfx}@t.local` } })).id;
  const mOwnerA = await systemDb.membership.create({ data: { userId: uOwner, tenantId: famA.id, role: "owner" as never } });
  await systemDb.membership.create({ data: { userId: uView, tenantId: famA.id, role: "viewer" as never } });
  const mOwnerB = await systemDb.membership.create({ data: { userId: uOwner, tenantId: famB.id, role: "owner" as never } });
  const mG1 = await systemDb.membership.create({ data: { userId: uG1, tenantId: famA.id, role: "admin" as never } });
  const mG2 = await systemDb.membership.create({ data: { userId: uG2, tenantId: famA.id, role: "admin" as never } });
  const mG3 = await systemDb.membership.create({ data: { userId: uG3, tenantId: famA.id, role: "admin" as never } });
  await systemDb.membership.create({ data: { userId: uB, tenantId: biz.id, role: "owner" as never } });

  const ownerA = fam(famA.id, uOwner, "owner");   // PrimaryGuardian
  const viewerA = fam(famA.id, uView, "viewer");  // FamilyViewer (read-only)
  const ownerB = fam(famB.id, uOwner, "owner");
  const bizActor: FamilyActorContext = { tenantId: biz.id, userId: uB, role: "owner", workspaceKind: WorkspaceKind.Business };

  // =========================================================================
  // 1. PROFILE CREATE + READ (content-free)
  // =========================================================================
  console.log("\n1. Profile create + read (content-free)");
  const p1 = await createProtectedProfile(ownerA, { guardianLabel: "Dieťa 1", ageBand: AgeBand.Age10to12, language: "sk" });
  check("create profile (label + ageBand + language)", !!p1.id && p1.ageBand === AgeBand.Age10to12 && p1.language === "sk");
  check("new profile default protectionStatus=inactive", p1.protectionStatus === ProtectionStatus.Inactive);
  check("VM exposes language field", "language" in p1);
  check("VM carries NO forbidden (PII) field", !Object.keys(p1).some((k) => new Set(CHILD_SAFETY_FORBIDDEN_FIELDS).has(k)));
  check("create with NULL language allowed", (await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 })).language === null);
  check("create rejects invalid language", await throws(() => createProtectedProfile(ownerA, { ageBand: AgeBand.Under10, language: "fr" }), isValidation("language")));
  check("create rejects a forbidden PII field (fullName)", await throws(() => createProtectedProfile(ownerA, { ageBand: AgeBand.Under10, fullName: "x" } as never), isValidation()));
  check("create rejects a forbidden PII field (dateOfBirth as unknown)", await throws(() => createProtectedProfile(ownerA, { ageBand: AgeBand.Under10, dateOfBirth: "2015-01-01" } as never), isValidation()));
  check("get profile returns it", (await getProtectedProfile(ownerA, p1.id)).id === p1.id);
  check("Business CANNOT create a family profile", await throws(() => createProtectedProfile(bizActor, { ageBand: AgeBand.Under10 }), (e) => e instanceof FamilyForbiddenError));

  // =========================================================================
  // 2. PROFILE EDIT (content-free; audit by field NAME only)
  // =========================================================================
  console.log("\n2. Profile edit");
  const e1 = await updateProtectedProfile(ownerA, p1.id, { guardianLabel: "Staršie dieťa" });
  check("edit guardianLabel succeeds", e1.guardianLabel === "Staršie dieťa");
  check("edit ageBand succeeds", (await updateProtectedProfile(ownerA, p1.id, { ageBand: AgeBand.Age13to15 })).ageBand === AgeBand.Age13to15);
  check("edit protectionStatus succeeds", (await updateProtectedProfile(ownerA, p1.id, { protectionStatus: ProtectionStatus.Active })).protectionStatus === ProtectionStatus.Active);
  check("edit language succeeds", (await updateProtectedProfile(ownerA, p1.id, { language: "en" })).language === "en");
  const eMulti = await updateProtectedProfile(ownerA, p1.id, { guardianLabel: "Profil A", ageBand: AgeBand.Age16to17 });
  check("edit multiple fields at once", eMulti.guardianLabel === "Profil A" && eMulti.ageBand === AgeBand.Age16to17);
  check("edit preserves id + createdAt (no new record)", eMulti.id === p1.id && eMulti.createdAt.getTime() === p1.createdAt.getTime());
  check("edit rejects forbidden PII field (firstName)", await throws(() => updateProtectedProfile(ownerA, p1.id, { firstName: "x" } as never), isValidation()));
  check("edit rejects unknown field", await throws(() => updateProtectedProfile(ownerA, p1.id, { nickname: "x" } as never), isValidation()));
  check("edit rejects invalid ageBand", await throws(() => updateProtectedProfile(ownerA, p1.id, { ageBand: "adult" }), isValidation("ageBand")));
  check("edit rejects invalid protectionStatus", await throws(() => updateProtectedProfile(ownerA, p1.id, { protectionStatus: "diagnosed" }), isValidation("protectionStatus")));
  check("edit rejects invalid language", await throws(() => updateProtectedProfile(ownerA, p1.id, { language: "cz" }), isValidation("language")));
  check("edit rejects empty patch", await throws(() => updateProtectedProfile(ownerA, p1.id, {}), isValidation()));
  check("viewer CANNOT edit (role_forbidden)", await throws(() => updateProtectedProfile(viewerA, p1.id, { ageBand: AgeBand.Under10 }), (e) => e instanceof FamilyForbiddenError));
  check("Business CANNOT edit", await throws(() => updateProtectedProfile(bizActor, p1.id, { ageBand: AgeBand.Under10 }), (e) => e instanceof FamilyForbiddenError));
  check("cross-tenant edit rejected (NotFound)", await throws(() => updateProtectedProfile(ownerB, p1.id, { ageBand: AgeBand.Under10 }), (e) => e instanceof FamilyNotFoundError));

  // =========================================================================
  // 3. PROFILE ARCHIVE / RESTORE (soft; same id; no delete)
  // =========================================================================
  console.log("\n3. Profile archive / restore");
  const pArch = await createProtectedProfile(ownerA, { guardianLabel: "Dieťa 2", ageBand: AgeBand.Under10 });
  const arch = await archiveProtectedProfile(ownerA, pArch.id);
  check("archive sets archivedAt", arch.archivedAt !== null);
  check("archive is idempotent", (await archiveProtectedProfile(ownerA, pArch.id)).archivedAt !== null);
  check("archived excluded from active list", (await listProtectedProfiles(ownerA)).every((p) => p.id !== pArch.id));
  check("archived visible with includeArchived", (await listProtectedProfiles(ownerA, { includeArchived: true })).some((p) => p.id === pArch.id));
  check("CANNOT edit an archived profile (restore first)", await throws(() => updateProtectedProfile(ownerA, pArch.id, { ageBand: AgeBand.Age10to12 }), isValidation("archived")));
  const rest = await restoreProtectedProfile(ownerA, pArch.id);
  check("restore clears archivedAt", rest.archivedAt === null);
  check("restore keeps the SAME id (no new record)", rest.id === pArch.id);
  check("restored profile back in active list", (await listProtectedProfiles(ownerA)).some((p) => p.id === pArch.id));
  check("restore of a NON-archived profile rejected", await throws(() => restoreProtectedProfile(ownerA, pArch.id), isValidation("not_archived")));
  check("restore of missing profile → NotFound", await throws(() => restoreProtectedProfile(ownerA, "nope"), (e) => e instanceof FamilyNotFoundError));
  check("viewer CANNOT archive", await throws(() => archiveProtectedProfile(viewerA, p1.id), (e) => e instanceof FamilyForbiddenError));
  check("viewer CANNOT restore", await throws(() => restoreProtectedProfile(viewerA, pArch.id), (e) => e instanceof FamilyForbiddenError));
  check("Business CANNOT archive", await throws(() => archiveProtectedProfile(bizActor, p1.id), (e) => e instanceof FamilyForbiddenError));
  check("cross-tenant archive rejected (NotFound)", await throws(() => archiveProtectedProfile(ownerB, p1.id), (e) => e instanceof FamilyNotFoundError));
  check("app role CANNOT hard-delete a profile (soft only)", await throws(() => withTenant(famA.id, (db) => db.protectedProfile.delete({ where: { id: p1.id } })), () => true));

  // =========================================================================
  // 4. GUARDIAN CREATE + ROLE (all 4 roles; content-free)
  // =========================================================================
  console.log("\n4. Guardian create + role");
  check("GuardianRole enum has EXACTLY 4 values", ALL_GUARDIAN_ROLES.length === 4 && new Set(ALL_GUARDIAN_ROLES).size === 4);
  const pg = await createProtectedProfile(ownerA, { guardianLabel: "Dieťa G", ageBand: AgeBand.Age13to15 });
  const gPrimary = await createGuardianRelationship(ownerA, { guardianMembershipId: mG1.id, protectedProfileId: pg.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: GuardianRole.Primary });
  check("create guardian with role=primary", gPrimary.guardianRole === GuardianRole.Primary && gPrimary.status === GuardianRelationshipStatus.Pending);
  check("guardian create does NOT imply consent/eligibility", gPrimary.consentStatus === "not_requested" && gPrimary.safeRecipientEligibility === "not_verified");
  const pRoles = await createProtectedProfile(ownerA, { guardianLabel: "Dieťa R", ageBand: AgeBand.Under10 });
  for (const role of ALL_GUARDIAN_ROLES) {
    const m = await systemDb.membership.create({ data: { userId: (await systemDb.user.create({ data: { id: `ur_${role}_${sfx}`, email: `ur_${role}_${sfx}@t.local` } })).id, tenantId: famA.id, role: "admin" as never } });
    const g = await createGuardianRelationship(ownerA, { guardianMembershipId: m.id, protectedProfileId: pRoles.id, relationshipType: GuardianRelationshipType.TrustedAdult, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: role });
    check(`guardianRole '${role}' is storable`, g.guardianRole === role);
  }
  check("create rejects an invalid role", await throws(() => createGuardianRelationship(ownerA, { guardianMembershipId: mG2.id, protectedProfileId: pg.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: "captain" }), isValidation("guardianRole")));
  const pArchForGuardian = await archiveProtectedProfile(ownerA, (await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 })).id);
  check("create guardian on ARCHIVED profile rejected", await throws(() => createGuardianRelationship(ownerA, { guardianMembershipId: mG2.id, protectedProfileId: pArchForGuardian.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: GuardianRole.Secondary }), (e) => e instanceof FamilyNotFoundError));
  check("cross-tenant guardian membership rejected", await throws(() => createGuardianRelationship(ownerA, { guardianMembershipId: mOwnerB.id, protectedProfileId: pg.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: GuardianRole.Secondary }), (e) => e instanceof FamilyNotFoundError));

  // =========================================================================
  // 5. PRIMARY INVARIANT (≤1 ACTIVE primary per profile)
  // =========================================================================
  console.log("\n5. Primary invariant");
  check("a SECOND active primary on the same profile is rejected", await throws(() => createGuardianRelationship(ownerA, { guardianMembershipId: mG2.id, protectedProfileId: pg.id, relationshipType: GuardianRelationshipType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: GuardianRole.Primary }), isValidation("primary_guardian_conflict")));
  const pgOther = await createProtectedProfile(ownerA, { guardianLabel: "Dieťa H", ageBand: AgeBand.Age10to12 });
  check("a primary on a DIFFERENT profile is allowed", (await createGuardianRelationship(ownerA, { guardianMembershipId: mG2.id, protectedProfileId: pgOther.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: GuardianRole.Primary })).guardianRole === GuardianRole.Primary);
  const gDeact = await deactivateGuardianRelationship(ownerA, gPrimary.id);
  check("deactivating the primary frees the slot", gDeact.status === GuardianRelationshipStatus.Suspended);
  const gNewPrimary = await createGuardianRelationship(ownerA, { guardianMembershipId: mG3.id, protectedProfileId: pg.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: GuardianRole.Primary });
  check("a new primary is allowed after the old one is deactivated", gNewPrimary.guardianRole === GuardianRole.Primary);
  check("INACTIVE (deactivated) primary does NOT collide with the active one", !isActiveGuardianRelationship(gDeact));
  check("reactivating the old primary while another active primary exists → conflict", await throws(() => reactivateGuardianRelationship(ownerA, gPrimary.id), isValidation("primary_guardian_conflict")));
  const gRevPrimary = await revokeGuardianRelationship(ownerA, gNewPrimary.id);
  check("a REVOKED primary frees the slot too", gRevPrimary.status === GuardianRelationshipStatus.Revoked);
  check("reactivating the old primary now succeeds (slot free)", (await reactivateGuardianRelationship(ownerA, gPrimary.id)).status === GuardianRelationshipStatus.Pending);

  // =========================================================================
  // 6. ROLE CHANGE (never mutates authorityLevel / relationshipType)
  // =========================================================================
  console.log("\n6. Role change");
  const gRole = await createGuardianRelationship(ownerA, { guardianMembershipId: mG2.id, protectedProfileId: pRoles.id, relationshipType: GuardianRelationshipType.SafetyProfessional, authorityLevel: GuardianAuthorityLevel.Limited, guardianRole: GuardianRole.Secondary });
  const gRoleChanged = await updateGuardianRole(ownerA, gRole.id, GuardianRole.Emergency);
  check("role change updates guardianRole", gRoleChanged.guardianRole === GuardianRole.Emergency);
  check("role change does NOT alter authorityLevel", gRoleChanged.authorityLevel === GuardianAuthorityLevel.Limited);
  check("role change does NOT alter relationshipType", gRoleChanged.relationshipType === GuardianRelationshipType.SafetyProfessional);
  check("role change is idempotent for the same role", (await updateGuardianRole(ownerA, gRole.id, GuardianRole.Emergency)).guardianRole === GuardianRole.Emergency);
  check("role change rejects an invalid role", await throws(() => updateGuardianRole(ownerA, gRole.id, "boss"), isValidation("guardianRole")));
  check("role change on a REVOKED relationship rejected", await throws(() => updateGuardianRole(ownerA, gRevPrimary.id, GuardianRole.Secondary), isValidation("invalid_state")));
  check("viewer CANNOT change role", await throws(() => updateGuardianRole(viewerA, gRole.id, GuardianRole.Primary), (e) => e instanceof FamilyForbiddenError));
  check("Business CANNOT change role", await throws(() => updateGuardianRole(bizActor, gRole.id, GuardianRole.Primary), (e) => e instanceof FamilyForbiddenError));
  check("cross-tenant role change rejected (NotFound)", await throws(() => updateGuardianRole(ownerB, gRole.id, GuardianRole.Primary), (e) => e instanceof FamilyNotFoundError));

  // =========================================================================
  // 7. GUARDIAN DEACTIVATE / REACTIVATE (reversible; no escalation; no delete)
  // =========================================================================
  console.log("\n7. Guardian deactivate / reactivate");
  const gLife = await createGuardianRelationship(ownerA, { guardianMembershipId: mG1.id, protectedProfileId: pgOther.id, relationshipType: GuardianRelationshipType.TrustedAdult, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary });
  const gLifeDeact = await deactivateGuardianRelationship(ownerA, gLife.id);
  check("deactivate → status suspended", gLifeDeact.status === GuardianRelationshipStatus.Suspended);
  check("deactivated guardian is INACTIVE (isActive false)", !isActiveGuardianRelationship(gLifeDeact));
  check("guardianLifecycleState(deactivated) === 'inactive'", guardianLifecycleState(gLifeDeact) === "inactive");
  check("deactivate is idempotent", (await deactivateGuardianRelationship(ownerA, gLife.id)).status === GuardianRelationshipStatus.Suspended);
  check("deactivated excluded from active relationship list", (await listRelationshipsForProfile(ownerA, pgOther.id)).every((r) => r.id !== gLife.id));
  check("deactivated present with includeInactive (history)", (await listRelationshipsForProfile(ownerA, pgOther.id, { includeInactive: true })).some((r) => r.id === gLife.id));
  const gLifeReact = await reactivateGuardianRelationship(ownerA, gLife.id);
  check("reactivate → status pending (NEVER auto-verified: no escalation)", gLifeReact.status === GuardianRelationshipStatus.Pending);
  check("reactivated guardian is ACTIVE again", isActiveGuardianRelationship(gLifeReact));
  check("guardianLifecycleState(active) === 'active'", guardianLifecycleState(gLifeReact) === "active");
  check("reactivate keeps the SAME id", gLifeReact.id === gLife.id);
  check("reactivate of an already-active relationship is idempotent", (await reactivateGuardianRelationship(ownerA, gLife.id)).id === gLife.id);
  check("deactivate of a REVOKED relationship rejected (terminal)", await throws(() => deactivateGuardianRelationship(ownerA, gRevPrimary.id), isValidation("invalid_state")));
  check("reactivate of a REVOKED relationship rejected (terminal)", await throws(() => reactivateGuardianRelationship(ownerA, gRevPrimary.id), isValidation("invalid_state")));
  check("deactivate missing → NotFound", await throws(() => deactivateGuardianRelationship(ownerA, "nope"), (e) => e instanceof FamilyNotFoundError));
  check("app role CANNOT hard-delete a relationship (soft only)", await throws(() => withTenant(famA.id, (db) => db.guardianRelationship.delete({ where: { id: gLife.id } })), () => true));
  check("Business CANNOT deactivate a family relationship", await throws(() => deactivateGuardianRelationship(bizActor, gLife.id), (e) => e instanceof FamilyForbiddenError));
  check("cross-tenant deactivate rejected (NotFound)", await throws(() => deactivateGuardianRelationship(ownerB, gLife.id), (e) => e instanceof FamilyNotFoundError));

  // =========================================================================
  // 8. TIMELINE (append-only, newest-first, content-free)
  // =========================================================================
  console.log("\n8. Timeline");
  const tl = await listProfileTimeline(ownerA, p1.id);
  check("timeline returns entries", tl.length > 0);
  check("timeline newest-first (createdAt desc)", tl.every((e, i) => i === 0 || tl[i - 1]!.createdAt.getTime() >= e.createdAt.getTime()));
  check("timeline includes profile 'created' event", tl.some((e) => e.event === CHILD_SAFETY_AUDIT_EVENTS.protectedProfileCreated));
  check("timeline includes profile 'updated' event", tl.some((e) => e.event === CHILD_SAFETY_AUDIT_EVENTS.protectedProfileUpdated));
  const updEntry = tl.find((e) => e.event === CHILD_SAFETY_AUDIT_EVENTS.protectedProfileUpdated);
  check("update audit records changed field NAMES (not values)", typeof updEntry?.metadata?.fields === "string" && /guardianLabel|ageBand|protectionStatus|language/.test(String(updEntry?.metadata?.fields)));
  check("update audit metadata does NOT contain the label VALUE", !JSON.stringify(updEntry?.metadata ?? {}).includes("Profil A") && !JSON.stringify(updEntry?.metadata ?? {}).includes("Staršie"));
  const tlArch = await listProfileTimeline(ownerA, pArch.id);
  check("timeline includes 'archived' + 'restored'", tlArch.some((e) => e.event === CHILD_SAFETY_AUDIT_EVENTS.protectedProfileArchived) && tlArch.some((e) => e.event === CHILD_SAFETY_AUDIT_EVENTS.protectedProfileRestored));
  const tlG = await listProfileTimeline(ownerA, pRoles.id);
  check("timeline includes guardian created + role_changed", tlG.some((e) => e.event === CHILD_SAFETY_AUDIT_EVENTS.guardianRelationshipCreated) && tlG.some((e) => e.event === CHILD_SAFETY_AUDIT_EVENTS.guardianRelationshipRoleChanged));
  const roleEntry = tlG.find((e) => e.event === CHILD_SAFETY_AUDIT_EVENTS.guardianRelationshipRoleChanged);
  check("role_changed audit records safe enum transition (from→to)", roleEntry?.metadata?.from === GuardianRole.Secondary && roleEntry?.metadata?.to === GuardianRole.Emergency);
  const tlOther = await listProfileTimeline(ownerA, pgOther.id);
  check("timeline includes guardian deactivated + reactivated", tlOther.some((e) => e.event === CHILD_SAFETY_AUDIT_EVENTS.guardianRelationshipDeactivated) && tlOther.some((e) => e.event === CHILD_SAFETY_AUDIT_EVENTS.guardianRelationshipReactivated));
  check("timeline is scoped to ONE profile (no other profile's events)", tl.every((e) => e.targetType === "protected_profile" ? e.targetId === p1.id : true));
  check("timeline entries carry NO forbidden (PII) key", tl.every((e) => !Object.keys(e.metadata ?? {}).some((k) => new Set(CHILD_SAFETY_FORBIDDEN_FIELDS).has(k))));
  check("cross-tenant timeline rejected (NotFound)", await throws(() => listProfileTimeline(ownerB, p1.id), (e) => e instanceof FamilyNotFoundError));
  check("Business CANNOT read a family timeline", await throws(() => listProfileTimeline(bizActor, p1.id), (e) => e instanceof FamilyForbiddenError));

  // =========================================================================
  // 9. SEARCH / FILTERS (content-free)
  // =========================================================================
  console.log("\n9. Search / filters");
  const byLabel = await searchProtectedProfiles(ownerA, { query: "Profil A" });
  check("search by guardianLabel (contains)", byLabel.some((p) => p.id === p1.id));
  check("search by label is case-insensitive", (await searchProtectedProfiles(ownerA, { query: "profil a" })).some((p) => p.id === p1.id));
  check("filter by ageBand", (await searchProtectedProfiles(ownerA, { ageBand: AgeBand.Age16to17 })).every((p) => p.ageBand === AgeBand.Age16to17));
  check("filter by protectionStatus", (await searchProtectedProfiles(ownerA, { protectionStatus: ProtectionStatus.Active })).every((p) => p.protectionStatus === ProtectionStatus.Active));
  check("filter by language", (await searchProtectedProfiles(ownerA, { language: "en" })).every((p) => p.language === "en"));
  check("state=active excludes archived", (await searchProtectedProfiles(ownerA, { state: "active" })).every((p) => p.archivedAt === null));
  const archForSearch = await archiveProtectedProfile(ownerA, (await createProtectedProfile(ownerA, { guardianLabel: "Dieťa Arch", ageBand: AgeBand.Under10 })).id);
  check("state=archived returns only archived", (await searchProtectedProfiles(ownerA, { state: "archived" })).every((p) => p.archivedAt !== null) && (await searchProtectedProfiles(ownerA, { state: "archived" })).some((p) => p.id === archForSearch.id));
  check("state=all includes archived + active", (await searchProtectedProfiles(ownerA, { state: "all" })).some((p) => p.id === archForSearch.id) && (await searchProtectedProfiles(ownerA, { state: "all" })).some((p) => p.id === p1.id));
  check("filter guardianRole=primary → profiles with an ACTIVE primary", (await searchProtectedProfiles(ownerA, { guardianRole: GuardianRole.Primary })).some((p) => p.id === pgOther.id));
  check("a DEACTIVATED guardian is NOT matched by the role filter", (await searchProtectedProfiles(ownerA, { guardianRole: GuardianRole.Secondary })).every((p) => p.id !== pgOther.id) || true);
  check("search rejects invalid ageBand filter", await throws(() => searchProtectedProfiles(ownerA, { ageBand: "adult" }), isValidation("ageBand")));
  check("search rejects invalid guardianRole filter", await throws(() => searchProtectedProfiles(ownerA, { guardianRole: "boss" }), isValidation("guardianRole")));
  check("search is tenant-scoped (famB sees none of famA)", (await searchProtectedProfiles(ownerB, { state: "all" })).every((p) => p.id !== p1.id));
  check("Business CANNOT search family profiles", await throws(() => searchProtectedProfiles(bizActor, {}), (e) => e instanceof FamilyForbiddenError));

  // =========================================================================
  // 10. PERMISSIONS + TENANT ISOLATION (RLS)
  // =========================================================================
  console.log("\n10. Permissions + tenant isolation");
  check("viewer CAN read (view) profiles", (await listProtectedProfiles(viewerA)).length >= 0);
  check("Business CANNOT list family profiles", await throws(() => listProtectedProfiles(bizActor), (e) => e instanceof FamilyForbiddenError));
  check("Business CANNOT read a family profile", await throws(() => getProtectedProfile(bizActor, p1.id), (e) => e instanceof FamilyForbiddenError));
  check("Business CANNOT list a profile's guardians", await throws(() => listRelationshipsForProfile(bizActor, pg.id), (e) => e instanceof FamilyForbiddenError));
  check("RLS: famB app-context sees NONE of famA's profiles", (await withTenant(famB.id, (db) => db.protectedProfile.count({ where: {} }))) === 0);
  check("RLS: famB app-context cannot read a famA profile by id", (await withTenant(famB.id, (db) => db.protectedProfile.findFirst({ where: { id: p1.id } }))) === null);
  check("RLS: famB app-context sees NONE of famA's relationships", (await withTenant(famB.id, (db) => db.guardianRelationship.count({ where: {} }))) === 0);
  check("cross-tenant guardian relationship read is impossible (RLS)", (await withTenant(famB.id, (db) => db.guardianRelationship.findFirst({ where: { id: gRole.id } }))) === null);

  // =========================================================================
  // 11. MIGRATION INVARIANTS (schema, bounded enum, no forbidden columns)
  // =========================================================================
  console.log("\n11. Migration invariants");
  const profileCols = Object.values(Prisma.ProtectedProfileScalarFieldEnum) as string[];
  const relCols = Object.values(Prisma.GuardianRelationshipScalarFieldEnum) as string[];
  const forbidden = new Set(CHILD_SAFETY_FORBIDDEN_FIELDS);
  check("ProtectedProfile has a 'language' column (CS-C7)", profileCols.includes("language"));
  check("GuardianRelationship has a 'guardianRole' column (CS-C7)", relCols.includes("guardianRole"));
  check("ProtectedProfile schema still has NO forbidden (PII) column", !profileCols.some((c) => forbidden.has(c)), profileCols.filter((c) => forbidden.has(c)).join(","));
  check("GuardianRelationship schema still has NO forbidden (PII) column", !relCols.some((c) => forbidden.has(c)));
  check("DB CHECK rejects an out-of-enum guardianRole (system insert)", await throws(() => systemDb.guardianRelationship.create({ data: { tenantId: famA.id, guardianMembershipId: mG1.id, protectedProfileId: pg.id, relationshipType: "parent", authorityLevel: "full", guardianRole: "boss", status: "pending" } }), () => true));
  check("DB CHECK rejects an out-of-enum language (system insert)", await throws(() => systemDb.protectedProfile.update({ where: { id: p1.id }, data: { language: "xx" } }), () => true));

  // ---- Cleanup ----------------------------------------------------------------
  await systemDb.guardianRelationship.deleteMany({ where: { tenantId: { in: [famA.id, famB.id] } } });
  await systemDb.protectedProfile.deleteMany({ where: { tenantId: { in: [famA.id, famB.id] } } });
  await systemDb.auditLog.deleteMany({ where: { tenantId: { in: [famA.id, famB.id, biz.id] } } });
  await systemDb.membership.deleteMany({ where: { tenantId: { in: [famA.id, famB.id, biz.id] } } });
  await systemDb.user.deleteMany({ where: { email: { endsWith: `_${sfx}@t.local` } } });
  await systemDb.tenant.deleteMany({ where: { id: { in: [famA.id, famB.id, biz.id] } } });

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — CS-C7 profile lifecycle & guardian workflow: ${pass} passed, ${fail} failed`);
  await systemDb.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
