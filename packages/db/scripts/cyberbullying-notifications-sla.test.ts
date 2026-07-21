/**
 * C10 — Notifications, SLA & Escalation (local DB, deterministic clock). Covers the
 * notification foundation + recipient resolver, pure SLA calculation, the SLA
 * evaluator (idempotent transitions), manual escalation, permission + scope, trigger
 * integration, and privacy/audit. Run: pnpm cyberbullying-notifications-sla:test
 */
import {
  systemDb, withTenant,
  createIncidentFromManualReport, assignReviewer, reopenIncident, transitionIncident,
  addIncidentParticipant,
  updateProtectionPlan, createCaseTask,
  resolveIncidentRecipientsTx, createNotificationTx, listNotifications, countUnreadNotifications,
  markNotificationRead, dismissNotification, NotificationError,
  createManualEscalation, resolveEscalation, cancelEscalation, getIncidentEscalationView, EscalationError,
  evaluateCyberbullyingSla, getCyberbullyingSlaOverview, getIncidentSlaView,
} from "../src/index";
import {
  RecipientPurpose, NotificationType, NotificationEntityType, IncidentParticipantRole,
  CaseRiskLevel, IncidentLifecycleStatus as ST,
  EscalationSeverity, EscalationReason, EscalationStatus,
  SlaState, firstReviewSlaState, criticalRiskSlaState, taskSlaState, followUpSlaState,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function reject(l: string, fn: () => Promise<unknown>, code: string) {
  try { await fn(); check(l, false, "did not throw"); }
  catch (e) { const c = (e as { code?: string }).code; check(l, code ? c === code : true, `code=${c}`); }
}

const sfx = `cbns_${process.pid}`;
const tA = `tenA_${sfx}`, tB = `tenB_${sfx}`;
const owner = { tenantId: tA, userId: "u_owner", role: "owner" };
const admin = { tenantId: tA, userId: "u_admin", role: "admin" };
const reviewer = { tenantId: tA, userId: "u_rev", role: "reviewer" };
const reviewer2 = { tenantId: tA, userId: "u_rev2", role: "reviewer" };
const viewer = { tenantId: tA, userId: "u_view", role: "viewer" };
const ownerB = { tenantId: tB, userId: "u_ownerB", role: "owner" };
let u = 0;
const H = 3_600_000;
const at = (base: Date, hours: number) => new Date(base.getTime() + hours * H);
const NOW0 = new Date("2026-07-21T12:00:00.000Z");

async function mkMember(a: { tenantId: string; userId: string; role: string }) {
  await systemDb.user.upsert({ where: { id: a.userId }, update: {}, create: { id: a.userId, email: `${a.userId}-${sfx}@t.local` } });
  await systemDb.membership.upsert({ where: { userId_tenantId: { userId: a.userId, tenantId: a.tenantId } }, update: { role: a.role as never }, create: { userId: a.userId, tenantId: a.tenantId, role: a.role as never } });
}
async function mkIncident(actor = owner): Promise<string> {
  const subj = await withTenant(tA, (db) => db.protectedSubject.create({ data: { tenantId: tA, publicIdentifier: `s-${sfx}-${u++}`, displayLabel: "Alex", subjectType: "individual" } }));
  return (await createIncidentFromManualReport(actor, { protectedSubjectId: subj.id, summary: `case ${sfx} ${u++}` })).incidentId;
}
const notifsFor = (userId: string, type?: string) => withTenant(tA, (db) => db.notification.findMany({ where: { tenantId: tA, recipientUserId: userId, ...(type ? { type } : {}) } }));

async function main() {
  for (const id of [tA, tB]) await systemDb.tenant.upsert({ where: { id }, update: {}, create: { id, name: id, slug: id, plan: "growth" } });
  for (const a of [owner, admin, reviewer, reviewer2, viewer]) await mkMember(a);
  await mkMember(ownerB);

  // === B. Recipient resolver ==============================================
  const inc = await mkIncident(); // owner = reporter participant
  await assignReviewer(owner, inc, reviewer.userId); // reviewer = assignee (in scope)
  await addIncidentParticipant(owner, inc, { role: IncidentParticipantRole.Reviewer, userId: reviewer2.userId });
  await addIncidentParticipant(owner, inc, { role: IncidentParticipantRole.TrustedContact, userId: viewer.userId });

  await withTenant(tA, async (db) => {
    const assign = await resolveIncidentRecipientsTx(db, tA, inc, RecipientPurpose.Assignment, { targetUserId: reviewer.userId, excludeUserId: owner.userId });
    check("resolver: assignment → the assignee", assign.length === 1 && assign[0] === reviewer.userId);
    const crit = await resolveIncidentRecipientsTx(db, tA, inc, RecipientPurpose.CriticalRisk, { excludeUserId: null });
    check("resolver: critical risk → reviewers + managers, viewer excluded", crit.includes(reviewer.userId) && crit.includes(reviewer2.userId) && crit.includes(owner.userId) && crit.includes(admin.userId) && !crit.includes(viewer.userId));
    const overdue = await resolveIncidentRecipientsTx(db, tA, inc, RecipientPurpose.TaskOverdue, { targetUserId: reviewer.userId });
    check("resolver: overdue task → assignee + managers", overdue.includes(reviewer.userId) && overdue.includes(owner.userId));
    // A user with review perm but NOT in scope is excluded.
    const outIncident = await mkIncident(); // owner-only participant
    const out = await resolveIncidentRecipientsTx(db, tA, outIncident, RecipientPurpose.CriticalRisk, {});
    check("resolver: out-of-scope reviewer excluded", !out.includes(reviewer.userId) && !out.includes(reviewer2.userId));
  });

  // === A. Notification service ============================================
  await withTenant(tA, async (db) => {
    const created1 = await createNotificationTx(db, tA, owner.userId, reviewer.userId, { type: NotificationType.CriticalRiskSet, entityType: NotificationEntityType.Incident, entityId: inc, incidentId: inc, discriminator: "d1" });
    const created2 = await createNotificationTx(db, tA, owner.userId, reviewer.userId, { type: NotificationType.CriticalRiskSet, entityType: NotificationEntityType.Incident, entityId: inc, incidentId: inc, discriminator: "d1" });
    check("notification: dedup — same key created once", created1 === true && created2 === false);
    const created3 = await createNotificationTx(db, tA, owner.userId, reviewer.userId, { type: NotificationType.CriticalRiskSet, entityType: NotificationEntityType.Incident, entityId: inc, incidentId: inc, discriminator: "d2" });
    check("notification: a NEW relevant state (new key) creates a new notification", created3 === true);
  });
  const revNotifs = await notifsFor(reviewer.userId);
  const oneId = revNotifs[0]!.id;
  check("notification: unread count reflects delivered", (await countUnreadNotifications(reviewer)) >= 1);
  await markNotificationRead(reviewer, oneId);
  check("notification: mark read clears unread for that row", (await withTenant(tA, (db) => db.notification.findFirst({ where: { id: oneId }, select: { readAt: true } })))?.readAt != null);
  await reject("notification: cross-user mark read fails closed", () => markNotificationRead(reviewer2, oneId), "not_found");
  await reject("notification: cross-tenant mark read fails closed", () => markNotificationRead(ownerB, oneId), "not_found");
  await dismissNotification(reviewer, oneId);
  const dismissed = await withTenant(tA, (db) => db.notification.findFirst({ where: { id: oneId }, select: { dismissedAt: true } }));
  check("notification: dismiss keeps the row (auditable), sets dismissedAt", dismissed?.dismissedAt != null);
  check("notification: list VM has no dedup key / raw metadata leak", !(JSON.stringify(await listNotifications(reviewer)).includes("deduplicationKey")));

  // === C. SLA calculation (pure, deterministic) ===========================
  const created = new Date("2026-07-21T00:00:00.000Z");
  check("sla: first review ON_TRACK (<12h)", firstReviewSlaState(created, null, at(created, 6)) === SlaState.OnTrack);
  check("sla: first review DUE_SOON (>=12h)", firstReviewSlaState(created, null, at(created, 13)) === SlaState.DueSoon);
  check("sla: first review OVERDUE (>=24h)", firstReviewSlaState(created, null, at(created, 25)) === SlaState.Overdue);
  check("sla: first review SATISFIED after review", firstReviewSlaState(created, at(created, 30), at(created, 40)) === SlaState.Satisfied);
  check("sla: critical DUE_SOON (>=1h) / OVERDUE (>=2h)", criticalRiskSlaState(created, null, at(created, 1.5)) === SlaState.DueSoon && criticalRiskSlaState(created, null, at(created, 3)) === SlaState.Overdue);
  check("sla: task OVERDUE past due / SATISFIED when closed", taskSlaState(at(created, -1), false, created) === SlaState.Overdue && taskSlaState(at(created, -1), true, created) === SlaState.Satisfied);
  check("sla: follow-up DUE_SOON within 24h", followUpSlaState(at(created, 10), created) === SlaState.DueSoon);

  // === D. SLA evaluator (idempotent transitions, bounded) =================
  const slaInc = await mkIncident();
  await assignReviewer(owner, slaInc, reviewer.userId); // reviewer assignee (recipient)
  // Task due in 10h ⇒ DUE_SOON at NOW0; OVERDUE later.
  await createCaseTask(owner, slaInc, { title: "follow the report", assigneeUserId: reviewer.userId, dueDate: at(NOW0, 10).toISOString() });
  const before = (await notifsFor(reviewer.userId, NotificationType.TaskDueSoon)).length;
  const e1 = await evaluateCyberbullyingSla(tA, { now: NOW0 });
  const afterDueSoon = (await notifsFor(reviewer.userId, NotificationType.TaskDueSoon)).length;
  check("evaluator: DUE_SOON transition creates a notification", afterDueSoon === before + 1 && e1.notified >= 1);
  const e2 = await evaluateCyberbullyingSla(tA, { now: at(NOW0, 1) });
  check("evaluator: repeated run in same state creates NO duplicate", (await notifsFor(reviewer.userId, NotificationType.TaskDueSoon)).length === afterDueSoon);
  const beforeOver = (await notifsFor(reviewer.userId, NotificationType.TaskOverdue)).length;
  await evaluateCyberbullyingSla(tA, { now: at(NOW0, 11) }); // now past due
  check("evaluator: DUE_SOON → OVERDUE is a distinct notification", (await notifsFor(reviewer.userId, NotificationType.TaskOverdue)).length === beforeOver + 1);
  check("evaluator: no lifecycle mutation (incident still open)", (await withTenant(tA, (db) => db.incident.findFirst({ where: { id: slaInc }, select: { status: true } })))?.status === ST.Open);
  void e2;

  // === E. Escalation ======================================================
  const escInc = await mkIncident();
  await assignReviewer(owner, escInc, reviewer.userId);
  const SECRET_NOTE = `ESC-SECRET-${sfx}`;
  await reject("escalation: OTHER without note rejected", () => createManualEscalation(reviewer, escInc, { severity: EscalationSeverity.Urgent, reasonCode: EscalationReason.Other }), "missing_note");
  await reject("escalation: invalid target (out of scope) rejected", () => createManualEscalation(owner, escInc, { severity: EscalationSeverity.Urgent, reasonCode: EscalationReason.SafetyConcern, targetUserId: viewer.userId }), "invalid_recipient");
  const { escalationId } = await createManualEscalation(reviewer, escInc, { severity: EscalationSeverity.Urgent, reasonCode: EscalationReason.Other, note: SECRET_NOTE });
  check("escalation: created active", (await getIncidentEscalationView(reviewer, escInc))?.status === EscalationStatus.Active);
  check("escalation: view omits the confidential note", !JSON.stringify(await getIncidentEscalationView(reviewer, escInc)).includes(SECRET_NOTE));
  await reject("escalation: duplicate active rejected", () => createManualEscalation(owner, escInc, { severity: EscalationSeverity.Attention, reasonCode: EscalationReason.SlaBreach }), "duplicate");
  await reject("escalation: reviewer (not target, not manage) cannot cancel", () => cancelEscalation(reviewer, escalationId), "forbidden");
  await resolveEscalation(owner, escalationId, "handled");
  check("escalation: resolved", (await withTenant(tA, (db) => db.cyberbullyingEscalation.findFirst({ where: { id: escalationId }, select: { status: true } })))?.status === EscalationStatus.Resolved);
  await reject("escalation: resolve again (terminal) rejected", () => resolveEscalation(owner, escalationId), "invalid_transition");
  check("escalation: does NOT change incident status / risk", await (async () => { const i = await withTenant(tA, (db) => db.incident.findFirst({ where: { id: escInc }, select: { status: true, caseProtectionPlan: { select: { riskLevel: true } } } })); return i?.status === ST.Open && i?.caseProtectionPlan == null; })());

  // === G. Triggers =========================================================
  const trigInc = await mkIncident();
  const beforeAssign = (await notifsFor(reviewer2.userId, NotificationType.IncidentAssigned)).length;
  await addIncidentParticipant(owner, trigInc, { role: IncidentParticipantRole.Reviewer, userId: reviewer2.userId });
  await assignReviewer(owner, trigInc, reviewer2.userId);
  check("trigger: assignment creates a notification for the assignee", (await notifsFor(reviewer2.userId, NotificationType.IncidentAssigned)).length === beforeAssign + 1);
  const beforeCrit = (await notifsFor(reviewer2.userId, NotificationType.CriticalRiskSet)).length;
  await updateProtectionPlan(owner, trigInc, { riskLevel: CaseRiskLevel.Critical });
  check("trigger: critical risk creates an URGENT notification", (await notifsFor(reviewer2.userId, NotificationType.CriticalRiskSet)).length === beforeCrit + 1);
  check("trigger: critical set records criticalRiskSetAt", (await withTenant(tA, (db) => db.cyberbullyingProtectionPlan.findFirst({ where: { incidentId: trigInc }, select: { criticalRiskSetAt: true } })))?.criticalRiskSetAt != null);
  const beforeTask = (await notifsFor(reviewer2.userId, NotificationType.CaseTaskAssigned)).length;
  await createCaseTask(owner, trigInc, { title: "assigned task", assigneeUserId: reviewer2.userId });
  check("trigger: task assignment creates a notification", (await notifsFor(reviewer2.userId, NotificationType.CaseTaskAssigned)).length === beforeTask + 1);
  // Reopen: move to resolved then reopen.
  await transitionIncident(owner, trigInc, ST.UnderReview); await transitionIncident(owner, trigInc, ST.Acknowledged); await transitionIncident(owner, trigInc, ST.Resolved, "done");
  const beforeReopen = (await notifsFor(reviewer2.userId, NotificationType.IncidentReopened)).length;
  await reopenIncident(owner, trigInc, "new info");
  check("trigger: reopen creates a notification for participants/assignee", (await notifsFor(reviewer2.userId, NotificationType.IncidentReopened)).length === beforeReopen + 1);
  // Rollback: a failing domain op leaves no orphan notification.
  const beforeOrphan = (await withTenant(tA, (db) => db.notification.count({ where: { tenantId: tA } })));
  await reject("trigger: no-change assign rolls back (no orphan)", () => assignReviewer(owner, trigInc, reviewer2.userId), "ASSIGNMENT_REJECTED");
  check("trigger: failed op created NO notification", (await withTenant(tA, (db) => db.notification.count({ where: { tenantId: tA } }))) === beforeOrphan);

  // === F. Permission + scope ==============================================
  await reject("perm: viewer cannot escalate (no review)", () => createManualEscalation(viewer, escInc, { severity: EscalationSeverity.Attention, reasonCode: EscalationReason.SafetyConcern }), "forbidden");
  const outOfScopeInc = await mkIncident();
  await reject("scope: reviewer out of scope cannot escalate", () => createManualEscalation(reviewer, outOfScopeInc, { severity: EscalationSeverity.Attention, reasonCode: EscalationReason.SafetyConcern }), "forbidden");
  await reject("sla: viewer denied the overview", () => getCyberbullyingSlaOverview(viewer), "");
  const overview = await getCyberbullyingSlaOverview(owner, at(NOW0, 30));
  check("sla overview: aggregates return numbers", typeof overview.taskOverdue === "number" && typeof overview.activeEscalations === "number");
  check("sla incident view: derived states, no raw entity", await (async () => { const v = await getIncidentSlaView(owner, slaInc, at(NOW0, 30)); return !!v && typeof v.firstReview === "string" && !("id" in (v as object)); })());

  // === H. Privacy / audit =================================================
  const allAudit = await withTenant(tA, (db) => db.auditLog.findMany({ where: { tenantId: tA, event: { startsWith: "cyberbullying." } } }));
  const allNotif = await withTenant(tA, (db) => db.notification.findMany({ where: { tenantId: tA } }));
  const allTimeline = await withTenant(tA, (db) => db.incidentTimelineEvent.findMany({ where: { tenantId: tA } }));
  const dump = JSON.stringify(allAudit) + JSON.stringify(allNotif) + JSON.stringify(allTimeline);
  check("privacy: escalation note NEVER in audit/notification/timeline", !dump.includes(SECRET_NOTE));
  check("privacy: notification metadata carries no incident summary text", !dump.includes(`case ${sfx}`));
  check("audit: escalation + sla + notification events recorded", allAudit.some((r) => r.event === "cyberbullying.escalation.created") && allAudit.some((r) => r.event === "cyberbullying.sla.state_transition") && allAudit.some((r) => r.event === "cyberbullying.notification.created"));

  // === Cross-tenant isolation =============================================
  check("cross-tenant: tenant B has no notifications/escalations", (await withTenant(tB, (db) => db.notification.count())) === 0 && (await withTenant(tB, (db) => db.cyberbullyingEscalation.count())) === 0);

  await systemDb.tenant.deleteMany({ where: { id: { in: [tA, tB] } } });
  await systemDb.user.deleteMany({ where: { id: { in: [owner.userId, admin.userId, reviewer.userId, reviewer2.userId, viewer.userId, ownerB.userId] } } });

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — cyberbullying notifications/sla/escalation: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
