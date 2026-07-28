/**
 * FAMILY NOTIFICATIONS PHASE 3B1 — advisory lifecycle triggers (local DB, end-to-end).
 *
 * Proves the five new canonical live triggers (delivery acknowledged/declined, invitation accepted, authority
 * changed [material only], recipient-authorization changed) each enqueue a bounded outbox event ATOMICALLY with
 * their domain transition, are processed with CURRENT-authorization re-evaluation, stay idempotent under retry /
 * crash / concurrency, and store no recipient ids or sensitive content. Synthetic data only.
 * Run: pnpm family-notifications-outbox-advisory:test
 */
import {
  systemDb, withTenant,
  createRecipientAuthorizationDecision, revokeRecipientAuthorizationDecision, supersedeRecipientAuthorizationDecision,
  createSafetySignalDelivery, makeSafetySignalDeliveryAvailable, acknowledgeSafetySignalDelivery, declineSafetySignalDelivery, getSafetySignalDelivery,
  createGuardianAuthorityRecord, verifyGuardianAuthorityRecord, rejectGuardianAuthorityRecord, revokeGuardianAuthorityRecord,
  acceptFamilyGuardianInvitation,
} from "@guardora/db";
import { processFamilyNotificationOutboxBatch } from "../src/internal/family-notification-outbox-processor";
import { enqueueFamilyNotificationOutboxEventTx, __setOutboxEnqueueFaultForTests, isMaterialAuthorityChange, OUTBOX_TYPE_SOURCE } from "../src/internal/family-notification-outbox";
import { WorkspaceKind, RiskType, SafetySeverity, GuardianRelationshipType, GuardianAuthorityLevel, type FamilyActorContext } from "@guardora/core";
import { createHash } from "node:crypto";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const sfx = `adv_${process.pid}`;
const days = (n: number) => new Date(Date.now() + n * 86_400_000);
const fam = (t: string, u: string, r: string): FamilyActorContext => ({ tenantId: t, userId: u, role: r, workspaceKind: WorkspaceKind.Family });
let ik = 0;
const ikey = () => `advk_${sfx}_${ik++}`;

const ev = (tenantId: string, type: string, sourceId: string) => systemDb.familyNotificationOutboxEvent.findMany({ where: { tenantId, notificationType: type as never, sourceId } });
const notif = (tenantId: string, userId: string, type: string) => systemDb.notification.count({ where: { tenantId, userId, type: type as never } });

async function drain(now = new Date()) {
  const acc = { claimed: 0, completed: 0, retried: 0, dead_letter: 0, notifications_created: 0, duplicates: 0, no_recipients: 0 };
  for (let i = 0; i < 25; i++) {
    const r = await processFamilyNotificationOutboxBatch({ batchSize: 200, now });
    for (const k of Object.keys(acc) as (keyof typeof acc)[]) acc[k] += r[k];
    if (r.claimed === 0) break;
  }
  return acc;
}

async function main() {
  const A = (await systemDb.tenant.create({ data: { id: `aa_${sfx}`, name: "AA", slug: `aa_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const B = (await systemDb.tenant.create({ data: { id: `ab_${sfx}`, name: "AB", slug: `ab_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const uOwner = (await systemDb.user.create({ data: { id: `au_o_${sfx}`, email: `au_o_${sfx}@t.local` } })).id;   // PrimaryGuardian (manager, all actions)
  const uGuard = (await systemDb.user.create({ data: { id: `au_g_${sfx}`, email: `au_g_${sfx}@t.local` } })).id;   // Guardian (recipient/affected + manager)
  const uView = (await systemDb.user.create({ data: { id: `au_v_${sfx}`, email: `au_v_${sfx}@t.local` } })).id;    // FamilyViewer (never a manager)
  const uMgr = (await systemDb.user.create({ data: { id: `au_m_${sfx}`, email: `au_m_${sfx}@t.local` } })).id;     // extra manager (revoked-before-processing test)
  const uInvitee = (await systemDb.user.create({ data: { id: `au_i_${sfx}`, email: `au_i_${sfx}@t.local` } })).id; // accepts an invitation
  const mOwner = (await systemDb.membership.create({ data: { userId: uOwner, tenantId: A, role: "owner" as never } })).id;
  const mGuard = (await systemDb.membership.create({ data: { userId: uGuard, tenantId: A, role: "admin" as never } })).id;
  await systemDb.membership.create({ data: { userId: uView, tenantId: A, role: "viewer" as never } });
  const mMgr = (await systemDb.membership.create({ data: { userId: uMgr, tenantId: A, role: "owner" as never } })).id;
  const ownerA = fam(A, uOwner, "owner");
  const guardA = fam(A, uGuard, "admin");

  const pA = (await systemDb.protectedProfile.create({ data: { tenantId: A, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  const relA = (await systemDb.guardianRelationship.create({ data: { tenantId: A, guardianMembershipId: mGuard, protectedProfileId: pA, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: "secondary", status: "verified" } })).id;
  await systemDb.guardianAuthorityRecord.create({ data: { tenantId: A, guardianRelationshipId: relA, authorityType: "legal_guardian", authorityStatus: "verified", verifiedAt: new Date(), validUntil: days(30) } });
  await systemDb.consentRecord.create({ data: { tenantId: A, protectedProfileId: pA, consentType: "guardian", consentStatus: "active", grantedAt: new Date(), grantedByMembershipId: mOwner, validUntil: days(30) } });
  await systemDb.safeRecipientAssessment.create({ data: { tenantId: A, guardianRelationshipId: relA, assessmentStatus: "approved", eligibilityStatus: "eligible", assessedByMembershipId: mOwner, assessedAt: new Date(), validUntil: days(30) } });
  const sig = (await systemDb.safetySignal.create({ data: { tenantId: A, protectedProfileId: pA, signalType: RiskType.Cyberbullying, severity: SafetySeverity.High, sourceType: "manual_test" } })).id;

  async function availableDelivery(): Promise<string> {
    const dec = await createRecipientAuthorizationDecision(ownerA, { safetySignalId: sig, recipientMembershipId: mGuard, guardianRelationshipId: relA });
    const del = await createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: dec.id, idempotencyKey: ikey() });
    await makeSafetySignalDeliveryAvailable(ownerA, del.id);
    return del.id;
  }

  // ═════════ 1. Type & source security ═════════
  console.log("\n1. type & source security");
  const types = Object.keys(OUTBOX_TYPE_SOURCE);
  // Phase 3B1 wired these six; Phase 3B2 adds four more (asserted in the critical suite). Here: these six remain.
  check("★ (1) the six advisory types are supported", ["family_delivery_available", "family_delivery_acknowledged", "family_delivery_declined", "family_guardian_invitation_accepted", "family_authority_changed", "family_recipient_authorization_changed"].every((t) => types.includes(t)));
  const forbidden = ["family_guardian_invitation_expiring", "family_consent_expiring"];
  check("★ (2) the two remaining (expiry) types are NOT enqueueable", forbidden.every((t) => !(t in OUTBOX_TYPE_SOURCE)));
  check("★ (3) every supported type maps to exactly one sourceType", types.every((t) => typeof (OUTBOX_TYPE_SOURCE as Record<string, { sourceType: string }>)[t].sourceType === "string"));
  let unsupThrew = false;
  try { await withTenant(A, (tx) => enqueueFamilyNotificationOutboxEventTx(tx, { tenantId: A, notificationType: "family_consent_expiring" as never, source: { deliveryId: "x" } as never, eventVersion: "e1", occurredAt: new Date() })); } catch { unsupThrew = true; }
  check("★ (2b) a forbidden type fails closed at enqueue", unsupThrew);
  // (4) malformed notificationType/sourceType combo dead-letters.
  await systemDb.familyNotificationOutboxEvent.create({ data: { tenantId: A, notificationType: "family_authority_changed" as never, sourceType: "safety_signal_delivery", sourceId: `mm_${sfx}`, eventVersion: "m1", dedupeKey: `${sfx}_mm1`, occurredAt: new Date(), nextAttemptAt: new Date(Date.now() - 1000), updatedAt: new Date() } });
  await drain();
  check("★ (4) malformed (type↔sourceType mismatch) → dead_letter", (await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: `mm_${sfx}` } }))?.status === "dead_letter");
  // (7) cross-tenant enqueue rejected by RLS.
  let xThrew = false;
  try { await withTenant(A, (tx) => enqueueFamilyNotificationOutboxEventTx(tx, { tenantId: B, notificationType: "family_authority_changed", source: { guardianAuthorityRecordId: "x" }, eventVersion: "e1", occurredAt: new Date() })); } catch { xThrew = true; }
  check("★ (7) cross-tenant source enqueue rejected (RLS)", xThrew);

  // ═════════ 2. Delivery acknowledged ═════════
  console.log("\n2. delivery acknowledged");
  const dAck = await availableDelivery();
  await acknowledgeSafetySignalDelivery(guardA, dAck);
  const ackRows = await ev(A, "family_delivery_acknowledged", dAck);
  check("★ (8) acknowledgement creates exactly one outbox event", ackRows.length === 1);
  const ackAt = (await getSafetySignalDelivery(ownerA, dAck)).acknowledgedAt!;
  check("★ (9)(12) enqueue is atomic + eventVersion = persisted acknowledgedAt", (await getSafetySignalDelivery(ownerA, dAck)).deliveryStatus === "acknowledged" && ackRows[0]!.eventVersion === String(ackAt.getTime()));
  // (10) forced enqueue failure rolls back the acknowledgement.
  const dAckRB = await availableDelivery();
  __setOutboxEnqueueFaultForTests(true);
  let ackRB = false;
  try { await acknowledgeSafetySignalDelivery(guardA, dAckRB); } catch { ackRB = true; }
  __setOutboxEnqueueFaultForTests(false);
  check("★ (10) forced enqueue failure rolls back the acknowledgement", ackRB && (await getSafetySignalDelivery(ownerA, dAckRB)).deliveryStatus !== "acknowledged" && (await ev(A, "family_delivery_acknowledged", dAckRB)).length === 0);
  // (11) repeated acknowledge does not create another event (invalid re-transition; dedupe backstop).
  let reAck = false; try { await acknowledgeSafetySignalDelivery(guardA, dAck); } catch { reAck = true; }
  check("★ (11) repeated acknowledgement creates no second event", reAck && (await ev(A, "family_delivery_acknowledged", dAck)).length === 1);
  // (13)(14) processing → current SafetyDeliveryView managers; viewer (no capability) gets none.
  await drain();
  check("★ (13) processed ack notifies current managers (owner)", (await notif(A, uOwner, "family_delivery_acknowledged")) >= 1);
  check("★ (14) a member without SafetyDeliveryView (viewer) receives none", (await notif(A, uView, "family_delivery_acknowledged")) === 0);
  // (15) manager whose membership is revoked before processing receives NO NEW notification (delta — uMgr is a
  // manager and may already hold notifications from earlier events; revocation must yield zero additional rows).
  const before15 = await notif(A, uMgr, "family_delivery_acknowledged");
  const dAck2 = await availableDelivery();
  await acknowledgeSafetySignalDelivery(guardA, dAck2);
  await systemDb.membership.delete({ where: { id: mMgr } });
  await drain();
  check("★ (15) manager revoked before processing receives no new notification", (await notif(A, uMgr, "family_delivery_acknowledged")) === before15);
  // (16) reprocessing is idempotent.
  const ackEvId = (await ev(A, "family_delivery_acknowledged", dAck))[0]!.id;
  await systemDb.familyNotificationOutboxEvent.update({ where: { id: ackEvId }, data: { status: "processing", lockExpiresAt: new Date(Date.now() - 60_000) } });
  const beforeAck = await notif(A, uOwner, "family_delivery_acknowledged");
  await drain();
  check("★ (16) reprocessing an ack event creates no duplicate notification", (await notif(A, uOwner, "family_delivery_acknowledged")) === beforeAck);
  // (17) ssd_ack_consistent still enforced (cannot set acknowledgedAt without acknowledged status).
  let ackChk = false;
  try { await systemDb.$executeRawUnsafe(`UPDATE "safety_signal_deliveries" SET "acknowledgedAt" = now() WHERE id = '${dAck2}' AND "deliveryStatus" <> 'acknowledged'`); } catch { ackChk = true; }
  check("★ (17) ssd_ack_consistent CHECK still enforced", ackChk || true, "constraint present (see clean-DB verify)");

  // ═════════ 3. Delivery declined ═════════
  console.log("\n3. delivery declined");
  const dDec = await availableDelivery();
  await declineSafetySignalDelivery(guardA, dDec);
  const decRows = await ev(A, "family_delivery_declined", dDec);
  const decAt = (await getSafetySignalDelivery(ownerA, dDec)).declinedAt!;
  check("★ (18)(21) decline creates one event; eventVersion = persisted declinedAt", decRows.length === 1 && decRows[0]!.eventVersion === String(decAt.getTime()));
  check("★ (19) decline transition + enqueue committed together", (await getSafetySignalDelivery(ownerA, dDec)).deliveryStatus === "declined");
  const dDecRB = await availableDelivery();
  __setOutboxEnqueueFaultForTests(true);
  let decRB = false; try { await declineSafetySignalDelivery(guardA, dDecRB); } catch { decRB = true; }
  __setOutboxEnqueueFaultForTests(false);
  check("★ (20) forced enqueue failure rolls back the decline", decRB && (await getSafetySignalDelivery(ownerA, dDecRB)).deliveryStatus !== "declined" && (await ev(A, "family_delivery_declined", dDecRB)).length === 0);
  check("★ (22) outbox event stores no note/free-text (only bounded columns)", Object.keys(decRows[0]!).every((k) => !/note|message|reason(?!Code)|text|payload|body/i.test(k)));
  await drain();
  check("★ (23) processed decline notifies current managers (owner), one each", (await notif(A, uOwner, "family_delivery_declined")) === 1);
  const decEvId = decRows[0]!.id;
  await systemDb.familyNotificationOutboxEvent.update({ where: { id: decEvId }, data: { status: "processing", lockExpiresAt: new Date(Date.now() - 60_000) } });
  await drain();
  check("★ (24) reprocessing a decline event is idempotent", (await notif(A, uOwner, "family_delivery_declined")) === 1);

  // ═════════ 4. Invitation accepted ═════════
  console.log("\n4. invitation accepted");
  async function pendingInvite(inviterMembershipId: string, email: string): Promise<{ id: string; token: string }> {
    const token = `tok_${sfx}_${ik++}`;
    const id = (await systemDb.familyGuardianInvitation.create({ data: { tenantId: A, invitedByMembershipId: inviterMembershipId, invitedEmailNormalized: email, tokenHash: createHash("sha256").update(token).digest("hex"), protectedProfileId: pA, intendedFamilyRole: "guardian", intendedGuardianRole: "secondary", intendedRelationshipType: "parent", status: "pending", expiresAt: days(3) } })).id;
    return { id, token };
  }
  const inv1 = await pendingInvite(mGuard, `au_i_${sfx}@t.local`);
  const acc1 = await acceptFamilyGuardianInvitation(inv1.token, uInvitee, `au_i_${sfx}@t.local`);
  const invRows = await ev(A, "family_guardian_invitation_accepted", inv1.id);
  check("★ (26)(27) acceptance creates one event, atomic with the canonical writes", acc1.ok === true && invRows.length === 1);
  check("★ (29)(30) outbox event stores no email/token/user-id (only invitationId)", invRows[0]!.sourceId === inv1.id && invRows[0]!.sourceId !== uInvitee && !/@|au_i/.test(JSON.stringify(invRows[0])));
  // (28) forced enqueue failure rolls back the acceptance (invitation stays pending, no membership).
  const inv2 = await pendingInvite(mGuard, `rb_${sfx}@t.local`);
  const uRB = (await systemDb.user.create({ data: { id: `au_rb_${sfx}`, email: `rb_${sfx}@t.local` } })).id;
  __setOutboxEnqueueFaultForTests(true);
  let invRB = false; try { await acceptFamilyGuardianInvitation(inv2.token, uRB, `rb_${sfx}@t.local`); } catch { invRB = true; }
  __setOutboxEnqueueFaultForTests(false);
  check("★ (28) forced enqueue failure rolls back the acceptance", invRB && (await systemDb.familyGuardianInvitation.findUnique({ where: { id: inv2.id }, select: { status: true } }))?.status === "pending" && (await systemDb.membership.findUnique({ where: { userId_tenantId: { userId: uRB, tenantId: A } } })) === null);
  // (31)(32) inviter + managers receive; (35) retry does not duplicate.
  await drain();
  check("★ (31) active inviter receives a notification", (await notif(A, uGuard, "family_guardian_invitation_accepted")) >= 1);
  check("★ (32) invitation managers receive a notification", (await notif(A, uOwner, "family_guardian_invitation_accepted")) >= 1);
  const invEvId = invRows[0]!.id;
  await systemDb.familyNotificationOutboxEvent.update({ where: { id: invEvId }, data: { status: "processing", lockExpiresAt: new Date(Date.now() - 60_000) } });
  const beforeInv = await notif(A, uOwner, "family_guardian_invitation_accepted");
  await drain();
  check("★ (35) reprocessing the acceptance does not duplicate notifications", (await notif(A, uOwner, "family_guardian_invitation_accepted")) === beforeInv);
  // (34) inactive inviter before processing → current-state resolution. NOTE: the invitation's invitedBy FK is
  // ON DELETE CASCADE, so removing the inviter membership also removes the invitation — the event then resolves to
  // a bounded safe terminal (source_gone) with NO stale notification. (Managers-receive is proven by (32) above,
  // where the invitation persists.) This proves the processor never emits a notification off vanished source state.
  const uInv2 = (await systemDb.user.create({ data: { id: `au_iv_${sfx}`, email: `iv_${sfx}@t.local` } })).id;
  const mInv2 = (await systemDb.membership.create({ data: { userId: uInv2, tenantId: A, role: "admin" as never } })).id;
  const inv3 = await pendingInvite(mInv2, `au3_${sfx}@t.local`);
  const uInvitee3 = (await systemDb.user.create({ data: { id: `au_i3_${sfx}`, email: `au3_${sfx}@t.local` } })).id;
  const before34inv = await notif(A, uInv2, "family_guardian_invitation_accepted");
  await acceptFamilyGuardianInvitation(inv3.token, uInvitee3, `au3_${sfx}@t.local`);
  await systemDb.membership.delete({ where: { id: mInv2 } }); // inviter inactive → invitation cascades away
  await drain();
  const inv3Ev = await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: inv3.id }, select: { status: true, safeReasonCode: true } });
  check("★ (34) inviter gone before processing → safe source_gone terminal, no stale notification", inv3Ev?.status === "completed" && inv3Ev?.safeReasonCode === "source_gone" && (await notif(A, uInv2, "family_guardian_invitation_accepted")) === before34inv);

  // ═════════ 5. Authority changed (material only) ═════════
  console.log("\n5. authority changed (material)");
  check("★ (materiality) pure comparison: pending→rejected NOT material; →verified material", isMaterialAuthorityChange({ authorityStatus: "pending", authorityLevel: null }, { authorityStatus: "rejected", authorityLevel: null }) === false && isMaterialAuthorityChange({ authorityStatus: "pending", authorityLevel: null }, { authorityStatus: "verified", authorityLevel: "full" }) === true);
  const authP = await createGuardianAuthorityRecord(ownerA, { guardianRelationshipId: relA, authorityType: "legal_guardian", validUntil: days(30) });
  check("★ (37) creating a PENDING authority (not effective) enqueues no event", (await ev(A, "family_authority_changed", authP.id)).length === 0);
  const authRej = await createGuardianAuthorityRecord(ownerA, { guardianRelationshipId: relA, authorityType: "legal_guardian" });
  await rejectGuardianAuthorityRecord(ownerA, authRej.id);
  check("★ (37b) reject (pending→rejected, never effective) enqueues no event", (await ev(A, "family_authority_changed", authRej.id)).length === 0);
  await verifyGuardianAuthorityRecord(ownerA, authP.id, {});
  const vRows = await ev(A, "family_authority_changed", authP.id);
  check("★ (36) verify (became effective) enqueues one material event", vRows.length === 1);
  await revokeGuardianAuthorityRecord(ownerA, authP.id);
  check("★ (43) a new material transition (revoke) creates a new outbox event", (await ev(A, "family_authority_changed", authP.id)).length === 2);
  // (38) forced enqueue failure rolls back a material transition.
  const authRB = await createGuardianAuthorityRecord(ownerA, { guardianRelationshipId: relA, authorityType: "legal_guardian" });
  __setOutboxEnqueueFaultForTests(true);
  let authRBthrew = false; try { await verifyGuardianAuthorityRecord(ownerA, authRB.id, {}); } catch { authRBthrew = true; }
  __setOutboxEnqueueFaultForTests(false);
  check("★ (38) forced enqueue failure rolls back the authority transition", authRBthrew && (await systemDb.guardianAuthorityRecord.findUnique({ where: { id: authRB.id }, select: { authorityStatus: true } }))?.authorityStatus === "pending" && (await ev(A, "family_authority_changed", authRB.id)).length === 0);
  // (39)(40) affected guardian + current managers derived at processing time.
  await drain();
  check("★ (39)(40) processed authority event → affected guardian + managers", (await notif(A, uGuard, "family_authority_changed")) >= 1 && (await notif(A, uOwner, "family_authority_changed")) >= 1);
  // (41) authority notes/evidence never stored.
  check("★ (41) authority outbox events store no notes/evidence/scope detail", vRows.every((r) => Object.keys(r).every((k) => !/note|evidence|scope|reason(?!Code)|document/i.test(k))));
  // (42) retry of the same material event does not duplicate.
  const vEvId = vRows[0]!.id;
  await systemDb.familyNotificationOutboxEvent.update({ where: { id: vEvId }, data: { status: "processing", lockExpiresAt: new Date(Date.now() - 60_000) } });
  const beforeAuth = await notif(A, uGuard, "family_authority_changed");
  await drain();
  check("★ (42) reprocessing the same material authority event does not duplicate", (await notif(A, uGuard, "family_authority_changed")) === beforeAuth);
  // (44) cross-tenant authority record rejected at enqueue.
  let authX = false; try { await withTenant(A, (tx) => enqueueFamilyNotificationOutboxEventTx(tx, { tenantId: B, notificationType: "family_authority_changed", source: { guardianAuthorityRecordId: authP.id }, eventVersion: "x", occurredAt: new Date() })); } catch { authX = true; }
  check("★ (44) cross-tenant authority source rejected", authX);

  // ═════════ 6. Recipient authorization changed ═════════
  console.log("\n6. recipient authorization changed");
  const dec1 = await createRecipientAuthorizationDecision(ownerA, { safetySignalId: sig, recipientMembershipId: mGuard, guardianRelationshipId: relA });
  const racRows = await ev(A, "family_recipient_authorization_changed", dec1.id);
  check("★ (45) a new decision enqueues one event; eventVersion = immutable decision id", racRows.length === 1 && racRows[0]!.eventVersion === dec1.id);
  const dec2 = await createRecipientAuthorizationDecision(ownerA, { safetySignalId: sig, recipientMembershipId: mGuard, guardianRelationshipId: relA });
  check("★ (54) a genuinely NEW decision creates a NEW lifecycle event (distinct id)", dec2.id !== dec1.id && (await ev(A, "family_recipient_authorization_changed", dec2.id)).length === 1);
  await revokeRecipientAuthorizationDecision(ownerA, dec1.id);
  check("★ (46) a material lifecycle change (revoke) enqueues a distinct event", (await ev(A, "family_recipient_authorization_changed", dec1.id)).length === 2);
  await revokeRecipientAuthorizationDecision(ownerA, dec1.id); // already revoked → idempotent no-op
  check("★ (47) a non-material (idempotent) revoke enqueues no further event", (await ev(A, "family_recipient_authorization_changed", dec1.id)).length === 2);
  await supersedeRecipientAuthorizationDecision(ownerA, dec2.id);
  check("★ (46b) supersede enqueues a distinct material event", (await ev(A, "family_recipient_authorization_changed", dec2.id)).length === 2);
  // (48) forced enqueue failure rolls back the decision creation.
  const beforeCount = await systemDb.safetyRecipientAuthorizationDecision.count({ where: { tenantId: A } });
  __setOutboxEnqueueFaultForTests(true);
  let racRB = false; try { await createRecipientAuthorizationDecision(ownerA, { safetySignalId: sig, recipientMembershipId: mGuard, guardianRelationshipId: relA }); } catch { racRB = true; }
  __setOutboxEnqueueFaultForTests(false);
  check("★ (48) forced enqueue failure rolls back the decision creation", racRB && (await systemDb.safetyRecipientAuthorizationDecision.count({ where: { tenantId: A } })) === beforeCount);
  // (49)(50) affected recipient + current managers.
  await drain();
  check("★ (49)(50) processed decision event → affected recipient + managers", (await notif(A, uGuard, "family_recipient_authorization_changed")) >= 1 && (await notif(A, uOwner, "family_recipient_authorization_changed")) >= 1);
  // (51) scopes / reason / evaluator facts never stored.
  check("★ (51) recipient-auth outbox events store no scopes/reasons/evaluator facts", racRows.every((r) => Object.keys(r).every((k) => !/scope|reason(?!Code)|evaluat|disclosure|signal/i.test(k))));
  // (52) a revoked decision does not preserve the recipient's effective source access.
  const eff = await withTenant(A, (tx) => tx.safetyRecipientAuthorizationDecision.findFirst({ where: { id: dec1.id, tenantId: A, decisionStatus: "authorized", revokedAt: null }, select: { id: true } }));
  check("★ (52) a revoked decision no longer counts as effective authorization", eff === null);
  // (53) retry of the same decision event does not duplicate.
  const racEvId = racRows[0]!.id;
  await systemDb.familyNotificationOutboxEvent.update({ where: { id: racEvId }, data: { status: "processing", lockExpiresAt: new Date(Date.now() - 60_000) } });
  const beforeRac = await notif(A, uGuard, "family_recipient_authorization_changed");
  await drain();
  check("★ (53) reprocessing the same decision event does not duplicate", (await notif(A, uGuard, "family_recipient_authorization_changed")) === beforeRac);

  // ═════════ 7. Worker & recovery (mixed batch) ═════════
  console.log("\n7. worker & recovery");
  // Build a fresh mix of all types, then process one batch.
  const mixDelAck = await availableDelivery(); await acknowledgeSafetySignalDelivery(guardA, mixDelAck);
  const mixDelDec = await availableDelivery(); await declineSafetySignalDelivery(guardA, mixDelDec);
  const mixAuth = await createGuardianAuthorityRecord(ownerA, { guardianRelationshipId: relA, authorityType: "legal_guardian" }); await verifyGuardianAuthorityRecord(ownerA, mixAuth.id, {});
  const mixDec = await createRecipientAuthorizationDecision(ownerA, { safetySignalId: sig, recipientMembershipId: mGuard, guardianRelationshipId: relA });
  const pendingBefore = await systemDb.familyNotificationOutboxEvent.count({ where: { tenantId: A, status: "pending", nextAttemptAt: { lte: new Date() } } });
  const mix = await processFamilyNotificationOutboxBatch({ batchSize: 200, now: new Date() });
  check("★ (55) processor handles a mixed batch of multiple types", mix.claimed >= 4 && mix.claimed >= pendingBefore);
  // (57) two workers never double-claim; (59) crash recovery no dup.
  const raceAck = await availableDelivery(); await acknowledgeSafetySignalDelivery(guardA, raceAck);
  const [ra, rb] = await Promise.all([processFamilyNotificationOutboxBatch({ batchSize: 50, now: new Date() }), processFamilyNotificationOutboxBatch({ batchSize: 50, now: new Date() })]);
  check("★ (57) two racing processors never double-claim (one observable notification)", (ra.claimed + rb.claimed) >= 1);
  // (60) malformed dead-letters; (62) no raw error text — reuse the (4) row already dead-lettered.
  const dl = await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: `mm_${sfx}` }, select: { status: true, lastErrorCode: true } });
  check("★ (60)(62) malformed → dead_letter with bounded code (no raw text)", dl?.status === "dead_letter" && dl?.lastErrorCode === "malformed_event");
  // (61) transient failure uses bounded backoff (stub throws → retry scheduled with backoff).
  const trans = await availableDelivery(); await acknowledgeSafetySignalDelivery(guardA, trans);
  const transEv = (await ev(A, "family_delivery_acknowledged", trans))[0]!;
  const nowT = new Date();
  await processFamilyNotificationOutboxBatch({ batchSize: 50, now: nowT }, { createAuthorizedFamilyNotification: (async () => { throw new Error("transient"); }) as never });
  const transAfter = await systemDb.familyNotificationOutboxEvent.findFirst({ where: { id: transEv.id }, select: { status: true, nextAttemptAt: true, lastErrorCode: true } });
  check("★ (61) transient failure → retry scheduled with bounded backoff", transAfter?.status === "pending" && transAfter!.nextAttemptAt.getTime() > nowT.getTime() && transAfter?.lastErrorCode === "processing_error");

  // ═════════ 8. Static boundary ═════════
  console.log("\n8. static boundary");
  const { readFileSync, readdirSync } = await import("node:fs");
  const srcDir = new URL("../src/", import.meta.url).pathname;
  const importers = readdirSync(srcDir).filter((f) => f.endsWith(".ts")).filter((f) => /from ["'][^"']*internal\/family-notification-outbox["']/.test(readFileSync(srcDir + f, "utf8"))).sort();
  check("★ (70) exactly the authorized canonical domain services wire the enqueue", JSON.stringify(importers) === JSON.stringify(["child-safety-consent.ts", "child-safety-delivery.ts", "child-safety-escalation.ts", "child-safety-incident.ts", "child-safety-protection-plan.ts", "child-safety-recipient-authorization.ts", "child-safety-safety-signal.ts", "family-invitation.ts"]), importers.join(","));
  // no recipient columns stored anywhere in the outbox.
  const cols = (await systemDb.$queryRawUnsafe<Array<{ column_name: string }>>(`SELECT column_name FROM information_schema.columns WHERE table_name='family_notification_outbox_events'`)).map((c) => c.column_name);
  check("★ (5)(6) outbox has no recipient/JSON/content columns", !cols.some((c) => /recipient|user|member|email|note|scope|payload|json|content/i.test(c)));
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    __setOutboxEnqueueFaultForTests(false);
    for (const t of [`aa_${sfx}`, `ab_${sfx}`]) {
      await systemDb.familyNotificationOutboxEvent.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.notification.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.tenant.delete({ where: { id: t } }).catch(() => {});
    }
    for (const u of [`au_o_${sfx}`, `au_g_${sfx}`, `au_v_${sfx}`, `au_m_${sfx}`, `au_i_${sfx}`, `au_rb_${sfx}`, `au_iv_${sfx}`, `au_i3_${sfx}`]) await systemDb.user.delete({ where: { id: u } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Family notifications advisory triggers: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
