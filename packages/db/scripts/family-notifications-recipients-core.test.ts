/**
 * FAMILY NOTIFICATIONS — Phase 2b-A recipient authorization kernel tests (local DB). Proves the INTERNAL
 * resolver + high-level authorized creation for signals + delivery: fail-closed source/workspace/profile
 * validation, the full CS-C4 authorization chain (each link necessary), the exact delivery recipient,
 * deterministic dedup, and transaction-safe creation. Composes canonical domain services for fixtures.
 * Run: pnpm family-notifications-recipients-core:test
 */
import { systemDb, withTenant, createRecipientAuthorizationDecision, createSafetySignalDelivery, makeSafetySignalDeliveryAvailable, acknowledgeSafetySignalDelivery, createFamilyNotificationTx } from "@guardora/db";
import { resolveFamilyNotificationRecipientsTx, createAuthorizedFamilyNotificationTx } from "../src/internal/family-notification-authorization";
import { WorkspaceKind, RiskType, SafetySeverity, GuardianRelationshipType, GuardianAuthorityLevel, type FamilyActorContext } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const sfx = `fnr_${process.pid}`;
const future = new Date(Date.now() + 30 * 86_400_000);
const fam = (tenantId: string, userId: string, role: string): FamilyActorContext => ({ tenantId, userId, role, workspaceKind: WorkspaceKind.Family });
// The resolver runs read-only via canonical evaluators; a fresh withTenant tx per call is fine for tests.
const resolveSig = (tenantId: string, safetySignalId: string, type: "family_signal_available" | "family_urgent_signal", v = "e1") =>
  withTenant(tenantId, (tx) => resolveFamilyNotificationRecipientsTx(tx, { tenantId, source: { type, safetySignalId, eventVersion: v } }));
const resolveDlv = (tenantId: string, deliveryId: string, v = "e1") =>
  withTenant(tenantId, (tx) => resolveFamilyNotificationRecipientsTx(tx, { tenantId, source: { type: "family_delivery_available", deliveryId, eventVersion: v } }));

async function main() {
  // ── Fixture: an authorized chain in famA + a Business tenant + famB (cross-tenant) ──
  const famA = (await systemDb.tenant.create({ data: { id: `fa_${sfx}`, name: "FamA", slug: `fa_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const famB = (await systemDb.tenant.create({ data: { id: `fb_${sfx}`, name: "FamB", slug: `fb_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const biz = (await systemDb.tenant.create({ data: { id: `bz_${sfx}`, name: "Biz", slug: `bz_${sfx}`, workspaceKind: WorkspaceKind.Business } })).id;
  const uOwner = (await systemDb.user.create({ data: { id: `uo_${sfx}`, email: `uo_${sfx}@t.local` } })).id;
  const uGuard = (await systemDb.user.create({ data: { id: `ug_${sfx}`, email: `ug_${sfx}@t.local` } })).id;
  const uGuard2 = (await systemDb.user.create({ data: { id: `ug2_${sfx}`, email: `ug2_${sfx}@t.local` } })).id;
  const uView = (await systemDb.user.create({ data: { id: `uv_${sfx}`, email: `uv_${sfx}@t.local` } })).id;
  const mOwnerA = (await systemDb.membership.create({ data: { userId: uOwner, tenantId: famA, role: "owner" as never } })).id;
  const mGuardA = (await systemDb.membership.create({ data: { userId: uGuard, tenantId: famA, role: "admin" as never } })).id;
  const mGuard2A = (await systemDb.membership.create({ data: { userId: uGuard2, tenantId: famA, role: "admin" as never } })).id;
  await systemDb.membership.create({ data: { userId: uView, tenantId: famA, role: "viewer" as never } });
  const ownerA = fam(famA, uOwner, "owner");

  const pA = (await systemDb.protectedProfile.create({ data: { tenantId: famA, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  const relA = (await systemDb.guardianRelationship.create({ data: { tenantId: famA, guardianMembershipId: mGuardA, protectedProfileId: pA, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: "secondary", status: "verified" } })).id;
  const authA = (await systemDb.guardianAuthorityRecord.create({ data: { tenantId: famA, guardianRelationshipId: relA, authorityType: "legal_guardian", authorityStatus: "verified", verifiedAt: new Date(), validUntil: future } })).id;
  const consentA = (await systemDb.consentRecord.create({ data: { tenantId: famA, protectedProfileId: pA, consentType: "guardian", consentStatus: "active", grantedAt: new Date(), grantedByMembershipId: mOwnerA, validUntil: future } })).id;
  const assessA = (await systemDb.safeRecipientAssessment.create({ data: { tenantId: famA, guardianRelationshipId: relA, assessmentStatus: "approved", eligibilityStatus: "eligible", assessedByMembershipId: mOwnerA, assessedAt: new Date(), validUntil: future } })).id;
  const sigA = (await systemDb.safetySignal.create({ data: { tenantId: famA, protectedProfileId: pA, signalType: RiskType.Cyberbullying, severity: SafetySeverity.High, sourceType: "manual_test" } })).id;
  // Persisted recipient authorization decision (via canonical service) for mGuardA.
  const decision = await createRecipientAuthorizationDecision(ownerA, { safetySignalId: sigA, recipientMembershipId: mGuardA, guardianRelationshipId: relA });

  console.log("\n1. source / workspace validation (fail-closed)");
  check("★ unsupported Family type fails closed (unknown type)", (await withTenant(famA, (tx) => resolveFamilyNotificationRecipientsTx(tx, { tenantId: famA, source: { type: "family_totally_unknown" as never, safetySignalId: sigA, eventVersion: "e1" } }))).ok === false);
  check("★ Business workspace → workspace_mismatch", (await resolveSig(biz, sigA, "family_signal_available")).ok === false);
  check("★ missing source → source_not_found", (() => true)() && (await resolveSig(famA, `nope_${sfx}`, "family_signal_available")).ok === false);
  check("★ cross-tenant signal (looked up in famB) → not found", (await resolveSig(famB, sigA, "family_signal_available")).ok === false);
  check("★ malformed eventVersion rejected", (await withTenant(famA, (tx) => resolveFamilyNotificationRecipientsTx(tx, { tenantId: famA, source: { type: "family_signal_available", safetySignalId: sigA, eventVersion: "bad version!!" } }))).ok === false);

  console.log("\n2. safety-signal authorization chain");
  const r = await resolveSig(famA, sigA, "family_signal_available");
  check("★ fully authorized recipient receives family_signal_available", r.ok === true && r.recipientUserIds.length === 1 && r.recipientUserIds[0] === uGuard);
  const ru = await resolveSig(famA, sigA, "family_urgent_signal");
  check("★ fully authorized recipient receives family_urgent_signal (severity high)", ru.ok === true && ru.recipientUserIds.includes(uGuard));
  // normal severity signal cannot become urgent
  const sigNormal = (await systemDb.safetySignal.create({ data: { tenantId: famA, protectedProfileId: pA, signalType: RiskType.Cyberbullying, severity: SafetySeverity.Low, sourceType: "manual_test" } })).id;
  check("★ normal signal cannot create an urgent notification (source_state_invalid)", (await resolveSig(famA, sigNormal, "family_urgent_signal")).ok === false);
  // ordinary membership / viewer / second guardian without the chain are NOT recipients
  check("★ ordinary tenant membership / viewer alone is insufficient (only the authorized guardian)", r.ok === true && !r.recipientUserIds.includes(uOwner) && !r.recipientUserIds.includes(uView) && !r.recipientUserIds.includes(uGuard2));

  // each chain link necessary → revoke, re-resolve, restore
  const expectNone = async (label: string) => { const x = await resolveSig(famA, sigA, "family_signal_available"); check(label, x.ok === true && x.recipientUserIds.length === 0); };
  await systemDb.guardianAuthorityRecord.update({ where: { id: authA }, data: { authorityStatus: "revoked", revokedAt: new Date() } });
  await expectNone("★ revoked authority → no recipient");
  await systemDb.guardianAuthorityRecord.update({ where: { id: authA }, data: { authorityStatus: "verified", revokedAt: null } });
  await systemDb.consentRecord.update({ where: { id: consentA }, data: { consentStatus: "withdrawn", revokedAt: new Date() } });
  await expectNone("★ revoked consent → no recipient");
  await systemDb.consentRecord.update({ where: { id: consentA }, data: { consentStatus: "active", revokedAt: null } });
  await systemDb.safeRecipientAssessment.update({ where: { id: assessA }, data: { assessmentStatus: "revoked", revokedAt: new Date() } });
  await expectNone("★ revoked safe-recipient assessment → no recipient");
  await systemDb.safeRecipientAssessment.update({ where: { id: assessA }, data: { assessmentStatus: "approved", revokedAt: null } });
  await systemDb.guardianRelationship.update({ where: { id: relA }, data: { status: "revoked", revokedAt: new Date() } });
  await expectNone("★ revoked guardian relationship → no recipient");
  await systemDb.guardianRelationship.update({ where: { id: relA }, data: { status: "verified", revokedAt: null } });
  await systemDb.safetyRecipientAuthorizationDecision.update({ where: { id: decision.id }, data: { revokedAt: new Date() } });
  await expectNone("★ revoked recipient-authorization decision → no recipient (prior notification never preserves access)");
  await systemDb.safetyRecipientAuthorizationDecision.update({ where: { id: decision.id }, data: { revokedAt: null } });
  // profile inactive/archived → none
  await systemDb.protectedProfile.update({ where: { id: pA }, data: { protectionStatus: "inactive" } });
  await expectNone("★ inactive protected profile → no recipient");
  await systemDb.protectedProfile.update({ where: { id: pA }, data: { protectionStatus: "active" } });

  console.log("\n3. delivery recipient authorization");
  const dlv = await createSafetySignalDelivery(ownerA, { recipientAuthorizationDecisionId: decision.id, idempotencyKey: `dlvk_${sfx}` });
  await makeSafetySignalDeliveryAvailable(ownerA, dlv.id);
  const rd = await resolveDlv(famA, dlv.id);
  check("★ exact eligible delivery recipient receives one notification", rd.ok === true && rd.recipientUserIds.length === 1 && rd.recipientUserIds[0] === uGuard);
  check("★ delivery recipient membership comes from the canonical row (not a caller value)", rd.ok === true && !rd.recipientUserIds.includes(uOwner) && !rd.recipientUserIds.includes(uGuard2));
  // acknowledged delivery → none
  await acknowledgeSafetySignalDelivery(fam(famA, uGuard, "admin"), dlv.id);
  check("★ acknowledged delivery → no recipient (not 'available')", (await resolveDlv(famA, dlv.id)).ok === true && (await resolveDlv(famA, dlv.id)).recipientUserIds.length === 0);

  console.log("\n4. authorized creation + transaction safety");
  const c1 = await withTenant(famA, (tx) => createAuthorizedFamilyNotificationTx(tx, { tenantId: famA, source: { type: "family_signal_available", safetySignalId: sigA, eventVersion: "v1" } }));
  check("★ eligible signal event creates one row per recipient", c1.ok === true && c1.createdCount === 1 && c1.eligibleRecipientCount === 1);
  const c2 = await withTenant(famA, (tx) => createAuthorizedFamilyNotificationTx(tx, { tenantId: famA, source: { type: "family_signal_available", safetySignalId: sigA, eventVersion: "v1" } }));
  check("★ same event retry creates no duplicate", c2.ok === true && c2.createdCount === 0);
  const c3 = await withTenant(famA, (tx) => createAuthorizedFamilyNotificationTx(tx, { tenantId: famA, source: { type: "family_signal_available", safetySignalId: sigA, eventVersion: "v2" } }));
  check("★ different eventVersion creates a new row", c3.ok === true && c3.createdCount === 1);
  // resolver failure → zero rows
  const before = await systemDb.notification.count({ where: { tenantId: famA } });
  const cf = await withTenant(famA, (tx) => createAuthorizedFamilyNotificationTx(tx, { tenantId: famA, source: { type: "family_signal_available", safetySignalId: `ghost_${sfx}`, eventVersion: "v9" } }));
  check("★ resolver failure creates zero rows", cf.ok === false && (await systemDb.notification.count({ where: { tenantId: famA } })) === before);
  // rollback leaves zero rows
  const before2 = await systemDb.notification.count({ where: { tenantId: famA } });
  try { await withTenant(famA, async (tx) => { await createAuthorizedFamilyNotificationTx(tx, { tenantId: famA, source: { type: "family_signal_available", safetySignalId: sigA, eventVersion: "v_rb" } }); throw new Error("rollback"); }); } catch { /* expected */ }
  check("★ caller rollback leaves zero rows", (await systemDb.notification.count({ where: { tenantId: famA } })) === before2);
  // created rows are per-recipient, non-null userId, catalogue-derived
  const rows = await systemDb.notification.findMany({ where: { tenantId: famA, type: "family_signal_available" as never }, select: { userId: true, titleKey: true, metadata: true } });
  check("★ every created row has non-null userId + catalogue titleKey", rows.length > 0 && rows.every((n) => n.userId === uGuard && n.titleKey.startsWith("family_notif.")));
  check("★ creation result never returns recipient IDs", !("recipientUserIds" in (c1 as object)));
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    for (const t of [`fa_${sfx}`, `fb_${sfx}`, `bz_${sfx}`]) {
      await systemDb.notification.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.membership.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.tenant.delete({ where: { id: t } }).catch(() => {});
    }
    for (const u of [`uo_${sfx}`, `ug_${sfx}`, `ug2_${sfx}`, `uv_${sfx}`]) await systemDb.user.delete({ where: { id: u } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Family notifications recipients (kernel): ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
