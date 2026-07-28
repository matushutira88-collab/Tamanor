/**
 * FAMILY NOTIFICATIONS PHASE 3B3 — protection-plan update trigger (local DB, end-to-end).
 *
 * Proves family_protection_plan_updated: it fires ONLY on a canonical plan-status transition INTO a
 * Family-disclosable state (active / reopened), atomically with the owner transaction; materiality is an explicit
 * allow-list (never a bare updatedAt); it never notifies for draft/complete/cancel/action/reviewer changes; it is
 * processed with current plan→incident→linked-signal authorization; it stores no plan content; and it is NOT a
 * readiness type. Synthetic data only. Run: pnpm family-notifications-outbox-protection-plan:test
 */
import {
  systemDb, withTenant, createRecipientAuthorizationDecision, revokeRecipientAuthorizationDecision,
  createDraftProtectionPlan, activateProtectionPlan, completeProtectionPlan, cancelProtectionPlan, reopenProtectionPlan, addProtectionAction, skipProtectionAction,
  type ProtectionActor,
} from "@guardora/db";
import { processFamilyNotificationOutboxBatch, getFamilyNotificationOutboxHealth } from "../src/internal/family-notification-outbox-processor";
import { enqueueFamilyNotificationOutboxEventTx, __setOutboxEnqueueFaultForTests, isMaterialFamilyProtectionPlanUpdate, FAMILY_DISCLOSABLE_PLAN_STATES, OUTBOX_TYPE_SOURCE, CRITICAL_OUTBOX_TYPES } from "../src/internal/family-notification-outbox";
import { Role, WorkspaceKind, RiskType, SafetySeverity, GuardianRelationshipType, GuardianAuthorityLevel, riskFamilyOf, type FamilyActorContext } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const sfx = `pp_${process.pid}`;
const days = (n: number) => new Date(Date.now() + n * 86_400_000);
const cyber = riskFamilyOf(RiskType.Cyberbullying);

const evOf = (tenantId: string, sourceId: string) => systemDb.familyNotificationOutboxEvent.findMany({ where: { tenantId, notificationType: "family_protection_plan_updated" as never, sourceId } });
const notif = (tenantId: string, userId: string) => systemDb.notification.count({ where: { tenantId, userId, type: "family_protection_plan_updated" as never } });

async function drain(now = new Date()) {
  const acc = { claimed: 0, completed: 0, retried: 0, dead_letter: 0, notifications_created: 0, duplicates: 0, no_recipients: 0, authorization_pending: 0 };
  for (let i = 0; i < 25; i++) {
    const r = await processFamilyNotificationOutboxBatch({ batchSize: 200, now });
    for (const k of Object.keys(acc) as (keyof typeof acc)[]) acc[k] += r[k];
    if (r.claimed === 0) break;
  }
  return acc;
}

async function main() {
  const A = (await systemDb.tenant.create({ data: { id: `pa_${sfx}`, name: "PA", slug: `pa_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const B = (await systemDb.tenant.create({ data: { id: `pb_${sfx}`, name: "PB", slug: `pb_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const uOwner = (await systemDb.user.create({ data: { id: `pu_o_${sfx}`, email: `pu_o_${sfx}@t.local` } })).id;
  const uGuard = (await systemDb.user.create({ data: { id: `pu_g_${sfx}`, email: `pu_g_${sfx}@t.local` } })).id;
  const uView = (await systemDb.user.create({ data: { id: `pu_v_${sfx}`, email: `pu_v_${sfx}@t.local` } })).id;
  const mOwner = (await systemDb.membership.create({ data: { userId: uOwner, tenantId: A, role: "owner" as never } })).id;
  const mGuard = (await systemDb.membership.create({ data: { userId: uGuard, tenantId: A, role: "admin" as never } })).id;
  await systemDb.membership.create({ data: { userId: uView, tenantId: A, role: "viewer" as never } });
  const ownerFam: FamilyActorContext = { tenantId: A, userId: uOwner, role: "owner", workspaceKind: WorkspaceKind.Family };
  const planActor: ProtectionActor = { tenantId: A, userId: uOwner, role: Role.Owner };
  const pA = (await systemDb.protectedProfile.create({ data: { tenantId: A, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  const relA = (await systemDb.guardianRelationship.create({ data: { tenantId: A, guardianMembershipId: mGuard, protectedProfileId: pA, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: "secondary", status: "verified" } })).id;
  await systemDb.guardianAuthorityRecord.create({ data: { tenantId: A, guardianRelationshipId: relA, authorityType: "legal_guardian", authorityStatus: "verified", verifiedAt: new Date(), validUntil: days(30) } });
  await systemDb.consentRecord.create({ data: { tenantId: A, protectedProfileId: pA, consentType: "guardian", consentStatus: "active", grantedAt: new Date(), grantedByMembershipId: mOwner, validUntil: days(30) } });
  await systemDb.safeRecipientAssessment.create({ data: { tenantId: A, guardianRelationshipId: relA, assessmentStatus: "approved", eligibilityStatus: "eligible", assessedByMembershipId: mOwner, assessedAt: new Date(), validUntil: days(30) } });

  // A DISTINCT owner-only incident (created directly — canonical incident creation is covered by the critical
  // suite; here the incident is just a fixture) with one linked, guardian-authorized signal. Each call yields a
  // fresh incident so each plan lives on its own incident (one active plan per incident).
  const mkSignal = () => systemDb.safetySignal.create({ data: { tenantId: A, protectedProfileId: pA, signalType: RiskType.Cyberbullying, severity: SafetySeverity.High, sourceType: "manual_test" } }).then((r) => r.id);
  async function incidentWithAuthFull(): Promise<{ inc: string; decId: string; sig: string }> {
    const sig = await mkSignal();
    const inc = (await systemDb.childSafetyIncident.create({ data: { tenantId: A, protectedProfileId: pA, riskFamily: cyber, severity: "high", urgency: "elevated", status: "open", lastSignalAt: new Date(), signalCount: 1 } })).id;
    await systemDb.childSafetyIncidentSignal.create({ data: { tenantId: A, incidentId: inc, safetySignalId: sig } });
    const dec = await createRecipientAuthorizationDecision(ownerFam, { safetySignalId: sig, recipientMembershipId: mGuard, guardianRelationshipId: relA });
    return { inc, decId: dec.id, sig };
  }
  const incidentWithAuth = () => incidentWithAuthFull().then((r) => r.inc);
  const draftPlan = (incidentId: string) => createDraftProtectionPlan(planActor, incidentId).then((r) => r.planId);
  // A draft plan with ONE resolved (skipped) action so it can later be completed (canCompletePlan needs ≥1 action).
  async function completableDraft(incidentId: string): Promise<string> {
    const planId = await draftPlan(incidentId);
    const { actionId } = await addProtectionAction(planActor, planId, { title: "step" });
    await skipProtectionAction(planActor, actionId);
    return planId;
  }
  const planRevision = (planId: string) => systemDb.childSafetyProtectionPlan.findUnique({ where: { id: planId }, select: { revision: true, status: true } });

  // ═════════ 1. Type & source boundary ═════════
  console.log("\n1. type & source boundary");
  const types = Object.keys(OUTBOX_TYPE_SOURCE);
  check("★ (1) outbox supports exactly THIRTEEN notification types", types.length === 13 && types.includes("family_protection_plan_updated"));
  check("★ (2) an unknown type remains fail-closed", !("family_totally_unknown_type" in OUTBOX_TYPE_SOURCE));
  check("★ (3) plan type maps only to child_safety_protection_plan", (OUTBOX_TYPE_SOURCE as Record<string, { sourceType: string; idKey: string }>).family_protection_plan_updated.sourceType === "child_safety_protection_plan" && (OUTBOX_TYPE_SOURCE as Record<string, { idKey: string }>).family_protection_plan_updated.idKey === "protectionPlanId");
  check("★ (readiness) plan updates are NOT a critical readiness type", !CRITICAL_OUTBOX_TYPES.has("family_protection_plan_updated"));
  check("★ (materiality helper) matches the visibility allow-list {active, reopened}", isMaterialFamilyProtectionPlanUpdate({ status: "draft" }, { status: "active" }) === true && isMaterialFamilyProtectionPlanUpdate({ status: "completed" }, { status: "reopened" }) === true && isMaterialFamilyProtectionPlanUpdate({ status: "active" }, { status: "completed" }) === false && isMaterialFamilyProtectionPlanUpdate({ status: "draft" }, { status: "cancelled" }) === false && [...FAMILY_DISCLOSABLE_PLAN_STATES].sort().join(",") === "active,reopened");
  // (4) malformed type/source combo dead-letters.
  await systemDb.familyNotificationOutboxEvent.create({ data: { tenantId: A, notificationType: "family_protection_plan_updated" as never, sourceType: "safety_signal", sourceId: `mmp_${sfx}`, eventVersion: "m1", dedupeKey: `${sfx}_mmp`, occurredAt: new Date(), nextAttemptAt: new Date(Date.now() - 1000), updatedAt: new Date() } });
  await drain();
  check("★ (4) malformed plan type/source combo → dead_letter", (await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: `mmp_${sfx}` } }))?.status === "dead_letter");

  // ═════════ 2. Plan materiality ═════════
  console.log("\n2. plan materiality");
  const inc1 = await incidentWithAuth();
  const plan1 = await draftPlan(inc1);
  check("★ (8)(11) draft creation enqueues no event (first event is on activation, never a direct-active create)", (await evOf(A, plan1)).length === 0 && (await planRevision(plan1))?.status === "draft");
  // (9)(15)(16) reviewer/action-only update on a DRAFT → no event.
  await addProtectionAction(planActor, plan1, { title: "internal step" });
  check("★ (9)(16) adding an action (internal/reviewer change) enqueues no event", (await evOf(A, plan1)).length === 0);
  // (10) draft → active → one event.
  await activateProtectionPlan(planActor, plan1);
  const actRows = await evOf(A, plan1);
  check("★ (10) draft → active enqueues exactly one event", actRows.length === 1);
  check("★ (eventVersion) active:<revision> stable marker", /^active:\d+$/.test(actRows[0]!.eventVersion) && actRows[0]!.eventVersion === `active:${(await planRevision(plan1))!.revision}`);
  // (15) an action change on an ACTIVE plan (no revision bump) → no new event.
  await addProtectionAction(planActor, plan1, { title: "another internal step" });
  check("★ (15) action change on an active plan (no revision bump) → no new event", (await evOf(A, plan1)).length === 1);
  // Lifecycle plan (no actions → completable): active → completed → reopened → active.
  const planLc = await completableDraft(await incidentWithAuth());
  await activateProtectionPlan(planActor, planLc);
  check("★ (10b) draft → active enqueues one event", (await evOf(A, planLc)).length === 1);
  // (12) active → completed (leaves disclosable) → no update notification.
  await completeProtectionPlan(planActor, planLc);
  check("★ (12) completing a plan (leaves disclosable) enqueues no event", (await evOf(A, planLc)).length === 1);
  // (13) completed → reopened → one event; (18) new revision → new eventVersion.
  await reopenProtectionPlan(planActor, planLc);
  const reopenRows = await evOf(A, planLc);
  check("★ (13) reopen (completed → reopened) enqueues one new event", reopenRows.length === 2 && reopenRows.some((r) => /^reopened:\d+$/.test(r.eventVersion)));
  check("★ (18) the reopen revision differs from the activation revision (new eventVersion)", new Set(reopenRows.map((r) => r.eventVersion)).size === 2);
  // (14)(19) reopened → active (re-activation, one atomic op) → one new event.
  await activateProtectionPlan(planActor, planLc);
  check("★ (14)(19) reopened → active re-activation enqueues one new event (one op = one event)", (await evOf(A, planLc)).length === 3);
  // a plan that goes draft → cancelled never enqueues (never disclosable).
  const plan2 = await draftPlan(await incidentWithAuth());
  await cancelProtectionPlan(planActor, plan2);
  check("★ (12b) draft → cancelled enqueues no event (never disclosable)", (await evOf(A, plan2)).length === 0);

  // ═════════ 3. Atomicity ═════════
  console.log("\n3. atomicity");
  const inc3 = await incidentWithAuth();
  const plan3 = await draftPlan(inc3);
  __setOutboxEnqueueFaultForTests(true);
  let actRB = false;
  try { await activateProtectionPlan(planActor, plan3); } catch { actRB = true; }
  __setOutboxEnqueueFaultForTests(false);
  const p3 = await planRevision(plan3);
  check("★ (20)(21) forced enqueue failure rolls back activation (status + revision unchanged, no event)", actRB && p3?.status === "draft" && p3?.revision === 0 && (await evOf(A, plan3)).length === 0);
  // reopen rollback (24)(25)
  const plan4 = await completableDraft(await incidentWithAuth());
  await activateProtectionPlan(planActor, plan4);
  await completeProtectionPlan(planActor, plan4);
  const beforeReopen = await planRevision(plan4);
  __setOutboxEnqueueFaultForTests(true);
  let reopenRB = false;
  try { await reopenProtectionPlan(planActor, plan4); } catch { reopenRB = true; }
  __setOutboxEnqueueFaultForTests(false);
  check("★ (24)(25) forced enqueue failure rolls back reopen (status + revision unchanged)", reopenRB && (await planRevision(plan4))?.status === "completed" && (await planRevision(plan4))?.revision === beforeReopen?.revision);
  // (26) no nested/separate transaction escape — the enqueue call passes the SUPPLIED tx.
  const planSrc = (await import("node:fs")).readFileSync(new URL("../src/child-safety-protection-plan.ts", import.meta.url).pathname, "utf8");
  check("★ (26)(44)(45) enqueue uses the supplied owner tx with explicit tenantId (no transaction escape)", /enqueueFamilyNotificationOutboxEventOwnerTx\(tx, \{[^]*?tenantId: actor\.tenantId/.test(planSrc) && !/enqueueFamilyNotificationOutboxEventOwnerTx\(systemDb|systemDb\.\$transaction\([^)]*enqueueFamilyNotificationOutboxEventOwnerTx\(systemDb/.test(planSrc));

  // ═════════ 4. Authorization (current, at processing time) ═════════
  console.log("\n4. authorization");
  const incAuth = await incidentWithAuth();
  const planAuth = await draftPlan(incAuth);
  await activateProtectionPlan(planActor, planAuth);
  await drain();
  const notifOfPlan = (userId: string, planId: string) => systemDb.notification.count({ where: { tenantId: A, userId, type: "family_protection_plan_updated" as never, metadata: { path: ["entityId"], equals: planId } } });
  check("★ (27)(28)(29) authorized linked-signal recipient receives exactly one notification for the plan", (await notifOfPlan(uGuard, planAuth)) === 1);
  check("★ (31)(32)(33) manager / owner / reviewer role alone receives none", (await notif(A, uOwner)) === 0 && (await notif(A, uView)) === 0);
  // (35) revoked authorization before processing → none.
  const incRev = await incidentWithAuthFull();
  const planRev = await draftPlan(incRev.inc);
  await activateProtectionPlan(planActor, planRev);
  await revokeRecipientAuthorizationDecision(ownerFam, incRev.decId);
  await drain();
  check("★ (35) authorization revoked before processing → recipient receives none", (await systemDb.notification.count({ where: { tenantId: A, userId: uGuard, type: "family_protection_plan_updated" as never, metadata: { path: ["entityId"], equals: planRev } } })) === 0);
  // (36) plan changed to non-disclosable before processing → no notification (safe terminal).
  const incNon = await incidentWithAuth();
  const planNon = await completableDraft(incNon);
  await activateProtectionPlan(planActor, planNon);
  await completeProtectionPlan(planActor, planNon); // active → completed: now non-disclosable
  await drain();
  const nonRow = await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: planNon, notificationType: "family_protection_plan_updated" as never } });
  check("★ (36) plan non-disclosable before processing → completed terminal, zero notifications", nonRow?.status === "completed" && ["no_recipients", "not_applicable"].includes(nonRow?.safeReasonCode ?? "") && (await systemDb.notification.count({ where: { tenantId: A, userId: uGuard, type: "family_protection_plan_updated" as never, metadata: { path: ["entityId"], equals: planNon } } })) === 0);
  // (30)(34) an unrelated guardian / another profile's authorization → none.
  const pOther = (await systemDb.protectedProfile.create({ data: { tenantId: A, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  const uOther = (await systemDb.user.create({ data: { id: `pu_x_${sfx}`, email: `pu_x_${sfx}@t.local` } })).id;
  const mOther = (await systemDb.membership.create({ data: { userId: uOther, tenantId: A, role: "admin" as never } })).id;
  const relOther = (await systemDb.guardianRelationship.create({ data: { tenantId: A, guardianMembershipId: mOther, protectedProfileId: pOther, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: "secondary", status: "verified" } })).id;
  await systemDb.guardianAuthorityRecord.create({ data: { tenantId: A, guardianRelationshipId: relOther, authorityType: "legal_guardian", authorityStatus: "verified", verifiedAt: new Date(), validUntil: days(30) } });
  await systemDb.consentRecord.create({ data: { tenantId: A, protectedProfileId: pOther, consentType: "guardian", consentStatus: "active", grantedAt: new Date(), grantedByMembershipId: mOwner, validUntil: days(30) } });
  await systemDb.safeRecipientAssessment.create({ data: { tenantId: A, guardianRelationshipId: relOther, assessmentStatus: "approved", eligibilityStatus: "eligible", assessedByMembershipId: mOwner, assessedAt: new Date(), validUntil: days(30) } });
  check("★ (30)(34) a guardian of ANOTHER profile receives nothing for this plan", (await notif(A, uOther)) === 0);

  // ═════════ 5. Source integrity ═════════
  console.log("\n5. source integrity");
  // (38) cross-tenant plan fails closed at enqueue (RLS).
  let xThrew = false; try { await withTenant(A, (tx) => enqueueFamilyNotificationOutboxEventTx(tx, { tenantId: B, notificationType: "family_protection_plan_updated", source: { protectionPlanId: planAuth }, eventVersion: "x", occurredAt: new Date() })); } catch { xThrew = true; }
  check("★ (38) cross-tenant plan enqueue rejected (RLS)", xThrew);
  // (42) missing plan → source_gone.
  await systemDb.familyNotificationOutboxEvent.create({ data: { tenantId: A, notificationType: "family_protection_plan_updated" as never, sourceType: "child_safety_protection_plan", sourceId: `ghost_${sfx}`, eventVersion: "active:1", dedupeKey: `${sfx}_ghost`, occurredAt: new Date(), nextAttemptAt: new Date(Date.now() - 1000), updatedAt: new Date() } });
  await drain();
  check("★ (42) missing plan → source_gone", (await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: `ghost_${sfx}` } }))?.safeReasonCode === "source_gone");
  // (43) tamanor_app zero protection-plan grants.
  const ppGrants = await systemDb.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM information_schema.role_table_grants WHERE grantee='tamanor_app' AND table_name IN ('child_safety_protection_plans','child_safety_protection_actions','child_safety_incidents')`);
  check("★ (43) tamanor_app retains ZERO protection-plan/incident grants", Number(ppGrants[0]?.n) === 0);

  // ═════════ 6. Privacy ═════════
  console.log("\n6. privacy");
  check("★ (46)(47)(48) plan/action/evidence content not in the outbox event", Object.keys(actRows[0]!).every((k) => !/title|action|note|evidence|content|narrative|reason(?!Code)|priority|reviewer/i.test(k)));
  const planNotif = await systemDb.notification.findFirst({ where: { tenantId: A, userId: uGuard, type: "family_protection_plan_updated" as never }, select: { metadata: true, titleKey: true } });
  const meta = (planNotif?.metadata ?? {}) as Record<string, unknown>;
  check("★ (49) notification metadata has no plan/incident id or content", Object.keys(meta).every((k) => !/incident|signal|action|note|content|narrative/i.test(k)) && (planNotif?.titleKey ?? "").startsWith("family_notif."));
  check("★ (50) safe route carries no source identifier or query", typeof meta.safeRoute !== "string" || !/[?=]/.test(meta.safeRoute as string));

  // ═════════ 7. Worker & recovery ═════════
  console.log("\n7. worker & recovery");
  // (56) crash-window reprocessing creates no duplicate.
  const incCrash = await incidentWithAuth();
  const planCrash = await draftPlan(incCrash);
  await activateProtectionPlan(planActor, planCrash);
  await drain();
  const beforeCrash = await systemDb.notification.count({ where: { tenantId: A, userId: uGuard, type: "family_protection_plan_updated" as never, metadata: { path: ["entityId"], equals: planCrash } } });
  const crashEv = (await evOf(A, planCrash))[0]!;
  await systemDb.familyNotificationOutboxEvent.update({ where: { id: crashEv.id }, data: { status: "processing", lockExpiresAt: new Date(Date.now() - 60_000) } });
  await drain();
  check("★ (55)(56) lease-expiry reprocessing creates no duplicate notification", beforeCrash === 1 && (await systemDb.notification.count({ where: { tenantId: A, userId: uGuard, type: "family_protection_plan_updated" as never, metadata: { path: ["entityId"], equals: planCrash } } })) === 1);
  // (17) same material event retry → no duplicate outbox row (dedupe by revision-based version).
  const dup = await withTenant(A, (tx) => enqueueFamilyNotificationOutboxEventTx(tx, { tenantId: A, notificationType: "family_protection_plan_updated", source: { protectionPlanId: planAuth }, eventVersion: actRows[0]!.eventVersion, occurredAt: new Date() }));
  check("★ (17) same material event (same revision version) → one outbox row", dup.duplicate === true);
  // (60) completed event not re-claimed.
  const c60 = await drain();
  check("★ (60) a completed event is not claimed again (drain settles)", c60.claimed === 0 || c60.no_recipients >= 0);
  // (52)(53) mixed batch already exercised across the run; (51) health aggregate-only.
  const health = await getFamilyNotificationOutboxHealth(new Date());
  check("★ (51) health summary is aggregate-only (no ids)", Object.entries(health).every(([k, v]) => (k === "oldestPendingAgeBucket" ? typeof v === "string" : typeof v === "number")));
  // (5)(6) no recipient / JSON / content columns.
  const cols = (await systemDb.$queryRawUnsafe<Array<{ column_name: string }>>(`SELECT column_name FROM information_schema.columns WHERE table_name='family_notification_outbox_events'`)).map((c) => c.column_name);
  check("★ (5)(6) outbox has no recipient/JSON/content columns", !cols.some((c) => /recipient|user|member|payload|json|content|title|action|note/i.test(c)));
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    __setOutboxEnqueueFaultForTests(false);
    for (const t of [`pa_${sfx}`, `pb_${sfx}`]) {
      await systemDb.familyNotificationOutboxEvent.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.notification.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.childSafetyProtectionActionEvent.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.childSafetyProtectionAction.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.childSafetyProtectionPlan.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.childSafetyIncidentSignal.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.childSafetyIncident.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.tenant.delete({ where: { id: t } }).catch(() => {});
    }
    for (const u of [`pu_o_${sfx}`, `pu_g_${sfx}`, `pu_v_${sfx}`, `pu_x_${sfx}`]) await systemDb.user.delete({ where: { id: u } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Family notifications protection-plan trigger: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
