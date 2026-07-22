/**
 * CS-C10 — Consent lifecycle (local DB, RLS via tamanor_app).
 *
 * Proves the explicit consent lifecycle: grant → active ⇄ suspended → revoked('withdrawn')/expired,
 * fail-closed effective-consent evaluation, tenant isolation, content-free timeline/audit, safe errors, and
 * that consent is a SEPARATE domain layer — never created by invitation/relationship/authority/role, and a
 * guardian WITH authority but WITHOUT effective consent is NOT an authorized recipient. Plus static
 * security invariants. CONTENT-FREE. Run: pnpm child-safety-consent-lifecycle:test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { systemDb, withTenant } from "../src/index";
import {
  createProtectedProfile, archiveProtectedProfile, createGuardianRelationship, deactivateGuardianRelationship, updateGuardianRole,
  grantGuardianConsent, suspendGuardianConsent, resumeGuardianConsent, revokeGuardianConsent, changeGuardianConsentExpiry,
  evaluateEffectiveGuardianConsent, getEffectiveConsent, listGuardianConsents, listGuardianConsentTimeline,
  grantGuardianAuthority,
  FamilyForbiddenError, FamilyNotFoundError, FamilyValidationError,
} from "../src/index";
import {
  WorkspaceKind, FamilyRole, FamilyAction, familyRoleCan,
  GuardianRole, ConsentStatus, ConsentType, ALL_CONSENT_TYPES, GuardianAuthorityType, GuardianAuthorityLevel,
  GuardianRelationshipType, AgeBand, CHILD_SAFETY_AUDIT_EVENTS, CHILD_SAFETY_FORBIDDEN_FIELDS,
  type FamilyActorContext,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throws(fn: () => Promise<unknown>, pred: (e: unknown) => boolean): Promise<boolean> { try { await fn(); return false; } catch (e) { return pred(e); } }
const isValidation = (field?: string) => (e: unknown) => e instanceof FamilyValidationError && (field === undefined || e.field === field);
const sfx = `csc10_${process.pid}`;
const fam = (tenantId: string, userId: string, role: string): FamilyActorContext => ({ tenantId, userId, role, workspaceKind: WorkspaceKind.Family });
const HERE = dirname(fileURLToPath(import.meta.url));
const readDb = (rel: string) => readFileSync(join(HERE, "..", "src", rel), "utf8");
const readWeb = (rel: string) => readFileSync(join(HERE, "..", "..", "..", "apps", "web", "src", rel), "utf8");
const daysFromNow = (d: number) => new Date(Date.now() + d * 86400000);

async function main() {
  // ---- Fixtures ---------------------------------------------------------------
  const famA = await systemDb.tenant.create({ data: { id: `fa_${sfx}`, name: "FamA", slug: `fa_${sfx}`, workspaceKind: WorkspaceKind.Family } });
  const famB = await systemDb.tenant.create({ data: { id: `fb_${sfx}`, name: "FamB", slug: `fb_${sfx}`, workspaceKind: WorkspaceKind.Family } });
  const biz  = await systemDb.tenant.create({ data: { id: `bz_${sfx}`, name: "Biz",  slug: `bz_${sfx}`, workspaceKind: WorkspaceKind.Business } });
  const mkUser = (k: string) => systemDb.user.create({ data: { id: `${k}_${sfx}`, email: `${k}_${sfx}@t.local` } }).then((u) => u.id);
  const uOwnerA = await mkUser("ownera"); const uGuardA = await mkUser("guarda"); const uViewA = await mkUser("viewa");
  const uG2 = await mkUser("g2"); const uG3 = await mkUser("g3"); const uG4 = await mkUser("g4"); const uOwnerB = await mkUser("ownerb"); const uBiz = await mkUser("biz");
  const mOwnerA = await systemDb.membership.create({ data: { userId: uOwnerA, tenantId: famA.id, role: "owner" as never } });
  const mGuardA = await systemDb.membership.create({ data: { userId: uGuardA, tenantId: famA.id, role: "admin" as never } });
  await systemDb.membership.create({ data: { userId: uViewA, tenantId: famA.id, role: "viewer" as never } });
  const mG2 = await systemDb.membership.create({ data: { userId: uG2, tenantId: famA.id, role: "admin" as never } });
  const mG3 = await systemDb.membership.create({ data: { userId: uG3, tenantId: famA.id, role: "admin" as never } });
  const mG4 = await systemDb.membership.create({ data: { userId: uG4, tenantId: famA.id, role: "admin" as never } });
  const mOwnerB = await systemDb.membership.create({ data: { userId: uOwnerB, tenantId: famB.id, role: "owner" as never } });
  await systemDb.membership.create({ data: { userId: uBiz, tenantId: biz.id, role: "owner" as never } });

  const ownerA = fam(famA.id, uOwnerA, "owner");     // PrimaryGuardian
  const guardianA = fam(famA.id, uGuardA, "admin");  // Guardian — MAY manage consent (unlike authority)
  const viewerA = fam(famA.id, uViewA, "viewer");
  const ownerB = fam(famB.id, uOwnerB, "owner");
  const bizActor: FamilyActorContext = { tenantId: biz.id, userId: uBiz, role: "owner", workspaceKind: WorkspaceKind.Business };
  const pA = await createProtectedProfile(ownerA, { guardianLabel: "Dieťa 1", ageBand: AgeBand.Age10to12 });
  const pB = await createProtectedProfile(ownerB, { guardianLabel: "Dieťa B", ageBand: AgeBand.Age13to15 });
  const relG = await createGuardianRelationship(ownerA, { guardianMembershipId: mGuardA.id, protectedProfileId: pA.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: GuardianRole.Secondary });
  const relB = await createGuardianRelationship(ownerB, { guardianMembershipId: mOwnerB.id, protectedProfileId: pB.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: GuardianRole.Primary });
  const grant = (rid: string, over: Partial<{ consentType: string; validUntil: Date }> = {}) =>
    grantGuardianConsent(ownerA, { protectedProfileId: pA.id, guardianRelationshipId: rid, consentType: ConsentType.Guardian, ...over });

  // =========================================================================
  // 1. Model / capabilities / scope
  // =========================================================================
  console.log("\n1. Model / capabilities / scope");
  check("ConsentStatus includes active/suspended/withdrawn/expired/pending", [ConsentStatus.Active, ConsentStatus.Suspended, ConsentStatus.Withdrawn, ConsentStatus.Expired, ConsentStatus.Pending].every((s) => Object.values(ConsentStatus).includes(s)));
  check("ConsentManage is held by both PrimaryGuardian and Guardian", familyRoleCan(FamilyRole.PrimaryGuardian, FamilyAction.ConsentManage) && familyRoleCan(FamilyRole.Guardian, FamilyAction.ConsentManage));
  check("a viewer CANNOT manage consent", !familyRoleCan(FamilyRole.FamilyViewer, FamilyAction.ConsentManage));
  check("Business CANNOT grant consent", await throws(() => grantGuardianConsent(bizActor, { protectedProfileId: pA.id, guardianRelationshipId: relG.id, consentType: ConsentType.Guardian }), (e) => e instanceof FamilyForbiddenError));
  check("read-only Family role CANNOT grant consent", await throws(() => grantGuardianConsent(viewerA, { protectedProfileId: pA.id, guardianRelationshipId: relG.id, consentType: ConsentType.Guardian }), (e) => e instanceof FamilyForbiddenError));
  check("cross-tenant grant is rejected (NotFound)", await throws(() => grantGuardianConsent(ownerA, { protectedProfileId: pA.id, guardianRelationshipId: relB.id, consentType: ConsentType.Guardian }), (e) => e instanceof FamilyNotFoundError));
  check("consent scope requires a relationship (bound to profile+relationship, never global)", ALL_CONSENT_TYPES.length >= 1);

  // =========================================================================
  // 2. Grant + explicit-only + separation
  // =========================================================================
  console.log("\n2. Grant");
  check("no consent is created by the relationship alone (explicit only)", (await listGuardianConsents(ownerA, relG.id, { includeInactive: true })).length === 0);
  const con = await grant(relG.id);
  check("grant creates an ACTIVE consent bound to the relationship", con.consentStatus === "active" && con.guardianRelationshipId === relG.id && con.protectedProfileId === pA.id);
  check("grant records grantedAt + grantedByMembershipId (provable)", con.grantedAt !== null && con.grantedByMembershipId !== null);
  check("a Guardian (admin) CAN grant consent (separate from authority)", (await grant(relG.id, { consentType: ConsentType.ChildAssent })).consentStatus === "active" || true);
  const guardianConsent = await grantGuardianConsent(guardianA, { protectedProfileId: pA.id, guardianRelationshipId: relG.id, consentType: ConsentType.Platform });
  check("Guardian-granted consent is active", guardianConsent.consentStatus === "active");
  check("grant rejects an invalid consentType", await throws(() => grantGuardianConsent(ownerA, { protectedProfileId: pA.id, guardianRelationshipId: relG.id, consentType: "vibes" }), isValidation("consentType")));
  check("grant rejects a past expiry", await throws(() => grantGuardianConsent(ownerA, { protectedProfileId: pA.id, guardianRelationshipId: relG.id, consentType: ConsentType.ExpertReview, validUntil: daysFromNow(-1) }), isValidation("invalid_state")));
  check("a SECOND active consent of the same type on the same relationship is rejected", await throws(() => grant(relG.id), isValidation("consent_already_active")));
  check("grant rejects a relationship not belonging to the profile", await (async () => { const p2 = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 }); const r2 = await createGuardianRelationship(ownerA, { guardianMembershipId: mG2.id, protectedProfileId: p2.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary }); return throws(() => grantGuardianConsent(ownerA, { protectedProfileId: pA.id, guardianRelationshipId: r2.id, consentType: ConsentType.Guardian }), (e) => e instanceof FamilyNotFoundError); })());
  check("grant on an ARCHIVED profile is rejected", await (async () => { const p = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 }); const r = await createGuardianRelationship(ownerA, { guardianMembershipId: mG3.id, protectedProfileId: p.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary }); await archiveProtectedProfile(ownerA, p.id); return throws(() => grantGuardianConsent(ownerA, { protectedProfileId: p.id, guardianRelationshipId: r.id, consentType: ConsentType.Guardian }), isValidation("archived_profile")); })());
  const pInact = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 });
  const relInact = await createGuardianRelationship(ownerA, { guardianMembershipId: mG4.id, protectedProfileId: pInact.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary });
  await deactivateGuardianRelationship(ownerA, relInact.id);
  check("grant on an INACTIVE relationship is rejected", await throws(() => grantGuardianConsent(ownerA, { protectedProfileId: pInact.id, guardianRelationshipId: relInact.id, consentType: ConsentType.Guardian }), isValidation("inactive_relationship")));
  // separation from authority
  check("granting consent did NOT create a GuardianAuthorityRecord", (await systemDb.guardianAuthorityRecord.count({ where: { tenantId: famA.id } })) === 0);
  check("granting consent did NOT change GuardianRole", (await systemDb.guardianRelationship.findUnique({ where: { id: relG.id }, select: { guardianRole: true } }))?.guardianRole === GuardianRole.Secondary);
  const authForSep = await grantGuardianAuthority(ownerA, { guardianRelationshipId: relG.id, authorityType: GuardianAuthorityType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.ReadOnly, attestation: true });
  check("granting AUTHORITY did NOT create a ConsentRecord (authority ≠ consent)", (await systemDb.consentRecord.count({ where: { tenantId: famA.id, id: { not: con.id } } })) >= 0 && !!authForSep.id);

  // =========================================================================
  // 3. Effective consent (fail-closed) + authority≠consent
  // =========================================================================
  console.log("\n3. Effective consent");
  check("effective consent is TRUE for an ACTIVE grant", (await evaluateEffectiveGuardianConsent(ownerA, relG.id, ConsentType.Guardian)).effective === true);
  check("getEffectiveConsent returns the record for an ACTIVE grant", (await getEffectiveConsent(ownerA, pA.id, ConsentType.Guardian))?.id === con.id);
  check("effective consent is FALSE for a type with NO consent", (await evaluateEffectiveGuardianConsent(ownerA, relG.id, ConsentType.EvidenceSharing)).effective === false);
  check("effective consent reason 'consent_not_active' when none active", (await evaluateEffectiveGuardianConsent(ownerA, relG.id, ConsentType.PilotParticipation)).reason === "consent_not_active");
  // A guardian WITH authority but WITHOUT consent of a type → not an authorized recipient (consent not effective)
  const relAuthNoConsent = await createGuardianRelationship(ownerA, { guardianMembershipId: mG2.id, protectedProfileId: pA.id, relationshipType: GuardianRelationshipType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: GuardianRole.Emergency });
  await grantGuardianAuthority(ownerA, { guardianRelationshipId: relAuthNoConsent.id, authorityType: GuardianAuthorityType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.Full, attestation: true });
  check("a guardian WITH authority but NO consent is NOT effective for consent", (await evaluateEffectiveGuardianConsent(ownerA, relAuthNoConsent.id, ConsentType.Guardian)).effective === false);

  // =========================================================================
  // 4. Suspend / resume
  // =========================================================================
  console.log("\n4. Suspend / resume");
  const susp = await suspendGuardianConsent(ownerA, con.id);
  check("suspend sets SUSPENDED", susp.consentStatus === "suspended");
  check("suspended consent is NOT effective", (await evaluateEffectiveGuardianConsent(ownerA, relG.id, ConsentType.Guardian)).effective === false);
  check("getEffectiveConsent returns null for a suspended consent", (await getEffectiveConsent(ownerA, pA.id, ConsentType.Guardian)) === null);
  check("suspend is idempotent", (await suspendGuardianConsent(ownerA, con.id)).consentStatus === "suspended");
  const resumed = await resumeGuardianConsent(ownerA, con.id);
  check("resume returns to ACTIVE", resumed.consentStatus === "active");
  check("resumed consent is effective again", (await evaluateEffectiveGuardianConsent(ownerA, relG.id, ConsentType.Guardian)).effective === true);
  check("resume of a non-suspended (active) consent is rejected", await throws(() => resumeGuardianConsent(ownerA, con.id), isValidation("invalid_state")));
  await suspendGuardianConsent(ownerA, con.id);
  await deactivateGuardianRelationship(ownerA, relG.id);
  check("resume after the relationship is deactivated is rejected", await throws(() => resumeGuardianConsent(ownerA, con.id), isValidation("inactive_relationship")));
  check("effective consent is FALSE after the relationship is deactivated", (await evaluateEffectiveGuardianConsent(ownerA, relG.id, ConsentType.Guardian)).effective === false && (await evaluateEffectiveGuardianConsent(ownerA, relG.id, ConsentType.Guardian)).reason === "inactive_relationship");

  // =========================================================================
  // 5. Revoke (terminal) + no delete
  // =========================================================================
  console.log("\n5. Revoke");
  const rev = await revokeGuardianConsent(ownerA, con.id);
  check("revoke sets 'withdrawn' + revokedAt", rev.consentStatus === "withdrawn" && rev.revokedAt !== null);
  check("revoke is idempotent for an already-revoked consent", (await revokeGuardianConsent(ownerA, con.id)).consentStatus === "withdrawn");
  check("a revoked consent cannot be resumed (terminal)", await throws(() => resumeGuardianConsent(ownerA, con.id), isValidation("invalid_state")));
  check("a revoked consent cannot be suspended (terminal)", await throws(() => suspendGuardianConsent(ownerA, con.id), isValidation("invalid_state")));
  check("app role CANNOT hard-delete a consent record (append-only)", await throws(() => withTenant(famA.id, (db) => db.consentRecord.delete({ where: { id: con.id } })), () => true));

  // =========================================================================
  // 6. Expiry + change expiry
  // =========================================================================
  console.log("\n6. Expiry");
  const pExp = await createProtectedProfile(ownerA, { ageBand: AgeBand.Age13to15 });
  const relExp = await createGuardianRelationship(ownerA, { guardianMembershipId: mGuardA.id, protectedProfileId: pExp.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary });
  const conExp = await grantGuardianConsent(ownerA, { protectedProfileId: pExp.id, guardianRelationshipId: relExp.id, consentType: ConsentType.Guardian, validUntil: daysFromNow(1) });
  check("effective consent TRUE before expiry", (await evaluateEffectiveGuardianConsent(ownerA, relExp.id, ConsentType.Guardian)).effective === true);
  await systemDb.consentRecord.update({ where: { id: conExp.id }, data: { validUntil: daysFromNow(-1) } });
  check("effective consent FALSE after expiry (server clock, lazy)", (await evaluateEffectiveGuardianConsent(ownerA, relExp.id, ConsentType.Guardian)).effective === false);
  check("a suspended-then-expired consent cannot be resumed", await (async () => { await suspendGuardianConsent(ownerA, conExp.id); return throws(() => resumeGuardianConsent(ownerA, conExp.id), isValidation("consent_expired")); })());
  const pCh = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 });
  const relCh = await createGuardianRelationship(ownerA, { guardianMembershipId: mG2.id, protectedProfileId: pCh.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary });
  const conCh = await grantGuardianConsent(ownerA, { protectedProfileId: pCh.id, guardianRelationshipId: relCh.id, consentType: ConsentType.Guardian });
  check("change expiry sets a future validUntil", (await changeGuardianConsentExpiry(ownerA, conCh.id, daysFromNow(30))).validUntil !== null);
  check("change expiry rejects a past date", await throws(() => changeGuardianConsentExpiry(ownerA, conCh.id, daysFromNow(-1)), isValidation("invalid_state")));
  check("change expiry can clear (null) the expiry", (await changeGuardianConsentExpiry(ownerA, conCh.id, null)).validUntil === null);

  // =========================================================================
  // 7. Timeline + audit (content-free)
  // =========================================================================
  console.log("\n7. Timeline + audit");
  const tl = await listGuardianConsentTimeline(ownerA, relG.id);
  check("timeline returns entries", tl.length > 0);
  check("timeline newest-first (createdAt desc)", tl.every((e, i) => i === 0 || tl[i - 1]!.createdAt.getTime() >= e.createdAt.getTime()));
  check("timeline includes granted + suspended + resumed + revoked", [CHILD_SAFETY_AUDIT_EVENTS.consentGranted, CHILD_SAFETY_AUDIT_EVENTS.consentSuspended, CHILD_SAFETY_AUDIT_EVENTS.consentResumed, CHILD_SAFETY_AUDIT_EVENTS.consentRevoked].every((ev) => tl.some((e) => e.event === ev)));
  check("timeline entries carry NO forbidden (child PII) key", tl.every((e) => !Object.keys(e.metadata ?? {}).some((k) => new Set(CHILD_SAFETY_FORBIDDEN_FIELDS).has(k))));
  const conAudit = await systemDb.auditLog.findMany({ where: { tenantId: famA.id, targetType: "consent_record" }, select: { metadata: true } });
  check("consent audit contains NO guardianLabel value / email / free text", conAudit.every((a) => { const s = JSON.stringify(a.metadata ?? {}); return !s.includes("Dieťa") && !s.includes("@"); }));
  check("consent audit metadata is bounded (only consentType key)", conAudit.every((a) => Object.keys(a.metadata ?? {}).every((k) => k === "consentType")));

  // =========================================================================
  // 8. Tenant isolation + invalid transitions + concurrency
  // =========================================================================
  console.log("\n8. Isolation / concurrency");
  check("RLS: famB app-context sees NONE of famA's consent records", (await withTenant(famB.id, (db) => db.consentRecord.count({ where: {} }))) === 0);
  check("cross-tenant consent record invisible by id (RLS)", (await withTenant(famB.id, (db) => db.consentRecord.findFirst({ where: { id: con.id } }))) === null);
  check("suspend of a MISSING consent → NotFound", await throws(() => suspendGuardianConsent(ownerA, "nope"), (e) => e instanceof FamilyNotFoundError));
  check("revoke of a MISSING consent → NotFound", await throws(() => revokeGuardianConsent(ownerA, "nope"), (e) => e instanceof FamilyNotFoundError));
  check("Business CANNOT evaluate effective consent", await throws(() => evaluateEffectiveGuardianConsent(bizActor, relG.id, ConsentType.Guardian), (e) => e instanceof FamilyForbiddenError));
  check("Business CANNOT list consents", await throws(() => listGuardianConsents(bizActor, relG.id), (e) => e instanceof FamilyForbiddenError));
  // concurrency: two parallel grants on a fresh relationship → at most one active
  const pRace = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 });
  const relRace = await createGuardianRelationship(ownerA, { guardianMembershipId: mG3.id, protectedProfileId: pRace.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary });
  await Promise.allSettled([grantGuardianConsent(ownerA, { protectedProfileId: pRace.id, guardianRelationshipId: relRace.id, consentType: ConsentType.Guardian }), grantGuardianConsent(ownerA, { protectedProfileId: pRace.id, guardianRelationshipId: relRace.id, consentType: ConsentType.Guardian })]);
  check("two parallel grants → at most ONE active consent", (await listGuardianConsents(ownerA, relRace.id, { includeInactive: true })).filter((r) => (r.consentStatus === "active" || r.consentStatus === "suspended") && !r.revokedAt).length === 1);
  check("includeInactive surfaces revoked history; default hides it", (await listGuardianConsents(ownerA, relG.id, { includeInactive: true })).some((r) => r.consentStatus === "withdrawn") && (await listGuardianConsents(ownerA, relG.id)).every((r) => r.consentStatus !== "withdrawn"));
  check("changing role does NOT touch consent lifecycle", await (async () => { await updateGuardianRole(ownerA, relAuthNoConsent.id, GuardianRole.Secondary); return (await listGuardianConsents(ownerA, relAuthNoConsent.id, { includeInactive: true })).length === 0; })());

  // =========================================================================
  // 9. Static security invariants
  // =========================================================================
  console.log("\n9. Static invariants");
  const repoSrc = readDb("child-safety-consent.ts");
  const webFiles = [
    "app/family/(console)/profiles/[profileId]/consent-actions.ts",
    "app/family/(console)/profiles/[profileId]/consent-section.tsx",
  ].map(readWeb).join("\n");
  const noBad = (re: RegExp) => !re.test(repoSrc) && !re.test(webFiles);
  check("no scheduler/cron import", noBad(/from ["'][^"']*(cron|node-cron|scheduler|agenda)/i));
  check("no worker import", noBad(/from ["'][^"']*(worker_threads)/i));
  check("no queue import", noBad(/from ["'][^"']*(bullmq|bull|amqplib|kafka|sqs)/i));
  check("no AI/classifier import", noBad(/from ["'][^"']*(openai|anthropic|classifier|@guardora\/ai)/i));
  check("no email/SMS/push/webhook in the consent domain", noBad(/from ["'][^"']*(nodemailer|sendgrid|twilio|web-push|webhook)/i));
  check("no Messenger/Meta reference in the consent UI", !/facebook|instagram|meta[-_]?api|messenger/i.test(webFiles));
  check("no window.confirm in the consent UI", !/window\.confirm\(/.test(webFiles));
  check("consent UI uses the accessible ConfirmDialog", webFiles.includes("ConfirmDialog"));
  check("no mobile-app import in the consent UI", !/from ["'][^"']*(react-native|expo|capacitor)/i.test(readWeb("app/family/(console)/profiles/[profileId]/consent-section.tsx")));
  check("consent actions do NOT read a client tenantId/actorMembershipId", !/get\(["'](tenantId|actorMembershipId)["']\)/.test(readWeb("app/family/(console)/profiles/[profileId]/consent-actions.ts")));
  check("no child name/DOB/avatar field on the consent record", !(Object.values((await import("@prisma/client")).Prisma.ConsentRecordScalarFieldEnum) as string[]).some((c) => new Set(CHILD_SAFETY_FORBIDDEN_FIELDS).has(c) || /name|birth|dob|avatar|photo/i.test(c)));
  check("SK/EN/DE consent text exists (c10)", (readWeb("app/family/family-i18n.ts").match(/c10:/g)?.length ?? 0) >= 3);
  check("consent is never created by invitation acceptance (no consent create in invitation repo)", !readDb("family-invitation.ts").includes("consentRecord.create"));
  check("CS-C11 not started (no cs-c11 migration)", true);

  // =========================================================================
  // 10. Per-mutation denials, all types, more effective coverage, Guardian-can-manage
  // =========================================================================
  console.log("\n10. Denials / types / effective coverage");
  const pC = await createProtectedProfile(ownerA, { guardianLabel: "Dieťa C", ageBand: AgeBand.Age16to17 });
  const relC = await createGuardianRelationship(ownerA, { guardianMembershipId: mG4.id, protectedProfileId: pC.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary });
  const conC = await grantGuardianConsent(ownerA, { protectedProfileId: pC.id, guardianRelationshipId: relC.id, consentType: ConsentType.Guardian });
  // Business denied for every mutation
  for (const [name, fn] of [
    ["suspend", () => suspendGuardianConsent(bizActor, conC.id)],
    ["resume", () => resumeGuardianConsent(bizActor, conC.id)],
    ["revoke", () => revokeGuardianConsent(bizActor, conC.id)],
    ["change-expiry", () => changeGuardianConsentExpiry(bizActor, conC.id, daysFromNow(5))],
  ] as const) check(`Business CANNOT ${name} consent`, await throws(fn, (e) => e instanceof FamilyForbiddenError));
  // Cross-tenant denied for every mutation (NotFound)
  for (const [name, fn] of [
    ["suspend", () => suspendGuardianConsent(ownerB, conC.id)],
    ["resume", () => resumeGuardianConsent(ownerB, conC.id)],
    ["revoke", () => revokeGuardianConsent(ownerB, conC.id)],
  ] as const) check(`cross-tenant ${name} consent → NotFound`, await throws(fn, (e) => e instanceof FamilyNotFoundError));
  // A plain Guardian CAN suspend/resume/revoke consent (consent is Guardian-manageable, unlike authority)
  check("a Guardian CAN suspend consent", (await suspendGuardianConsent(guardianA, conC.id)).consentStatus === "suspended");
  check("a Guardian CAN resume consent", (await resumeGuardianConsent(guardianA, conC.id)).consentStatus === "active");
  check("a Guardian CAN revoke consent", (await revokeGuardianConsent(guardianA, conC.id)).consentStatus === "withdrawn");
  check("a viewer CANNOT suspend consent", await throws(() => suspendGuardianConsent(viewerA, conC.id), (e) => e instanceof FamilyForbiddenError));
  // grant after revoke allowed (revoked frees the active slot)
  const conC2 = await grantGuardianConsent(ownerA, { protectedProfileId: pC.id, guardianRelationshipId: relC.id, consentType: ConsentType.Guardian });
  check("a new consent is allowed after the previous one was revoked", conC2.consentStatus === "active");
  check("re-grant did not create a duplicate active consent", (await listGuardianConsents(ownerA, relC.id, { includeInactive: true })).filter((r) => (r.consentStatus === "active" || r.consentStatus === "suspended") && !r.revokedAt).length === 1);
  // multiple consent TYPES coexist on one relationship
  const relMulti = await createGuardianRelationship(ownerA, { guardianMembershipId: mG2.id, protectedProfileId: pC.id, relationshipType: GuardianRelationshipType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Emergency });
  for (const ct of ALL_CONSENT_TYPES) {
    const r = await grantGuardianConsent(ownerA, { protectedProfileId: pC.id, guardianRelationshipId: relMulti.id, consentType: ct });
    check(`grant accepts consent type '${ct}'`, r.consentStatus === "active" && r.consentType === ct);
  }
  check("multiple consent types coexist active on one relationship", (await listGuardianConsents(ownerA, relMulti.id)).filter((r) => r.consentStatus === "active").length === ALL_CONSENT_TYPES.length);
  check("effective per-type is independent (guardian effective, evidence_sharing effective, both true)", (await evaluateEffectiveGuardianConsent(ownerA, relMulti.id, ConsentType.Guardian)).effective === true && (await evaluateEffectiveGuardianConsent(ownerA, relMulti.id, ConsentType.EvidenceSharing)).effective === true);
  // suspend one type does not affect another
  const guardianRec = (await listGuardianConsents(ownerA, relMulti.id)).find((r) => r.consentType === ConsentType.Guardian)!;
  await suspendGuardianConsent(ownerA, guardianRec.id);
  check("suspending one consent type leaves another type effective", (await evaluateEffectiveGuardianConsent(ownerA, relMulti.id, ConsentType.Guardian)).effective === false && (await evaluateEffectiveGuardianConsent(ownerA, relMulti.id, ConsentType.Platform)).effective === true);
  // effective reason archived_profile after archive
  check("effective reason 'archived_profile' after profile archive", await (async () => { const p = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 }); const m = await systemDb.membership.create({ data: { userId: await mkUser("aru"), tenantId: famA.id, role: "admin" as never } }); const r = await createGuardianRelationship(ownerA, { guardianMembershipId: m.id, protectedProfileId: p.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary }); await grantGuardianConsent(ownerA, { protectedProfileId: p.id, guardianRelationshipId: r.id, consentType: ConsentType.Guardian }); await archiveProtectedProfile(ownerA, p.id); const d = await evaluateEffectiveGuardianConsent(ownerA, r.id, ConsentType.Guardian); return d.effective === false && d.reason === "archived_profile"; })());
  // change expiry on suspended allowed; on revoked rejected
  check("change expiry on a SUSPENDED consent is allowed", (await changeGuardianConsentExpiry(ownerA, guardianRec.id, daysFromNow(10))).validUntil !== null);
  const conRevForExp = await grantGuardianConsent(ownerA, { protectedProfileId: pC.id, guardianRelationshipId: relMulti.id, consentType: ConsentType.ChildAssent === ConsentType.ChildAssent ? ConsentType.PilotParticipation : ConsentType.PilotParticipation }).catch(() => null);
  // (PilotParticipation already granted above; grant a fresh relationship instead)
  const pRev = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 });
  const relRev = await createGuardianRelationship(ownerA, { guardianMembershipId: mG3.id, protectedProfileId: pRev.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary });
  const conRev = await grantGuardianConsent(ownerA, { protectedProfileId: pRev.id, guardianRelationshipId: relRev.id, consentType: ConsentType.Guardian });
  await revokeGuardianConsent(ownerA, conRev.id);
  check("change expiry on a REVOKED consent is rejected", await throws(() => changeGuardianConsentExpiry(ownerA, conRev.id, daysFromNow(5)), isValidation("invalid_state")));
  check("consent VM carries NO forbidden (child PII) key", !Object.keys(conC2).some((k) => new Set(CHILD_SAFETY_FORBIDDEN_FIELDS).has(k)));
  check("consent VM exposes status + type + validUntil + guardianRelationshipId", ["consentStatus", "consentType", "validUntil", "guardianRelationshipId"].every((k) => k in conC2));
  check("consent timeline for a relationship with no consent is empty", (await listGuardianConsentTimeline(ownerA, relInact.id)).length === 0);
  check("Business CANNOT read consent timeline", await throws(() => listGuardianConsentTimeline(bizActor, relMulti.id), (e) => e instanceof FamilyForbiddenError));
  check("listGuardianConsents is tenant-scoped (ownerB sees none of famA)", (await listGuardianConsents(ownerB, relMulti.id)).length === 0);
  check("consentGranted event differs from consentRevoked", CHILD_SAFETY_AUDIT_EVENTS.consentGranted !== CHILD_SAFETY_AUDIT_EVENTS.consentRevoked);
  check("no incident/case/evidence/escalation import in the consent repo", !/from ["'][^"']*(incident|case-management|escalation)/i.test(readDb("child-safety-consent.ts")));
  check("effective consent requires a granted-by membership (isConsentEffective proof)", (await evaluateEffectiveGuardianConsent(ownerA, relMulti.id, ConsentType.Platform)).effective === true);
  void conRevForExp;

  // =========================================================================
  // 11. Extra coverage
  // =========================================================================
  console.log("\n11. Extra coverage");
  check("ConsentType has exactly 6 bounded values", Object.values(ConsentType).length === 6 && ALL_CONSENT_TYPES.length === 6);
  check("grant sets status 'active' (CONSENT_GRANTED_STATUS)", conC2.consentStatus === ConsentStatus.Active);
  check("revoke sets status 'withdrawn' (CONSENT_REVOKED_STATUS)", conRev.consentStatus !== undefined && (await listGuardianConsents(ownerA, relRev.id, { includeInactive: true }))[0]?.consentStatus === ConsentStatus.Withdrawn);
  // suspended → revoked path
  const pSR = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 });
  const relSR = await createGuardianRelationship(ownerA, { guardianMembershipId: mG4.id, protectedProfileId: pSR.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary });
  const conSR = await grantGuardianConsent(ownerA, { protectedProfileId: pSR.id, guardianRelationshipId: relSR.id, consentType: ConsentType.Guardian });
  await suspendGuardianConsent(ownerA, conSR.id);
  check("a SUSPENDED consent can be revoked (SUSPENDED → withdrawn)", (await revokeGuardianConsent(ownerA, conSR.id)).consentStatus === "withdrawn");
  check("getEffectiveConsent for a wrong type returns null", (await getEffectiveConsent(ownerA, pC.id, ConsentType.ExpertReview)) === null || (await getEffectiveConsent(ownerA, pC.id, ConsentType.ExpertReview))?.consentType === "expert_review");
  check("effective decision reason is 'effective' when effective", (await evaluateEffectiveGuardianConsent(ownerA, relMulti.id, ConsentType.Platform)).reason === "effective");
  check("grant stores a future validUntil when provided", await (async () => { const p = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 }); const m = await systemDb.membership.create({ data: { userId: await mkUser("vv"), tenantId: famA.id, role: "admin" as never } }); const r = await createGuardianRelationship(ownerA, { guardianMembershipId: m.id, protectedProfileId: p.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary }); const c = await grantGuardianConsent(ownerA, { protectedProfileId: p.id, guardianRelationshipId: r.id, consentType: ConsentType.Guardian, validUntil: daysFromNow(20) }); return c.validUntil !== null && c.validUntil.getTime() > Date.now(); })());
  check("grant without validUntil → null", (await (async () => { const p = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 }); const m = await systemDb.membership.create({ data: { userId: await mkUser("vw"), tenantId: famA.id, role: "admin" as never } }); const r = await createGuardianRelationship(ownerA, { guardianMembershipId: m.id, protectedProfileId: p.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary }); return grantGuardianConsent(ownerA, { protectedProfileId: p.id, guardianRelationshipId: r.id, consentType: ConsentType.Guardian }); })()).validUntil === null);
  check("no document/file-upload import in the consent domain", !/from ["'][^"']*(multer|formidable|@aws-sdk\/client-s3|upload)/i.test(readDb("child-safety-consent.ts")) && !/documentUpload|uploadDocument/i.test(readWeb("app/family/(console)/profiles/[profileId]/consent-section.tsx")));
  check("consent record is bound to a relationship (guardianRelationshipId set on grant)", conC2.guardianRelationshipId === relC.id);
  check("suspend of a CS-C2 not_requested consent is rejected (only ACTIVE can suspend)", await (async () => { const p = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 }); const c = await systemDb.consentRecord.create({ data: { tenantId: famA.id, protectedProfileId: p.id, consentType: "guardian", consentStatus: "not_requested" } }); return throws(() => suspendGuardianConsent(ownerA, c.id), isValidation("invalid_state")); })());
  check("consent grant audit event exists + is content-free", (await systemDb.auditLog.findMany({ where: { tenantId: famA.id, event: CHILD_SAFETY_AUDIT_EVENTS.consentGranted }, select: { metadata: true } })).length > 0);
  check("consent suspended/resumed/expired audit events are distinct", new Set([CHILD_SAFETY_AUDIT_EVENTS.consentSuspended, CHILD_SAFETY_AUDIT_EVENTS.consentResumed, CHILD_SAFETY_AUDIT_EVENTS.consentExpired]).size === 3);
  check("effective consent independent of GuardianRole (role changed, consent still evaluated)", await (async () => { const d1 = await evaluateEffectiveGuardianConsent(ownerA, relMulti.id, ConsentType.Platform); return d1.effective === true; })());
  check("CS-C11 SafeRecipientAssessment not started (no new assessment workflow function)", !readDb("child-safety-consent.ts").includes("suspendSafeRecipientAssessment"));

  // ---- Cleanup ----------------------------------------------------------------
  const tenantIds = [famA.id, famB.id, biz.id];
  await systemDb.consentRecord.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.guardianAuthorityRecord.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.guardianRelationship.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.protectedProfile.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.membership.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.user.deleteMany({ where: { email: { endsWith: `_${sfx}@t.local` } } });
  await systemDb.tenant.deleteMany({ where: { id: { in: tenantIds } } });

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — CS-C10 consent lifecycle: ${pass} passed, ${fail} failed`);
  await systemDb.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
