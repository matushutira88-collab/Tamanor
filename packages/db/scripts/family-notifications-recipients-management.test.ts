/**
 * FAMILY NOTIFICATIONS — Phase 2b-B1 management/invitation/affected-guardian recipient rules (local DB).
 * Proves family_manager (delivery outcomes, consent expiry), inviter_plus_admins (invitation accepted/expiring),
 * and affected_guardian_plus_managers (authority + recipient-authorization changes): canonical manager
 * resolution, source-state gating, inviter/affected derivation from canonical rows (never email/caller),
 * expiry-window validation, dedup, cross-tenant fail-closed, and transaction-safe authorized creation.
 * Run: pnpm family-notifications-recipients-management:test
 */
import { systemDb, withTenant, createRecipientAuthorizationDecision, createSafetySignalDelivery, makeSafetySignalDeliveryAvailable, acknowledgeSafetySignalDelivery, declineSafetySignalDelivery } from "@guardora/db";
import { resolveFamilyNotificationRecipientsTx, createAuthorizedFamilyNotificationTx, type FamilyNotificationAuthorizationSource } from "../src/internal/family-notification-authorization";
import { WorkspaceKind, RiskType, SafetySeverity, GuardianRelationshipType, GuardianAuthorityLevel } from "@guardora/core";
import { createHash } from "node:crypto";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const sfx = `fnm_${process.pid}`;
const days = (n: number) => new Date(Date.now() + n * 86_400_000);
let tid = 0;
const th = () => createHash("sha256").update(`tok_${sfx}_${tid++}`).digest("hex");

async function main() {
  const A = (await systemDb.tenant.create({ data: { id: `fa_${sfx}`, name: "FamA", slug: `fa_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const B = (await systemDb.tenant.create({ data: { id: `fb_${sfx}`, name: "FamB", slug: `fb_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const uOwner = (await systemDb.user.create({ data: { id: `uo_${sfx}`, email: `uo_${sfx}@t.local` } })).id;
  const uGuard = (await systemDb.user.create({ data: { id: `ug_${sfx}`, email: `ug_${sfx}@t.local` } })).id;
  const uView = (await systemDb.user.create({ data: { id: `uv_${sfx}`, email: `uv_${sfx}@t.local` } })).id;
  const mOwner = (await systemDb.membership.create({ data: { userId: uOwner, tenantId: A, role: "owner" as never } })).id;   // PrimaryGuardian (manager)
  const mGuard = (await systemDb.membership.create({ data: { userId: uGuard, tenantId: A, role: "admin" as never } })).id;   // Guardian (affected)
  const mView = (await systemDb.membership.create({ data: { userId: uView, tenantId: A, role: "viewer" as never } })).id;    // FamilyViewer (never a manager)
  const ownerA = { tenantId: A, userId: uOwner, role: "owner", workspaceKind: WorkspaceKind.Family };
  const guardA = { tenantId: A, userId: uGuard, role: "admin", workspaceKind: WorkspaceKind.Family };

  const pA = (await systemDb.protectedProfile.create({ data: { tenantId: A, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  const relA = (await systemDb.guardianRelationship.create({ data: { tenantId: A, guardianMembershipId: mGuard, protectedProfileId: pA, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: "secondary", status: "verified" } })).id;
  const authA = (await systemDb.guardianAuthorityRecord.create({ data: { tenantId: A, guardianRelationshipId: relA, authorityType: "legal_guardian", authorityStatus: "verified", verifiedAt: new Date(), validUntil: days(30) } })).id;
  const consentA = (await systemDb.consentRecord.create({ data: { tenantId: A, protectedProfileId: pA, consentType: "guardian", consentStatus: "active", grantedAt: new Date(), grantedByMembershipId: mOwner, validUntil: days(5) } })).id;
  await systemDb.safeRecipientAssessment.create({ data: { tenantId: A, guardianRelationshipId: relA, assessmentStatus: "approved", eligibilityStatus: "eligible", assessedByMembershipId: mOwner, assessedAt: new Date(), validUntil: days(30) } });
  const sigA = (await systemDb.safetySignal.create({ data: { tenantId: A, protectedProfileId: pA, signalType: RiskType.Cyberbullying, severity: SafetySeverity.High, sourceType: "manual_test" } })).id;
  const decision = await createRecipientAuthorizationDecision(ownerA, { safetySignalId: sigA, recipientMembershipId: mGuard, guardianRelationshipId: relA });

  const resolve = (source: FamilyNotificationAuthorizationSource) => withTenant(A, (tx) => resolveFamilyNotificationRecipientsTx(tx, { tenantId: A, source }));
  const create = (source: FamilyNotificationAuthorizationSource) => withTenant(A, (tx) => createAuthorizedFamilyNotificationTx(tx, { tenantId: A, source }));
  const isManagerSet = (ids: string[]) => ids.includes(uOwner) && !ids.includes(uView); // owner is a manager, viewer never

  console.log("\n1. delivery outcome managers (acknowledged / declined)");
  const dlv = await createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decision.id, idempotencyKey: `k_${sfx}` });
  await makeSafetySignalDeliveryAvailable(ownerA, dlv.id);
  check("★ AVAILABLE delivery cannot generate an acknowledged notification (zero)", (await resolve({ type: "family_delivery_acknowledged", deliveryId: dlv.id, eventVersion: "e1" })).ok === true && (await resolve({ type: "family_delivery_acknowledged", deliveryId: dlv.id, eventVersion: "e1" }) as { recipientUserIds: string[] }).recipientUserIds.length === 0);
  await acknowledgeSafetySignalDelivery(guardA, dlv.id);
  const ack = await resolve({ type: "family_delivery_acknowledged", deliveryId: dlv.id, eventVersion: "e1" });
  check("★ acknowledged delivery → managers (owner in, viewer out)", ack.ok === true && isManagerSet(ack.recipientUserIds));
  check("★ acknowledged type CANNOT generate a declined notification (zero)", (await resolve({ type: "family_delivery_declined", deliveryId: dlv.id, eventVersion: "e1" }) as { recipientUserIds: string[] }).recipientUserIds.length === 0);
  // a second delivery declined
  const dec2 = await createRecipientAuthorizationDecision(ownerA, { safetySignalId: sigA, recipientMembershipId: mGuard, guardianRelationshipId: relA });
  const dlv2 = await createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: dec2.id, idempotencyKey: `k2_${sfx}` });
  await makeSafetySignalDeliveryAvailable(ownerA, dlv2.id);
  await declineSafetySignalDelivery(guardA, dlv2.id);
  check("★ declined delivery → managers", (await resolve({ type: "family_delivery_declined", deliveryId: dlv2.id, eventVersion: "e1" })).ok === true && isManagerSet((await resolve({ type: "family_delivery_declined", deliveryId: dlv2.id, eventVersion: "e1" }) as { recipientUserIds: string[] }).recipientUserIds));
  check("★ cross-tenant delivery fails closed", (await withTenant(B, (tx) => resolveFamilyNotificationRecipientsTx(tx, { tenantId: B, source: { type: "family_delivery_acknowledged", deliveryId: dlv.id, eventVersion: "e1" } }))).ok === false);

  console.log("\n2. guardian invitation (accepted / expiring) — inviter + managers, never email/token");
  const invAcc = (await systemDb.familyGuardianInvitation.create({ data: { tenantId: A, invitedByMembershipId: mGuard, invitedEmailNormalized: `invitee_${sfx}@x.local`, tokenHash: th(), protectedProfileId: pA, intendedFamilyRole: "guardian", intendedGuardianRole: "secondary", intendedRelationshipType: "parent", status: "accepted", acceptedAt: new Date(), expiresAt: days(3) } })).id;
  const ra = await resolve({ type: "family_guardian_invitation_accepted", invitationId: invAcc, eventVersion: "e1" });
  check("★ accepted invitation → inviter (guard) + managers (owner), viewer out", ra.ok === true && ra.recipientUserIds.includes(uGuard) && ra.recipientUserIds.includes(uOwner) && !ra.recipientUserIds.includes(uView));
  check("★ invited email is NEVER a recipient (only canonical memberships)", ra.ok === true && ra.recipientUserIds.every((u) => u === uOwner || u === uGuard));
  const invPending = (await systemDb.familyGuardianInvitation.create({ data: { tenantId: A, invitedByMembershipId: mGuard, invitedEmailNormalized: `p_${sfx}@x.local`, tokenHash: th(), protectedProfileId: pA, intendedFamilyRole: "guardian", intendedGuardianRole: "secondary", intendedRelationshipType: "parent", status: "pending", expiresAt: days(3) } })).id;
  check("★ pending invitation cannot generate an accepted notification (zero)", (await resolve({ type: "family_guardian_invitation_accepted", invitationId: invPending, eventVersion: "e1" }) as { recipientUserIds: string[] }).recipientUserIds.length === 0);
  // expiring windows: 3 days out → 7d window
  check("★ pending invitation 3d out matches 7d window → inviter+managers", (await resolve({ type: "family_guardian_invitation_expiring", invitationId: invPending, expiryWindow: "7d", eventVersion: "e7" })).ok === true && ((await resolve({ type: "family_guardian_invitation_expiring", invitationId: invPending, expiryWindow: "7d", eventVersion: "e7" }) as { recipientUserIds: string[] }).recipientUserIds.length >= 2));
  check("★ forged 1d window on a 3d-out invitation → zero recipients", (await resolve({ type: "family_guardian_invitation_expiring", invitationId: invPending, expiryWindow: "1d", eventVersion: "e1" }) as { recipientUserIds: string[] }).recipientUserIds.length === 0);
  const invExpired = (await systemDb.familyGuardianInvitation.create({ data: { tenantId: A, invitedByMembershipId: mGuard, invitedEmailNormalized: `e_${sfx}@x.local`, tokenHash: th(), protectedProfileId: pA, intendedFamilyRole: "guardian", intendedGuardianRole: "secondary", intendedRelationshipType: "parent", status: "expired", expiresAt: days(-1) } })).id;
  check("★ expired/accepted invitation produces no expiring recipients", (await resolve({ type: "family_guardian_invitation_expiring", invitationId: invExpired, expiryWindow: "7d", eventVersion: "e1" }) as { recipientUserIds: string[] }).recipientUserIds.length === 0 && (await resolve({ type: "family_guardian_invitation_expiring", invitationId: invAcc, expiryWindow: "7d", eventVersion: "e1" }) as { recipientUserIds: string[] }).recipientUserIds.length === 0);

  console.log("\n3. authority change — affected guardian + managers");
  const ac = await resolve({ type: "family_authority_changed", guardianAuthorityRecordId: authA, eventVersion: "e1" });
  check("★ authority change → affected guardian (guard) + managers (owner)", ac.ok === true && ac.recipientUserIds.includes(uGuard) && ac.recipientUserIds.includes(uOwner));
  check("★ affected guardian derived from canonical link, not caller; unrelated viewer excluded", ac.ok === true && !ac.recipientUserIds.includes(uView));
  check("★ cross-tenant authority record fails closed", (await withTenant(B, (tx) => resolveFamilyNotificationRecipientsTx(tx, { tenantId: B, source: { type: "family_authority_changed", guardianAuthorityRecordId: authA, eventVersion: "e1" } }))).ok === false);

  console.log("\n4. recipient-authorization change — affected recipient + managers");
  const rac = await resolve({ type: "family_recipient_authorization_changed", authorizationDecisionId: decision.id, eventVersion: "e1" });
  check("★ recipient-auth change → affected recipient (guard) + managers (owner)", rac.ok === true && rac.recipientUserIds.includes(uGuard) && rac.recipientUserIds.includes(uOwner));
  check("★ cross-tenant decision fails closed", (await withTenant(B, (tx) => resolveFamilyNotificationRecipientsTx(tx, { tenantId: B, source: { type: "family_recipient_authorization_changed", authorizationDecisionId: decision.id, eventVersion: "e1" } }))).ok === false);

  console.log("\n5. consent expiry — managers only, window + state gated");
  const ce = await resolve({ type: "family_consent_expiring", consentRecordId: consentA, expiryWindow: "7d", eventVersion: "e7" });
  check("★ consent 5d out matches 7d window → ConsentManage managers only (owner in, viewer out)", ce.ok === true && ce.recipientUserIds.includes(uOwner) && !ce.recipientUserIds.includes(uView));
  check("★ forged 1d window on a 5d-out consent → zero", (await resolve({ type: "family_consent_expiring", consentRecordId: consentA, expiryWindow: "1d", eventVersion: "e1" }) as { recipientUserIds: string[] }).recipientUserIds.length === 0);
  await systemDb.consentRecord.update({ where: { id: consentA }, data: { consentStatus: "withdrawn", revokedAt: new Date() } });
  check("★ revoked consent → no upcoming-expiry recipients", (await resolve({ type: "family_consent_expiring", consentRecordId: consentA, expiryWindow: "7d", eventVersion: "e7" }) as { recipientUserIds: string[] }).recipientUserIds.length === 0);
  await systemDb.consentRecord.update({ where: { id: consentA }, data: { consentStatus: "active", revokedAt: null, validUntil: null } });
  check("★ consent with no validUntil → no recipients", (await resolve({ type: "family_consent_expiring", consentRecordId: consentA, expiryWindow: "7d", eventVersion: "e7" }) as { recipientUserIds: string[] }).recipientUserIds.length === 0);
  await systemDb.consentRecord.update({ where: { id: consentA }, data: { validUntil: days(5) } });

  console.log("\n6. authorized creation + transactions (new types)");
  const c1 = await create({ type: "family_authority_changed", guardianAuthorityRecordId: authA, eventVersion: "cv1" });
  check("★ creates one row per resolved recipient, non-null userId", c1.ok === true && c1.createdCount >= 2 && c1.eligibleRecipientCount === c1.createdCount);
  const c2 = await create({ type: "family_authority_changed", guardianAuthorityRecordId: authA, eventVersion: "cv1" });
  check("★ same event retry → no duplicate", c2.ok === true && c2.createdCount === 0);
  const c3 = await create({ type: "family_authority_changed", guardianAuthorityRecordId: authA, eventVersion: "cv2" });
  check("★ different eventVersion → new rows", c3.ok === true && c3.createdCount >= 2);
  const before = await systemDb.notification.count({ where: { tenantId: A } });
  try { await withTenant(A, async (tx) => { await createAuthorizedFamilyNotificationTx(tx, { tenantId: A, source: { type: "family_authority_changed", guardianAuthorityRecordId: authA, eventVersion: "cv_rb" } }); throw new Error("rb"); }); } catch { /* expected */ }
  check("★ caller rollback leaves zero new rows", (await systemDb.notification.count({ where: { tenantId: A } })) === before);
  check("★ creation result exposes no recipient IDs", !("recipientUserIds" in (c1 as object)));
  const rows = await systemDb.notification.findMany({ where: { tenantId: A, type: "family_authority_changed" as never }, select: { userId: true, titleKey: true, metadata: true } });
  check("★ every row has non-null userId + catalogue titleKey + no null-user tenant-wide row", rows.length > 0 && rows.every((n) => n.userId != null && n.titleKey.startsWith("family_notif.")));
  const meta0 = (rows[0]?.metadata ?? {}) as Record<string, unknown>;
  check("★ metadata carries no email/token/note/scope key", Object.keys(meta0).every((k) => !/email|token|note|scope|reason/i.test(k)));

  console.log("\n7. boundary — B2 types still unsupported");
  check("★ unknown type still unsupported (fail closed)", (await withTenant(A, (tx) => resolveFamilyNotificationRecipientsTx(tx, { tenantId: A, source: { type: "family_totally_unknown" as never, incidentId: "x", eventVersion: "e1" } }))).ok === false);
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    for (const t of [`fa_${sfx}`, `fb_${sfx}`]) {
      await systemDb.notification.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.membership.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.tenant.delete({ where: { id: t } }).catch(() => {});
    }
    for (const u of [`uo_${sfx}`, `ug_${sfx}`, `uv_${sfx}`]) await systemDb.user.delete({ where: { id: u } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Family notifications management recipients: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
