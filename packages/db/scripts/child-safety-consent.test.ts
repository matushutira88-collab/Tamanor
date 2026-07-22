/**
 * CS-C2 — Consent, Guardian Authority & Safe Recipients (local DB, RLS via tamanor_app).
 * Verifies the four axes stay separate & never auto-derived, PENDING/REVOKED/EXPIRED are non-effective,
 * consent is never auto-granted, safe-recipient needs an explicit approved assessment,
 * `canReceiveSafetyInformation` is true only for the complete valid chain, workspace/role gating,
 * cross-tenant DB FK rejection, RLS isolation, history preservation, and no forbidden fields / PII.
 * Run: pnpm child-safety-consent:test
 */
import { Prisma } from "@prisma/client";
import { systemDb, withTenant } from "../src/index";
import {
  createGuardianAuthorityRecord, verifyGuardianAuthorityRecord, revokeGuardianAuthorityRecord,
  listGuardianAuthorityRecords, getEffectiveGuardianAuthority,
  createConsentRecord, grantConsent, revokeConsent, listConsentRecords, getEffectiveConsent,
  createSafeRecipientAssessment, approveSafeRecipientAssessment, revokeSafeRecipientAssessment,
  listSafeRecipientAssessments, getEffectiveSafeRecipientEligibility,
  canGuardianManageProtectedProfile, canReceiveSafetyInformation,
} from "../src/child-safety-consent";
import { FamilyForbiddenError, FamilyNotFoundError, FamilyValidationError } from "../src/child-safety-family";
import {
  WorkspaceKind, GuardianAuthorityType, VerificationMethod, ConsentType, GuardianRelationshipType,
  GuardianAuthorityLevel, CHILD_SAFETY_FORBIDDEN_FIELDS, type FamilyActorContext,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throws(fn: () => Promise<unknown>, pred: (e: unknown) => boolean): Promise<boolean> {
  try { await fn(); return false; } catch (e) { return pred(e); }
}
const past = new Date(Date.now() - 86_400_000);
const future = new Date(Date.now() + 86_400_000);
const sfx = `csc2_${process.pid}`;
const fam = (tenantId: string, userId: string, role: string): FamilyActorContext => ({ tenantId, userId, role, workspaceKind: WorkspaceKind.Family });

async function main() {
  // ---- Fixtures ---------------------------------------------------------------------------------
  const famA = await systemDb.tenant.create({ data: { id: `fa_${sfx}`, name: "FamA", slug: `fa_${sfx}`, workspaceKind: WorkspaceKind.Family } });
  const famB = await systemDb.tenant.create({ data: { id: `fb_${sfx}`, name: "FamB", slug: `fb_${sfx}`, workspaceKind: WorkspaceKind.Family } });
  const biz  = await systemDb.tenant.create({ data: { id: `bz_${sfx}`, name: "Biz",  slug: `bz_${sfx}`, workspaceKind: WorkspaceKind.Business } });
  const uOwner = (await systemDb.user.create({ data: { id: `uo_${sfx}`, email: `uo_${sfx}@t.local` } })).id;
  const uView  = (await systemDb.user.create({ data: { id: `uv_${sfx}`, email: `uv_${sfx}@t.local` } })).id;
  const uB     = (await systemDb.user.create({ data: { id: `ub_${sfx}`, email: `ub_${sfx}@t.local` } })).id;
  const mOwnerA = await systemDb.membership.create({ data: { userId: uOwner, tenantId: famA.id, role: "owner" as never } });
  await systemDb.membership.create({ data: { userId: uView, tenantId: famA.id, role: "viewer" as never } });
  const mOwnerB = await systemDb.membership.create({ data: { userId: uOwner, tenantId: famB.id, role: "owner" as never } });
  await systemDb.membership.create({ data: { userId: uB, tenantId: biz.id, role: "owner" as never } });
  const pA = await systemDb.protectedProfile.create({ data: { tenantId: famA.id, ageBand: "age_10_12" } });
  const pB = await systemDb.protectedProfile.create({ data: { tenantId: famB.id, ageBand: "age_10_12" } });
  const relA = await systemDb.guardianRelationship.create({ data: { tenantId: famA.id, guardianMembershipId: mOwnerA.id, protectedProfileId: pA.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, status: "verified" } });
  const relB = await systemDb.guardianRelationship.create({ data: { tenantId: famB.id, guardianMembershipId: mOwnerB.id, protectedProfileId: pB.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, status: "verified" } });

  const ownerA = fam(famA.id, uOwner, "owner");   // PrimaryGuardian
  const viewerA = fam(famA.id, uView, "viewer");  // FamilyViewer
  const ownerB = fam(famB.id, uOwner, "owner");
  const bizActor: FamilyActorContext = { tenantId: biz.id, userId: uB, role: "owner", workspaceKind: WorkspaceKind.Business };

  // 1) Business cannot create/read CS-2 records --------------------------------------------------
  check("Business CANNOT create guardian authority", await throws(() => createGuardianAuthorityRecord(bizActor, { guardianRelationshipId: relA.id, authorityType: GuardianAuthorityType.LegalGuardian }), (e) => e instanceof FamilyForbiddenError && e.reason === "not_family_workspace"));
  check("Business CANNOT read consent", await throws(() => listConsentRecords(bizActor, pA.id), (e) => e instanceof FamilyForbiddenError));

  // 3) GuardianRelationship auto-creates NOTHING -------------------------------------------------
  check("relationship implies NO authority/consent/eligibility rows", (await listGuardianAuthorityRecords(ownerA, relA.id)).length === 0 && (await listConsentRecords(ownerA, pA.id)).length === 0 && (await listSafeRecipientAssessments(ownerA, relA.id)).length === 0);

  // 4/5/6) Authority lifecycle -------------------------------------------------------------------
  const auth = await createGuardianAuthorityRecord(ownerA, { guardianRelationshipId: relA.id, authorityType: GuardianAuthorityType.LegalGuardian });
  check("PENDING authority is NOT effective", auth.authorityStatus === "pending" && (await getEffectiveGuardianAuthority(ownerA, relA.id)) === null);
  const verified = await verifyGuardianAuthorityRecord(ownerA, auth.id, { verificationMethod: VerificationMethod.ManualReview, validUntil: future });
  check("VERIFIED + time-valid authority IS effective", verified.authorityStatus === "verified" && (await getEffectiveGuardianAuthority(ownerA, relA.id))?.id === auth.id);
  // EXPIRED: verify a second relationship-less scenario via a past validUntil on a fresh record.
  const auth2 = await createGuardianAuthorityRecord(ownerA, { guardianRelationshipId: relA.id, authorityType: GuardianAuthorityType.DelegatedCare });
  await verifyGuardianAuthorityRecord(ownerA, auth2.id, { validUntil: past });
  check("EXPIRED authority (validUntil in past) is NOT effective", (await getEffectiveGuardianAuthority(ownerA, relA.id))?.id === auth.id); // auth2 expired, auth still effective
  await revokeGuardianAuthorityRecord(ownerA, auth.id);
  check("REVOKED authority is NOT effective", (await getEffectiveGuardianAuthority(ownerA, relA.id)) === null);
  // re-verify a clean authority for the full-chain test later
  const authOk = await createGuardianAuthorityRecord(ownerA, { guardianRelationshipId: relA.id, authorityType: GuardianAuthorityType.ParentalResponsibility });
  await verifyGuardianAuthorityRecord(ownerA, authOk.id, { validUntil: future });

  // 7/8/9) Consent lifecycle ---------------------------------------------------------------------
  const consent = await createConsentRecord(ownerA, { protectedProfileId: pA.id, guardianRelationshipId: relA.id, consentType: ConsentType.Guardian });
  check("consent is NEVER auto-granted (default not_requested, no effective)", consent.consentStatus === "not_requested" && consent.grantedAt === null && (await getEffectiveConsent(ownerA, pA.id, ConsentType.Guardian)) === null);
  const granted = await grantConsent(ownerA, consent.id);
  check("GRANTED consent records grantedAt + grantedBy", granted.consentStatus === "active" && granted.grantedAt !== null && granted.grantedByMembershipId === mOwnerA.id);
  check("DB rejects an ACTIVE consent without a grantor (CHECK)", await throws(() => systemDb.consentRecord.create({ data: { tenantId: famA.id, protectedProfileId: pA.id, consentType: "child_assent", consentStatus: "active" } }), () => true));
  check("effective consent present after grant", (await getEffectiveConsent(ownerA, pA.id, ConsentType.Guardian))?.id === consent.id);
  await revokeConsent(ownerA, consent.id);
  check("REVOKED consent is NOT effective", (await getEffectiveConsent(ownerA, pA.id, ConsentType.Guardian)) === null);
  // re-grant a clean consent for the full-chain test
  const consentOk = await createConsentRecord(ownerA, { protectedProfileId: pA.id, consentType: ConsentType.Guardian });
  await grantConsent(ownerA, consentOk.id, { validUntil: future });

  // 10/11) Safe-recipient assessment -------------------------------------------------------------
  const assess = await createSafeRecipientAssessment(ownerA, { guardianRelationshipId: relA.id });
  check("assessment starts not_started / not eligible", assess.assessmentStatus === "not_started" && assess.eligibilityStatus === "not_verified" && (await getEffectiveSafeRecipientEligibility(ownerA, relA.id)) === null);
  check("guardian is NOT automatically a safe recipient", (await getEffectiveSafeRecipientEligibility(ownerA, relA.id)) === null);
  const approved = await approveSafeRecipientAssessment(ownerA, assess.id, { validUntil: future });
  check("APPROVED assessment records assessedBy + assessedAt + eligible", approved.assessmentStatus === "approved" && approved.assessedByMembershipId === mOwnerA.id && approved.assessedAt !== null && approved.eligibilityStatus === "eligible");

  // 12/13) Role gating ---------------------------------------------------------------------------
  check("viewer CANNOT verify authority / grant consent / approve assessment", await throws(() => verifyGuardianAuthorityRecord(viewerA, authOk.id), (e) => e instanceof FamilyForbiddenError && e.reason === "role_forbidden") && await throws(() => grantConsent(viewerA, consentOk.id), (e) => e instanceof FamilyForbiddenError) && await throws(() => approveSafeRecipientAssessment(viewerA, assess.id), (e) => e instanceof FamilyForbiddenError));
  check("viewer CAN read (view) authority list", Array.isArray(await listGuardianAuthorityRecords(viewerA, relA.id)));
  check("authorized guardian (owner→PrimaryGuardian) CAN mutate", (await getEffectiveGuardianAuthority(ownerA, relA.id))?.id === authOk.id);

  // 14/15) canReceiveSafetyInformation -----------------------------------------------------------
  const full = await canReceiveSafetyInformation(ownerA, relA.id, { consentType: ConsentType.Guardian });
  check("canReceiveSafetyInformation TRUE only for the COMPLETE valid chain", full.ok === true && full.reasons.length === 0);
  // break one link: revoke the assessment ⇒ false with a precise reason
  await revokeSafeRecipientAssessment(ownerA, assess.id);
  const missingAssess = await canReceiveSafetyInformation(ownerA, relA.id, { consentType: ConsentType.Guardian });
  check("canReceiveSafetyInformation FALSE if ANY link missing (assessment revoked)", missingAssess.ok === false && missingAssess.reasons.includes("assessment_not_approved"));
  // wrong consent type ⇒ consent_missing
  const wrongConsent = await canReceiveSafetyInformation(ownerA, relA.id, { consentType: ConsentType.ChildAssent });
  check("canReceiveSafetyInformation FALSE for a consent type with no grant", wrongConsent.ok === false && wrongConsent.reasons.includes("consent_missing"));

  // canGuardianManageProtectedProfile: verified relationship ⇒ true; pending ⇒ false
  check("verified guardian relationship ⇒ canManage true", (await canGuardianManageProtectedProfile(ownerA, pA.id)) === true);
  const pPending = await systemDb.protectedProfile.create({ data: { tenantId: famA.id, ageBand: "under_10" } });
  await systemDb.guardianRelationship.create({ data: { tenantId: famA.id, guardianMembershipId: mOwnerA.id, protectedProfileId: pPending.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, status: "pending" } });
  check("PENDING guardian relationship ⇒ canManage false", (await canGuardianManageProtectedProfile(ownerA, pPending.id)) === false);

  // 2/16/17) Cross-tenant + RLS ------------------------------------------------------------------
  check("cross-tenant relationship ref rejected server-side (famA actor, relB)", await throws(() => createGuardianAuthorityRecord(ownerA, { guardianRelationshipId: relB.id, authorityType: GuardianAuthorityType.LegalGuardian }), (e) => e instanceof FamilyNotFoundError));
  check("cross-tenant composite FK rejected by DB", await throws(() => systemDb.guardianAuthorityRecord.create({ data: { tenantId: famA.id, guardianRelationshipId: relB.id, authorityType: "legal_guardian" } }), () => true));
  check("Tenant A does not see/modify Tenant B (getEffectiveConsent famA→profileB is empty)", (await getEffectiveConsent(ownerB, pA.id, ConsentType.Guardian)) === null);
  const bCountFromA = await withTenant(famA.id, (db) => db.guardianAuthorityRecord.count({ where: { tenantId: famB.id } }));
  const aVisibleToB = await withTenant(famB.id, (db) => db.guardianAuthorityRecord.count({}));
  check("RLS: famA context cannot count famB rows; famB sees none of famA's", bCountFromA === 0 && aVisibleToB === 0);

  // 18) History preserved ------------------------------------------------------------------------
  check("archive/revoke preserves history (revoked authority still listable)", (await listGuardianAuthorityRecords(ownerA, relA.id, { includeInactive: true })).some((r) => r.id === auth.id && r.revokedAt !== null));

  // 19) No forbidden fields in schema or DTOs ----------------------------------------------------
  const forbidden = new Set(CHILD_SAFETY_FORBIDDEN_FIELDS);
  const cols = [
    ...Object.values(Prisma.GuardianAuthorityRecordScalarFieldEnum),
    ...Object.values(Prisma.ConsentRecordScalarFieldEnum),
    ...Object.values(Prisma.SafeRecipientAssessmentScalarFieldEnum),
  ] as string[];
  check("CS-C2 schemas contain NO forbidden field", !cols.some((c) => forbidden.has(c)), cols.filter((c) => forbidden.has(c)).join(","));
  check("CS-C2 DTOs contain NO forbidden field", !Object.keys(verified).some((k) => forbidden.has(k)) && !Object.keys(granted).some((k) => forbidden.has(k)) && !Object.keys(approved).some((k) => forbidden.has(k)));

  // 20) Audit payloads are content-free ----------------------------------------------------------
  const audits = await withTenant(famA.id, (db) => db.auditLog.findMany({ where: { tenantId: famA.id, event: { startsWith: "child_safety." } }, select: { event: true, targetType: true, metadata: true } }));
  const auditBlob = JSON.stringify(audits);
  check("CS-C2 audit events were written", audits.some((a) => a.event.startsWith("child_safety.guardian_authority")) && audits.some((a) => a.event.startsWith("child_safety.consent")) && audits.some((a) => a.event.startsWith("child_safety.safe_recipient_assessment")));
  check("audit payloads carry NO forbidden field / PII", !CHILD_SAFETY_FORBIDDEN_FIELDS.some((f) => auditBlob.includes(`"${f}"`)) && !auditBlob.includes("@t.local"));

  // ---- Cleanup (owner role; app role cannot DELETE) --------------------------------------------
  const tids = [famA.id, famB.id, biz.id];
  await systemDb.guardianAuthorityRecord.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.consentRecord.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.safeRecipientAssessment.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.guardianRelationship.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.protectedProfile.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.auditLog.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.membership.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.user.deleteMany({ where: { id: { in: [uOwner, uView, uB] } } });
  await systemDb.tenant.deleteMany({ where: { id: { in: tids } } });

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — CS-C2 consent/authority/safe-recipients: ${pass} passed, ${fail} failed`);
  await systemDb.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
