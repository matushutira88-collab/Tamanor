/**
 * C9 — Case management (local DB). A case IS the incident: protection plan, manual
 * risk, follow-up, milestones, and case tasks. All human-set. Covers writes,
 * validation, task lifecycle, permission + scope, audit/timeline, and confidential
 * content never leaking. Run: pnpm cyberbullying-case-management:test
 */
import {
  systemDb, withTenant,
  createIncidentFromManualReport, assignReviewer,
  updateProtectionPlan, updateFollowUp, setCaseMilestone, createCaseTask, updateCaseTask, CaseError,
} from "../src/index";
import { CaseRiskLevel, CaseProtectionStatus, CaseTaskStatus, CaseMilestoneKey } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function reject(l: string, fn: () => Promise<unknown>, code: string) {
  try { await fn(); check(l, false, "did not throw"); }
  catch (e) { const c = (e as CaseError).code; check(l, c === code, `code=${c}`); }
}

const sfx = `cbcm_${process.pid}`;
const tA = `tenA_${sfx}`, tB = `tenB_${sfx}`;
const owner = { tenantId: tA, userId: "u_owner", role: "owner" };
const reviewer = { tenantId: tA, userId: "u_rev", role: "reviewer" };
const reviewer2 = { tenantId: tA, userId: "u_rev2", role: "reviewer" };
const viewer = { tenantId: tA, userId: "u_view", role: "viewer" };
const ownerB = { tenantId: tB, userId: "u_ownerB", role: "owner" };
let u = 0;

const OBJ = `OBJECTIVE-SECRET-${sfx}`, NOTE = `NOTES-SECRET-${sfx}`, TASK_TITLE = `TASK-TITLE-SECRET-${sfx}`;

async function seedIncident(actor = owner): Promise<string> {
  const subj = await withTenant(tA, (db) => db.protectedSubject.create({ data: { tenantId: tA, publicIdentifier: `s-${sfx}-${u++}`, displayLabel: "Alex", subjectType: "individual" } }));
  return (await createIncidentFromManualReport(actor, { protectedSubjectId: subj.id, summary: `case ${sfx} ${u++}` })).incidentId;
}
const plan = (incidentId: string) => withTenant(tA, (db) => db.cyberbullyingProtectionPlan.findFirst({ where: { incidentId, tenantId: tA } }));

async function main() {
  for (const id of [tA, tB]) await systemDb.tenant.upsert({ where: { id }, update: {}, create: { id, name: id, slug: id, plan: "growth" } });
  for (const a of [owner, reviewer, reviewer2, viewer, ownerB]) await systemDb.user.upsert({ where: { id: a.userId }, update: {}, create: { id: a.userId, email: `${a.userId}-${sfx}@t.local` } });

  // === Protection plan =====================================================
  const inc = await seedIncident();
  await updateProtectionPlan(owner, inc, { riskLevel: CaseRiskLevel.High, protectionStatus: CaseProtectionStatus.Active, objective: OBJ, notes: NOTE });
  const p1 = await plan(inc);
  check("protection: plan upserted with manual risk + status", p1?.riskLevel === CaseRiskLevel.High && p1?.protectionStatus === CaseProtectionStatus.Active);
  check("protection: objective + notes stored", p1?.objective === OBJ && p1?.notes === NOTE);
  await reject("protection: invalid risk level rejected", () => updateProtectionPlan(owner, inc, { riskLevel: "extreme" }), "validation");
  await reject("protection: invalid status rejected", () => updateProtectionPlan(owner, inc, { protectionStatus: "on_fire" }), "validation");

  // === Follow-up ===========================================================
  await updateFollowUp(owner, inc, { nextReviewAt: "2026-09-01", lastReviewAt: "2026-07-25", followUpNotes: "check back" });
  const p2 = await plan(inc);
  check("follow-up: dates + notes stored", !!p2?.nextReviewAt && !!p2?.lastReviewAt && p2?.followUpNotes === "check back");
  await reject("follow-up: invalid date rejected", () => updateFollowUp(owner, inc, { nextReviewAt: "not-a-date" }), "validation");

  // === Milestones ==========================================================
  await setCaseMilestone(owner, inc, CaseMilestoneKey.InitialReview, true);
  check("milestone: set achieved (timestamp)", (await plan(inc))?.milestoneInitialReviewAt != null);
  await setCaseMilestone(owner, inc, CaseMilestoneKey.InitialReview, false);
  check("milestone: cleared (null)", (await plan(inc))?.milestoneInitialReviewAt == null);
  await reject("milestone: unknown key rejected", () => setCaseMilestone(owner, inc, "made_up", true), "validation");

  // === Task lifecycle ======================================================
  await reject("task: empty title rejected", () => createCaseTask(owner, inc, { title: "   " }), "validation");
  const { taskId } = await createCaseTask(owner, inc, { title: TASK_TITLE, description: "do the thing", dueDate: "2026-08-15", assigneeUserId: reviewer.userId });
  const t1 = await withTenant(tA, (db) => db.cyberbullyingCaseTask.findFirst({ where: { id: taskId, tenantId: tA } }));
  check("task: created as todo with fields", t1?.status === CaseTaskStatus.Todo && t1?.title === TASK_TITLE && t1?.dueDate != null && t1?.assigneeUserId === reviewer.userId);
  await updateCaseTask(owner, inc, taskId, { status: CaseTaskStatus.InProgress });
  check("task: todo → in_progress", (await withTenant(tA, (db) => db.cyberbullyingCaseTask.findFirst({ where: { id: taskId, tenantId: tA }, select: { status: true } })))?.status === CaseTaskStatus.InProgress);
  await updateCaseTask(owner, inc, taskId, { status: CaseTaskStatus.Done });
  const done = await withTenant(tA, (db) => db.cyberbullyingCaseTask.findFirst({ where: { id: taskId, tenantId: tA }, select: { status: true, completedAt: true } }));
  check("task: complete → done + completedAt set", done?.status === CaseTaskStatus.Done && done?.completedAt != null);
  await reject("task: illegal transition done → todo rejected", () => updateCaseTask(owner, inc, taskId, { status: CaseTaskStatus.Todo }), "invalid_transition");
  await updateCaseTask(owner, inc, taskId, { status: CaseTaskStatus.InProgress }); // reopen
  check("task: reopen done → in_progress + completedAt cleared", (await withTenant(tA, (db) => db.cyberbullyingCaseTask.findFirst({ where: { id: taskId, tenantId: tA }, select: { completedAt: true } })))?.completedAt == null);
  await reject("task: invalid status value rejected", () => updateCaseTask(owner, inc, taskId, { status: "frozen" }), "validation");
  await reject("task: update missing task rejected", () => updateCaseTask(owner, inc, "no-such-task", { status: CaseTaskStatus.Done }), "not_found");

  // === Permission + scope ==================================================
  const incScope = await seedIncident();
  await assignReviewer(owner, incScope, reviewer.userId); // reviewer becomes assignee → in scope
  await createCaseTask(reviewer, incScope, { title: "reviewer can add a task here" });
  check("scope: assigned reviewer can manage case", true);
  await reject("scope: unassigned reviewer blocked", () => createCaseTask(reviewer2, incScope, { title: "should be blocked" }), "forbidden");
  await reject("perm: viewer (no review) blocked", () => updateProtectionPlan(viewer, incScope, { riskLevel: CaseRiskLevel.Low }), "forbidden");
  await reject("scope: cross-tenant incident rejected", () => updateProtectionPlan(ownerB, incScope, { riskLevel: CaseRiskLevel.Low }), "not_found");

  // === Audit + timeline ====================================================
  const audit = await withTenant(tA, (db) => db.auditLog.findMany({ where: { tenantId: tA, targetId: inc, event: { startsWith: "cyberbullying.case." } } }));
  check("audit: case events recorded", audit.some((r) => r.event === "cyberbullying.case.protection_updated") && audit.some((r) => r.event === "cyberbullying.case.task_created") && audit.some((r) => r.event === "cyberbullying.case.task_completed"));
  const timeline = await withTenant(tA, (db) => db.incidentTimelineEvent.findMany({ where: { tenantId: tA, incidentId: inc } }));
  const tlTypes = timeline.map((e) => e.eventType);
  check("timeline: case events appended", tlTypes.includes("protection_plan_updated") && tlTypes.includes("task_created") && tlTypes.includes("task_completed") && tlTypes.includes("milestone_changed") && tlTypes.includes("follow_up_updated"));
  const dump = JSON.stringify(audit) + JSON.stringify(timeline);
  check("privacy: objective/notes/task title NEVER in audit or timeline", !dump.includes(OBJ) && !dump.includes(NOTE) && !dump.includes(TASK_TITLE));

  // === Cross-tenant isolation ==============================================
  check("cross-tenant: tenant B has no plans/tasks", (await withTenant(tB, (db) => db.cyberbullyingProtectionPlan.count())) === 0 && (await withTenant(tB, (db) => db.cyberbullyingCaseTask.count())) === 0);

  await systemDb.tenant.deleteMany({ where: { id: { in: [tA, tB] } } });
  await systemDb.user.deleteMany({ where: { id: { in: [owner.userId, reviewer.userId, reviewer2.userId, viewer.userId, ownerB.userId] } } });

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — cyberbullying case management: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
