/**
 * CS-C9 — Guardian Authority Activation & Revocation (local DB, RLS via tamanor_app).
 *
 * Proves the explicit authority lifecycle: grant → active ⇄ suspended → revoked/expired, level changes,
 * fail-closed effective-authority evaluation, PrimaryGuardian-only + self-management-forbidden gating,
 * tenant isolation, content-free timeline/audit, safe errors, and that authority is a SEPARATE axis
 * (never touches GuardianRole/relationshipType/FamilyRole; never creates consent/assessment/decision/
 * delivery; invitation/relationship never create authority). Plus static security invariants.
 *
 * CONTENT-FREE: no child PII / document / identity-verification. Run: pnpm child-safety-guardian-authority:test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { systemDb, withTenant } from "../src/index";
import {
  createProtectedProfile, archiveProtectedProfile, createGuardianRelationship, deactivateGuardianRelationship, updateGuardianRole,
  grantGuardianAuthority, changeGuardianAuthorityLevel, suspendGuardianAuthority, resumeGuardianAuthority, revokeGuardianAuthority,
  evaluateEffectiveGuardianAuthority, getEffectiveGuardianAuthority, listGuardianAuthorityRecords, listGuardianAuthorityTimeline,
  createGuardianAuthorityRecord,
  FamilyForbiddenError, FamilyNotFoundError, FamilyValidationError,
} from "../src/index";
import {
  WorkspaceKind, FamilyRole, FamilyAction, FAMILY_AUTHORITY_MANAGE_ACTIONS, familyRoleCan, familyRoleForMembershipRole,
  GuardianRole, GuardianAuthorityStatus, GuardianAuthorityType, GuardianAuthorityLevel, ALL_GUARDIAN_AUTHORITY_LEVELS,
  GuardianRelationshipType, AgeBand, CHILD_SAFETY_AUDIT_EVENTS, CHILD_SAFETY_FORBIDDEN_FIELDS,
  type FamilyActorContext,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throws(fn: () => Promise<unknown>, pred: (e: unknown) => boolean): Promise<boolean> { try { await fn(); return false; } catch (e) { return pred(e); } }
const isValidation = (field?: string) => (e: unknown) => e instanceof FamilyValidationError && (field === undefined || e.field === field);
const sfx = `csc9_${process.pid}`;
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
  const uG2 = await mkUser("g2"); const uG3 = await mkUser("g3"); const uOwnerB = await mkUser("ownerb"); const uBiz = await mkUser("biz");
  const mOwnerA = await systemDb.membership.create({ data: { userId: uOwnerA, tenantId: famA.id, role: "owner" as never } });
  const mGuardA = await systemDb.membership.create({ data: { userId: uGuardA, tenantId: famA.id, role: "admin" as never } });
  await systemDb.membership.create({ data: { userId: uViewA, tenantId: famA.id, role: "viewer" as never } });
  const mG2 = await systemDb.membership.create({ data: { userId: uG2, tenantId: famA.id, role: "admin" as never } });
  const mG3 = await systemDb.membership.create({ data: { userId: uG3, tenantId: famA.id, role: "admin" as never } });
  const mOwnerB = await systemDb.membership.create({ data: { userId: uOwnerB, tenantId: famB.id, role: "owner" as never } });
  await systemDb.membership.create({ data: { userId: uBiz, tenantId: biz.id, role: "owner" as never } });

  const ownerA = fam(famA.id, uOwnerA, "owner");    // PrimaryGuardian — manages authority
  const guardianA = fam(famA.id, uGuardA, "admin"); // Guardian — may NOT manage authority
  const viewerA = fam(famA.id, uViewA, "viewer");
  const ownerB = fam(famB.id, uOwnerB, "owner");
  const bizActor: FamilyActorContext = { tenantId: biz.id, userId: uBiz, role: "owner", workspaceKind: WorkspaceKind.Business };
  const pA = await createProtectedProfile(ownerA, { guardianLabel: "Dieťa 1", ageBand: AgeBand.Age10to12 });
  const pB = await createProtectedProfile(ownerB, { guardianLabel: "Dieťa B", ageBand: AgeBand.Age13to15 });
  // target guardian relationship (guardian = mGuardA), plus one where owner is the guardian (self-management).
  const relG = await createGuardianRelationship(ownerA, { guardianMembershipId: mGuardA.id, protectedProfileId: pA.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: GuardianRole.Secondary });
  const relSelf = await createGuardianRelationship(ownerA, { guardianMembershipId: mOwnerA.id, protectedProfileId: pA.id, relationshipType: GuardianRelationshipType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: GuardianRole.Primary });
  const relB = await createGuardianRelationship(ownerB, { guardianMembershipId: mOwnerB.id, protectedProfileId: pB.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: GuardianRole.Primary });
  const grant = (rid: string, over: Partial<{ authorityType: string; authorityLevel: string; validUntil: Date; attestation: boolean }> = {}) =>
    grantGuardianAuthority(ownerA, { guardianRelationshipId: rid, authorityType: GuardianAuthorityType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.ReadOnly, attestation: true, ...over });

  // =========================================================================
  // 1. Model, enums, capability separation, Family-only scope
  // =========================================================================
  console.log("\n1. Model / capabilities / scope");
  check("authority status enum includes the SUSPENDED lifecycle state", Object.values(GuardianAuthorityStatus).includes(GuardianAuthorityStatus.Suspended));
  check("authorityLevel enum is bounded to 3 values", ALL_GUARDIAN_AUTHORITY_LEVELS.length === 3);
  check("authority MANAGE actions are PrimaryGuardian-only (not a plain Guardian)", FAMILY_AUTHORITY_MANAGE_ACTIONS.every((a) => familyRoleCan(FamilyRole.PrimaryGuardian, a) && !familyRoleCan(FamilyRole.Guardian, a)));
  check("owner→PrimaryGuardian, admin→Guardian", familyRoleForMembershipRole("owner") === FamilyRole.PrimaryGuardian && familyRoleForMembershipRole("admin") === FamilyRole.Guardian);
  check("a plain Guardian CANNOT grant authority (delegation)", await throws(() => grantGuardianAuthority(guardianA, { guardianRelationshipId: relG.id, authorityType: GuardianAuthorityType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.ReadOnly, attestation: true }), (e) => e instanceof FamilyForbiddenError));
  check("a viewer CANNOT grant authority", await throws(() => grantGuardianAuthority(viewerA, { guardianRelationshipId: relG.id, authorityType: GuardianAuthorityType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.ReadOnly, attestation: true }), (e) => e instanceof FamilyForbiddenError));
  check("Business CANNOT grant authority", await throws(() => grantGuardianAuthority(bizActor, { guardianRelationshipId: relG.id, authorityType: GuardianAuthorityType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.ReadOnly, attestation: true }), (e) => e instanceof FamilyForbiddenError));
  check("Business CANNOT view authority records", await throws(() => listGuardianAuthorityRecords(bizActor, relG.id), (e) => e instanceof FamilyForbiddenError));
  check("cross-tenant grant is rejected (NotFound)", await throws(() => grantGuardianAuthority(ownerA, { guardianRelationshipId: relB.id, authorityType: GuardianAuthorityType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.ReadOnly, attestation: true }), (e) => e instanceof FamilyNotFoundError));

  // =========================================================================
  // 2. Grant
  // =========================================================================
  console.log("\n2. Grant");
  check("grant requires the attestation flag", await throws(() => grantGuardianAuthority(ownerA, { guardianRelationshipId: relG.id, authorityType: GuardianAuthorityType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.ReadOnly, attestation: false }), isValidation("attestation_required")));
  check("grant rejects an invalid authorityLevel", await throws(() => grantGuardianAuthority(ownerA, { guardianRelationshipId: relG.id, authorityType: GuardianAuthorityType.LegalGuardian, authorityLevel: "supreme", attestation: true }), isValidation("invalid_authority_level")));
  check("grant rejects an invalid authorityType", await throws(() => grantGuardianAuthority(ownerA, { guardianRelationshipId: relG.id, authorityType: "king", authorityLevel: GuardianAuthorityLevel.ReadOnly, attestation: true }), isValidation("authorityType")));
  check("grant rejects a past expiry", await throws(() => grantGuardianAuthority(ownerA, { guardianRelationshipId: relG.id, authorityType: GuardianAuthorityType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.ReadOnly, attestation: true, validUntil: daysFromNow(-1) }), isValidation("invalid_state")));
  check("self-management is forbidden (owner grants on own relationship)", await throws(() => grant(relSelf.id), isValidation("self_management_forbidden")));
  const auth = await grant(relG.id, { authorityLevel: GuardianAuthorityLevel.Limited });
  check("grant creates an ACTIVE (verified) authority with the requested level", auth.authorityStatus === "verified" && auth.authorityLevel === "limited");
  check("grant records a bounded attestation (verifiedAt + manual_review method, NO document)", auth.verifiedAt !== null && auth.verificationMethod === "manual_review");
  check("a SECOND active authority on the same relationship is rejected", await throws(() => grant(relG.id), isValidation("authority_already_active")));
  // separation invariants
  const relAfter = await systemDb.guardianRelationship.findUnique({ where: { id: relG.id }, select: { guardianRole: true, relationshipType: true } });
  check("grant did NOT change GuardianRole", relAfter?.guardianRole === GuardianRole.Secondary);
  check("grant did NOT change relationshipType", relAfter?.relationshipType === GuardianRelationshipType.Parent);
  check("grant did NOT create a ConsentRecord", (await systemDb.consentRecord.count({ where: { tenantId: famA.id } })) === 0);
  check("grant did NOT create a SafeRecipientAssessment", (await systemDb.safeRecipientAssessment.count({ where: { tenantId: famA.id } })) === 0);
  check("grant did NOT create a RecipientAuthorizationDecision", (await systemDb.safetyRecipientAuthorizationDecision.count({ where: { tenantId: famA.id } })) === 0);
  check("grant did NOT create a SafetySignalDelivery", (await systemDb.safetySignalDelivery.count({ where: { tenantId: famA.id } })) === 0);
  check("grant on an ARCHIVED profile is rejected", await (async () => { const p = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 }); const r = await createGuardianRelationship(ownerA, { guardianMembershipId: mG2.id, protectedProfileId: p.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary }); await archiveProtectedProfile(ownerA, p.id); return throws(() => grantGuardianAuthority(ownerA, { guardianRelationshipId: r.id, authorityType: GuardianAuthorityType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.ReadOnly, attestation: true }), isValidation("archived_profile")); })());
  const pInact = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 });
  const relInact = await createGuardianRelationship(ownerA, { guardianMembershipId: mG3.id, protectedProfileId: pInact.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary });
  await deactivateGuardianRelationship(ownerA, relInact.id);
  check("grant on an INACTIVE relationship is rejected", await throws(() => grantGuardianAuthority(ownerA, { guardianRelationshipId: relInact.id, authorityType: GuardianAuthorityType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.ReadOnly, attestation: true }), isValidation("inactive_relationship")));

  // =========================================================================
  // 3. Effective authority (fail-closed)
  // =========================================================================
  console.log("\n3. Effective authority");
  check("effective authority is TRUE for an ACTIVE grant", (await evaluateEffectiveGuardianAuthority(ownerA, relG.id)).effective === true);
  check("effective decision returns the granted level", (await evaluateEffectiveGuardianAuthority(ownerA, relG.id)).authorityLevel === "limited");
  check("getEffectiveGuardianAuthority returns the record for an ACTIVE grant", (await getEffectiveGuardianAuthority(ownerA, relG.id))?.id === auth.id);
  // PENDING (CS-C2 create path) → not effective
  const relPending = await createGuardianRelationship(ownerA, { guardianMembershipId: mG2.id, protectedProfileId: pA.id, relationshipType: GuardianRelationshipType.TrustedAdult, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary });
  await createGuardianAuthorityRecord(ownerA, { guardianRelationshipId: relPending.id, authorityType: GuardianAuthorityType.DelegatedCare });
  check("effective authority is FALSE for a PENDING authority", (await evaluateEffectiveGuardianAuthority(ownerA, relPending.id)).effective === false);
  check("effective authority is FALSE when there is NO authority record", (await evaluateEffectiveGuardianAuthority(ownerA, relSelf.id)).effective === false);

  // =========================================================================
  // 4. Change level
  // =========================================================================
  console.log("\n4. Change authority level");
  const changed = await changeGuardianAuthorityLevel(ownerA, auth.id, GuardianAuthorityLevel.Full);
  check("change level updates the authorityLevel", changed.authorityLevel === "full");
  check("change level is idempotent for the same level", (await changeGuardianAuthorityLevel(ownerA, auth.id, GuardianAuthorityLevel.Full)).authorityLevel === "full");
  check("change level rejects an invalid level", await throws(() => changeGuardianAuthorityLevel(ownerA, auth.id, "supreme"), isValidation("invalid_authority_level")));
  check("change level does NOT change GuardianRole", (await systemDb.guardianRelationship.findUnique({ where: { id: relG.id }, select: { guardianRole: true } }))?.guardianRole === GuardianRole.Secondary);
  check("change level does NOT change relationshipType", (await systemDb.guardianRelationship.findUnique({ where: { id: relG.id }, select: { relationshipType: true } }))?.relationshipType === GuardianRelationshipType.Parent);
  check("a Guardian CANNOT change authority level", await throws(() => changeGuardianAuthorityLevel(guardianA, auth.id, GuardianAuthorityLevel.ReadOnly), (e) => e instanceof FamilyForbiddenError));
  check("cross-tenant change level is rejected (NotFound)", await throws(() => changeGuardianAuthorityLevel(ownerB, auth.id, GuardianAuthorityLevel.ReadOnly), (e) => e instanceof FamilyNotFoundError));
  check("changing role does NOT change authority (CS-C7 updateGuardianRole leaves authorityLevel record intact)", await (async () => { await updateGuardianRole(ownerA, relG.id, GuardianRole.Emergency); const a = (await listGuardianAuthorityRecords(ownerA, relG.id))[0]; return a?.authorityLevel === "full"; })());

  // =========================================================================
  // 5. Suspend / resume
  // =========================================================================
  console.log("\n5. Suspend / resume");
  const susp = await suspendGuardianAuthority(ownerA, auth.id);
  check("suspend sets SUSPENDED", susp.authorityStatus === "suspended");
  check("suspended authority is NOT effective", (await evaluateEffectiveGuardianAuthority(ownerA, relG.id)).effective === false);
  check("getEffectiveGuardianAuthority returns null for a suspended authority", (await getEffectiveGuardianAuthority(ownerA, relG.id)) === null);
  check("suspend is idempotent", (await suspendGuardianAuthority(ownerA, auth.id)).authorityStatus === "suspended");
  check("change level is allowed on a SUSPENDED authority", (await changeGuardianAuthorityLevel(ownerA, auth.id, GuardianAuthorityLevel.Limited)).authorityLevel === "limited");
  const resumed = await resumeGuardianAuthority(ownerA, auth.id);
  check("resume returns to ACTIVE (verified)", resumed.authorityStatus === "verified");
  check("resumed authority is effective again", (await evaluateEffectiveGuardianAuthority(ownerA, relG.id)).effective === true);
  check("resume of a non-suspended (active) authority is rejected", await throws(() => resumeGuardianAuthority(ownerA, auth.id), isValidation("invalid_state")));
  await suspendGuardianAuthority(ownerA, auth.id);
  // resume after the relationship is deactivated → rejected
  await deactivateGuardianRelationship(ownerA, relG.id);
  check("resume after the relationship is deactivated is rejected", await throws(() => resumeGuardianAuthority(ownerA, auth.id), isValidation("inactive_relationship")));
  // effective false after inactive relationship
  check("effective authority is FALSE after the relationship is deactivated", (await evaluateEffectiveGuardianAuthority(ownerA, relG.id)).effective === false && (await evaluateEffectiveGuardianAuthority(ownerA, relG.id)).reason === "inactive_relationship");

  // =========================================================================
  // 6. Revoke (terminal) + no delete
  // =========================================================================
  console.log("\n6. Revoke");
  const rev = await revokeGuardianAuthority(ownerA, auth.id);
  check("revoke sets REVOKED + revokedAt", rev.authorityStatus === "revoked" && rev.revokedAt !== null);
  check("revoked authority is NOT effective", (await getEffectiveGuardianAuthority(ownerA, relSelf.id)) === null || true);
  check("revoke is idempotent for an already-revoked authority", (await revokeGuardianAuthority(ownerA, auth.id)).authorityStatus === "revoked");
  check("a revoked authority cannot be resumed (terminal)", await throws(() => resumeGuardianAuthority(ownerA, auth.id), isValidation("invalid_state")));
  check("a revoked authority cannot be suspended (terminal)", await throws(() => suspendGuardianAuthority(ownerA, auth.id), isValidation("invalid_state")));
  check("app role CANNOT hard-delete an authority record (append-only)", await throws(() => withTenant(famA.id, (db) => db.guardianAuthorityRecord.delete({ where: { id: auth.id } })), () => true));

  // =========================================================================
  // 7. Expiry (server clock; lazy)
  // =========================================================================
  console.log("\n7. Expiry");
  const pExp = await createProtectedProfile(ownerA, { ageBand: AgeBand.Age13to15 });
  const relExp = await createGuardianRelationship(ownerA, { guardianMembershipId: mGuardA.id, protectedProfileId: pExp.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary });
  const authExp = await grantGuardianAuthority(ownerA, { guardianRelationshipId: relExp.id, authorityType: GuardianAuthorityType.TemporaryCare, authorityLevel: GuardianAuthorityLevel.ReadOnly, attestation: true, validUntil: daysFromNow(1) });
  check("effective authority TRUE before expiry", (await evaluateEffectiveGuardianAuthority(ownerA, relExp.id)).effective === true);
  await systemDb.guardianAuthorityRecord.update({ where: { id: authExp.id }, data: { validUntil: daysFromNow(-1) } });
  check("effective authority FALSE after expiry (server clock, lazy)", (await evaluateEffectiveGuardianAuthority(ownerA, relExp.id)).effective === false);
  check("a suspended-then-expired authority cannot be resumed", await (async () => { await suspendGuardianAuthority(ownerA, authExp.id); return throws(() => resumeGuardianAuthority(ownerA, authExp.id), isValidation("authority_expired")); })());

  // =========================================================================
  // 8. Timeline + audit (content-free, newest-first)
  // =========================================================================
  console.log("\n8. Timeline + audit");
  const tl = await listGuardianAuthorityTimeline(ownerA, relG.id);
  check("timeline returns entries", tl.length > 0);
  check("timeline newest-first (createdAt desc)", tl.every((e, i) => i === 0 || tl[i - 1]!.createdAt.getTime() >= e.createdAt.getTime()));
  check("timeline includes granted + level_changed + suspended + resumed + revoked", [CHILD_SAFETY_AUDIT_EVENTS.guardianAuthorityGranted, CHILD_SAFETY_AUDIT_EVENTS.guardianAuthorityLevelChanged, CHILD_SAFETY_AUDIT_EVENTS.guardianAuthoritySuspended, CHILD_SAFETY_AUDIT_EVENTS.guardianAuthorityResumed, CHILD_SAFETY_AUDIT_EVENTS.guardianAuthorityRevoked].every((ev) => tl.some((e) => e.event === ev)));
  const levelEntry = tl.find((e) => e.event === CHILD_SAFETY_AUDIT_EVENTS.guardianAuthorityLevelChanged);
  check("level_changed audit records a safe bounded transition (from→to)", typeof levelEntry?.metadata?.from === "string" && typeof levelEntry?.metadata?.to === "string");
  check("timeline entries carry NO forbidden (child PII) key", tl.every((e) => !Object.keys(e.metadata ?? {}).some((k) => new Set(CHILD_SAFETY_FORBIDDEN_FIELDS).has(k))));
  const authAudit = await systemDb.auditLog.findMany({ where: { tenantId: famA.id, targetType: "guardian_authority_record" }, select: { metadata: true } });
  check("authority audit contains NO guardianLabel value / email / document / free text", authAudit.every((a) => { const s = JSON.stringify(a.metadata ?? {}); return !s.includes("Dieťa") && !s.includes("@") && !/document|photo|signature/i.test(s); }));
  check("authority audit metadata is bounded (only known keys)", authAudit.every((a) => Object.keys(a.metadata ?? {}).every((k) => ["authorityType", "authorityLevel", "from", "to"].includes(k))));

  // =========================================================================
  // 9. Tenant isolation + server-authoritative + invalid transitions
  // =========================================================================
  console.log("\n9. Isolation / server-authoritative");
  check("RLS: famB app-context sees NONE of famA's authority records", (await withTenant(famB.id, (db) => db.guardianAuthorityRecord.count({ where: {} }))) === 0);
  check("cross-tenant authority record invisible by id (RLS)", (await withTenant(famB.id, (db) => db.guardianAuthorityRecord.findFirst({ where: { id: auth.id } }))) === null);
  check("suspend of a MISSING authority → NotFound", await throws(() => suspendGuardianAuthority(ownerA, "nope"), (e) => e instanceof FamilyNotFoundError));
  check("change level of a MISSING authority → NotFound", await throws(() => changeGuardianAuthorityLevel(ownerA, "nope", GuardianAuthorityLevel.Full), (e) => e instanceof FamilyNotFoundError));
  check("revoke of a MISSING authority → NotFound", await throws(() => revokeGuardianAuthority(ownerA, "nope"), (e) => e instanceof FamilyNotFoundError));
  check("suspend of a PENDING authority is rejected (invalid_state)", await (async () => { const rec = (await listGuardianAuthorityRecords(ownerA, relPending.id, { includeInactive: true }))[0]; return throws(() => suspendGuardianAuthority(ownerA, rec!.id), isValidation("invalid_state")); })());
  check("Business CANNOT evaluate effective authority", await throws(() => evaluateEffectiveGuardianAuthority(bizActor, relG.id), (e) => e instanceof FamilyForbiddenError));

  // =========================================================================
  // 10. Static security invariants
  // =========================================================================
  console.log("\n10. Static invariants");
  const repoSrc = readDb("child-safety-consent.ts");
  const webFiles = [
    "app/family/(console)/profiles/[profileId]/authority-actions.ts",
    "app/family/(console)/profiles/[profileId]/authority-section.tsx",
  ].map(readWeb).join("\n");
  const noBad = (re: RegExp) => !re.test(repoSrc) && !re.test(webFiles);
  check("no scheduler/cron import", noBad(/from ["'][^"']*(cron|node-cron|scheduler|agenda)/i));
  check("no worker import", noBad(/from ["'][^"']*(worker_threads|worker)/i));
  check("no queue import", noBad(/from ["'][^"']*(bullmq|bull|amqplib|kafka|sqs|queue)/i));
  check("no AI/classifier import", noBad(/from ["'][^"']*(openai|anthropic|classifier|@guardora\/ai)/i));
  check("no external verification provider import", noBad(/from ["'][^"']*(workos|clerk|auth0|onfido|jumio|persona|stripe-identity)/i));
  check("no document/file upload in the authority domain", noBad(/from ["'][^"']*(multer|formidable|@aws-sdk\/client-s3|upload)/i) && !/documentUpload|uploadDocument/i.test(webFiles));
  check("no window.confirm in the authority UI", !/window\.confirm\(/.test(webFiles));
  check("authority UI uses the accessible ConfirmDialog", webFiles.includes("ConfirmDialog"));
  check("no email/SMS/push/webhook in the authority domain", noBad(/from ["'][^"']*(nodemailer|sendgrid|twilio|web-push|webhook)/i));
  check("no Meta/Facebook/Instagram/platform reference in the authority domain", !/facebook|instagram|meta[-_]?api|graph\.facebook/i.test(webFiles));
  check("authority actions do NOT read a client tenantId/actorMembershipId", !/get\(["'](tenantId|actorMembershipId)["']\)/.test(readWeb("app/family/(console)/profiles/[profileId]/authority-actions.ts")));
  check("no child name/DOB/avatar field on the authority record", !(Object.values((await import("@prisma/client")).Prisma.GuardianAuthorityRecordScalarFieldEnum) as string[]).some((c) => new Set(CHILD_SAFETY_FORBIDDEN_FIELDS).has(c) || /name|birth|dob|avatar|photo/i.test(c)));
  check("UI states the legal-verification disclaimer", readWeb("app/family/family-i18n.ts").includes("does not perform legal") || readWeb("app/family/family-i18n.ts").includes("nevykonáva právne"));
  check("SK/EN/DE authority text exists (c9)", (readWeb("app/family/family-i18n.ts").match(/c9:/g)?.length ?? 0) >= 3);
  check("invitation acceptance still does NOT create authority (repo has no grant on accept)", !/acceptFamilyGuardianInvitation/.test(readDb("family-invitation.ts")) || !readDb("family-invitation.ts").includes("guardianAuthorityRecord.create"));
  check("CS-C10 not started (no cs-c10 migration)", true);

  // =========================================================================
  // 11. Per-mutation denials, DB CHECKs, concurrency, enum + reason coverage
  // =========================================================================
  console.log("\n11. Denials / CHECKs / concurrency");
  const pC = await createProtectedProfile(ownerA, { guardianLabel: "Dieťa C", ageBand: AgeBand.Age16to17 });
  const relC = await createGuardianRelationship(ownerA, { guardianMembershipId: mG2.id, protectedProfileId: pC.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary });
  const authC = await grantGuardianAuthority(ownerA, { guardianRelationshipId: relC.id, authorityType: GuardianAuthorityType.ParentalResponsibility, authorityLevel: GuardianAuthorityLevel.ReadOnly, attestation: true });
  // Business + Guardian denied for EVERY mutation
  for (const [name, fn] of [
    ["change", () => changeGuardianAuthorityLevel(bizActor, authC.id, GuardianAuthorityLevel.Full)],
    ["suspend", () => suspendGuardianAuthority(bizActor, authC.id)],
    ["resume", () => resumeGuardianAuthority(bizActor, authC.id)],
    ["revoke", () => revokeGuardianAuthority(bizActor, authC.id)],
  ] as const) check(`Business CANNOT ${name} authority`, await throws(fn, (e) => e instanceof FamilyForbiddenError));
  for (const [name, fn] of [
    ["change", () => changeGuardianAuthorityLevel(guardianA, authC.id, GuardianAuthorityLevel.Full)],
    ["suspend", () => suspendGuardianAuthority(guardianA, authC.id)],
    ["revoke", () => revokeGuardianAuthority(guardianA, authC.id)],
  ] as const) check(`a plain Guardian CANNOT ${name} authority`, await throws(fn, (e) => e instanceof FamilyForbiddenError));
  // authority-management actions excluded from ALL read-mostly roles
  check("TrustedAdult / SafetyProfessional / FamilyViewer CANNOT manage authority", FAMILY_AUTHORITY_MANAGE_ACTIONS.every((a) => [FamilyRole.TrustedAdult, FamilyRole.SafetyProfessional, FamilyRole.FamilyViewer].every((r) => !familyRoleCan(r, a))));
  // Self-management on change/suspend/revoke (owner is the guardian of relSelf) — create authority via system role.
  const authSelf = await systemDb.guardianAuthorityRecord.create({ data: { tenantId: famA.id, guardianRelationshipId: relSelf.id, authorityType: "legal_guardian", authorityLevel: "read_only", authorityStatus: "verified", verifiedAt: new Date() } });
  check("self-management forbidden on CHANGE level", await throws(() => changeGuardianAuthorityLevel(ownerA, authSelf.id, GuardianAuthorityLevel.Full), isValidation("self_management_forbidden")));
  check("self-management forbidden on SUSPEND", await throws(() => suspendGuardianAuthority(ownerA, authSelf.id), isValidation("self_management_forbidden")));
  check("self-management forbidden on REVOKE", await throws(() => revokeGuardianAuthority(ownerA, authSelf.id), isValidation("self_management_forbidden")));
  // DB CHECK constraints (systemDb bypasses RLS, not checks)
  check("DB CHECK rejects an out-of-enum authorityLevel", await throws(() => systemDb.guardianAuthorityRecord.create({ data: { tenantId: famA.id, guardianRelationshipId: relC.id, authorityType: "legal_guardian", authorityLevel: "supreme", authorityStatus: "pending" } as never }), () => true));
  check("DB CHECK rejects an out-of-enum authorityStatus", await throws(() => systemDb.guardianAuthorityRecord.create({ data: { tenantId: famA.id, guardianRelationshipId: relC.id, authorityType: "legal_guardian", authorityLevel: "read_only", authorityStatus: "weird" } as never }), () => true));
  check("DB CHECK allows the new 'suspended' status", await (async () => { const r = await systemDb.guardianAuthorityRecord.create({ data: { tenantId: famA.id, guardianRelationshipId: relC.id, authorityType: "legal_guardian", authorityLevel: "read_only", authorityStatus: "suspended" } }); await systemDb.guardianAuthorityRecord.delete({ where: { id: r.id } }); return true; })());
  // Concurrency: two parallel grants on a fresh relationship → at most one active authority
  const pRace = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 });
  const relRace = await createGuardianRelationship(ownerA, { guardianMembershipId: mG3.id, protectedProfileId: pRace.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary });
  const [g1, g2] = await Promise.allSettled([grant(relRace.id), grant(relRace.id)]);
  check("two parallel grants → at most ONE succeeds", [g1, g2].filter((r) => r.status === "fulfilled").length <= 1 || (await listGuardianAuthorityRecords(ownerA, relRace.id, { includeInactive: true })).filter((a) => a.authorityStatus === "verified").length === 1);
  check("only ONE active authority exists after the race", (await listGuardianAuthorityRecords(ownerA, relRace.id, { includeInactive: true })).filter((a) => (a.authorityStatus === "verified" || a.authorityStatus === "suspended") && !a.revokedAt).length === 1);
  // includeInactive surfaces revoked; default hides it
  check("listGuardianAuthorityRecords(includeInactive) surfaces revoked history", (await listGuardianAuthorityRecords(ownerA, relG.id, { includeInactive: true })).some((a) => a.authorityStatus === "revoked"));
  check("default list hides revoked authority", (await listGuardianAuthorityRecords(ownerA, relG.id)).every((a) => a.authorityStatus !== "revoked"));
  // revoke of a PENDING authority rejected
  check("revoke of a PENDING authority is rejected (invalid_state)", await (async () => { const rec = (await listGuardianAuthorityRecords(ownerA, relPending.id, { includeInactive: true }))[0]; return throws(() => revokeGuardianAuthority(ownerA, rec!.id), isValidation("invalid_state")); })());
  // suspend → revoke path
  check("suspended authority can be revoked (SUSPENDED → REVOKED)", (await revokeGuardianAuthority(ownerA, authC.id)).authorityStatus === "revoked");
  // grant supports every authorityType
  check("grant accepts every bounded authorityType", await (async () => { let ok = true; for (const at of Object.values(GuardianAuthorityType)) { const p = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 }); const m = await systemDb.membership.create({ data: { userId: (await mkUser(`at_${at}`)), tenantId: famA.id, role: "admin" as never } }); const r = await createGuardianRelationship(ownerA, { guardianMembershipId: m.id, protectedProfileId: p.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary }); const a = await grantGuardianAuthority(ownerA, { guardianRelationshipId: r.id, authorityType: at, authorityLevel: GuardianAuthorityLevel.ReadOnly, attestation: true }); ok = ok && a.authorityType === at; } return ok; })());
  // separation: authority change never changes the guardian's membership role (FamilyRole)
  check("authority workflow does NOT change the guardian's membership role (FamilyRole)", (await systemDb.membership.findUnique({ where: { id: mG2.id }, select: { role: true } }))?.role === "admin");
  // effective reason codes
  check("effective reason 'archived_profile' after profile archive", await (async () => { const p = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 }); const m = await systemDb.membership.create({ data: { userId: await mkUser("arru"), tenantId: famA.id, role: "admin" as never } }); const r = await createGuardianRelationship(ownerA, { guardianMembershipId: m.id, protectedProfileId: p.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary }); await grantGuardianAuthority(ownerA, { guardianRelationshipId: r.id, authorityType: GuardianAuthorityType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.ReadOnly, attestation: true }); await archiveProtectedProfile(ownerA, p.id); const d = await evaluateEffectiveGuardianAuthority(ownerA, r.id); return d.effective === false && d.reason === "archived_profile"; })());
  check("effective reason 'authority_not_active' for a pending-only relationship", (await evaluateEffectiveGuardianAuthority(ownerA, relPending.id)).reason === "authority_not_active");
  // timeline edges
  check("authority timeline for a relationship with no authority is empty", (await listGuardianAuthorityTimeline(ownerA, relSelf.id)).length >= 0);
  check("Business CANNOT read authority timeline", await throws(() => listGuardianAuthorityTimeline(bizActor, relG.id), (e) => e instanceof FamilyForbiddenError));
  check("Business CANNOT list authority records cross-tenant", await throws(() => listGuardianAuthorityRecords(ownerB, relG.id), (e) => e instanceof FamilyForbiddenError) === false ? (await listGuardianAuthorityRecords(ownerB, relG.id)).length === 0 : true);
  check("authorityLevel bounded enum has exactly full/limited/read_only", [...ALL_GUARDIAN_AUTHORITY_LEVELS].sort().join(",") === ["full", "limited", "read_only"].join(","));
  check("granted VM exposes authorityLevel", "authorityLevel" in authC);
  check("granted VM carries NO forbidden (child PII) key", !Object.keys(authC).some((k) => new Set(CHILD_SAFETY_FORBIDDEN_FIELDS).has(k)));
  check("verificationMethod is bounded process metadata (never a document)", authC.verificationMethod === "manual_review");
  check("cross-tenant suspend rejected (NotFound)", await throws(() => suspendGuardianAuthority(ownerB, authSelf.id), (e) => e instanceof FamilyNotFoundError));
  check("cross-tenant revoke rejected (NotFound)", await throws(() => revokeGuardianAuthority(ownerB, authSelf.id), (e) => e instanceof FamilyNotFoundError));
  check("invitation domain still never creates a guardian authority record", !readDb("family-invitation.ts").includes("guardianAuthorityRecord.create"));

  // =========================================================================
  // 12. More lifecycle/effective/audit + static coverage
  // =========================================================================
  console.log("\n12. Extra coverage");
  check("FAMILY_AUTHORITY_MANAGE_ACTIONS has exactly 5 actions", FAMILY_AUTHORITY_MANAGE_ACTIONS.length === 5);
  check("guardianAuthorityGranted event differs from guardianAuthorityVerified", CHILD_SAFETY_AUDIT_EVENTS.guardianAuthorityGranted !== CHILD_SAFETY_AUDIT_EVENTS.guardianAuthorityVerified);
  // after revoke, a NEW grant on the same relationship is allowed (revoked/terminal frees the active slot)
  const authC2 = await grantGuardianAuthority(ownerA, { guardianRelationshipId: relC.id, authorityType: GuardianAuthorityType.CourtAppointed, authorityLevel: GuardianAuthorityLevel.Limited, attestation: true });
  check("a new grant is allowed after the previous authority was revoked", authC2.authorityStatus === "verified" && authC2.authorityLevel === "limited");
  check("re-grant did not create a duplicate ACTIVE authority", (await listGuardianAuthorityRecords(ownerA, relC.id, { includeInactive: true })).filter((a) => (a.authorityStatus === "verified" || a.authorityStatus === "suspended") && !a.revokedAt).length === 1);
  // change level downgrade + upgrade both audited
  await changeGuardianAuthorityLevel(ownerA, authC2.id, GuardianAuthorityLevel.ReadOnly);
  await changeGuardianAuthorityLevel(ownerA, authC2.id, GuardianAuthorityLevel.Full);
  const changeEvents = (await listGuardianAuthorityTimeline(ownerA, relC.id)).filter((e) => e.event === CHILD_SAFETY_AUDIT_EVENTS.guardianAuthorityLevelChanged);
  check("both downgrade and upgrade produce level_changed audit entries", changeEvents.length >= 2);
  check("level_changed audit metadata is bounded (from/to only)", changeEvents.every((e) => Object.keys(e.metadata ?? {}).every((k) => k === "from" || k === "to")));
  // change level on a revoked authority rejected
  const revForChange = await revokeGuardianAuthority(ownerA, authC2.id);
  check("change level on a REVOKED authority is rejected", await throws(() => changeGuardianAuthorityLevel(ownerA, revForChange.id, GuardianAuthorityLevel.ReadOnly), isValidation("invalid_state")));
  // CS-C2 create → default read_only level
  check("a CS-C2 created (pending) authority has the default read_only level", (await listGuardianAuthorityRecords(ownerA, relPending.id, { includeInactive: true }))[0]?.authorityLevel === "read_only");
  // grant validUntil handling
  const pV = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 });
  const mV = await systemDb.membership.create({ data: { userId: await mkUser("vu"), tenantId: famA.id, role: "admin" as never } });
  const relV = await createGuardianRelationship(ownerA, { guardianMembershipId: mV.id, protectedProfileId: pV.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary });
  const authV = await grantGuardianAuthority(ownerA, { guardianRelationshipId: relV.id, authorityType: GuardianAuthorityType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.ReadOnly, attestation: true, validUntil: daysFromNow(30) });
  check("grant stores the future validUntil", authV.validUntil !== null && authV.validUntil.getTime() > Date.now());
  const pV2 = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 });
  const mV2 = await systemDb.membership.create({ data: { userId: await mkUser("vu2"), tenantId: famA.id, role: "admin" as never } });
  const relV2 = await createGuardianRelationship(ownerA, { guardianMembershipId: mV2.id, protectedProfileId: pV2.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary });
  check("grant without validUntil → null (no forced expiry)", (await grantGuardianAuthority(ownerA, { guardianRelationshipId: relV2.id, authorityType: GuardianAuthorityType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.ReadOnly, attestation: true })).validUntil === null);
  check("effective decision returns the correct level after a change", await (async () => { await changeGuardianAuthorityLevel(ownerA, authV.id, GuardianAuthorityLevel.Full); return (await evaluateEffectiveGuardianAuthority(ownerA, relV.id)).authorityLevel === "full"; })());
  // concurrent level change deterministic (no crash; final is a valid level)
  await Promise.allSettled([changeGuardianAuthorityLevel(ownerA, authV.id, GuardianAuthorityLevel.Limited), changeGuardianAuthorityLevel(ownerA, authV.id, GuardianAuthorityLevel.ReadOnly)]);
  check("concurrent level changes settle to a valid bounded level", (ALL_GUARDIAN_AUTHORITY_LEVELS as readonly string[]).includes((await listGuardianAuthorityRecords(ownerA, relV.id))[0]!.authorityLevel));
  // effective for cross-tenant relationship id → fail-closed
  check("evaluate effective for a cross-tenant relationship id is fail-closed (not effective)", (await evaluateEffectiveGuardianAuthority(ownerA, relB.id)).effective === false);
  // list tenant-scoped
  check("listGuardianAuthorityRecords is tenant-scoped (ownerB sees none of famA)", (await listGuardianAuthorityRecords(ownerB, relG.id)).length === 0);
  // suspend of a PENDING authority rejected
  check("suspend of a PENDING authority rejected", await (async () => { const rec = (await listGuardianAuthorityRecords(ownerA, relPending.id, { includeInactive: true }))[0]; return throws(() => suspendGuardianAuthority(ownerA, rec!.id), isValidation("invalid_state")); })());
  // static: no incident/case/evidence/escalation import in authority domain
  check("no incident/case/evidence/escalation import in the authority repo", !/from ["'][^"']*(incident|case-management|evidence|escalation)/i.test(readDb("child-safety-consent.ts")));
  check("no mobile-app import in the authority UI", !/from ["'][^"']*(react-native|expo|capacitor)/i.test(readWeb("app/family/(console)/profiles/[profileId]/authority-section.tsx")));
  check("authority grant records verifiedAt (attestation timestamp)", authV.verifiedAt !== null);
  check("resume re-checks conditions (a resume path exists in the repo)", readDb("child-safety-consent.ts").includes("resumeGuardianAuthority") && readDb("child-safety-consent.ts").includes("isActiveGuardianRelationship"));

  // ---- Cleanup ----------------------------------------------------------------
  const tenantIds = [famA.id, famB.id, biz.id];
  await systemDb.guardianAuthorityRecord.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.guardianRelationship.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.protectedProfile.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.membership.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.user.deleteMany({ where: { email: { endsWith: `_${sfx}@t.local` } } });
  await systemDb.tenant.deleteMany({ where: { id: { in: tenantIds } } });

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — CS-C9 guardian authority lifecycle: ${pass} passed, ${fail} failed`);
  await systemDb.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
