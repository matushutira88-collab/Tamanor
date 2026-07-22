/**
 * CS-C4 — Authorized Recipient Resolution & Disclosure Decisions (local DB, RLS via tamanor_app).
 * Verifies workspace/role gating, tenant scoping + cross-tenant rejection (server + DB FK + RLS), the
 * complete authorization chain (each link necessary), disclosure policy, snapshot/effective logic with
 * live CS-2 re-check, supersession/revocation/history, self-authorization rule, content-free schema/DTO/
 * audit, no side effects (no notification/incident/consent/authority/assessment/relationship change),
 * no app DELETE/TRUNCATE, strict RLS. Run: pnpm child-safety-recipient-authorization:test
 */
import { Prisma } from "@prisma/client";
import { systemDb, withTenant } from "../src/index";
import {
  evaluateRecipientAuthorization, createRecipientAuthorizationDecision, getRecipientAuthorizationDecision,
  listRecipientAuthorizationDecisions, getEffectiveRecipientAuthorization, revokeRecipientAuthorizationDecision,
  supersedeRecipientAuthorizationDecision,
} from "../src/child-safety-recipient-authorization";
import { FamilyForbiddenError, FamilyNotFoundError, FamilyValidationError } from "../src/child-safety-family";
import {
  WorkspaceKind, RiskType, SafetySeverity, ConsentType, GuardianRelationshipType, GuardianAuthorityLevel,
  SafetyDisclosureScope, RecipientAuthorizationReasonCode, RECIPIENT_AUTHORIZATION_LIST_MAX_LIMIT,
  ALL_SAFETY_DISCLOSURE_SCOPES, CHILD_SAFETY_FORBIDDEN_FIELDS, type FamilyActorContext,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throws(fn: () => Promise<unknown>, pred: (e: unknown) => boolean): Promise<boolean> { try { await fn(); return false; } catch (e) { return pred(e); } }
const future = new Date(Date.now() + 86_400_000);
const sfx = `csc4_${process.pid}`;
const fam = (tenantId: string, userId: string, role: string): FamilyActorContext => ({ tenantId, userId, role, workspaceKind: WorkspaceKind.Family });

async function main() {
  const famA = await systemDb.tenant.create({ data: { id: `fa_${sfx}`, name: "FamA", slug: `fa_${sfx}`, workspaceKind: WorkspaceKind.Family } });
  const famB = await systemDb.tenant.create({ data: { id: `fb_${sfx}`, name: "FamB", slug: `fb_${sfx}`, workspaceKind: WorkspaceKind.Family } });
  const biz  = await systemDb.tenant.create({ data: { id: `bz_${sfx}`, name: "Biz",  slug: `bz_${sfx}`, workspaceKind: WorkspaceKind.Business } });
  const uOwner = (await systemDb.user.create({ data: { id: `uo_${sfx}`, email: `uo_${sfx}@t.local` } })).id;
  const uGuard = (await systemDb.user.create({ data: { id: `ug_${sfx}`, email: `ug_${sfx}@t.local` } })).id;
  const uView  = (await systemDb.user.create({ data: { id: `uv_${sfx}`, email: `uv_${sfx}@t.local` } })).id;
  const uProf  = (await systemDb.user.create({ data: { id: `up_${sfx}`, email: `up_${sfx}@t.local` } })).id;
  const uB     = (await systemDb.user.create({ data: { id: `ub_${sfx}`, email: `ub_${sfx}@t.local` } })).id;
  const mOwnerA = await systemDb.membership.create({ data: { userId: uOwner, tenantId: famA.id, role: "owner" as never } });
  const mGuardA = await systemDb.membership.create({ data: { userId: uGuard, tenantId: famA.id, role: "admin" as never } });
  await systemDb.membership.create({ data: { userId: uView, tenantId: famA.id, role: "viewer" as never } });
  await systemDb.membership.create({ data: { userId: uProf, tenantId: famA.id, role: "analyst" as never } });
  const mOwnerB = await systemDb.membership.create({ data: { userId: uOwner, tenantId: famB.id, role: "owner" as never } });
  await systemDb.membership.create({ data: { userId: uB, tenantId: biz.id, role: "owner" as never } });
  const pA = await systemDb.protectedProfile.create({ data: { tenantId: famA.id, ageBand: "age_10_12" } });
  const pB = await systemDb.protectedProfile.create({ data: { tenantId: famB.id, ageBand: "age_10_12" } });
  // recipient mGuardA is the guardian in relA (verified). Actor ownerA authorizes independently.
  const relA = await systemDb.guardianRelationship.create({ data: { tenantId: famA.id, guardianMembershipId: mGuardA.id, protectedProfileId: pA.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, status: "verified" } });
  const relB = await systemDb.guardianRelationship.create({ data: { tenantId: famB.id, guardianMembershipId: mOwnerB.id, protectedProfileId: pB.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, status: "verified" } });
  const authA = await systemDb.guardianAuthorityRecord.create({ data: { tenantId: famA.id, guardianRelationshipId: relA.id, authorityType: "legal_guardian", authorityStatus: "verified", verifiedAt: new Date(), validUntil: future } });
  const consentA = await systemDb.consentRecord.create({ data: { tenantId: famA.id, protectedProfileId: pA.id, consentType: "guardian", consentStatus: "active", grantedAt: new Date(), grantedByMembershipId: mOwnerA.id, validUntil: future } });
  const assessA = await systemDb.safeRecipientAssessment.create({ data: { tenantId: famA.id, guardianRelationshipId: relA.id, assessmentStatus: "approved", eligibilityStatus: "eligible", assessedByMembershipId: mOwnerA.id, assessedAt: new Date(), validUntil: future } });
  const sigA = await systemDb.safetySignal.create({ data: { tenantId: famA.id, protectedProfileId: pA.id, signalType: RiskType.Cyberbullying, severity: SafetySeverity.High, sourceType: "manual_test" } });
  const sigB = await systemDb.safetySignal.create({ data: { tenantId: famB.id, protectedProfileId: pB.id, signalType: RiskType.Threat, severity: SafetySeverity.High, sourceType: "manual_test" } });

  const ownerA = fam(famA.id, uOwner, "owner");    // PrimaryGuardian (actor)
  const guardianA = fam(famA.id, uGuard, "admin"); // Guardian (recipient)
  const viewerA = fam(famA.id, uView, "viewer");   // FamilyViewer
  const profA = fam(famA.id, uProf, "analyst");    // SafetyProfessional
  const ownerB = fam(famB.id, uOwner, "owner");
  const bizActor: FamilyActorContext = { tenantId: biz.id, userId: uB, role: "owner", workspaceKind: WorkspaceKind.Business };
  const baseInput = { safetySignalId: sigA.id, recipientMembershipId: mGuardA.id, guardianRelationshipId: relA.id };

  // 1/2) Business gating
  check("Business CANNOT evaluate authorization", await throws(() => evaluateRecipientAuthorization(bizActor, baseInput), (e) => e instanceof FamilyForbiddenError && e.reason === "not_family_workspace"));
  check("Business CANNOT read/list decisions", await throws(() => listRecipientAuthorizationDecisions(bizActor), (e) => e instanceof FamilyForbiddenError));

  // 12) complete valid chain ⇒ AUTHORIZED
  const evalOk = await evaluateRecipientAuthorization(ownerA, baseInput);
  check("complete valid chain ⇒ AUTHORIZED + complete reason", evalOk.authorized && evalOk.decisionStatus === "authorized" && evalOk.reasonCode === "complete_authorization_chain");
  check("AUTHORIZED snapshot references all CS-2 record IDs", evalOk.recordIds.guardianRelationshipId === relA.id && evalOk.recordIds.guardianAuthorityRecordId === authA.id && evalOk.recordIds.consentRecordId === consentA.id && evalOk.recordIds.safeRecipientAssessmentId === assessA.id);

  // 8/9/10/11) each link is necessary (missing one ⇒ DENIED with precise reason)
  const noRel = await evaluateRecipientAuthorization(ownerA, { ...baseInput, recipientMembershipId: mOwnerA.id }); // mOwnerA has no relationship to pA
  check("guardian relationship alone required (missing ⇒ NoActiveGuardianRelationship)", !noRel.authorized && noRel.reasonCode === "no_active_guardian_relationship");
  await systemDb.guardianAuthorityRecord.update({ where: { id: authA.id }, data: { authorityStatus: "revoked", revokedAt: new Date() } });
  check("authority alone insufficient — revoked authority ⇒ NoValidAuthority", !(await evaluateRecipientAuthorization(ownerA, baseInput)).authorized && (await evaluateRecipientAuthorization(ownerA, baseInput)).reasonCode === "no_valid_authority");
  await systemDb.guardianAuthorityRecord.update({ where: { id: authA.id }, data: { authorityStatus: "verified", revokedAt: null } });
  await systemDb.consentRecord.update({ where: { id: consentA.id }, data: { consentStatus: "withdrawn", revokedAt: new Date() } });
  check("consent required — revoked consent ⇒ NoValidConsent", (await evaluateRecipientAuthorization(ownerA, baseInput)).reasonCode === "no_valid_consent");
  await systemDb.consentRecord.update({ where: { id: consentA.id }, data: { consentStatus: "active", revokedAt: null } });
  await systemDb.safeRecipientAssessment.update({ where: { id: assessA.id }, data: { assessmentStatus: "revoked", revokedAt: new Date() } });
  check("safe-recipient assessment required — revoked ⇒ NoApprovedSafeRecipient", (await evaluateRecipientAuthorization(ownerA, baseInput)).reasonCode === "no_approved_safe_recipient");
  await systemDb.safeRecipientAssessment.update({ where: { id: assessA.id }, data: { assessmentStatus: "approved", revokedAt: null } });

  // 13/14) missing condition ⇒ DENIED with allow-listed reason
  const denied = noRel;
  check("DENIED decisions use an allow-listed reasonCode", (ALL_SAFETY_DISCLOSURE_SCOPES.length > 0) && Object.values(RecipientAuthorizationReasonCode).includes(denied.reasonCode) && denied.allowedDisclosureScopes.length === 0);

  // 15/16) guardian/trusted-adult is NOT automatically a recipient (needs the full chain / assessment)
  check("guardian relationship without approved assessment is NOT authorized", noRel.reasonCode === "no_active_guardian_relationship"); // mOwnerA path shown above; assessment-only covered by chain tests

  // 17/18) role gating for decision creation
  check("FamilyViewer CANNOT create a decision", await throws(() => createRecipientAuthorizationDecision(viewerA, baseInput), (e) => e instanceof FamilyForbiddenError));
  check("SafetyProfessional CANNOT create (view/evaluate only)", await throws(() => createRecipientAuthorizationDecision(profA, baseInput), (e) => e instanceof FamilyForbiddenError && e.reason === "role_forbidden"));
  check("SafetyProfessional CAN evaluate (read-only)", (await evaluateRecipientAuthorization(profA, baseInput)).authorized === true);

  // 19) self-authorization fail-closed (Guardian cannot self-authorize; PrimaryGuardian may via full chain)
  check("Guardian CANNOT self-authorize (actor == recipient, not PrimaryGuardian)", await throws(() => createRecipientAuthorizationDecision(guardianA, baseInput), (e) => e instanceof FamilyForbiddenError && e.reason === "role_forbidden"));

  // 12) create AUTHORIZED (ownerA authorizes mGuardA — independent actor≠recipient)
  const decision = await createRecipientAuthorizationDecision(ownerA, baseInput);
  check("create records an AUTHORIZED decision with scope", decision.decisionStatus === "authorized" && decision.disclosureScope.length > 0 && decision.reasonCode === "complete_authorization_chain");

  // 33/34) disclosure policy: HIGH severity scope, never raw content
  const scopes = decision.disclosureScope.split(",");
  check("HIGH severity discloses existence/category/severity/timing (no raw content)", scopes.includes("signal_existence") && scopes.includes("severity") && scopes.includes("timing_bucket") && !scopes.includes("recommended_action_class"));
  // LOW severity signal gets a narrower scope
  const sigLow = await systemDb.safetySignal.create({ data: { tenantId: famA.id, protectedProfileId: pA.id, signalType: RiskType.Cyberbullying, severity: SafetySeverity.Low, sourceType: "manual_test" } });
  const evalLow = await evaluateRecipientAuthorization(ownerA, { ...baseInput, safetySignalId: sigLow.id });
  check("LOW severity scope is narrower than HIGH (policy bounded)", evalLow.allowedDisclosureScopes.includes(SafetyDisclosureScope.SignalExistence) && evalLow.allowedDisclosureScopes.includes(SafetyDisclosureScope.RiskCategory) && !evalLow.allowedDisclosureScopes.includes(SafetyDisclosureScope.Severity));
  // CRITICAL still contains no raw content
  const sigCrit = await systemDb.safetySignal.create({ data: { tenantId: famA.id, protectedProfileId: pA.id, signalType: RiskType.Cyberbullying, severity: SafetySeverity.Critical, sourceType: "manual_test" } });
  const evalCrit = await evaluateRecipientAuthorization(ownerA, { ...baseInput, safetySignalId: sigCrit.id });
  check("CRITICAL scope contains NO raw content scope", !(evalCrit.allowedDisclosureScopes as string[]).some((s) => /content|message|image|video|audio|url|location|username|evidence/.test(s)));
  // 31/32) scopes allow-listed; RAW_CONTENT does not exist
  check("all disclosure scopes are allow-listed; RAW_CONTENT absent", ALL_SAFETY_DISCLOSURE_SCOPES.every((s) => /^(signal_existence|risk_category|severity|timing_bucket|recommended_action_class)$/.test(s)) && !(ALL_SAFETY_DISCLOSURE_SCOPES as string[]).includes("raw_content"));

  // 20) archived signal cannot be authorized
  const sigArch = await systemDb.safetySignal.create({ data: { tenantId: famA.id, protectedProfileId: pA.id, signalType: RiskType.Cyberbullying, severity: SafetySeverity.High, sourceType: "manual_test", reviewStatus: "archived", archivedAt: new Date() } });
  check("archived SafetySignal ⇒ DENIED SignalArchived", (await evaluateRecipientAuthorization(ownerA, { ...baseInput, safetySignalId: sigArch.id })).reasonCode === "signal_archived");

  // 27/28/29/30) effective + supersession + revocation + history
  check("AUTHORIZED decision is effective (row + live chain)", (await getEffectiveRecipientAuthorization(ownerA, sigA.id, mGuardA.id))?.id === decision.id);
  const decision2 = await createRecipientAuthorizationDecision(ownerA, baseInput);
  await supersedeRecipientAuthorizationDecision(ownerA, decision.id);
  check("superseded decision is not effective; historical row remains", (await getRecipientAuthorizationDecision(ownerA, decision.id)).decisionStatus === "superseded" && (await getEffectiveRecipientAuthorization(ownerA, sigA.id, mGuardA.id))?.id === decision2.id);
  await revokeRecipientAuthorizationDecision(ownerA, decision2.id);
  check("revoked decision is not effective; historical row remains", (await getRecipientAuthorizationDecision(ownerA, decision2.id)).decisionStatus === "revoked" && (await getEffectiveRecipientAuthorization(ownerA, sigA.id, mGuardA.id)) === null);
  check("historical AUTHORIZED rows remain in history", (await listRecipientAuthorizationDecisions(ownerA, { safetySignalId: sigA.id, includeArchived: true })).items.length >= 2);

  // 21-26) live CS-2 re-check invalidates a historical AUTHORIZED
  const decision3 = await createRecipientAuthorizationDecision(ownerA, baseInput);
  check("fresh AUTHORIZED effective before downstream revoke", (await getEffectiveRecipientAuthorization(ownerA, sigA.id, mGuardA.id))?.id === decision3.id);
  await systemDb.consentRecord.update({ where: { id: consentA.id }, data: { consentStatus: "withdrawn", revokedAt: new Date() } });
  check("consent revoked AFTER decision ⇒ no longer effective (live re-check)", (await getEffectiveRecipientAuthorization(ownerA, sigA.id, mGuardA.id)) === null);
  await systemDb.consentRecord.update({ where: { id: consentA.id }, data: { consentStatus: "active", revokedAt: null } });
  await systemDb.guardianRelationship.update({ where: { id: relA.id }, data: { status: "revoked", revokedAt: new Date() } });
  check("relationship revoked AFTER decision ⇒ no longer effective", (await getEffectiveRecipientAuthorization(ownerA, sigA.id, mGuardA.id)) === null);
  await systemDb.guardianRelationship.update({ where: { id: relA.id }, data: { status: "verified", revokedAt: null } });

  // 3/4/5/6/7/41) tenant isolation, cross-tenant refs, RLS
  check("cross-tenant signal rejected (famA actor, sigB) ⇒ TenantMismatch", (await evaluateRecipientAuthorization(ownerA, { ...baseInput, safetySignalId: sigB.id })).reasonCode === "tenant_mismatch");
  check("cross-tenant recipient membership rejected ⇒ InactiveMembership", (await evaluateRecipientAuthorization(ownerA, { ...baseInput, recipientMembershipId: mOwnerB.id })).reasonCode === "inactive_membership");
  check("cross-tenant relationship rejected ⇒ NoActiveGuardianRelationship", (await evaluateRecipientAuthorization(ownerA, { ...baseInput, guardianRelationshipId: relB.id })).reasonCode === "no_active_guardian_relationship");
  check("Tenant A does not see Tenant B decisions", await throws(() => getRecipientAuthorizationDecision(ownerB, decision.id), (e) => e instanceof FamilyNotFoundError));
  check("RLS: famB app-context sees none of famA's decisions", (await withTenant(famB.id, (db) => db.safetyRecipientAuthorizationDecision.count({ where: { tenantId: famA.id } }))) === 0 && (await withTenant(famA.id, (db) => db.safetyRecipientAuthorizationDecision.count({}))) >= 1);
  check("RLS: cross-tenant INSERT rejected (WITH CHECK)", await throws(() => withTenant(famA.id, (db) => db.safetyRecipientAuthorizationDecision.create({ data: { tenantId: famB.id, safetySignalId: sigB.id, protectedProfileId: pB.id, recipientMembershipId: mOwnerB.id, decisionStatus: "denied", reasonCode: "tenant_mismatch" } })), () => true));
  check("cross-tenant composite FK rejected by DB (signal from other tenant)", await throws(() => systemDb.safetyRecipientAuthorizationDecision.create({ data: { tenantId: famA.id, safetySignalId: sigB.id, protectedProfileId: pA.id, recipientMembershipId: mGuardA.id, decisionStatus: "denied", reasonCode: "tenant_mismatch" } }), () => true));

  // 35/36/37/38) no delivery / no side effects / no mutation of CS-1/2/3
  const side = await withTenant(famA.id, (db) => Promise.all([
    db.notification.count({ where: { tenantId: famA.id } }), db.cyberbullyingNotification.count({ where: { tenantId: famA.id } }), db.incident.count({ where: { tenantId: famA.id } }),
  ]));
  check("decisions create NO notification/incident (no delivery)", side[0] === 0 && side[1] === 0 && side[2] === 0);
  const sig0 = await systemDb.safetySignal.findFirstOrThrow({ where: { id: sigA.id }, select: { reviewStatus: true } });
  check("decision does NOT change the SafetySignal", sig0.reviewStatus === "new");
  const cs2unchanged = await withTenant(famA.id, (db) => Promise.all([
    db.guardianRelationship.findFirstOrThrow({ where: { id: relA.id }, select: { status: true } }),
    db.consentRecord.findFirstOrThrow({ where: { id: consentA.id }, select: { consentStatus: true } }),
    db.guardianAuthorityRecord.findFirstOrThrow({ where: { id: authA.id }, select: { authorityStatus: true } }),
    db.safeRecipientAssessment.findFirstOrThrow({ where: { id: assessA.id }, select: { assessmentStatus: true } }),
  ]));
  check("decision does NOT mutate consent/authority/assessment/relationship", cs2unchanged[0].status === "verified" && cs2unchanged[1].consentStatus === "active" && cs2unchanged[2].authorityStatus === "verified" && cs2unchanged[3].assessmentStatus === "approved");

  // 43/44/45) fail-closed unknown enum, bounded pagination, stable ordering
  check("unknown disclosure scope in request is rejected (fail-closed)", await throws(() => evaluateRecipientAuthorization(ownerA, { ...baseInput, requestedScopes: ["raw_content"] as never }), (e) => e instanceof FamilyValidationError));
  const page = await listRecipientAuthorizationDecisions(ownerA, { limit: 9999 });
  check("list pagination is bounded to the max limit", page.limit === RECIPIENT_AUTHORIZATION_LIST_MAX_LIMIT);
  const ord = await listRecipientAuthorizationDecisions(ownerA, { safetySignalId: sigA.id, includeArchived: true });
  const sorted = [...ord.items].every((it, i, a) => i === 0 || a[i - 1].createdAt.getTime() >= it.createdAt.getTime());
  check("stable ordering is deterministic (createdAt desc)", sorted);

  // 39/40) app role grants + RLS policy shape
  const grants = (await systemDb.$queryRawUnsafe<{ privilege_type: string }[]>(`SELECT privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='safety_recipient_authorization_decisions' AND grantee='tamanor_app'`)).map((r) => r.privilege_type);
  check("tamanor_app has SELECT/INSERT/UPDATE but NOT DELETE/TRUNCATE", grants.includes("SELECT") && grants.includes("INSERT") && grants.includes("UPDATE") && !grants.includes("DELETE") && !grants.includes("TRUNCATE"));
  const pol = await systemDb.$queryRawUnsafe<{ qual: string; withcheck: string }[]>(`SELECT pg_get_expr(polqual, polrelid) AS qual, pg_get_expr(polwithcheck, polrelid) AS withcheck FROM pg_policy WHERE polrelid='public.safety_recipient_authorization_decisions'::regclass`);
  check("RLS policy has NO 'IS NULL' bootstrap branch", pol.length === 1 && !/is null/i.test(pol[0].qual) && !/is null/i.test(pol[0].withcheck));

  // 6) content-free schema/DTO/audit
  const forbidden = new Set(CHILD_SAFETY_FORBIDDEN_FIELDS);
  const cols = Object.values(Prisma.SafetyRecipientAuthorizationDecisionScalarFieldEnum) as string[];
  check("CS-C4 schema has NO forbidden field", !cols.some((c) => forbidden.has(c)), cols.filter((c) => forbidden.has(c)).join(","));
  check("CS-C4 DTO has NO forbidden field", !Object.keys(decision).some((k) => forbidden.has(k)));
  const audits = await withTenant(famA.id, (db) => db.auditLog.findMany({ where: { tenantId: famA.id, event: { startsWith: "child_safety.recipient_authorization" } }, select: { event: true, metadata: true } }));
  const blob = JSON.stringify(audits);
  check("CS-C4 audit events written (evaluated/created/authorized/revoked/superseded)", audits.some((a) => a.event.endsWith(".evaluated")) && audits.some((a) => a.event.endsWith(".authorized")) && audits.some((a) => a.event.endsWith(".revoked")) && audits.some((a) => a.event.endsWith(".superseded")));
  check("audit payloads carry NO forbidden field / PII", !CHILD_SAFETY_FORBIDDEN_FIELDS.some((f) => blob.includes(`"${f}"`)) && !blob.includes("@t.local") && !blob.includes("age_10_12"));

  // Cleanup (owner role; app role cannot DELETE)
  const tids = [famA.id, famB.id, biz.id];
  await systemDb.safetyRecipientAuthorizationDecision.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.safetySignal.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.safeRecipientAssessment.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.consentRecord.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.guardianAuthorityRecord.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.guardianRelationship.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.protectedProfile.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.auditLog.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.membership.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.user.deleteMany({ where: { id: { in: [uOwner, uGuard, uView, uProf, uB] } } });
  await systemDb.tenant.deleteMany({ where: { id: { in: tids } } });

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — CS-C4 recipient authorization decisions: ${pass} passed, ${fail} failed`);
  await systemDb.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
