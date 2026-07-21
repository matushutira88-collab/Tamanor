/**
 * C5 — Cyberbullying Incident OPERATIONS (local DB). Exercises the review workflow
 * end-to-end against the real service: lifecycle transitions (legal/illegal/reason/
 * terminal/no-change), permission gating (review vs manage vs none), assignment
 * (claim/reassign/unassign + append-only history + visibility), confidential
 * append-only reviewer notes, timeline + audit side effects, and subject protection.
 * Run: pnpm cyberbullying-operations:test
 */
import {
  systemDb, withTenant,
  createIncidentFromManualReport,
  transitionIncident, reopenIncident,
  assignReviewer, unassignReviewer,
  addReviewerNote, listReviewerNotes, listAssignmentHistory,
} from "../src/index";
import {
  IncidentLifecycleStatus as ST, IncidentCategory, IncidentAssignmentAction, IncidentTimelineEventType,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function expectReject(l: string, fn: () => Promise<unknown>, code?: string) {
  try { await fn(); check(l, false, "did not throw"); }
  catch (e) { const ec = (e as { code?: string }).code; check(l, code ? ec === code : true, `code=${ec}`); }
}

const sfx = `cbops_${process.pid}`;
const tA = `tenA_${sfx}`, tB = `tenB_${sfx}`;
const owner = { tenantId: tA, userId: "u_owner", role: "owner" };
const reviewer = { tenantId: tA, userId: "u_reviewer", role: "reviewer" };
const reviewer2 = { tenantId: tA, userId: "u_reviewer2", role: "reviewer" };
const viewer = { tenantId: tA, userId: "u_viewer", role: "viewer" };
const DOMAIN = IncidentCategory.Cyberbullying;
const NOTE_BODY = `CONFIDENTIAL-secret-${sfx}`;

// Mirror of the C5 read-model participant-or-assignee scope (visibility check).
const participantScope = (userId: string) => ({
  tenantId: tA, domain: DOMAIN,
  OR: [{ participants: { some: { userId } } }, { cyberbullyingDetail: { is: { assignedReviewerUserId: userId } } }],
});

async function seedIncident(): Promise<string> {
  const subj = await withTenant(tA, (db) => db.protectedSubject.create({ data: { tenantId: tA, publicIdentifier: `s-${sfx}-${Math.round(performance.now())}`, displayLabel: "Subject", subjectType: "individual" } }));
  const { incidentId } = await createIncidentFromManualReport(owner, { protectedSubjectId: subj.id, summary: `case ${sfx}` });
  return incidentId;
}

async function main() {
  for (const id of [tA, tB]) await systemDb.tenant.upsert({ where: { id }, update: {}, create: { id, name: id, slug: id, plan: "growth" } });
  for (const u of [owner, reviewer, reviewer2, viewer]) await systemDb.user.upsert({ where: { id: u.userId }, update: {}, create: { id: u.userId, email: `${u.userId}-${sfx}@t.local` } });

  // === Lifecycle transitions ===============================================
  const i1 = await seedIncident();
  check("lifecycle: reviewer open→under_review (review-level)", (await transitionIncident(reviewer, i1, ST.UnderReview)).ok);
  await expectReject("lifecycle: viewer under_review→acknowledged forbidden", () => transitionIncident(viewer, i1, ST.Acknowledged), "FORBIDDEN");
  await expectReject("lifecycle: reviewer under_review→confirmed forbidden (manage-level)", () => transitionIncident(reviewer, i1, ST.Confirmed), "FORBIDDEN");
  await expectReject("lifecycle: owner under_review→confirmed rejected without reason", () => transitionIncident(owner, i1, ST.Confirmed), "TRANSITION_REJECTED");
  check("lifecycle: owner under_review→confirmed with reason", (await transitionIncident(owner, i1, ST.Confirmed, "verified by review")).ok);
  await expectReject("lifecycle: no-change confirmed→confirmed rejected", () => transitionIncident(owner, i1, ST.Confirmed, "x"), "TRANSITION_REJECTED");
  await expectReject("lifecycle: illegal confirmed→archived rejected", () => transitionIncident(owner, i1, ST.Archived, "x"), "TRANSITION_REJECTED");
  check("lifecycle: owner confirmed→resolved with reason", (await transitionIncident(owner, i1, ST.Resolved, "handled")).ok);

  // Terminal + reopen path.
  const i2 = await seedIncident();
  await transitionIncident(reviewer, i2, ST.UnderReview);
  await transitionIncident(reviewer, i2, ST.Dismissed, "not actionable"); // dismiss is review-level
  await expectReject("terminal: dismissed→under_review (non-reopen) rejected", () => transitionIncident(owner, i2, ST.UnderReview), "TRANSITION_REJECTED");
  await expectReject("reopen: reviewer reopen forbidden (manage-level)", () => reopenIncident(reviewer, i2, "new info"), "FORBIDDEN");
  await expectReject("reopen: owner reopen without reason rejected", () => reopenIncident(owner, i2, ""), "TRANSITION_REJECTED");
  check("reopen: owner reopen(dismissed) with reason → under_review", (await reopenIncident(owner, i2, "new info")).ok);
  const i2status = await withTenant(tA, (db) => db.incident.findFirst({ where: { id: i2, tenantId: tA }, select: { status: true } }));
  check("reopen: status is under_review after reopen", i2status?.status === ST.UnderReview);

  // === Assignment ==========================================================
  const i3 = await seedIncident();
  const asg1 = await assignReviewer(reviewer, i3, reviewer.userId); // claim (unassigned → review-level)
  check("assign: reviewer claims unassigned case (assigned)", asg1.action === IncidentAssignmentAction.Assigned);
  await expectReject("assign: reviewer reassign to other forbidden (manage-level)", () => assignReviewer(reviewer, i3, reviewer2.userId), "FORBIDDEN");
  const asg2 = await assignReviewer(owner, i3, reviewer2.userId, "load balance"); // reassign
  check("assign: owner reassigns (reassigned)", asg2.action === IncidentAssignmentAction.Reassigned);
  await expectReject("assign: reassign to same assignee rejected (no_change)", () => assignReviewer(owner, i3, reviewer2.userId), "ASSIGNMENT_REJECTED");
  await expectReject("assign: reviewer unassign forbidden (manage-level)", () => unassignReviewer(reviewer, i3), "FORBIDDEN");
  await unassignReviewer(owner, i3, "closing out");
  await expectReject("assign: unassign when already unassigned rejected", () => unassignReviewer(owner, i3), "ASSIGNMENT_REJECTED");

  const history = await listAssignmentHistory(owner, i3);
  check("assign history: append-only, 3 events in order", history.length === 3 && history[0]!.action === "assigned" && history[1]!.action === "reassigned" && history[2]!.action === "unassigned");
  check("assign history: reassign records previous assignee", history[1]!.previousAssigneeUserId === reviewer.userId && history[1]!.assigneeUserId === reviewer2.userId);
  check("assign history: unassign has null assignee", history[2]!.assigneeUserId === null && history[2]!.previousAssigneeUserId === reviewer2.userId);

  // Visibility: an assigned reviewer (not a participant) can see the case via scope.
  const i5 = await seedIncident();
  await assignReviewer(owner, i5, reviewer2.userId, "assign for visibility"); // reviewer2 is NOT a participant
  const visible = await withTenant(tA, (db) => db.incident.findMany({ where: participantScope(reviewer2.userId), select: { id: true } }));
  check("assign visibility: assignee sees own assigned case via scope", visible.some((r) => r.id === i5));
  const notVisible = await withTenant(tA, (db) => db.incident.findMany({ where: participantScope(reviewer2.userId), select: { id: true } }));
  check("assign visibility: assignee does NOT see unrelated unassigned case", !notVisible.some((r) => r.id === i3));

  // === Reviewer notes (confidential, append-only) ==========================
  const i4 = await seedIncident();
  const n1 = await addReviewerNote(reviewer, i4, NOTE_BODY);
  check("notes: reviewer adds note", !!n1.noteId);
  await addReviewerNote(reviewer, i4, `second-${sfx}`);
  const notes = await listReviewerNotes(reviewer, i4);
  check("notes: append-only, 2 notes in order, bodies persisted", notes.length === 2 && notes[0]!.body === NOTE_BODY);
  await expectReject("notes: viewer cannot READ confidential notes", () => listReviewerNotes(viewer, i4), "FORBIDDEN");
  await expectReject("notes: viewer cannot WRITE notes", () => addReviewerNote(viewer, i4, "x"), "FORBIDDEN");
  await expectReject("notes: empty body rejected", () => addReviewerNote(reviewer, i4, "   "), "ASSIGNMENT_REJECTED");
  // No update/delete surface exists (append-only): the service exports none.

  // Confidential: body NEVER in timeline or audit.
  const tlNote = await withTenant(tA, (db) => db.incidentTimelineEvent.findMany({ where: { incidentId: i4, tenantId: tA, eventType: IncidentTimelineEventType.NoteAdded }, select: { reason: true } }));
  check("notes confidential: note_added timeline events exist, reason is null (no body)", tlNote.length === 2 && tlNote.every((e) => e.reason === null));
  const auditNote = await withTenant(tA, (db) => db.auditLog.findMany({ where: { tenantId: tA, targetId: i4, event: "cyberbullying.incident.reviewer_note_added" }, select: { metadata: true } }));
  check("notes confidential: reviewer_note_added audit exists, no body in metadata", auditNote.length === 2 && !JSON.stringify(auditNote).includes(NOTE_BODY));
  const anyLeak = await withTenant(tA, (db) => db.auditLog.count({ where: { tenantId: tA, event: { contains: "reviewer_note" } } }));
  check("notes confidential: audit body never leaked (search whole log)", !JSON.stringify(await withTenant(tA, (db) => db.auditLog.findMany({ where: { tenantId: tA } }))).includes(NOTE_BODY) && anyLeak === 2);

  // === Timeline + audit side effects (transitions/assignment) ==============
  const tl3 = await withTenant(tA, (db) => db.incidentTimelineEvent.findMany({ where: { incidentId: i3, tenantId: tA }, select: { eventType: true } }));
  const tlTypes = tl3.map((e) => e.eventType);
  check("timeline: assignment produced reviewer_assigned/reassigned/unassigned", tlTypes.includes("reviewer_assigned") && tlTypes.includes("reviewer_reassigned") && tlTypes.includes("reviewer_unassigned"));
  const auditAssign = await withTenant(tA, (db) => db.auditLog.count({ where: { tenantId: tA, targetId: i3, event: { in: ["cyberbullying.incident.assigned", "cyberbullying.incident.reassigned", "cyberbullying.incident.unassigned"] } } }));
  check("audit: assignment produced 3 audit events", auditAssign === 3);
  const auditConfirm = await withTenant(tA, (db) => db.auditLog.count({ where: { tenantId: tA, targetId: i1, event: "cyberbullying.incident.confirmed" } }));
  check("audit: confirm transition produced an audit event", auditConfirm === 1);

  // === Subject protection (a protected subject / viewer role has NO write) ==
  const i6 = await seedIncident();
  await expectReject("subject-protection: viewer cannot start review", () => transitionIncident(viewer, i6, ST.UnderReview), "FORBIDDEN");
  await expectReject("subject-protection: viewer cannot confirm", () => transitionIncident(viewer, i6, ST.Confirmed, "x"), "FORBIDDEN");
  await expectReject("subject-protection: viewer cannot dismiss", () => transitionIncident(viewer, i6, ST.Dismissed, "x"), "FORBIDDEN");
  await expectReject("subject-protection: viewer cannot archive", () => transitionIncident(viewer, i6, ST.Archived, "x"), "FORBIDDEN");
  await expectReject("subject-protection: viewer cannot assign", () => assignReviewer(viewer, i6, viewer.userId), "FORBIDDEN");

  // === Cross-tenant isolation ==============================================
  check("cross-tenant: tenant B has no reviewer notes / assignment events", (await withTenant(tB, (db) => db.incidentReviewerNote.count())) === 0 && (await withTenant(tB, (db) => db.incidentAssignmentEvent.count())) === 0);

  await systemDb.tenant.deleteMany({ where: { id: { in: [tA, tB] } } });
  await systemDb.user.deleteMany({ where: { id: { in: [owner.userId, reviewer.userId, reviewer2.userId, viewer.userId] } } });

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — cyberbullying operations: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
