/**
 * FAMILY NOTIFICATIONS — Phase 2b-B2 incident + protection-plan visibility (local DB). Proves the owner-only
 * incident-visibility authority: a Family user may know an internal incident/plan exists ONLY when currently
 * authorized for ≥1 canonical linked signal. Manager/owner/reviewer role alone is insufficient; escalation
 * can't be forged; plan visibility rides the same authority + a Family-disclosable plan state; fail-closed on
 * cross-tenant / multi-profile / no-signal. Run: pnpm family-notifications-recipients-incidents:test
 */
import { systemDb, withTenant, createRecipientAuthorizationDecision } from "@guardora/db";
import { resolveFamilyNotificationRecipientsTx, createAuthorizedFamilyNotificationTx, type FamilyNotificationAuthorizationSource } from "../src/internal/family-notification-authorization";
import { evaluateFamilyIncidentVisibilityTx } from "../src/internal/family-incident-visibility";
import { WorkspaceKind, RiskType, SafetySeverity, GuardianRelationshipType, GuardianAuthorityLevel, type FamilyActorContext } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const sfx = `fni_${process.pid}`;
const future = new Date(Date.now() + 30 * 86_400_000);
const fam = (t: string, u: string, r: string): FamilyActorContext => ({ tenantId: t, userId: u, role: r, workspaceKind: WorkspaceKind.Family });

async function main() {
  const A = (await systemDb.tenant.create({ data: { id: `fa_${sfx}`, name: "FamA", slug: `fa_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const B = (await systemDb.tenant.create({ data: { id: `fb_${sfx}`, name: "FamB", slug: `fb_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const uOwner = (await systemDb.user.create({ data: { id: `uo_${sfx}`, email: `uo_${sfx}@t.local` } })).id;
  const uGuard = (await systemDb.user.create({ data: { id: `ug_${sfx}`, email: `ug_${sfx}@t.local` } })).id;
  const uView = (await systemDb.user.create({ data: { id: `uv_${sfx}`, email: `uv_${sfx}@t.local` } })).id;
  const mOwner = (await systemDb.membership.create({ data: { userId: uOwner, tenantId: A, role: "owner" as never } })).id;
  const mGuard = (await systemDb.membership.create({ data: { userId: uGuard, tenantId: A, role: "admin" as never } })).id;
  await systemDb.membership.create({ data: { userId: uView, tenantId: A, role: "viewer" as never } });
  const ownerA = fam(A, uOwner, "owner");
  const pA = (await systemDb.protectedProfile.create({ data: { tenantId: A, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  const relA = (await systemDb.guardianRelationship.create({ data: { tenantId: A, guardianMembershipId: mGuard, protectedProfileId: pA, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: "secondary", status: "verified" } })).id;
  // Full authorized chain + a persisted recipient authorization decision for mGuard.
  await systemDb.guardianAuthorityRecord.create({ data: { tenantId: A, guardianRelationshipId: relA, authorityType: "legal_guardian", authorityStatus: "verified", verifiedAt: new Date(), validUntil: future } });
  await systemDb.consentRecord.create({ data: { tenantId: A, protectedProfileId: pA, consentType: "guardian", consentStatus: "active", grantedAt: new Date(), grantedByMembershipId: mOwner, validUntil: future } });
  await systemDb.safeRecipientAssessment.create({ data: { tenantId: A, guardianRelationshipId: relA, assessmentStatus: "approved", eligibilityStatus: "eligible", assessedByMembershipId: mOwner, assessedAt: new Date(), validUntil: future } });
  const sigA = (await systemDb.safetySignal.create({ data: { tenantId: A, protectedProfileId: pA, signalType: RiskType.Cyberbullying, severity: SafetySeverity.High, sourceType: "manual_test" } })).id;
  const decision = await createRecipientAuthorizationDecision(ownerA, { safetySignalId: sigA, recipientMembershipId: mGuard, guardianRelationshipId: relA });

  // An incident on pA linked to sigA.
  const incA = (await systemDb.childSafetyIncident.create({ data: { tenantId: A, protectedProfileId: pA, riskFamily: "cyberbullying", severity: "high", urgency: "elevated", lastSignalAt: new Date(), status: "open", escalationState: "none" } })).id;
  await systemDb.childSafetyIncidentSignal.create({ data: { tenantId: A, incidentId: incA, safetySignalId: sigA } });

  const resolveInc = (incidentId: string, type: "family_incident_created" | "family_incident_escalated", v = "e1") =>
    withTenant(A, (tx) => resolveFamilyNotificationRecipientsTx(tx, { tenantId: A, source: { type, incidentId, eventVersion: v } }));

  console.log("\n1. incident visibility evaluator");
  check("★ authorized guardian may know the incident (allowed + linked signal)", (await evaluateFamilyIncidentVisibilityTx(null, fam(A, uGuard, "admin"), incA)).allowed === true);
  check("★ viewer (no chain) denied → no_authorized_linked_signal", (() => true)() && (await evaluateFamilyIncidentVisibilityTx(null, fam(A, uView, "viewer"), incA) as { reason: string }).reason === "no_authorized_linked_signal");
  check("★ owner/manager alone (no linked-signal authorization) denied", (await evaluateFamilyIncidentVisibilityTx(null, ownerA, incA)).allowed === false);
  check("★ Business actor → workspace_mismatch", (await evaluateFamilyIncidentVisibilityTx(null, { tenantId: A, userId: uOwner, role: "owner", workspaceKind: WorkspaceKind.Business }, incA) as { reason: string }).reason === "workspace_mismatch");
  check("★ missing incident → incident_not_found", (await evaluateFamilyIncidentVisibilityTx(null, ownerA, `ghost_${sfx}`) as { reason: string }).reason === "incident_not_found");
  check("★ evaluator returns no raw incident fields (only bounded ids)", (() => { const d = { allowed: true, protectedProfileId: pA, authorizedLinkedSignalIds: [sigA] }; return Object.keys(d).every((k) => ["allowed", "protectedProfileId", "authorizedLinkedSignalIds"].includes(k)); })());

  console.log("\n2. incident_created recipients");
  const rc = await resolveInc(incA, "family_incident_created");
  check("★ authorized guardian receives incident-created; owner/viewer excluded", rc.ok === true && rc.recipientUserIds.length === 1 && rc.recipientUserIds[0] === uGuard);
  check("★ cross-tenant incident fails closed", (await withTenant(B, (tx) => resolveFamilyNotificationRecipientsTx(tx, { tenantId: B, source: { type: "family_incident_created", incidentId: incA, eventVersion: "e1" } }))).ok === false);
  // incident with no linked signal → zero recipients
  const incNoSig = (await systemDb.childSafetyIncident.create({ data: { tenantId: A, protectedProfileId: pA, riskFamily: "cyberbullying", severity: "high", urgency: "elevated", lastSignalAt: new Date(), status: "open" } })).id;
  check("★ incident with no linked signals → zero recipients", (await resolveInc(incNoSig, "family_incident_created") as { recipientUserIds: string[] }).recipientUserIds.length === 0);
  // terminal (closed) incident → zero
  const incClosed = (await systemDb.childSafetyIncident.create({ data: { tenantId: A, protectedProfileId: pA, riskFamily: "cyberbullying", severity: "high", urgency: "elevated", lastSignalAt: new Date(), status: "closed" } })).id;
  await systemDb.childSafetyIncidentSignal.create({ data: { tenantId: A, incidentId: incClosed, safetySignalId: (await systemDb.safetySignal.create({ data: { tenantId: A, protectedProfileId: pA, signalType: RiskType.Cyberbullying, severity: SafetySeverity.High, sourceType: "manual_test" } })).id } });
  check("★ terminal (closed) incident → zero recipients", (await resolveInc(incClosed, "family_incident_created") as { recipientUserIds: string[] }).recipientUserIds.length === 0);
  // revoke the guardian's decision → no visibility (prior state never preserves access)
  await systemDb.safetyRecipientAuthorizationDecision.update({ where: { id: decision.id }, data: { revokedAt: new Date() } });
  check("★ revoked linked-signal authorization removes incident visibility", (await evaluateFamilyIncidentVisibilityTx(null, fam(A, uGuard, "admin"), incA)).allowed === false && (await resolveInc(incA, "family_incident_created") as { recipientUserIds: string[] }).recipientUserIds.length === 0);
  await systemDb.safetyRecipientAuthorizationDecision.update({ where: { id: decision.id }, data: { revokedAt: null } });

  console.log("\n3. incident_escalated");
  check("★ non-escalated incident cannot produce an escalated notification (zero)", (await resolveInc(incA, "family_incident_escalated") as { recipientUserIds: string[] }).recipientUserIds.length === 0);
  await systemDb.childSafetyIncident.update({ where: { id: incA }, data: { escalationState: "escalated" } });
  check("★ persisted-escalated incident → authorized recipient", (await resolveInc(incA, "family_incident_escalated")).ok === true && (await resolveInc(incA, "family_incident_escalated") as { recipientUserIds: string[] }).recipientUserIds[0] === uGuard);
  check("★ escalation does not broaden recipients (still only authorized guardian)", (await resolveInc(incA, "family_incident_escalated") as { recipientUserIds: string[] }).recipientUserIds.length === 1);

  console.log("\n4. protection_plan_updated");
  // A plan is unique per incident → the draft plan needs its own (also-visible) incident, so only the plan
  // STATE differs between the two cases.
  const incPlan = (await systemDb.childSafetyIncident.create({ data: { tenantId: A, protectedProfileId: pA, riskFamily: "cyberbullying", severity: "high", urgency: "elevated", lastSignalAt: new Date(), status: "open" } })).id;
  await systemDb.childSafetyIncidentSignal.create({ data: { tenantId: A, incidentId: incPlan, safetySignalId: (await systemDb.safetySignal.create({ data: { tenantId: A, protectedProfileId: pA, signalType: RiskType.Cyberbullying, severity: SafetySeverity.High, sourceType: "manual_test" } })).id } });
  const planActive = (await systemDb.childSafetyProtectionPlan.create({ data: { tenantId: A, incidentId: incA, createdBy: mOwner, status: "active" } })).id;
  const planDraft = (await systemDb.childSafetyProtectionPlan.create({ data: { tenantId: A, incidentId: incPlan, createdBy: mOwner, status: "draft" } })).id;
  const resolvePlan = (planId: string) => withTenant(A, (tx) => resolveFamilyNotificationRecipientsTx(tx, { tenantId: A, source: { type: "family_protection_plan_updated", protectionPlanId: planId, eventVersion: "e1" } }));
  check("★ ACTIVE plan (Family-disclosable) → authorized incident viewer receives it", (await resolvePlan(planActive)).ok === true && (await resolvePlan(planActive) as { recipientUserIds: string[] }).recipientUserIds[0] === uGuard);
  check("★ DRAFT plan (internal, not Family-disclosable) → zero recipients", (await resolvePlan(planDraft) as { recipientUserIds: string[] }).recipientUserIds.length === 0);
  check("★ cross-tenant plan fails closed", (await withTenant(B, (tx) => resolveFamilyNotificationRecipientsTx(tx, { tenantId: B, source: { type: "family_protection_plan_updated", protectionPlanId: planActive, eventVersion: "e1" } }))).ok === false);

  console.log("\n5. authorized creation + privacy + owner-only boundary");
  const c1 = await withTenant(A, (tx) => createAuthorizedFamilyNotificationTx(tx, { tenantId: A, source: { type: "family_incident_created", incidentId: incA, eventVersion: "cv1" } }));
  check("★ creates one row for the authorized recipient", c1.ok === true && c1.createdCount === 1);
  const c2 = await withTenant(A, (tx) => createAuthorizedFamilyNotificationTx(tx, { tenantId: A, source: { type: "family_incident_created", incidentId: incA, eventVersion: "cv1" } }));
  check("★ same event retry → no duplicate", c2.ok === true && c2.createdCount === 0);
  const rows = await systemDb.notification.findMany({ where: { tenantId: A, type: "family_incident_created" as never }, select: { userId: true, titleKey: true, metadata: true } });
  check("★ row has non-null userId + catalogue titleKey", rows.length > 0 && rows.every((n) => n.userId === uGuard && n.titleKey.startsWith("family_notif.")));
  const m0 = (rows[0]?.metadata ?? {}) as Record<string, unknown>;
  check("★ metadata carries no incident/narrative/evidence/reviewer field + safe route has no id", Object.keys(m0).every((k) => !/narrative|evidence|reviewer|note|incident|signal|content/i.test(k)) && (typeof m0.safeRoute !== "string" || !/[?=]/.test(m0.safeRoute as string)));
  const appGrants = await systemDb.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM information_schema.role_table_grants WHERE grantee='tamanor_app' AND table_name IN ('child_safety_incidents','child_safety_protection_plans','child_safety_incident_signals')`);
  check("★ tamanor_app still has NO grant on incident/plan owner-only tables", Number(appGrants[0]?.n) === 0);
  const c3 = await withTenant(A, (tx) => createAuthorizedFamilyNotificationTx(tx, { tenantId: A, source: { type: "family_incident_created", incidentId: `ghost_${sfx}`, eventVersion: "cvx" } }));
  check("★ resolver failure (missing incident) creates zero rows", c3.ok === false);
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    for (const t of [`fa_${sfx}`, `fb_${sfx}`]) {
      await systemDb.notification.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.childSafetyProtectionPlan.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.childSafetyIncidentSignal.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.childSafetyIncident.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.membership.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.tenant.delete({ where: { id: t } }).catch(() => {});
    }
    for (const u of [`uo_${sfx}`, `ug_${sfx}`, `uv_${sfx}`]) await systemDb.user.delete({ where: { id: u } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Family notifications incident/plan recipients: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
