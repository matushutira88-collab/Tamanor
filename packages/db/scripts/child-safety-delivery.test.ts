/**
 * CS-C5 — Internal Delivery Foundation (local DB, RLS via tamanor_app).
 * Verifies workspace/role gating, tenant scoping + cross-tenant rejection (server + DB FK + RLS),
 * delivery only from an EFFECTIVE CS-C4 decision, scope subset, internal-only channel, idempotency,
 * lifecycle transitions + recipient-only ack/decline, effective delivery with live CS-4 re-check,
 * history/revoke/expiry/supersession, content-free schema/DTO/audit, ZERO external side effects, no
 * app DELETE/TRUNCATE, strict RLS, and no forbidden imports. Run: pnpm child-safety-delivery:test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma } from "@prisma/client";
import { systemDb, withTenant } from "../src/index";
import { createRecipientAuthorizationDecision, revokeRecipientAuthorizationDecision, supersedeRecipientAuthorizationDecision } from "../src/child-safety-recipient-authorization";
import {
  evaluateSafetySignalDeliveryEligibility, createSafetySignalDelivery, getSafetySignalDelivery, listSafetySignalDeliveries,
  makeSafetySignalDeliveryAvailable, acknowledgeSafetySignalDelivery, declineSafetySignalDelivery,
  revokeSafetySignalDelivery, supersedeSafetySignalDelivery, archiveSafetySignalDelivery, getEffectiveSafetySignalDelivery,
  DeliveryNotEligibleError,
} from "../src/child-safety-delivery";
import { FamilyForbiddenError, FamilyNotFoundError, FamilyValidationError } from "../src/child-safety-family";
import {
  WorkspaceKind, RiskType, SafetySeverity, GuardianRelationshipType, GuardianAuthorityLevel,
  SafetyDeliveryChannel, SafetyDeliveryStatus, SAFETY_DELIVERY_LIST_MAX_LIMIT, ALL_SAFETY_DELIVERY_CHANNELS,
  ALL_SAFETY_DISCLOSURE_SCOPES, SafetyRecommendedActionClass, CHILD_SAFETY_FORBIDDEN_FIELDS, type FamilyActorContext,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throws(fn: () => Promise<unknown>, pred: (e: unknown) => boolean): Promise<boolean> { try { await fn(); return false; } catch (e) { return pred(e); } }
const future = new Date(Date.now() + 86_400_000);
const sfx = `csc5_${process.pid}`;
const fam = (tenantId: string, userId: string, role: string): FamilyActorContext => ({ tenantId, userId, role, workspaceKind: WorkspaceKind.Family });
let keyN = 0; const key = () => `dlv_key_${sfx}_${keyN++}`;

async function fullChain(tenantId: string, profileId: string, guardianMembershipId: string, relType: string, grantorMembershipId: string) {
  const rel = await systemDb.guardianRelationship.create({ data: { tenantId, guardianMembershipId, protectedProfileId: profileId, relationshipType: relType, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: "secondary", status: "verified" } });
  await systemDb.guardianAuthorityRecord.create({ data: { tenantId, guardianRelationshipId: rel.id, authorityType: "legal_guardian", authorityStatus: "verified", verifiedAt: new Date(), validUntil: future } });
  await systemDb.safeRecipientAssessment.create({ data: { tenantId, guardianRelationshipId: rel.id, assessmentStatus: "approved", eligibilityStatus: "eligible", assessedByMembershipId: grantorMembershipId, assessedAt: new Date(), validUntil: future } });
  return rel;
}

async function main() {
  const famA = await systemDb.tenant.create({ data: { id: `fa_${sfx}`, name: "FamA", slug: `fa_${sfx}`, workspaceKind: WorkspaceKind.Family } });
  const famB = await systemDb.tenant.create({ data: { id: `fb_${sfx}`, name: "FamB", slug: `fb_${sfx}`, workspaceKind: WorkspaceKind.Family } });
  const biz  = await systemDb.tenant.create({ data: { id: `bz_${sfx}`, name: "Biz",  slug: `bz_${sfx}`, workspaceKind: WorkspaceKind.Business } });
  const uOwner = (await systemDb.user.create({ data: { id: `uo_${sfx}`, email: `uo_${sfx}@t.local` } })).id;
  const uGuard = (await systemDb.user.create({ data: { id: `ug_${sfx}`, email: `ug_${sfx}@t.local` } })).id;
  const uTrust = (await systemDb.user.create({ data: { id: `ut_${sfx}`, email: `ut_${sfx}@t.local` } })).id;
  const uView  = (await systemDb.user.create({ data: { id: `uv_${sfx}`, email: `uv_${sfx}@t.local` } })).id;
  const uProf  = (await systemDb.user.create({ data: { id: `up_${sfx}`, email: `up_${sfx}@t.local` } })).id;
  const uB     = (await systemDb.user.create({ data: { id: `ub_${sfx}`, email: `ub_${sfx}@t.local` } })).id;
  const mOwnerA = await systemDb.membership.create({ data: { userId: uOwner, tenantId: famA.id, role: "owner" as never } });
  const mGuardA = await systemDb.membership.create({ data: { userId: uGuard, tenantId: famA.id, role: "admin" as never } });
  const mTrustA = await systemDb.membership.create({ data: { userId: uTrust, tenantId: famA.id, role: "reviewer" as never } });
  await systemDb.membership.create({ data: { userId: uView, tenantId: famA.id, role: "viewer" as never } });
  await systemDb.membership.create({ data: { userId: uProf, tenantId: famA.id, role: "analyst" as never } });
  const mOwnerB = await systemDb.membership.create({ data: { userId: uOwner, tenantId: famB.id, role: "owner" as never } });
  await systemDb.membership.create({ data: { userId: uB, tenantId: biz.id, role: "owner" as never } });
  const pA = await systemDb.protectedProfile.create({ data: { tenantId: famA.id, ageBand: "age_10_12" } });
  const pB = await systemDb.protectedProfile.create({ data: { tenantId: famB.id, ageBand: "age_10_12" } });
  const consentA = await systemDb.consentRecord.create({ data: { tenantId: famA.id, protectedProfileId: pA.id, consentType: "guardian", consentStatus: "active", grantedAt: new Date(), grantedByMembershipId: mOwnerA.id, validUntil: future } });
  const relA = await fullChain(famA.id, pA.id, mGuardA.id, GuardianRelationshipType.Parent, mOwnerA.id);       // recipient = mGuardA (Guardian)
  const relT = await fullChain(famA.id, pA.id, mTrustA.id, GuardianRelationshipType.TrustedAdult, mOwnerA.id);  // recipient = mTrustA (TrustedAdult)
  const sigA = await systemDb.safetySignal.create({ data: { tenantId: famA.id, protectedProfileId: pA.id, signalType: RiskType.Cyberbullying, severity: SafetySeverity.High, sourceType: "manual_test" } });
  // cross-tenant chain
  const consentB = await systemDb.consentRecord.create({ data: { tenantId: famB.id, protectedProfileId: pB.id, consentType: "guardian", consentStatus: "active", grantedAt: new Date(), grantedByMembershipId: mOwnerB.id, validUntil: future } });
  const relB = await fullChain(famB.id, pB.id, mOwnerB.id, GuardianRelationshipType.Parent, mOwnerB.id);
  const sigB = await systemDb.safetySignal.create({ data: { tenantId: famB.id, protectedProfileId: pB.id, signalType: RiskType.Threat, severity: SafetySeverity.High, sourceType: "manual_test" } });
  void consentA; void consentB;

  const ownerA = fam(famA.id, uOwner, "owner");     // PrimaryGuardian (creator/actor)
  const guardianA = fam(famA.id, uGuard, "admin");  // Guardian (recipient of decisionA)
  const trustedA = fam(famA.id, uTrust, "reviewer");// TrustedAdult (recipient of decisionT)
  const viewerA = fam(famA.id, uView, "viewer");    // FamilyViewer
  const profA = fam(famA.id, uProf, "analyst");     // SafetyProfessional
  const ownerB = fam(famB.id, uOwner, "owner");
  const bizActor: FamilyActorContext = { tenantId: biz.id, userId: uB, role: "owner", workspaceKind: WorkspaceKind.Business };

  // CS-C4 AUTHORIZED decisions (ownerA authorizes recipients)
  const decA = await createRecipientAuthorizationDecision(ownerA, { safetySignalId: sigA.id, recipientMembershipId: mGuardA.id, guardianRelationshipId: relA.id });
  const decT = await createRecipientAuthorizationDecision(ownerA, { safetySignalId: sigA.id, recipientMembershipId: mTrustA.id, guardianRelationshipId: relT.id });
  const decB = await createRecipientAuthorizationDecision(ownerB, { safetySignalId: sigB.id, recipientMembershipId: mOwnerB.id, guardianRelationshipId: relB.id });
  check("setup: CS-C4 decisions are AUTHORIZED", decA.decisionStatus === "authorized" && decT.decisionStatus === "authorized" && decB.decisionStatus === "authorized");

  // 1/2/3) Business gating
  check("Business CANNOT evaluate delivery", await throws(() => evaluateSafetySignalDeliveryEligibility(bizActor, { recipientAuthorizationDecisionId: decA.id }), (e) => e instanceof FamilyForbiddenError && e.reason === "not_family_workspace"));
  check("Business CANNOT create delivery", await throws(() => createSafetySignalDelivery(bizActor, { recipientAuthorizationDecisionId: decA.id, idempotencyKey: key() }), (e) => e instanceof FamilyForbiddenError));
  check("Business CANNOT read/list delivery", await throws(() => listSafetySignalDeliveries(bizActor), (e) => e instanceof FamilyForbiddenError));

  // 10/11/12/13/14/15/16) delivery requires an EFFECTIVE authorization
  check("delivery without any decision fails (not found)", await throws(() => createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: `nope_${sfx}`, idempotencyKey: key() }), (e) => e instanceof DeliveryNotEligibleError && e.reasonCode === "authorization_not_found"));
  const decDenied = await createRecipientAuthorizationDecision(ownerA, { safetySignalId: sigA.id, recipientMembershipId: mOwnerA.id, guardianRelationshipId: relA.id }); // mOwnerA not recipient of relA ⇒ DENIED
  check("DENIED authorization is not enough", decDenied.decisionStatus === "denied" && await throws(() => createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decDenied.id, idempotencyKey: key() }), (e) => e instanceof DeliveryNotEligibleError));
  const decRev = await createRecipientAuthorizationDecision(ownerA, { safetySignalId: sigA.id, recipientMembershipId: mGuardA.id, guardianRelationshipId: relA.id });
  await revokeRecipientAuthorizationDecision(ownerA, decRev.id);
  check("REVOKED authorization is not enough", (await evaluateSafetySignalDeliveryEligibility(ownerA, { recipientAuthorizationDecisionId: decRev.id })).reasonCode === "authorization_revoked");
  const decSup = await createRecipientAuthorizationDecision(ownerA, { safetySignalId: sigA.id, recipientMembershipId: mGuardA.id, guardianRelationshipId: relA.id });
  await supersedeRecipientAuthorizationDecision(ownerA, decSup.id);
  check("SUPERSEDED authorization is not enough", (await evaluateSafetySignalDeliveryEligibility(ownerA, { recipientAuthorizationDecisionId: decSup.id })).reasonCode === "authorization_superseded");

  // 17) effective authorization ⇒ prepared delivery
  const del = await createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decA.id, idempotencyKey: key() });
  check("effective authorization ⇒ prepared delivery", del.deliveryStatus === "prepared" && del.deliveryChannel === "internal_inbox" && del.disclosureScope.length > 0);
  check("delivery snapshots signalType + severity (no raw content)", del.signalType === "CYBERBULLYING" && del.severity === "high");

  // 18/19/20) scope subset / policy / no raw content
  check("requested scope must be subset of authorized", await throws(() => createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decA.id, idempotencyKey: key(), requestedScopes: ["recommended_action_class"] }), (e) => e instanceof DeliveryNotEligibleError && e.reasonCode === "scope_not_authorized"));
  check("RAW_CONTENT scope does not exist", !(ALL_SAFETY_DISCLOSURE_SCOPES as string[]).includes("raw_content"));

  // 21/22) channel
  check("unsupported delivery channel rejected", await throws(() => createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decA.id, idempotencyKey: key(), deliveryChannel: "email" }), (e) => e instanceof FamilyValidationError));
  check("only INTERNAL_INBOX channel exists", ALL_SAFETY_DELIVERY_CHANNELS.length === 1 && ALL_SAFETY_DELIVERY_CHANNELS[0] === SafetyDeliveryChannel.InternalInbox);

  // 23/24/25) idempotency
  const ikey = key();
  const d1 = await createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decA.id, idempotencyKey: ikey });
  const d2 = await createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decA.id, idempotencyKey: ikey });
  check("duplicate idempotency key returns the SAME row (no second)", d1.id === d2.id);
  check("invalid idempotency key rejected", await throws(() => createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decA.id, idempotencyKey: "has spaces/and:slashes" }), (e) => e instanceof FamilyValidationError));
  check("over-long idempotency key rejected", await throws(() => createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decA.id, idempotencyKey: "x".repeat(65) }), (e) => e instanceof FamilyValidationError));

  // 26/27/28) lifecycle
  const av = await makeSafetySignalDeliveryAvailable(ownerA, del.id);
  check("prepared → available works", av.deliveryStatus === "available" && av.availableAt !== null);
  const dAck = await createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decA.id, idempotencyKey: key() });
  await makeSafetySignalDeliveryAvailable(ownerA, dAck.id);
  const acked = await acknowledgeSafetySignalDelivery(guardianA, dAck.id); // guardianA IS the recipient
  check("available → acknowledged by recipient works", acked.deliveryStatus === "acknowledged" && acked.acknowledgedByMembershipId === mGuardA.id && acked.acknowledgedAt !== null);
  const dDec = await createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decA.id, idempotencyKey: key() });
  await makeSafetySignalDeliveryAvailable(ownerA, dDec.id);
  const declined = await declineSafetySignalDelivery(guardianA, dDec.id);
  check("available → declined by recipient works", declined.deliveryStatus === "declined" && declined.declinedByMembershipId === mGuardA.id);

  // 29/30) actor cannot ack/decline for another recipient
  const dOther = await createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decA.id, idempotencyKey: key() });
  await makeSafetySignalDeliveryAvailable(ownerA, dOther.id);
  check("actor cannot acknowledge for another recipient", await throws(() => acknowledgeSafetySignalDelivery(ownerA, dOther.id), (e) => e instanceof FamilyForbiddenError && e.reason === "role_forbidden"));
  check("actor cannot decline for another recipient", await throws(() => declineSafetySignalDelivery(ownerA, dOther.id), (e) => e instanceof FamilyForbiddenError));

  // 31/32/33/34) role gating
  check("FamilyViewer CANNOT view/change delivery", await throws(() => listSafetySignalDeliveries(viewerA), (e) => e instanceof FamilyForbiddenError));
  check("TrustedAdult CANNOT create delivery", await throws(() => createSafetySignalDelivery(trustedA, { recipientAuthorizationDecisionId: decT.id, idempotencyKey: key() }), (e) => e instanceof FamilyForbiddenError));
  check("SafetyProfessional CANNOT create delivery", await throws(() => createSafetySignalDelivery(profA, { recipientAuthorizationDecisionId: decA.id, idempotencyKey: key() }), (e) => e instanceof FamilyForbiddenError));
  const delT = await createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decT.id, idempotencyKey: key() });
  await makeSafetySignalDeliveryAvailable(ownerA, delT.id);
  const ackT = await acknowledgeSafetySignalDelivery(trustedA, delT.id); // trustedA is the recipient of decT
  check("TrustedAdult CAN acknowledge their OWN delivery", ackT.deliveryStatus === "acknowledged" && ackT.acknowledgedByMembershipId === mTrustA.id);

  // 35) invalid transition
  check("invalid status transition rejected (acknowledged → available)", await throws(() => makeSafetySignalDeliveryAvailable(ownerA, dAck.id), (e) => e instanceof FamilyValidationError));

  // 36/37/38/39/40) DB CHECK constraints (direct systemDb inserts)
  const badBase = { tenantId: famA.id, safetySignalId: sigA.id, protectedProfileId: pA.id, recipientAuthorizationDecisionId: decA.id, recipientMembershipId: mGuardA.id, disclosureScope: "signal_existence", signalType: "CYBERBULLYING", severity: "high" };
  check("DB: acknowledged requires acknowledgedAt + actor", await throws(() => systemDb.safetySignalDelivery.create({ data: { ...badBase, deliveryStatus: "acknowledged", idempotencyKey: key() } }), () => true));
  check("DB: declined requires declinedAt + actor", await throws(() => systemDb.safetySignalDelivery.create({ data: { ...badBase, deliveryStatus: "declined", idempotencyKey: key() } }), () => true));
  check("DB: failed requires failureReasonCode", await throws(() => systemDb.safetySignalDelivery.create({ data: { ...badBase, deliveryStatus: "failed", failedAt: new Date(), idempotencyKey: key() } }), () => true));
  check("DB: revoked requires revokedAt", await throws(() => systemDb.safetySignalDelivery.create({ data: { ...badBase, deliveryStatus: "revoked", idempotencyKey: key() } }), () => true));
  check("DB: superseded requires supersededAt", await throws(() => systemDb.safetySignalDelivery.create({ data: { ...badBase, deliveryStatus: "superseded", idempotencyKey: key() } }), () => true));
  check("DB: channel must be internal_inbox", await throws(() => systemDb.safetySignalDelivery.create({ data: { ...badBase, deliveryStatus: "prepared", deliveryChannel: "email", idempotencyKey: key() } }), () => true));

  // 41) archived is terminal
  const dArch = await createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decA.id, idempotencyKey: key() });
  await archiveSafetySignalDelivery(ownerA, dArch.id);
  check("archived delivery cannot transition further", await throws(() => makeSafetySignalDeliveryAvailable(ownerA, dArch.id), (e) => e instanceof FamilyValidationError));

  // 42/43/44/45) effective delivery + revoke/supersede — ISOLATED signal (one delivery at a time)
  const sigEff = await systemDb.safetySignal.create({ data: { tenantId: famA.id, protectedProfileId: pA.id, signalType: RiskType.Cyberbullying, severity: SafetySeverity.High, sourceType: "manual_test" } });
  const decEff = await createRecipientAuthorizationDecision(ownerA, { safetySignalId: sigEff.id, recipientMembershipId: mGuardA.id, guardianRelationshipId: relA.id });
  const dEff = await createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decEff.id, idempotencyKey: key() });
  check("prepared delivery is effective (row + live auth)", (await getEffectiveSafetySignalDelivery(ownerA, sigEff.id, mGuardA.id))?.id === dEff.id);
  await revokeSafetySignalDelivery(ownerA, dEff.id);
  check("revoked delivery is NOT effective", (await getEffectiveSafetySignalDelivery(ownerA, sigEff.id, mGuardA.id)) === null);
  const dEff2 = await createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decEff.id, idempotencyKey: key() });
  check("new delivery effective after old revoked", (await getEffectiveSafetySignalDelivery(ownerA, sigEff.id, mGuardA.id))?.id === dEff2.id);
  await supersedeSafetySignalDelivery(ownerA, dEff2.id);
  check("superseded delivery is NOT effective", (await getEffectiveSafetySignalDelivery(ownerA, sigEff.id, mGuardA.id)) === null);

  // 46-51) downstream revoke invalidates effective delivery (live re-check)
  const dLive = await createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decA.id, idempotencyKey: key() });
  check("delivery effective before downstream change", (await getEffectiveSafetySignalDelivery(ownerA, sigA.id, mGuardA.id))?.id === dLive.id);
  await systemDb.safetySignal.update({ where: { id: sigA.id }, data: { reviewStatus: "archived", archivedAt: new Date() } });
  check("signal archived after create ⇒ delivery not effective", (await getEffectiveSafetySignalDelivery(ownerA, sigA.id, mGuardA.id)) === null);
  await systemDb.safetySignal.update({ where: { id: sigA.id }, data: { reviewStatus: "new", archivedAt: null } });
  await systemDb.guardianRelationship.update({ where: { id: relA.id }, data: { status: "revoked", revokedAt: new Date() } });
  check("relationship revoked after create ⇒ delivery not effective", (await getEffectiveSafetySignalDelivery(ownerA, sigA.id, mGuardA.id)) === null);
  await systemDb.guardianRelationship.update({ where: { id: relA.id }, data: { status: "verified", revokedAt: null } });

  // 3/4/5/6/7/8/64/65/66) tenant isolation + cross-tenant + RLS
  check("cross-tenant decision rejected (famA actor, decB)", await throws(() => createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decB.id, idempotencyKey: key() }), (e) => e instanceof DeliveryNotEligibleError && e.reasonCode === "authorization_not_found"));
  check("Tenant A does not see Tenant B deliveries", await throws(() => getSafetySignalDelivery(ownerB, del.id), (e) => e instanceof FamilyNotFoundError));
  check("RLS: famB sees none of famA deliveries; famA ≥1", (await withTenant(famB.id, (db) => db.safetySignalDelivery.count({ where: { tenantId: famA.id } }))) === 0 && (await withTenant(famA.id, (db) => db.safetySignalDelivery.count({}))) >= 1);
  check("RLS: cross-tenant INSERT rejected (WITH CHECK)", await throws(() => withTenant(famA.id, (db) => db.safetySignalDelivery.create({ data: { tenantId: famB.id, safetySignalId: sigB.id, protectedProfileId: pB.id, recipientAuthorizationDecisionId: decB.id, recipientMembershipId: mOwnerB.id, disclosureScope: "signal_existence", signalType: "THREAT", severity: "high", idempotencyKey: key() } })), () => true));
  check("cross-tenant composite FK rejected by DB (signal from other tenant)", await throws(() => systemDb.safetySignalDelivery.create({ data: { tenantId: famA.id, safetySignalId: sigB.id, protectedProfileId: pA.id, recipientAuthorizationDecisionId: decA.id, recipientMembershipId: mGuardA.id, disclosureScope: "signal_existence", signalType: "THREAT", severity: "high", idempotencyKey: key() } }), () => true));
  check("RLS: cross-tenant SELECT returns nothing", (await withTenant(famB.id, (db) => db.safetySignalDelivery.findFirst({ where: { id: del.id } }))) === null);

  // 52/53) history preserved
  check("historical delivery rows remain", (await listSafetySignalDeliveries(ownerA, { safetySignalId: sigA.id, includeArchived: true })).items.length >= 3);
  const auditsSup = await withTenant(famA.id, (db) => db.auditLog.count({ where: { tenantId: famA.id, event: "child_safety.delivery.superseded" } }));
  check("supersede created an auditable event", auditsSup >= 1);

  // 54-60) no side effects / no mutation
  const side = await withTenant(famA.id, (db) => Promise.all([
    db.notification.count({ where: { tenantId: famA.id } }), db.cyberbullyingNotification.count({ where: { tenantId: famA.id } }), db.incident.count({ where: { tenantId: famA.id } }),
  ]));
  check("delivery creates NO notification/cyberbullying_notification/incident/case", side[0] === 0 && side[1] === 0 && side[2] === 0);
  const sigNow = await systemDb.safetySignal.findFirstOrThrow({ where: { id: sigA.id }, select: { reviewStatus: true } });
  const decNow = await systemDb.safetyRecipientAuthorizationDecision.findFirstOrThrow({ where: { id: decA.id }, select: { decisionStatus: true } });
  const cs2 = await withTenant(famA.id, (db) => Promise.all([
    db.guardianRelationship.findFirstOrThrow({ where: { id: relA.id }, select: { status: true } }),
    db.consentRecord.findFirstOrThrow({ where: { id: consentA.id }, select: { consentStatus: true } }),
  ]));
  check("delivery does NOT mutate SafetySignal / CS-C4 decision / CS-2 records", sigNow.reviewStatus === "new" && decNow.decisionStatus === "authorized" && cs2[0].status === "verified" && cs2[1].consentStatus === "active");

  // 61/62/63) grants + RLS shape
  const grants = (await systemDb.$queryRawUnsafe<{ privilege_type: string }[]>(`SELECT privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='safety_signal_deliveries' AND grantee='tamanor_app'`)).map((r) => r.privilege_type);
  check("tamanor_app has SELECT/INSERT/UPDATE but NOT DELETE/TRUNCATE", grants.includes("SELECT") && grants.includes("INSERT") && grants.includes("UPDATE") && !grants.includes("DELETE") && !grants.includes("TRUNCATE"));
  const pol = await systemDb.$queryRawUnsafe<{ qual: string; withcheck: string }[]>(`SELECT pg_get_expr(polqual, polrelid) AS qual, pg_get_expr(polwithcheck, polrelid) AS withcheck FROM pg_policy WHERE polrelid='public.safety_signal_deliveries'::regclass`);
  check("RLS policy has NO 'IS NULL' bootstrap branch", pol.length === 1 && !/is null/i.test(pol[0].qual) && !/is null/i.test(pol[0].withcheck));

  // 67/68) content-free schema/DTO/audit
  const forbidden = new Set(CHILD_SAFETY_FORBIDDEN_FIELDS);
  const cols = Object.values(Prisma.SafetySignalDeliveryScalarFieldEnum) as string[];
  check("CS-C5 schema has NO forbidden field", !cols.some((c) => forbidden.has(c)), cols.filter((c) => forbidden.has(c)).join(","));
  check("CS-C5 DTO has NO forbidden field", !Object.keys(del).some((k) => forbidden.has(k)));
  const audits = await withTenant(famA.id, (db) => db.auditLog.findMany({ where: { tenantId: famA.id, event: { startsWith: "child_safety.delivery" } }, select: { event: true, metadata: true } }));
  const blob = JSON.stringify(audits);
  check("delivery audit events written (created/available/acknowledged/declined/revoked/superseded/archived)", ["created", "available", "acknowledged", "declined", "revoked", "superseded", "archived"].every((s) => audits.some((a) => a.event.endsWith(`.${s}`))));
  check("audit payloads carry NO forbidden field / PII", !CHILD_SAFETY_FORBIDDEN_FIELDS.some((f) => blob.includes(`"${f}"`)) && !blob.includes("@t.local") && !blob.includes("age_10_12"));

  // 69/70/71/72) unknown enums fail-closed
  check("unknown status transition target fail-closed (via invalid transition)", await throws(() => makeSafetySignalDeliveryAvailable(ownerA, dAck.id), (e) => e instanceof FamilyValidationError));
  check("unknown reason/channel/scope fail-closed", await throws(() => createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decA.id, idempotencyKey: key(), deliveryChannel: "webhook" }), (e) => e instanceof FamilyValidationError) && await throws(() => createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decA.id, idempotencyKey: key(), requestedScopes: ["raw_content"] as never }), (e) => e instanceof FamilyValidationError) && await throws(() => createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decA.id, idempotencyKey: key(), recommendedActionClass: "call_the_police" }), (e) => e instanceof FamilyValidationError));

  // recommendedActionClass valid path — needs a CRITICAL signal (its policy includes recommended_action_class)
  const sigCrit = await systemDb.safetySignal.create({ data: { tenantId: famA.id, protectedProfileId: pA.id, signalType: RiskType.Cyberbullying, severity: SafetySeverity.Critical, sourceType: "manual_test" } });
  const decCrit = await createRecipientAuthorizationDecision(ownerA, { safetySignalId: sigCrit.id, recipientMembershipId: mGuardA.id, guardianRelationshipId: relA.id });
  const dAction = await createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decCrit.id, idempotencyKey: key(), requestedScopes: ["signal_existence", "risk_category", "severity", "timing_bucket", "recommended_action_class"] as never, recommendedActionClass: SafetyRecommendedActionClass.ReviewWithGuardian });
  check("valid recommendedActionClass stored (allow-listed enum only)", dAction.recommendedActionClass === "review_with_guardian");

  // 73/74) pagination + ordering
  const page = await listSafetySignalDeliveries(ownerA, { limit: 9999 });
  check("list pagination is bounded to the max limit", page.limit === SAFETY_DELIVERY_LIST_MAX_LIMIT);
  const ord = await listSafetySignalDeliveries(ownerA, { safetySignalId: sigA.id, includeArchived: true });
  check("stable ordering is deterministic (createdAt desc)", ord.items.every((it, i, a) => i === 0 || a[i - 1].createdAt.getTime() >= it.createdAt.getTime()));

  // 75/76/77) no forbidden imports in the delivery module
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "child-safety-delivery.ts"), "utf8");
  check("no scheduler/worker/queue/cron import", !/(nodemailer|node-cron|bullmq|['"]bull['"]|amqplib|kafkajs|worker_threads|node-schedule)/.test(src));
  check("no email/SMS/push/webhook/external-API import or call", !/(twilio|sendgrid|['"]axios['"]|node-fetch|@sendgrid|firebase-admin|fetch\()/.test(src) && !/notification\.create|cyberbullyingNotification\.create|incident\.create/.test(src));
  check("SafetyDeliveryStatus enum is closed + fail-closed", Object.values(SafetyDeliveryStatus).length === 9 && !(Object.values(SafetyDeliveryStatus) as string[]).includes("sent"));

  // Cleanup
  const tids = [famA.id, famB.id, biz.id];
  await systemDb.safetySignalDelivery.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.safetyRecipientAuthorizationDecision.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.safetySignal.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.safeRecipientAssessment.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.consentRecord.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.guardianAuthorityRecord.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.guardianRelationship.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.protectedProfile.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.auditLog.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.membership.deleteMany({ where: { tenantId: { in: tids } } });
  await systemDb.user.deleteMany({ where: { id: { in: [uOwner, uGuard, uTrust, uView, uProf, uB] } } });
  await systemDb.tenant.deleteMany({ where: { id: { in: tids } } });

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — CS-C5 internal delivery foundation: ${pass} passed, ${fail} failed`);
  await systemDb.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
