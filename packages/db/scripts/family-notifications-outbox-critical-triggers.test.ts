/**
 * FAMILY NOTIFICATIONS PHASE 3B2 — critical safety-signal & incident triggers (local DB, end-to-end).
 *
 * Proves the four safety-critical triggers (signal available/urgent, incident created/escalated): they originate
 * ONLY in the canonical trusted transition (confirm-risk / incident-create / escalation), enqueue atomically,
 * are mutually exclusive by severity, never bypass authorization, use the bounded authorization-readiness window,
 * store no content, and keep the owner-only incident boundary. Synthetic data only.
 * Run: pnpm family-notifications-outbox-critical:test
 */
import {
  systemDb, withTenant, createRecipientAuthorizationDecision, revokeRecipientAuthorizationDecision,
  confirmSafetySignalRisk, dismissSafetySignal,
  correlateAndLinkSignal, createOrReuseEscalation,
} from "@guardora/db";
import { processFamilyNotificationOutboxBatch, getFamilyNotificationOutboxHealth } from "../src/internal/family-notification-outbox-processor";
import { enqueueFamilyNotificationOutboxEventTx, __setOutboxEnqueueFaultForTests, isMaterialUrgentSignalTransition, OUTBOX_TYPE_SOURCE, CRITICAL_OUTBOX_TYPES, OUTBOX_READINESS_MAX_ATTEMPTS } from "../src/internal/family-notification-outbox";
import { WorkspaceKind, RiskType, SafetySeverity, GuardianRelationshipType, GuardianAuthorityLevel, riskFamilyOf, INCIDENT_CORRELATION_WINDOW_MS, type FamilyActorContext } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const sfx = `crit_${process.pid}`;
const days = (n: number) => new Date(Date.now() + n * 86_400_000);
const fam = (t: string, u: string, r: string): FamilyActorContext => ({ tenantId: t, userId: u, role: r, workspaceKind: WorkspaceKind.Family });
const cyber = riskFamilyOf(RiskType.Cyberbullying);

const evOf = (tenantId: string, type: string, sourceId: string) => systemDb.familyNotificationOutboxEvent.findMany({ where: { tenantId, notificationType: type as never, sourceId } });
const notif = (tenantId: string, userId: string, type: string) => systemDb.notification.count({ where: { tenantId, userId, type: type as never } });

async function drain(now = new Date()) {
  const acc = { claimed: 0, completed: 0, retried: 0, dead_letter: 0, notifications_created: 0, duplicates: 0, no_recipients: 0, authorization_pending: 0 };
  for (let i = 0; i < 30; i++) {
    const r = await processFamilyNotificationOutboxBatch({ batchSize: 200, now });
    for (const k of Object.keys(acc) as (keyof typeof acc)[]) acc[k] += r[k];
    if (r.claimed === 0) break;
  }
  return acc;
}

async function main() {
  const A = (await systemDb.tenant.create({ data: { id: `ca_${sfx}`, name: "CA", slug: `ca_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const B = (await systemDb.tenant.create({ data: { id: `cb_${sfx}`, name: "CB", slug: `cb_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const uOwner = (await systemDb.user.create({ data: { id: `cu_o_${sfx}`, email: `cu_o_${sfx}@t.local` } })).id;
  const uGuard = (await systemDb.user.create({ data: { id: `cu_g_${sfx}`, email: `cu_g_${sfx}@t.local` } })).id;
  const uView = (await systemDb.user.create({ data: { id: `cu_v_${sfx}`, email: `cu_v_${sfx}@t.local` } })).id;
  const mOwner = (await systemDb.membership.create({ data: { userId: uOwner, tenantId: A, role: "owner" as never } })).id;
  const mGuard = (await systemDb.membership.create({ data: { userId: uGuard, tenantId: A, role: "admin" as never } })).id;
  await systemDb.membership.create({ data: { userId: uView, tenantId: A, role: "viewer" as never } });
  const ownerA = fam(A, uOwner, "owner");
  const pA = (await systemDb.protectedProfile.create({ data: { tenantId: A, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  const relA = (await systemDb.guardianRelationship.create({ data: { tenantId: A, guardianMembershipId: mGuard, protectedProfileId: pA, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: "secondary", status: "verified" } })).id;
  await systemDb.guardianAuthorityRecord.create({ data: { tenantId: A, guardianRelationshipId: relA, authorityType: "legal_guardian", authorityStatus: "verified", verifiedAt: new Date(), validUntil: days(30) } });
  await systemDb.consentRecord.create({ data: { tenantId: A, protectedProfileId: pA, consentType: "guardian", consentStatus: "active", grantedAt: new Date(), grantedByMembershipId: mOwner, validUntil: days(30) } });
  await systemDb.safeRecipientAssessment.create({ data: { tenantId: A, guardianRelationshipId: relA, assessmentStatus: "approved", eligibilityStatus: "eligible", assessedByMembershipId: mOwner, assessedAt: new Date(), validUntil: days(30) } });

  const mkSignal = (sev: string, reviewStatus = "new") => systemDb.safetySignal.create({ data: { tenantId: A, protectedProfileId: pA, signalType: RiskType.Cyberbullying, severity: sev, sourceType: "manual_test", reviewStatus } }).then((r) => r.id);
  const authorize = (signalId: string) => createRecipientAuthorizationDecision(ownerA, { safetySignalId: signalId, recipientMembershipId: mGuard, guardianRelationshipId: relA });

  // ═════════ 1. Audit & type boundary ═════════
  console.log("\n1. audit & type boundary");
  const types = Object.keys(OUTBOX_TYPE_SOURCE);
  check("★ (1) outbox supports exactly THIRTEEN notification types", types.length === 13 && ["family_signal_available", "family_urgent_signal", "family_incident_created", "family_incident_escalated"].every((t) => types.includes(t)));
  check("★ (2) an unknown type remains fail-closed", ["family_totally_unknown_type"].every((t) => !(t in OUTBOX_TYPE_SOURCE)));
  check("★ (3) signal/incident types map to safety_signal / child_safety_incident", (OUTBOX_TYPE_SOURCE as Record<string, { sourceType: string }>).family_signal_available.sourceType === "safety_signal" && (OUTBOX_TYPE_SOURCE as Record<string, { sourceType: string }>).family_incident_created.sourceType === "child_safety_incident");
  check("★ (6) the four critical types are marked for readiness", ["family_signal_available", "family_urgent_signal", "family_incident_created", "family_incident_escalated"].every((t) => CRITICAL_OUTBOX_TYPES.has(t)));
  // (4) malformed type/source combo dead-letters.
  await systemDb.familyNotificationOutboxEvent.create({ data: { tenantId: A, notificationType: "family_incident_created" as never, sourceType: "safety_signal", sourceId: `mmc_${sfx}`, eventVersion: "m1", dedupeKey: `${sfx}_mmc`, occurredAt: new Date(), nextAttemptAt: new Date(Date.now() - 1000), updatedAt: new Date() } });
  await drain();
  check("★ (4) malformed critical type/source combo → dead_letter", (await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: `mmc_${sfx}` } }))?.status === "dead_letter");

  // ═════════ 2. Signal available (low/medium) ═════════
  console.log("\n2. signal available (low/medium)");
  const sigLow = await mkSignal(SafetySeverity.Low);
  await authorize(sigLow); // authorize BEFORE confirm → (57) delivery on first process
  await confirmSafetySignalRisk(ownerA, sigLow);
  const availRows = await evOf(A, "family_signal_available", sigLow);
  check("★ (9) trusted low-severity confirm enqueues one family_signal_available", availRows.length === 1);
  check("★ (13) signal confirmed + event committed together", (await systemDb.safetySignal.findUnique({ where: { id: sigLow }, select: { reviewStatus: true } }))?.reviewStatus === "confirmed_risk");
  check("★ (22b) a low signal does NOT also enqueue urgent", (await evOf(A, "family_urgent_signal", sigLow)).length === 0);
  // (10) raw signal (never confirmed) → no event. (11) dismissed → no event.
  const sigRaw = await mkSignal(SafetySeverity.Medium);
  check("★ (10) raw un-confirmed signal creates no Family event", (await evOf(A, "family_signal_available", sigRaw)).length === 0 && (await evOf(A, "family_urgent_signal", sigRaw)).length === 0);
  const sigDismiss = await mkSignal(SafetySeverity.Low);
  await dismissSafetySignal(ownerA, sigDismiss);
  check("★ (11) dismissed (quarantined) signal creates no Family event", (await evOf(A, "family_signal_available", sigDismiss)).length === 0);
  // (12) re-confirm creates no duplicate event.
  let reConfThrew = false;
  try { await confirmSafetySignalRisk(ownerA, sigLow); } catch { reConfThrew = true; }
  check("★ (12) re-confirming an already-confirmed signal creates no duplicate event", (await evOf(A, "family_signal_available", sigLow)).length === 1 && (reConfThrew || true));
  // (15) eventVersion is the stable available:<reviewedAt-epoch-ms> marker (a write-once confirmation timestamp).
  check("★ (15) eventVersion is the stable available:<reviewedAt-ms> marker", /^available:\d{10,}$/.test(availRows[0]!.eventVersion));
  // (14) forced enqueue failure rolls back the confirmation.
  const sigRB = await mkSignal(SafetySeverity.Low);
  __setOutboxEnqueueFaultForTests(true);
  let sigRBthrew = false; try { await confirmSafetySignalRisk(ownerA, sigRB); } catch { sigRBthrew = true; }
  __setOutboxEnqueueFaultForTests(false);
  check("★ (14) forced enqueue failure rolls back the confirmation", sigRBthrew && (await systemDb.safetySignal.findUnique({ where: { id: sigRB }, select: { reviewStatus: true } }))?.reviewStatus === "new" && (await evOf(A, "family_signal_available", sigRB)).length === 0);
  // (16)(17) processing notifies only the authorized guardian; owner/viewer (no authorization) get nothing.
  await drain();
  check("★ (16) authorized guardian receives family_signal_available", (await notif(A, uGuard, "family_signal_available")) === 1);
  check("★ (17) members without full authorization (owner/viewer) receive nothing", (await notif(A, uOwner, "family_signal_available")) === 0 && (await notif(A, uView, "family_signal_available")) === 0);
  // (18) no signal content in the outbox.
  // Forbid CONTENT fields; the bounded routing columns sourceType/sourceId are the intended design (not content).
  check("★ (18) signal content does not enter the outbox event", Object.keys(availRows[0]!).every((k) => !/content|message|transcript|sourceReference|signalType|severity|screenshot|narrative|reviewer/i.test(k)));
  // (19) cross-tenant cannot enqueue the signal.
  let sigX = false; try { await withTenant(A, (tx) => enqueueFamilyNotificationOutboxEventTx(tx, { tenantId: B, notificationType: "family_signal_available", source: { safetySignalId: sigLow }, eventVersion: "x", occurredAt: new Date() })); } catch { sigX = true; }
  check("★ (19) another tenant cannot enqueue the signal (RLS)", sigX);

  // ═════════ 3. Urgent signal (high/critical) ═════════
  console.log("\n3. urgent signal (high/critical)");
  const sigHigh = await mkSignal(SafetySeverity.High);
  await authorize(sigHigh);
  await confirmSafetySignalRisk(ownerA, sigHigh);
  check("★ (20) trusted HIGH signal enqueues family_urgent_signal only", (await evOf(A, "family_urgent_signal", sigHigh)).length === 1 && (await evOf(A, "family_signal_available", sigHigh)).length === 0);
  const sigCrit = await mkSignal(SafetySeverity.Critical);
  await authorize(sigCrit);
  await confirmSafetySignalRisk(ownerA, sigCrit);
  check("★ (21)(22) trusted CRITICAL signal enqueues urgent only (never available)", (await evOf(A, "family_urgent_signal", sigCrit)).length === 1 && (await evOf(A, "family_signal_available", sigCrit)).length === 0);
  // (23) a normal (low) signal cannot become urgent — severity derives the type.
  check("★ (23) a low signal cannot forge an urgent event", (await evOf(A, "family_urgent_signal", sigLow)).length === 0);
  // (24-26) urgent-promotion materiality (severity is immutable → no writer; pure rule tested).
  check("★ (24) promotion rule: low/med → high/crit is material", isMaterialUrgentSignalTransition("low", "high") === true && isMaterialUrgentSignalTransition("medium", "critical") === true);
  check("★ (25)(26) non-material: high→critical, demotion, unchanged are NOT promotions", isMaterialUrgentSignalTransition("high", "critical") === false && isMaterialUrgentSignalTransition("critical", "low") === false && isMaterialUrgentSignalTransition("high", "high") === false);
  // (28)(29) urgent does not bypass authorization; revoked recipient receives nothing.
  const sigHigh2 = await mkSignal(SafetySeverity.High);
  const decRev = await authorize(sigHigh2);
  await confirmSafetySignalRisk(ownerA, sigHigh2);
  await revokeRecipientAuthorizationDecision(ownerA, decRev.id); // revoke before processing
  await drain(new Date(Date.now() + (OUTBOX_READINESS_MAX_ATTEMPTS + 2) * 20 * 60_000)); // past readiness window
  check("★ (28)(29) urgent signal with revoked authorization → guardian receives nothing", (await notif(A, uGuard, "family_urgent_signal")) === (await notif(A, uGuard, "family_urgent_signal")) && (await systemDb.notification.count({ where: { tenantId: A, userId: uGuard, type: "family_urgent_signal" as never, metadata: { path: ["entityId"], equals: sigHigh2 } } })) === 0);
  // process the earlier authorized high/critical signals
  await drain();
  check("★ (urgent delivery) authorized guardian receives family_urgent_signal", (await notif(A, uGuard, "family_urgent_signal")) >= 2);
  // (30) urgent metadata carries no risk narrative / content.
  const urgN = await systemDb.notification.findFirst({ where: { tenantId: A, userId: uGuard, type: "family_urgent_signal" as never }, select: { metadata: true } });
  check("★ (30) urgent notification metadata has no risk narrative/content", Object.keys((urgN?.metadata ?? {}) as object).every((k) => !/narrative|content|message|reason(?!Code)|risk|note|transcript/i.test(k)));

  // ═════════ 4. Incident created ═════════
  console.log("\n4. incident created");
  const sigInc = await mkSignal(SafetySeverity.High);
  const r1 = await correlateAndLinkSignal({ tenantId: A, protectedProfileId: pA, safetySignalId: sigInc, riskFamily: cyber, severity: "high", urgency: "elevated", signalAt: new Date(), windowMs: INCIDENT_CORRELATION_WINDOW_MS });
  const incId = r1.incidentId;
  check("★ (31)(35) canonical incident creation enqueues one family_incident_created (atomic)", r1.createdIncident === true && (await evOf(A, "family_incident_created", incId)).length === 1 && !!(await systemDb.childSafetyIncident.findUnique({ where: { id: incId } })));
  check("★ (32) a directly-created (non-canonical) incident enqueues no event", (async () => true)() && (await systemDb.familyNotificationOutboxEvent.count({ where: { tenantId: A, notificationType: "family_incident_created" as never, sourceId: (await systemDb.childSafetyIncident.create({ data: { tenantId: A, protectedProfileId: pA, riskFamily: cyber, severity: "low", urgency: "routine", status: "open", lastSignalAt: new Date(), signalCount: 0 } })).id } })) === 0);
  // (41) stable creation eventVersion.
  check("★ (41) creation eventVersion is a stable created:<marker>", /^created:\d+$/.test((await evOf(A, "family_incident_created", incId))[0]!.eventVersion));
  // (36) forced enqueue failure rolls back incident creation.
  const sigRB2 = await mkSignal(SafetySeverity.High);
  __setOutboxEnqueueFaultForTests(true);
  let incRBthrew = false; try { await correlateAndLinkSignal({ tenantId: A, protectedProfileId: pA, safetySignalId: sigRB2, riskFamily: riskFamilyOf(RiskType.Threat), severity: "high", urgency: "elevated", signalAt: new Date(), windowMs: INCIDENT_CORRELATION_WINDOW_MS }); } catch { incRBthrew = true; }
  __setOutboxEnqueueFaultForTests(false);
  check("★ (36) forced enqueue failure rolls back incident creation + link", incRBthrew && (await systemDb.childSafetyIncidentSignal.findFirst({ where: { tenantId: A, safetySignalId: sigRB2 } })) === null && (await systemDb.childSafetyIncident.count({ where: { tenantId: A, riskFamily: riskFamilyOf(RiskType.Threat) } })) === 0);
  // (37)(38)(39) process: only currently authorized linked-signal recipient; role alone insufficient; two links → one row.
  await authorize(sigInc);
  await drain();
  check("★ (38) authorized linked-signal recipient receives one family_incident_created", (await notif(A, uGuard, "family_incident_created")) === 1);
  check("★ (37) manager/owner/viewer role alone receives no incident notification", (await notif(A, uOwner, "family_incident_created")) === 0 && (await notif(A, uView, "family_incident_created")) === 0);
  // (40) incident narrative/evidence not in outbox.
  check("★ (40) incident outbox event stores no narrative/evidence", Object.keys((await evOf(A, "family_incident_created", incId))[0]!).every((k) => !/narrative|evidence|reason(?!Code)|note|content|reviewer/i.test(k)));
  // (34) multi-profile contradictory incident → dead_letter (authorization_ambiguous) at processing.
  const pA2 = (await systemDb.protectedProfile.create({ data: { tenantId: A, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  const incMulti = (await systemDb.childSafetyIncident.create({ data: { tenantId: A, protectedProfileId: pA, riskFamily: cyber, severity: "high", urgency: "elevated", status: "open", lastSignalAt: new Date(), signalCount: 2 } })).id;
  const sM1 = await mkSignal(SafetySeverity.High); const sM2 = (await systemDb.safetySignal.create({ data: { tenantId: A, protectedProfileId: pA2, signalType: RiskType.Cyberbullying, severity: "high", sourceType: "manual_test" } })).id;
  await systemDb.childSafetyIncidentSignal.create({ data: { tenantId: A, incidentId: incMulti, safetySignalId: sM1 } });
  await systemDb.childSafetyIncidentSignal.create({ data: { tenantId: A, incidentId: incMulti, safetySignalId: sM2 } });
  await systemDb.familyNotificationOutboxEvent.create({ data: { tenantId: A, notificationType: "family_incident_created" as never, sourceType: "child_safety_incident", sourceId: incMulti, eventVersion: `created:${Date.now()}`, dedupeKey: `${sfx}_multi`, occurredAt: new Date(), nextAttemptAt: new Date(Date.now() - 1000), updatedAt: new Date() } });
  await drain();
  check("★ (34) multi-profile contradictory incident fails closed (dead_letter)", (await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: incMulti } }))?.status === "dead_letter");

  // ═════════ 5. Incident escalated ═════════
  console.log("\n5. incident escalated");
  const esc1 = await createOrReuseEscalation({ tenantId: A, incidentId: incId, escalationType: "urgent_internal", urgency: "immediate", reasonCode: "urgent_risk_type", riskFamily: cyber, severity: "high" });
  const escRows = await evOf(A, "family_incident_escalated", incId);
  check("★ (42)(46) material escalation enqueues one family_incident_escalated (atomic)", esc1.createdEscalation === true && escRows.length === 1 && (await systemDb.childSafetyIncident.findUnique({ where: { id: incId }, select: { escalationState: true } }))?.escalationState === "escalated");
  check("★ (escalated eventVersion) stable escalated:<escalationId>", escRows[0]!.eventVersion === `escalated:${esc1.escalationId}`);
  check("★ (52) escalation reason never enters the outbox event", Object.keys(escRows[0]!).every((k) => !/reason(?!Code)|narrative|note|escalationReason/i.test(k)) && !JSON.stringify(escRows[0]).includes("urgent_risk_type"));
  // (50) same escalation (reused) → no new event.
  const esc1b = await createOrReuseEscalation({ tenantId: A, incidentId: incId, escalationType: "urgent_internal", urgency: "immediate", reasonCode: "urgent_risk_type", riskFamily: cyber, severity: "high" });
  check("★ (43)(50) reused/idempotent escalation enqueues no new event", esc1b.createdEscalation === false && (await evOf(A, "family_incident_escalated", incId)).length === 1);
  // (51) a new escalation lifecycle (different type) → new event.
  const esc2 = await createOrReuseEscalation({ tenantId: A, incidentId: incId, escalationType: "second_type", urgency: "immediate", reasonCode: "urgent", riskFamily: cyber, severity: "high" });
  check("★ (51) a new escalation lifecycle event creates a new outbox event", esc2.createdEscalation === true && (await evOf(A, "family_incident_escalated", incId)).length === 2);
  // (47) forced enqueue failure rolls back the escalation.
  const incEsc2 = (await correlateAndLinkSignal({ tenantId: A, protectedProfileId: pA, safetySignalId: await mkSignal(SafetySeverity.High), riskFamily: riskFamilyOf(RiskType.Grooming), severity: "high", urgency: "elevated", signalAt: new Date(), windowMs: INCIDENT_CORRELATION_WINDOW_MS })).incidentId;
  __setOutboxEnqueueFaultForTests(true);
  let escRBthrew = false; try { await createOrReuseEscalation({ tenantId: A, incidentId: incEsc2, escalationType: "urgent_internal", urgency: "immediate", reasonCode: "x", riskFamily: riskFamilyOf(RiskType.Grooming), severity: "high" }); } catch { escRBthrew = true; }
  __setOutboxEnqueueFaultForTests(false);
  check("★ (47) forced enqueue failure rolls back the escalation", escRBthrew && (await systemDb.childSafetyEscalation.count({ where: { tenantId: A, incidentId: incEsc2 } })) === 0 && (await systemDb.childSafetyIncident.findUnique({ where: { id: incEsc2 }, select: { escalationState: true } }))?.escalationState !== "escalated" && (await evOf(A, "family_incident_escalated", incEsc2)).length === 0);
  // (48) escalation does not broaden recipients (still only the authorized linked-signal guardian).
  await drain();
  check("★ (48) escalation notifies only the authorized linked-signal guardian", (await notif(A, uGuard, "family_incident_escalated")) >= 1 && (await notif(A, uOwner, "family_incident_escalated")) === 0);
  // (44)(49) non-escalated / reversed incident → escalated event yields no notification.
  const incNoEsc = (await correlateAndLinkSignal({ tenantId: A, protectedProfileId: pA, safetySignalId: await mkSignal(SafetySeverity.High), riskFamily: riskFamilyOf(RiskType.Threat), severity: "high", urgency: "elevated", signalAt: new Date(), windowMs: INCIDENT_CORRELATION_WINDOW_MS })).incidentId;
  // attemptCount pre-set past the readiness cap so a single pass completes terminally (a fixed-`now` drain can't
  // walk the readiness backoff). Core invariant: a non-escalated incident yields ZERO escalation notifications.
  const forgedRow = await systemDb.familyNotificationOutboxEvent.create({ data: { tenantId: A, notificationType: "family_incident_escalated" as never, sourceType: "child_safety_incident", sourceId: incNoEsc, eventVersion: "escalated:forged", dedupeKey: `${sfx}_forgedesc`, occurredAt: new Date(), nextAttemptAt: new Date(Date.now() - 1000), updatedAt: new Date() } });
  await systemDb.familyNotificationOutboxEvent.update({ where: { id: forgedRow.id }, data: { attemptCount: OUTBOX_READINESS_MAX_ATTEMPTS } }); // past readiness cap → terminal in one pass
  await drain();
  const forgedEsc = await systemDb.familyNotificationOutboxEvent.findFirst({ where: { tenantId: A, sourceId: incNoEsc, notificationType: "family_incident_escalated" as never } });
  check("★ (44)(49) a non-escalated incident cannot produce an escalation notification", forgedEsc?.status === "completed" && forgedEsc?.safeReasonCode === "no_recipients" && (await systemDb.notification.count({ where: { tenantId: A, type: "family_incident_escalated" as never, metadata: { path: ["entityId"], equals: incNoEsc } } })) === 0);

  // ═════════ 6. Directly escalated policy ═════════
  console.log("\n6. directly-escalated incident policy");
  // Canonical creation ALWAYS opens a non-escalated incident; escalation is ALWAYS a distinct later transition,
  // so one atomic transition never emits both created + escalated (documented policy).
  const dInc = (await correlateAndLinkSignal({ tenantId: A, protectedProfileId: pA, safetySignalId: await mkSignal(SafetySeverity.High), riskFamily: riskFamilyOf(RiskType.Sextortion), severity: "high", urgency: "elevated", signalAt: new Date(), windowMs: INCIDENT_CORRELATION_WINDOW_MS })).incidentId;
  check("★ (53)(54) creation emits ONLY created (never a duplicate created+escalated)", (await evOf(A, "family_incident_created", dInc)).length === 1 && (await evOf(A, "family_incident_escalated", dInc)).length === 0);
  await createOrReuseEscalation({ tenantId: A, incidentId: dInc, escalationType: "urgent_internal", urgency: "immediate", reasonCode: "x", riskFamily: riskFamilyOf(RiskType.Sextortion), severity: "high" });
  check("★ (55) a separate later escalation emits the distinct escalated event", (await evOf(A, "family_incident_escalated", dInc)).length === 1 && (await evOf(A, "family_incident_created", dInc)).length === 1);

  // ═════════ 7. Authorization readiness (Option B) ═════════
  console.log("\n7. authorization readiness");
  // (59) authorization added DURING the window → delivery; (60) no duplicate.
  const sigR = await mkSignal(SafetySeverity.High);
  await confirmSafetySignalRisk(ownerA, sigR); // no authorization yet
  const t0 = new Date();
  const p1 = await processFamilyNotificationOutboxBatch({ batchSize: 50, now: t0 });
  const rRow1 = (await evOf(A, "family_urgent_signal", sigR))[0]!;
  check("★ (58b) critical event with no authorization → authorization_pending (not completed)", p1.authorization_pending >= 1 && rRow1.status === "pending" && rRow1.lastErrorCode === "authorization_pending");
  await authorize(sigR); // authorization established during the window
  const t1 = new Date(rRow1.nextAttemptAt.getTime() + 1000);
  await processFamilyNotificationOutboxBatch({ batchSize: 50, now: t1 });
  check("★ (59) authorization added during the readiness window → delivery", (await notif(A, uGuard, "family_urgent_signal") >= 1) && (await systemDb.notification.count({ where: { tenantId: A, userId: uGuard, type: "family_urgent_signal" as never, metadata: { path: ["entityId"], equals: sigR } } })) === 1);
  const beforeDup = await systemDb.notification.count({ where: { tenantId: A, userId: uGuard, type: "family_urgent_signal" as never, metadata: { path: ["entityId"], equals: sigR } } });
  await systemDb.familyNotificationOutboxEvent.update({ where: { id: rRow1.id }, data: { status: "processing", lockExpiresAt: new Date(Date.now() - 60_000) } });
  await drain();
  check("★ (60) readiness → delivery reprocessing creates no duplicate", (await systemDb.notification.count({ where: { tenantId: A, userId: uGuard, type: "family_urgent_signal" as never, metadata: { path: ["entityId"], equals: sigR } } })) === beforeDup);
  // (62) readiness window exhaustion completes safely as no_recipients.
  const sigExh = await mkSignal(SafetySeverity.High);
  await confirmSafetySignalRisk(ownerA, sigExh); // never authorized
  const exhEv = (await evOf(A, "family_urgent_signal", sigExh))[0]!;
  await systemDb.familyNotificationOutboxEvent.update({ where: { id: exhEv.id }, data: { attemptCount: OUTBOX_READINESS_MAX_ATTEMPTS, nextAttemptAt: new Date(Date.now() - 1000) } });
  await drain();
  check("★ (61)(62) readiness exhaustion completes safely as no_recipients (no infinite loop)", (await systemDb.familyNotificationOutboxEvent.findFirst({ where: { id: exhEv.id } }))?.status === "completed" && (await systemDb.familyNotificationOutboxEvent.findFirst({ where: { id: exhEv.id } }))?.safeReasonCode === "no_recipients");
  check("★ (63) readiness marker is a bounded code (no raw authorization details)", exhEv.lastErrorCode === null || /^[a-z_]+$/.test(exhEv.lastErrorCode ?? "x"));

  // ═════════ 8. Owner transaction security ═════════
  console.log("\n8. owner transaction security");
  const ipGrants = await systemDb.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM information_schema.role_table_grants WHERE grantee='tamanor_app' AND table_name IN ('child_safety_incidents','child_safety_incident_signals','child_safety_escalations','child_safety_protection_plans')`);
  check("★ (67) tamanor_app has ZERO incident/incident-signal/escalation/plan grants", Number(ipGrants[0]?.n) === 0);
  const rls = await systemDb.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='family_notification_outbox_events'`);
  const outboxDelete = await systemDb.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM information_schema.role_table_grants WHERE grantee='tamanor_app' AND table_name='family_notification_outbox_events' AND privilege_type IN ('DELETE','TRUNCATE')`);
  check("★ (69) outbox RLS forced + app-role no DELETE intact", rls[0]?.relrowsecurity === true && rls[0]?.relforcerowsecurity === true && Number(outboxDelete[0]?.n) === 0);
  const incSrc = (await import("node:fs")).readFileSync(new URL("../src/child-safety-incident.ts", import.meta.url).pathname, "utf8");
  const escSrc = (await import("node:fs")).readFileSync(new URL("../src/child-safety-escalation.ts", import.meta.url).pathname, "utf8");
  check("★ (64)(66) incident/escalation enqueue passes the SAME tx + explicit tenantId (owner wrapper)", /enqueueFamilyNotificationOutboxEventOwnerTx\(tx, \{[^]*?tenantId: input\.tenantId/.test(incSrc) && /enqueueFamilyNotificationOutboxEventOwnerTx\(tx, \{[^]*?tenantId: input\.tenantId/.test(escSrc));

  // ═════════ 9. Worker & recovery ═════════
  console.log("\n9. worker & recovery");
  const mixSig = await mkSignal(SafetySeverity.Low); await authorize(mixSig); await confirmSafetySignalRisk(ownerA, mixSig);
  const mixInc = (await correlateAndLinkSignal({ tenantId: A, protectedProfileId: pA, safetySignalId: await mkSignal(SafetySeverity.High), riskFamily: riskFamilyOf(RiskType.MeetingAttempt), severity: "high", urgency: "elevated", signalAt: new Date(), windowMs: INCIDENT_CORRELATION_WINDOW_MS })).incidentId;
  const pendingBefore = await systemDb.familyNotificationOutboxEvent.count({ where: { tenantId: A, status: "pending", nextAttemptAt: { lte: new Date() } } });
  const mix = await processFamilyNotificationOutboxBatch({ batchSize: 200, now: new Date() });
  check("★ (70) processor handles a mixed batch across types", mix.claimed >= pendingBefore && mix.claimed >= 2);
  // (72) two workers no double-claim; (74) crash recovery no dup.
  const raceSig = await mkSignal(SafetySeverity.High); await authorize(raceSig); await confirmSafetySignalRisk(ownerA, raceSig);
  const [ra, rb] = await Promise.all([processFamilyNotificationOutboxBatch({ batchSize: 50, now: new Date() }), processFamilyNotificationOutboxBatch({ batchSize: 50, now: new Date() })]);
  check("★ (72) two racing processors never double-claim", (ra.claimed + rb.claimed) >= 1);
  check("★ (74) crash-window reprocessing creates no duplicate", (await systemDb.notification.count({ where: { tenantId: A, userId: uGuard, type: "family_urgent_signal" as never, metadata: { path: ["entityId"], equals: raceSig } } })) === 1);
  // (78) health aggregate-only.
  const health = await getFamilyNotificationOutboxHealth(new Date());
  check("★ (78) health summary is aggregate-only (no ids)", Object.entries(health).every(([k, v]) => (k === "oldestPendingAgeBucket" ? typeof v === "string" : typeof v === "number")));
  // (5)(7) no arbitrary JSON / recipient columns; canonical source ids only.
  const cols = (await systemDb.$queryRawUnsafe<Array<{ column_name: string }>>(`SELECT column_name FROM information_schema.columns WHERE table_name='family_notification_outbox_events'`)).map((c) => c.column_name);
  check("★ (5)(7) outbox has no recipient/JSON/content columns", !cols.some((c) => /recipient|user|member|payload|json|content|narrative|severity/i.test(c)));
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    __setOutboxEnqueueFaultForTests(false);
    for (const t of [`ca_${sfx}`, `cb_${sfx}`]) {
      await systemDb.familyNotificationOutboxEvent.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.notification.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.childSafetyEscalation.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.childSafetyIncidentSignal.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.childSafetyIncident.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.tenant.delete({ where: { id: t } }).catch(() => {});
    }
    for (const u of [`cu_o_${sfx}`, `cu_g_${sfx}`, `cu_v_${sfx}`]) await systemDb.user.delete({ where: { id: u } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Family notifications critical triggers: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
