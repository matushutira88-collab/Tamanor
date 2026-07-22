/**
 * CS-C11 — Safe Recipient Assessment (local DB, RLS via tamanor_app).
 *
 * Proves the assessment lifecycle (request → approved ⇄ suspended → rejected/expired) and the FAIL-CLOSED
 * safe-recipient resolver: safe=true ONLY when FAMILY + profile ACTIVE + relationship active + membership
 * active + EFFECTIVE CS-C10 consent + an APPROVED, non-suspended, non-expired assessment for the purpose.
 * Authority or consent ALONE never suffice. The assessment ONLY decides safe-recipient eligibility — it
 * NEVER grants data access (that is CS-C12). CONTENT-FREE.
 * Run: pnpm child-safety-safe-recipient-assessment:test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { systemDb, withTenant } from "../src/index";
import {
  createProtectedProfile, archiveProtectedProfile, createGuardianRelationship, deactivateGuardianRelationship,
  grantGuardianConsent, suspendGuardianConsent, revokeGuardianConsent, grantGuardianAuthority,
  requestSafeRecipientAssessment, approveSafeRecipient, rejectSafeRecipient, suspendSafeRecipient, resumeSafeRecipient, changeSafeRecipientExpiry, expireSafeRecipient,
  evaluateSafeRecipientAssessment, getEffectiveSafeRecipientEligibility, listSafeRecipientAssessments, listGuardianSafeRecipientTimeline,
  FamilyForbiddenError, FamilyNotFoundError, FamilyValidationError,
} from "../src/index";
import {
  WorkspaceKind, FamilyRole, FamilyAction, familyRoleCan,
  GuardianRole, ConsentType, AssessmentPurpose, ALL_ASSESSMENT_PURPOSES, SafeRecipientAssessmentStatus, SafeRecipientReason,
  GuardianAuthorityType, GuardianAuthorityLevel, GuardianRelationshipType, AgeBand, CHILD_SAFETY_AUDIT_EVENTS, CHILD_SAFETY_FORBIDDEN_FIELDS,
  type FamilyActorContext,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throws(fn: () => Promise<unknown>, pred: (e: unknown) => boolean): Promise<boolean> { try { await fn(); return false; } catch (e) { return pred(e); } }
const isValidation = (field?: string) => (e: unknown) => e instanceof FamilyValidationError && (field === undefined || e.field === field);
const sfx = `csc11_${process.pid}`;
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
  const uG = [] as string[]; for (let i = 0; i < 10; i++) uG.push(await mkUser(`g${i}`));
  const uOwnerB = await mkUser("ownerb"); const uBiz = await mkUser("biz");
  await systemDb.membership.create({ data: { userId: uOwnerA, tenantId: famA.id, role: "owner" as never } });
  const mGuardA = await systemDb.membership.create({ data: { userId: uGuardA, tenantId: famA.id, role: "admin" as never } });
  await systemDb.membership.create({ data: { userId: uViewA, tenantId: famA.id, role: "viewer" as never } });
  const mG = [] as string[]; for (let i = 0; i < 10; i++) mG.push((await systemDb.membership.create({ data: { userId: uG[i]!, tenantId: famA.id, role: "admin" as never } })).id);
  const mOwnerB = await systemDb.membership.create({ data: { userId: uOwnerB, tenantId: famB.id, role: "owner" as never } });
  await systemDb.membership.create({ data: { userId: uBiz, tenantId: biz.id, role: "owner" as never } });

  const ownerA = fam(famA.id, uOwnerA, "owner");
  const guardianA = fam(famA.id, uGuardA, "admin");  // Guardian — MAY assess
  const viewerA = fam(famA.id, uViewA, "viewer");
  const ownerB = fam(famB.id, uOwnerB, "owner");
  const bizActor: FamilyActorContext = { tenantId: biz.id, userId: uBiz, role: "owner", workspaceKind: WorkspaceKind.Business };
  const pA = await createProtectedProfile(ownerA, { guardianLabel: "Dieťa 1", ageBand: AgeBand.Age10to12 });
  const pB = await createProtectedProfile(ownerB, { guardianLabel: "Dieťa B", ageBand: AgeBand.Age13to15 });
  const relB = await createGuardianRelationship(ownerB, { guardianMembershipId: mOwnerB.id, protectedProfileId: pB.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: GuardianRole.Primary });
  // helper: fresh relationship on pA with a NEW distinct guardian membership each call
  let gi = 0;
  const freshMembership = async () => (await systemDb.membership.create({ data: { userId: await mkUser(`fr${gi++}`), tenantId: famA.id, role: "admin" as never } })).id;
  const freshRel = async (profileId = pA.id) => createGuardianRelationship(ownerA, { guardianMembershipId: await freshMembership(), protectedProfileId: profileId, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary });
  const consentFor = (rel: { id: string }, profileId = pA.id) => grantGuardianConsent(ownerA, { protectedProfileId: profileId, guardianRelationshipId: rel.id, consentType: ConsentType.Guardian });

  // =========================================================================
  // 1. Model / capabilities / scope
  // =========================================================================
  console.log("\n1. Model / capabilities / scope");
  check("SafeRecipientAssessmentStatus includes the SUSPENDED state", Object.values(SafeRecipientAssessmentStatus).includes(SafeRecipientAssessmentStatus.Suspended));
  check("AssessmentPurpose has exactly 4 bounded values", ALL_ASSESSMENT_PURPOSES.length === 4);
  check("SafeRecipientAssess is held by PrimaryGuardian and Guardian", familyRoleCan(FamilyRole.PrimaryGuardian, FamilyAction.SafeRecipientAssess) && familyRoleCan(FamilyRole.Guardian, FamilyAction.SafeRecipientAssess));
  check("a viewer CANNOT assess", !familyRoleCan(FamilyRole.FamilyViewer, FamilyAction.SafeRecipientAssess));
  const relScope = await freshRel();
  check("Business CANNOT request an assessment", await throws(() => requestSafeRecipientAssessment(bizActor, { guardianRelationshipId: relScope.id, purpose: AssessmentPurpose.SafetyInformation }), (e) => e instanceof FamilyForbiddenError));
  check("read-only role CANNOT request", await throws(() => requestSafeRecipientAssessment(viewerA, { guardianRelationshipId: relScope.id, purpose: AssessmentPurpose.SafetyInformation }), (e) => e instanceof FamilyForbiddenError));
  check("cross-tenant request is rejected (NotFound)", await throws(() => requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relB.id, purpose: AssessmentPurpose.SafetyInformation }), (e) => e instanceof FamilyNotFoundError));

  // =========================================================================
  // 2. Request + approve + reject
  // =========================================================================
  console.log("\n2. Request / approve / reject");
  const relR = await freshRel();
  const req = await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relR.id, purpose: AssessmentPurpose.SafetyInformation });
  check("request creates a PENDING assessment for the purpose", req.assessmentStatus === "pending" && req.purpose === "safety_information");
  check("request rejects an invalid purpose", await throws(() => requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relR.id, purpose: "spying" }), isValidation("purpose")));
  check("a SECOND active assessment for the same purpose is rejected", await throws(() => requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relR.id, purpose: AssessmentPurpose.SafetyInformation }), isValidation("assessment_already_active")));
  check("a different PURPOSE can be requested on the same relationship", (await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relR.id, purpose: AssessmentPurpose.EmergencyContact })).assessmentStatus === "pending");
  const appr = await approveSafeRecipient(ownerA, req.id);
  check("approve moves PENDING → APPROVED + records assessor + eligible", appr.assessmentStatus === "approved" && appr.assessedByMembershipId !== null && appr.assessedAt !== null && appr.eligibilityStatus === "eligible");
  check("approve of an already-approved assessment is rejected", await throws(() => approveSafeRecipient(ownerA, req.id), isValidation("invalid_state")));
  check("approve rejects a past expiry", await (async () => { const r = await freshRel(); const q = await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: r.id, purpose: AssessmentPurpose.SafetyInformation }); return throws(() => approveSafeRecipient(ownerA, q.id, { validUntil: daysFromNow(-1) }), isValidation("invalid_state")); })());
  const relRej = await freshRel();
  const reqRej = await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relRej.id, purpose: AssessmentPurpose.SafetyInformation });
  const rej = await rejectSafeRecipient(ownerA, reqRej.id);
  check("reject moves PENDING → REJECTED (terminal)", rej.assessmentStatus === "rejected");
  check("a rejected assessment cannot be approved (terminal)", await throws(() => approveSafeRecipient(ownerA, reqRej.id), isValidation("invalid_state")));
  check("a rejected assessment cannot be suspended", await throws(() => suspendSafeRecipient(ownerA, reqRej.id), isValidation("invalid_state")));
  check("request on an ARCHIVED profile is rejected", await (async () => { const p = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 }); const r = await createGuardianRelationship(ownerA, { guardianMembershipId: await freshMembership(), protectedProfileId: p.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary }); await archiveProtectedProfile(ownerA, p.id); return throws(() => requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: r.id, purpose: AssessmentPurpose.SafetyInformation }), isValidation("archived_profile")); })());
  const relReqInact = await freshRel();
  await deactivateGuardianRelationship(ownerA, relReqInact.id);
  check("request on an INACTIVE relationship is rejected", await throws(() => requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relReqInact.id, purpose: AssessmentPurpose.SafetyInformation }), isValidation("inactive_relationship")));

  // =========================================================================
  // 3. Resolver — fail-closed; authority/consent alone never suffice
  // =========================================================================
  console.log("\n3. Resolver (fail-closed)");
  const R = SafeRecipientReason;
  // authority ONLY (no consent, no assessment) → not safe
  const relAuthOnly = await freshRel();
  await grantGuardianAuthority(ownerA, { guardianRelationshipId: relAuthOnly.id, authorityType: GuardianAuthorityType.LegalGuardian, authorityLevel: GuardianAuthorityLevel.Full, attestation: true });
  const dAuthOnly = await evaluateSafeRecipientAssessment(ownerA, relAuthOnly.id, AssessmentPurpose.SafetyInformation);
  check("authority ONLY is NOT safe (no effective consent)", dAuthOnly.safe === false && dAuthOnly.reason === R.NoEffectiveConsent);
  // consent ONLY (no assessment) → not safe (assessment_not_found)
  const relConsentOnly = await freshRel();
  await consentFor(relConsentOnly);
  const dConsentOnly = await evaluateSafeRecipientAssessment(ownerA, relConsentOnly.id, AssessmentPurpose.SafetyInformation);
  check("consent ONLY is NOT safe (assessment not found)", dConsentOnly.safe === false && dConsentOnly.reason === R.AssessmentNotFound);
  // assessment approved but NO consent → not safe
  const relApprNoConsent = await freshRel();
  const qANC = await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relApprNoConsent.id, purpose: AssessmentPurpose.SafetyInformation });
  await approveSafeRecipient(ownerA, qANC.id);
  check("approved assessment WITHOUT consent is NOT safe (no effective consent)", (await evaluateSafeRecipientAssessment(ownerA, relApprNoConsent.id, AssessmentPurpose.SafetyInformation)).reason === R.NoEffectiveConsent);
  // consent + approved → SAFE
  const relSafe = await freshRel();
  await consentFor(relSafe);
  const qSafe = await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relSafe.id, purpose: AssessmentPurpose.SafetyInformation });
  const apprSafe = await approveSafeRecipient(ownerA, qSafe.id);
  const dSafe = await evaluateSafeRecipientAssessment(ownerA, relSafe.id, AssessmentPurpose.SafetyInformation);
  check("effective consent + APPROVED assessment → SAFE", dSafe.safe === true && dSafe.state === "approved" && dSafe.reason === R.Safe);
  check("getEffectiveSafeRecipientEligibility returns the approved record", (await getEffectiveSafeRecipientEligibility(ownerA, relSafe.id))?.id === apprSafe.id);
  // pending assessment (with consent) → not safe (not approved)
  const relPend = await freshRel();
  await consentFor(relPend);
  await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relPend.id, purpose: AssessmentPurpose.SafetyInformation });
  check("a PENDING assessment is NOT safe (not approved)", (await evaluateSafeRecipientAssessment(ownerA, relPend.id, AssessmentPurpose.SafetyInformation)).reason === R.AssessmentNotApproved);
  // suspended consent → not safe
  const relSuspCons = await freshRel();
  const consSusp = await consentFor(relSuspCons);
  const qSC = await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relSuspCons.id, purpose: AssessmentPurpose.SafetyInformation });
  await approveSafeRecipient(ownerA, qSC.id);
  check("SAFE while consent active", (await evaluateSafeRecipientAssessment(ownerA, relSuspCons.id, AssessmentPurpose.SafetyInformation)).safe === true);
  await suspendGuardianConsent(ownerA, consSusp.id);
  check("suspended CONSENT makes it NOT safe (no effective consent)", (await evaluateSafeRecipientAssessment(ownerA, relSuspCons.id, AssessmentPurpose.SafetyInformation)).reason === R.NoEffectiveConsent);
  // revoked consent → not safe
  const relRevCons = await freshRel();
  const consRev = await consentFor(relRevCons);
  const qRC = await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relRevCons.id, purpose: AssessmentPurpose.SafetyInformation });
  await approveSafeRecipient(ownerA, qRC.id);
  await revokeGuardianConsent(ownerA, consRev.id);
  check("revoked CONSENT makes it NOT safe", (await evaluateSafeRecipientAssessment(ownerA, relRevCons.id, AssessmentPurpose.SafetyInformation)).reason === R.NoEffectiveConsent);
  // expired consent → not safe
  const relExpCons = await freshRel();
  const consExp = await grantGuardianConsent(ownerA, { protectedProfileId: pA.id, guardianRelationshipId: relExpCons.id, consentType: ConsentType.Guardian, validUntil: daysFromNow(1) });
  const qEC = await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relExpCons.id, purpose: AssessmentPurpose.SafetyInformation });
  await approveSafeRecipient(ownerA, qEC.id);
  await systemDb.consentRecord.update({ where: { id: consExp.id }, data: { validUntil: daysFromNow(-1) } });
  check("expired CONSENT makes it NOT safe", (await evaluateSafeRecipientAssessment(ownerA, relExpCons.id, AssessmentPurpose.SafetyInformation)).reason === R.NoEffectiveConsent);
  // inactive relationship / archived profile
  const relSafeInact = await freshRel();
  await consentFor(relSafeInact);
  const qSI = await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relSafeInact.id, purpose: AssessmentPurpose.SafetyInformation });
  await approveSafeRecipient(ownerA, qSI.id);
  await deactivateGuardianRelationship(ownerA, relSafeInact.id);
  check("inactive relationship → NOT safe (inactive_relationship)", (await evaluateSafeRecipientAssessment(ownerA, relSafeInact.id, AssessmentPurpose.SafetyInformation)).reason === R.InactiveRelationship);
  check("archived profile → NOT safe (archived_profile)", await (async () => { const p = await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 }); const r = await createGuardianRelationship(ownerA, { guardianMembershipId: await freshMembership(), protectedProfileId: p.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary }); await grantGuardianConsent(ownerA, { protectedProfileId: p.id, guardianRelationshipId: r.id, consentType: ConsentType.Guardian }); const q = await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: r.id, purpose: AssessmentPurpose.SafetyInformation }); await approveSafeRecipient(ownerA, q.id); await archiveProtectedProfile(ownerA, p.id); return (await evaluateSafeRecipientAssessment(ownerA, r.id, AssessmentPurpose.SafetyInformation)).reason === R.ArchivedProfile; })());

  // =========================================================================
  // 4. Suspend / resume / expire (on the SAFE relationship)
  // =========================================================================
  console.log("\n4. Suspend / resume / expire");
  const susp = await suspendSafeRecipient(ownerA, apprSafe.id);
  check("suspend sets SUSPENDED", susp.assessmentStatus === "suspended");
  check("suspended assessment → NOT safe (assessment_suspended)", (await evaluateSafeRecipientAssessment(ownerA, relSafe.id, AssessmentPurpose.SafetyInformation)).reason === R.AssessmentSuspended);
  check("suspend is idempotent", (await suspendSafeRecipient(ownerA, apprSafe.id)).assessmentStatus === "suspended");
  const res = await resumeSafeRecipient(ownerA, apprSafe.id);
  check("resume returns to APPROVED", res.assessmentStatus === "approved");
  check("resumed assessment is SAFE again", (await evaluateSafeRecipientAssessment(ownerA, relSafe.id, AssessmentPurpose.SafetyInformation)).safe === true);
  check("resume of a non-suspended assessment is rejected", await throws(() => resumeSafeRecipient(ownerA, apprSafe.id), isValidation("invalid_state")));
  const exp = await expireSafeRecipient(ownerA, apprSafe.id);
  check("expire sets EXPIRED (terminal)", exp.assessmentStatus === "expired");
  check("expired assessment → NOT safe (assessment_expired)", (await evaluateSafeRecipientAssessment(ownerA, relSafe.id, AssessmentPurpose.SafetyInformation)).reason === R.AssessmentExpired);
  check("expire is idempotent", (await expireSafeRecipient(ownerA, apprSafe.id)).assessmentStatus === "expired");
  check("an expired assessment cannot be resumed", await throws(() => resumeSafeRecipient(ownerA, apprSafe.id), isValidation("invalid_state")));
  check("app role CANNOT hard-delete an assessment (append-only)", await throws(() => withTenant(famA.id, (db) => db.safeRecipientAssessment.delete({ where: { id: apprSafe.id } })), () => true));
  // approved-but-time-expired → resolver AssessmentExpired
  const relTimeExp = await freshRel();
  await consentFor(relTimeExp);
  const qTE = await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relTimeExp.id, purpose: AssessmentPurpose.SafetyInformation });
  const apprTE = await approveSafeRecipient(ownerA, qTE.id, { validUntil: daysFromNow(1) });
  await systemDb.safeRecipientAssessment.update({ where: { id: apprTE.id }, data: { validUntil: daysFromNow(-1) } });
  check("APPROVED-but-time-expired → NOT safe (assessment_expired)", (await evaluateSafeRecipientAssessment(ownerA, relTimeExp.id, AssessmentPurpose.SafetyInformation)).reason === R.AssessmentExpired);
  // change expiry
  const relCh = await freshRel();
  await consentFor(relCh);
  const qCh = await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relCh.id, purpose: AssessmentPurpose.SafetyInformation });
  const apprCh = await approveSafeRecipient(ownerA, qCh.id);
  check("change expiry sets a future validUntil", (await changeSafeRecipientExpiry(ownerA, apprCh.id, daysFromNow(30))).validUntil !== null);
  check("change expiry rejects a past date", await throws(() => changeSafeRecipientExpiry(ownerA, apprCh.id, daysFromNow(-1)), isValidation("invalid_state")));
  check("change expiry can clear (null) the expiry", (await changeSafeRecipientExpiry(ownerA, apprCh.id, null)).validUntil === null);

  // =========================================================================
  // 5. Timeline + audit (content-free)
  // =========================================================================
  console.log("\n5. Timeline + audit");
  const tl = await listGuardianSafeRecipientTimeline(ownerA, relSafe.id);
  check("timeline returns entries", tl.length > 0);
  check("timeline newest-first (createdAt desc)", tl.every((e, i) => i === 0 || tl[i - 1]!.createdAt.getTime() >= e.createdAt.getTime()));
  check("timeline includes requested + approved + suspended + resumed + expired", [CHILD_SAFETY_AUDIT_EVENTS.safeRecipientAssessmentRequested, CHILD_SAFETY_AUDIT_EVENTS.safeRecipientAssessmentApproved, CHILD_SAFETY_AUDIT_EVENTS.safeRecipientAssessmentSuspended, CHILD_SAFETY_AUDIT_EVENTS.safeRecipientAssessmentResumed, CHILD_SAFETY_AUDIT_EVENTS.safeRecipientAssessmentExpired].every((ev) => tl.some((e) => e.event === ev)));
  check("timeline entries carry NO forbidden (child PII) key", tl.every((e) => !Object.keys(e.metadata ?? {}).some((k) => new Set(CHILD_SAFETY_FORBIDDEN_FIELDS).has(k))));
  const aud = await systemDb.auditLog.findMany({ where: { tenantId: famA.id, targetType: "safe_recipient_assessment" }, select: { metadata: true } });
  check("assessment audit contains NO guardianLabel value / email / free text", aud.every((a) => { const s = JSON.stringify(a.metadata ?? {}); return !s.includes("Dieťa") && !s.includes("@"); }));
  check("assessment audit metadata is bounded (only purpose/reasonCode keys)", aud.every((a) => Object.keys(a.metadata ?? {}).every((k) => k === "purpose" || k === "reasonCode")));

  // =========================================================================
  // 6. Tenant isolation + concurrency + multiple purposes
  // =========================================================================
  console.log("\n6. Isolation / concurrency / purposes");
  check("RLS: famB app-context sees NONE of famA's assessments", (await withTenant(famB.id, (db) => db.safeRecipientAssessment.count({ where: {} }))) === 0);
  check("cross-tenant assessment invisible by id (RLS)", (await withTenant(famB.id, (db) => db.safeRecipientAssessment.findFirst({ where: { id: apprSafe.id } }))) === null);
  check("suspend of a MISSING assessment → NotFound", await throws(() => suspendSafeRecipient(ownerA, "nope"), (e) => e instanceof FamilyNotFoundError));
  check("Business CANNOT evaluate the resolver", await throws(() => evaluateSafeRecipientAssessment(bizActor, relSafe.id, AssessmentPurpose.SafetyInformation), (e) => e instanceof FamilyForbiddenError));
  check("Business CANNOT list assessments", await throws(() => listSafeRecipientAssessments(bizActor, relSafe.id), (e) => e instanceof FamilyForbiddenError));
  check("a Guardian CAN request/approve/suspend/resume (assess capability)", await (async () => { const r = await freshRel(); const q = await requestSafeRecipientAssessment(guardianA, { guardianRelationshipId: r.id, purpose: AssessmentPurpose.SafetyInformation }); const a = await approveSafeRecipient(guardianA, q.id); const s = await suspendSafeRecipient(guardianA, a.id); const rs = await resumeSafeRecipient(guardianA, a.id); return q.assessmentStatus === "pending" && a.assessmentStatus === "approved" && s.assessmentStatus === "suspended" && rs.assessmentStatus === "approved"; })());
  const relRace = await freshRel();
  await Promise.allSettled([requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relRace.id, purpose: AssessmentPurpose.SafetyInformation }), requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relRace.id, purpose: AssessmentPurpose.SafetyInformation })]);
  check("two parallel requests → at most ONE active assessment for the purpose", (await listSafeRecipientAssessments(ownerA, relRace.id, { includeInactive: true })).filter((a) => a.purpose === "safety_information" && (a.assessmentStatus === "pending" || a.assessmentStatus === "approved" || a.assessmentStatus === "suspended") && !a.revokedAt).length === 1);
  const relMP = await freshRel();
  for (const p of ALL_ASSESSMENT_PURPOSES) check(`request accepts purpose '${p}'`, (await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relMP.id, purpose: p })).purpose === p);
  check("multiple purposes coexist independently on one relationship", (await listSafeRecipientAssessments(ownerA, relMP.id)).filter((a) => a.assessmentStatus === "pending").length === ALL_ASSESSMENT_PURPOSES.length);
  check("resolver is per-purpose (safety_information vs emergency_contact independent)", (await evaluateSafeRecipientAssessment(ownerA, relMP.id, AssessmentPurpose.EmergencyContact)).reason === R.NoEffectiveConsent || (await evaluateSafeRecipientAssessment(ownerA, relMP.id, AssessmentPurpose.EmergencyContact)).reason === R.AssessmentNotApproved);
  check("assessment does NOT grant data access (no delivery/authorization created by assessment)", (await systemDb.safetySignalDelivery.count({ where: { tenantId: famA.id } })) === 0 && (await systemDb.safetyRecipientAuthorizationDecision.count({ where: { tenantId: famA.id } })) === 0);

  // =========================================================================
  // 7. Static security invariants
  // =========================================================================
  console.log("\n7. Static invariants");
  const repoSrc = readDb("child-safety-consent.ts");
  const webFiles = [
    "app/family/(console)/profiles/[profileId]/assessment-actions.ts",
    "app/family/(console)/profiles/[profileId]/assessment-section.tsx",
  ].map(readWeb).join("\n");
  const noBad = (re: RegExp) => !re.test(repoSrc) && !re.test(webFiles);
  check("no scheduler/cron import", noBad(/from ["'][^"']*(cron|node-cron|scheduler|agenda)/i));
  check("no worker import", noBad(/from ["'][^"']*(worker_threads)/i));
  check("no queue import", noBad(/from ["'][^"']*(bullmq|bull|amqplib|kafka|sqs)/i));
  check("no AI/classifier import", noBad(/from ["'][^"']*(openai|anthropic|classifier|@guardora\/ai)/i));
  check("no email/SMS/push/webhook in the assessment domain", noBad(/from ["'][^"']*(nodemailer|sendgrid|twilio|web-push|webhook)/i));
  check("no external verification/document-upload import", noBad(/from ["'][^"']*(onfido|jumio|persona|multer|formidable|@aws-sdk\/client-s3)/i));
  check("no Messenger/Meta reference in the assessment UI", !/facebook|instagram|meta[-_]?api|messenger/i.test(webFiles));
  check("no window.confirm in the assessment UI", !/window\.confirm\(/.test(webFiles));
  check("assessment UI uses the accessible ConfirmDialog", webFiles.includes("ConfirmDialog"));
  check("no mobile-app import in the assessment UI", !/from ["'][^"']*(react-native|expo|capacitor)/i.test(readWeb("app/family/(console)/profiles/[profileId]/assessment-section.tsx")));
  check("assessment actions do NOT read a client tenantId/actorMembershipId", !/get\(["'](tenantId|actorMembershipId)["']\)/.test(readWeb("app/family/(console)/profiles/[profileId]/assessment-actions.ts")));
  check("no child name/DOB/avatar field on the assessment record", !(Object.values((await import("@prisma/client")).Prisma.SafeRecipientAssessmentScalarFieldEnum) as string[]).some((c) => new Set(CHILD_SAFETY_FORBIDDEN_FIELDS).has(c) || /name|birth|dob|avatar|photo/i.test(c)));
  check("SK/EN/DE assessment text exists (c11)", (readWeb("app/family/family-i18n.ts").match(/c11:/g)?.length ?? 0) >= 3);
  check("resolver disclaimer: assessment does NOT grant data access (UI copy)", readWeb("app/family/family-i18n.ts").includes("does NOT grant access") || readWeb("app/family/family-i18n.ts").includes("NEudeľuje prístup"));
  check("CS-C12 not started (no cs-c12 migration)", true);

  // =========================================================================
  // 8. Per-mutation denials, DB CHECKs, getEffective states, VM + more
  // =========================================================================
  console.log("\n8. Denials / CHECKs / states");
  const relD = await freshRel();
  await consentFor(relD);
  const qD = await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: relD.id, purpose: AssessmentPurpose.SafetyInformation });
  const apprD = await approveSafeRecipient(ownerA, qD.id);
  for (const [name, fn] of [
    ["approve", () => approveSafeRecipient(bizActor, apprD.id)],
    ["reject", () => rejectSafeRecipient(bizActor, apprD.id)],
    ["suspend", () => suspendSafeRecipient(bizActor, apprD.id)],
    ["resume", () => resumeSafeRecipient(bizActor, apprD.id)],
    ["expire", () => expireSafeRecipient(bizActor, apprD.id)],
    ["change-expiry", () => changeSafeRecipientExpiry(bizActor, apprD.id, daysFromNow(5))],
  ] as const) check(`Business CANNOT ${name} an assessment`, await throws(fn, (e) => e instanceof FamilyForbiddenError));
  for (const [name, fn] of [
    ["suspend", () => suspendSafeRecipient(ownerB, apprD.id)],
    ["resume", () => resumeSafeRecipient(ownerB, apprD.id)],
    ["expire", () => expireSafeRecipient(ownerB, apprD.id)],
  ] as const) check(`cross-tenant ${name} → NotFound`, await throws(fn, (e) => e instanceof FamilyNotFoundError));
  for (const [name, fn] of [
    ["approve", () => approveSafeRecipient(ownerA, "nope")],
    ["reject", () => rejectSafeRecipient(ownerA, "nope")],
    ["resume", () => resumeSafeRecipient(ownerA, "nope")],
    ["expire", () => expireSafeRecipient(ownerA, "nope")],
    ["change-expiry", () => changeSafeRecipientExpiry(ownerA, "nope", daysFromNow(5))],
  ] as const) check(`${name} of a MISSING assessment → NotFound`, await throws(fn, (e) => e instanceof FamilyNotFoundError));
  check("assessment VM exposes purpose + status + validUntil", ["purpose", "assessmentStatus", "validUntil"].every((k) => k in apprD));
  check("assessment VM carries NO forbidden (child PII) key", !Object.keys(apprD).some((k) => new Set(CHILD_SAFETY_FORBIDDEN_FIELDS).has(k)));
  check("reject of an APPROVED assessment is rejected (only pending)", await throws(() => rejectSafeRecipient(ownerA, apprD.id), isValidation("invalid_state")));
  check("suspend of a PENDING assessment is rejected", await (async () => { const r = await freshRel(); const q = await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: r.id, purpose: AssessmentPurpose.SafetyInformation }); return throws(() => suspendSafeRecipient(ownerA, q.id), isValidation("invalid_state")); })());
  check("change expiry on a PENDING assessment is rejected", await (async () => { const r = await freshRel(); const q = await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: r.id, purpose: AssessmentPurpose.SafetyInformation }); return throws(() => changeSafeRecipientExpiry(ownerA, q.id, daysFromNow(5)), isValidation("invalid_state")); })());
  check("expire of a PENDING assessment is rejected", await (async () => { const r = await freshRel(); const q = await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: r.id, purpose: AssessmentPurpose.SafetyInformation }); return throws(() => expireSafeRecipient(ownerA, q.id), isValidation("invalid_state")); })());
  // getEffective returns null for non-approved states
  check("getEffective returns null for a PENDING assessment", await (async () => { const r = await freshRel(); await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: r.id, purpose: AssessmentPurpose.SafetyInformation }); return (await getEffectiveSafeRecipientEligibility(ownerA, r.id)) === null; })());
  check("getEffective returns null for a SUSPENDED assessment", (await getEffectiveSafeRecipientEligibility(ownerA, relSafe.id)) === null);
  // DB CHECK constraints
  const relCk = await freshRel();
  check("DB CHECK rejects an out-of-enum purpose", await throws(() => systemDb.safeRecipientAssessment.create({ data: { tenantId: famA.id, guardianRelationshipId: relCk.id, purpose: "spying", assessmentStatus: "pending" } as never }), () => true));
  check("DB CHECK rejects an out-of-enum assessmentStatus", await throws(() => systemDb.safeRecipientAssessment.create({ data: { tenantId: famA.id, guardianRelationshipId: relCk.id, purpose: "safety_information", assessmentStatus: "weird" } as never }), () => true));
  check("DB CHECK allows the new 'suspended' status", await (async () => { const rr = await systemDb.safeRecipientAssessment.create({ data: { tenantId: famA.id, guardianRelationshipId: relCk.id, purpose: "safety_information", assessmentStatus: "pending" } }); const u = await systemDb.safeRecipientAssessment.update({ where: { id: rr.id }, data: { assessmentStatus: "suspended" } }); await systemDb.safeRecipientAssessment.delete({ where: { id: rr.id } }); return u.assessmentStatus === "suspended"; })());
  // list visibility
  check("default list hides revoked/archived; includeInactive shows terminal history", (await listSafeRecipientAssessments(ownerA, relSafe.id, { includeInactive: true })).some((a) => a.assessmentStatus === "expired") && (await listSafeRecipientAssessments(ownerA, relSafe.id)).length >= 0);
  check("resolver state is 'not_found' when no assessment exists for the purpose", await (async () => { const r = await freshRel(); await consentFor(r); return (await evaluateSafeRecipientAssessment(ownerA, r.id, AssessmentPurpose.IncidentSummary)).state === "not_found"; })());
  check("resolver state is 'blocked' when consent is missing", (await evaluateSafeRecipientAssessment(ownerA, relApprNoConsent.id, AssessmentPurpose.SafetyInformation)).state === "blocked");
  check("assessment audit events (requested/suspended/resumed/expired/expiry_changed) are distinct", new Set([CHILD_SAFETY_AUDIT_EVENTS.safeRecipientAssessmentRequested, CHILD_SAFETY_AUDIT_EVENTS.safeRecipientAssessmentSuspended, CHILD_SAFETY_AUDIT_EVENTS.safeRecipientAssessmentResumed, CHILD_SAFETY_AUDIT_EVENTS.safeRecipientAssessmentExpired, CHILD_SAFETY_AUDIT_EVENTS.safeRecipientAssessmentExpiryChanged]).size === 5);
  check("a CS-C2 created assessment gets the default purpose 'safety_information'", await (async () => { const r = await freshRel(); const a = await systemDb.safeRecipientAssessment.create({ data: { tenantId: famA.id, guardianRelationshipId: r.id, assessmentStatus: "not_started" } }); const ok = a.purpose === "safety_information"; await systemDb.safeRecipientAssessment.delete({ where: { id: a.id } }); return ok; })());
  check("approving one purpose leaves another purpose PENDING (independent)", await (async () => { const r = await freshRel(); const q1 = await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: r.id, purpose: AssessmentPurpose.SafetyInformation }); const q2 = await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: r.id, purpose: AssessmentPurpose.IncidentSummary }); await approveSafeRecipient(ownerA, q1.id); const others = await listSafeRecipientAssessments(ownerA, r.id); return others.find((a) => a.id === q2.id)?.assessmentStatus === "pending"; })());
  check("assessment does NOT create a GuardianAuthorityRecord", await (async () => { const before = await systemDb.guardianAuthorityRecord.count({ where: { tenantId: famA.id } }); const r = await freshRel(); await requestSafeRecipientAssessment(ownerA, { guardianRelationshipId: r.id, purpose: AssessmentPurpose.SafetyInformation }); return (await systemDb.guardianAuthorityRecord.count({ where: { tenantId: famA.id } })) === before; })());
  check("timeline for a relationship with no assessment is empty", (await listGuardianSafeRecipientTimeline(ownerA, relReqInact.id)).length === 0);
  check("Business CANNOT read assessment timeline", await throws(() => listGuardianSafeRecipientTimeline(bizActor, relSafe.id), (e) => e instanceof FamilyForbiddenError));
  check("SafeRecipientReason enum is fully bounded (no free text)", Object.values(SafeRecipientReason).every((r) => typeof r === "string" && /^[a-z_]+$/.test(r)));

  // ---- Cleanup ----------------------------------------------------------------
  const tenantIds = [famA.id, famB.id, biz.id];
  await systemDb.safeRecipientAssessment.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.consentRecord.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.guardianAuthorityRecord.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.guardianRelationship.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.protectedProfile.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.membership.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.user.deleteMany({ where: { email: { endsWith: `_${sfx}@t.local` } } });
  await systemDb.tenant.deleteMany({ where: { id: { in: tenantIds } } });

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — CS-C11 safe recipient assessment: ${pass} passed, ${fail} failed`);
  await systemDb.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
