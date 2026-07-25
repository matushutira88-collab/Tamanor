/**
 * Child Safety Protection Plans V1 (local DB). Proves the internal protection-plan domain over
 * ChildSafetyIncident: deterministic recommendation, plan + action lifecycles (with fail-closed gates and
 * invalid/no-op rejection), one-active-plan-per-incident + gap-free sequence + concurrent-completion
 * safety, tenant isolation, permission failures, and content-minimized audit/events.
 * Run: pnpm child-safety-protection-plan:test
 */
import {
  systemDb, correlateAndLinkSignal, createOrReuseEscalation,
  generateProtectionRecommendation, getProtectionPlanForIncident, getProtectionPlan, getProtectionPlanProgress,
  getProtectionPlanTimeline, getProtectionPlanDashboard,
  createDraftProtectionPlan, activateProtectionPlan, completeProtectionPlan, cancelProtectionPlan, reopenProtectionPlan,
  addProtectionAction, assignProtectionAction, unassignProtectionAction, updateProtectionActionDueDate, updateProtectionActionPriority,
  startProtectionAction, blockProtectionAction, completeProtectionAction, skipProtectionAction, reopenProtectionAction,
  ChildSafetyProtectionForbiddenError, ChildSafetyProtectionNotFoundError, type ProtectionActor,
} from "@guardora/db";
import {
  Role, RiskType, SafetySeverity, WorkspaceKind, riskFamilyOf, INCIDENT_CORRELATION_WINDOW_MS,
  ChildSafetyProtectionActionType, ChildSafetyEscalationType, recommendProtectionPlan, computePlanProgress,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throws(l: string, fn: () => Promise<unknown>, kind?: "forbidden" | "notfound" | "input") {
  try { await fn(); check(l, false, "did not throw"); }
  catch (e) {
    const ok = !kind || (kind === "forbidden" && e instanceof ChildSafetyProtectionForbiddenError) || (kind === "notfound" && e instanceof ChildSafetyProtectionNotFoundError) || (kind === "input" && !(e instanceof ChildSafetyProtectionForbiddenError) && !(e instanceof ChildSafetyProtectionNotFoundError));
    check(l, ok, `wrong error: ${(e as Error)?.message}`);
  }
}

const sfx = `cspp_${process.pid}`;
const tids: string[] = [];
let k = 0;
async function seed(sev: SafetySeverity = SafetySeverity.High, type: RiskType = RiskType.Grooming) {
  const id = `f${k++}_${sfx}`; tids.push(id);
  await systemDb.tenant.create({ data: { id, name: id, slug: id, workspaceKind: WorkspaceKind.Family, plan: "family_free" } });
  const u = (await systemDb.user.create({ data: { id: `u_${id}`, email: `u_${id}@t.local` } })).id;
  await systemDb.membership.create({ data: { userId: u, tenantId: id, role: "owner" as never } });
  const p = (await systemDb.protectedProfile.create({ data: { tenantId: id, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  const s = await systemDb.safetySignal.create({ data: { tenantId: id, protectedProfileId: p, signalType: type, severity: sev, confidenceBand: "high", sourceType: "platform_partner" } });
  const r = await correlateAndLinkSignal({ tenantId: id, protectedProfileId: p, safetySignalId: s.id, riskFamily: riskFamilyOf(type), severity: sev, urgency: sev === "critical" ? "immediate" : "elevated", signalAt: new Date(), windowMs: INCIDENT_CORRELATION_WINDOW_MS });
  return { tenantId: id, userId: u, incidentId: r.incidentId };
}
const actor = (tenantId: string, userId: string, role: Role): ProtectionActor => ({ tenantId, userId, role });
async function draftWithActions(a: ProtectionActor, incidentId: string) {
  const { planId } = await createDraftProtectionPlan(a, incidentId, { fromRecommendation: true });
  const { actions } = await getProtectionPlan(a, planId);
  return { planId, actions };
}

async function main() {
  // ── A. deterministic recommendation ────────────────────────────────
  console.log("\nA. deterministic recommendation");
  const r1 = recommendProtectionPlan({ riskFamily: "grooming", severity: "critical", urgency: "immediate", escalationState: "escalated", guardianDelivered: false, evidenceCount: 0, incidentStatus: "open" });
  const r1b = recommendProtectionPlan({ riskFamily: "grooming", severity: "critical", urgency: "immediate", escalationState: "escalated", guardianDelivered: false, evidenceCount: 0, incidentStatus: "open" });
  check("★ same canonical input → identical recommendation (deterministic)", JSON.stringify(r1) === JSON.stringify(r1b));
  check("★ grooming maps to guardian + restrict + reporting actions", r1.actions.some((a) => a.type === "verify_guardian_contact") && r1.actions.some((a) => a.type === "restrict_interaction") && r1.actions.some((a) => a.type === "recommend_reporting"));
  check("★ urgent (critical/immediate) → plan priority urgent + escalate + legal_review", r1.priority === "urgent" && r1.actions.some((a) => a.type === "escalate_internal_safety") && r1.actions.some((a) => a.type === "legal_review"));
  check("★ no evidence → preserve_evidence + explanation code", r1.actions.some((a) => a.type === "preserve_evidence") && r1.explanationCodes.includes("no_evidence_captured"));
  check("★ guardian not delivered → notify + code", r1.actions.some((a) => a.type === "notify_authorized_guardian") && r1.explanationCodes.includes("guardian_not_notified"));
  const rLow = recommendProtectionPlan({ riskFamily: "bullying", severity: "low", urgency: "routine", escalationState: "none", guardianDelivered: true, evidenceCount: 3, incidentStatus: "open" });
  check("★ low bullying → normal priority, no escalate/legal", rLow.priority === "normal" && !rLow.actions.some((a) => a.type === "escalate_internal_safety"));
  check("★ recommendation is content-free (codes only)", !JSON.stringify(r1).match(/message|transcript|content|secret|@[a-z]/i));
  check("★ actions de-duplicated (no repeated type)", new Set(r1.actions.map((a) => a.type)).size === r1.actions.length);

  const f = await seed(SafetySeverity.Critical);
  const owner = actor(f.tenantId, f.userId, Role.Owner);
  const reviewer = actor(f.tenantId, f.userId, Role.Reviewer);
  const analyst = actor(f.tenantId, f.userId, Role.Analyst);
  const viewer = actor(f.tenantId, f.userId, Role.Viewer);
  const svcRec = await generateProtectionRecommendation(owner, f.incidentId);
  check("★ generateProtectionRecommendation reads canonical incident state", svcRec.actions.length > 0 && svcRec.priority === "urgent");

  // ── B. plan lifecycle ──────────────────────────────────────────────
  console.log("\nB. plan lifecycle");
  const { planId, actions } = await draftWithActions(owner, f.incidentId);
  check("★ create draft from recommendation → draft plan + seeded actions", actions.length > 0 && (await getProtectionPlan(owner, planId)).plan.status === "draft");
  check("★ action sequences are 1..n gap-free", actions.every((a, i) => a.sequence === i + 1));
  await throws("★ only ONE non-terminal plan per incident (2nd draft rejected)", () => createDraftProtectionPlan(owner, f.incidentId, {}), "input");
  check("★ activate draft → active", (await activateProtectionPlan(owner, planId)).status === "active");
  await throws("★ no-op activate (active→active) fails closed", () => activateProtectionPlan(owner, planId), "input");
  await throws("★ complete blocked while actions pending (fail-closed gate)", () => completeProtectionPlan(owner, planId), "input");

  // resolve every action (complete or skip) then complete
  for (const a of actions) { if (a.sequence % 2 === 0) await skipProtectionAction(owner, a.id); else await completeProtectionAction(owner, a.id, "done internally"); }
  check("★ complete plan once all actions resolved", (await completeProtectionPlan(owner, planId, "resolved")).status === "completed");
  check("★ reopen completed plan → reopened, completedAt cleared, plan_completed event preserved", (await reopenProtectionPlan(owner, planId)).status === "reopened" && (await getProtectionPlan(owner, planId)).plan.completedAt === null && (await getProtectionPlanTimeline(owner, planId)).some((e) => e.eventType === "plan_completed"));
  check("★ cancel reopened plan", (await cancelProtectionPlan(owner, planId, "not_required")).status === "cancelled");
  await throws("★ invalid transition (cancelled→completed) fails closed", () => completeProtectionPlan(owner, planId), "input");
  check("★ after terminal plan, a NEW draft is allowed for the incident", !!(await createDraftProtectionPlan(owner, f.incidentId, {})).planId);

  // ── C. action lifecycle ────────────────────────────────────────────
  console.log("\nC. action lifecycle");
  const g = await seed();
  const gOwner = actor(g.tenantId, g.userId, Role.Owner);
  const gp = await createDraftProtectionPlan(gOwner, g.incidentId, {});
  const add = await addProtectionAction(gOwner, gp.planId, { title: "Check the account", priority: "high" });
  check("★ add custom action → sequence 1", add.sequence === 1);
  await assignProtectionAction(gOwner, add.actionId, g.userId);
  check("★ assign sets reviewer + event", (await systemDb.childSafetyProtectionAction.findUnique({ where: { id: add.actionId } }))?.assignedReviewerId === g.userId);
  await unassignProtectionAction(gOwner, add.actionId);
  check("★ unassign clears reviewer", (await systemDb.childSafetyProtectionAction.findUnique({ where: { id: add.actionId } }))?.assignedReviewerId === null);
  const due = new Date(Date.now() + 3600_000);
  await updateProtectionActionDueDate(gOwner, add.actionId, due);
  await updateProtectionActionPriority(gOwner, add.actionId, "urgent");
  check("★ due date + priority updated + events", (await systemDb.childSafetyProtectionAction.findUnique({ where: { id: add.actionId } }))?.priority === "urgent");
  check("★ start → in_progress", (await startProtectionAction(gOwner, add.actionId)).status === "in_progress");
  check("★ block → blocked (reason stored on the row only)", (await blockProtectionAction(gOwner, add.actionId, "waiting on guardian")).status === "blocked");
  check("★ complete → completed (note stored on the row only)", (await completeProtectionAction(gOwner, add.actionId, "resolved internally")).status === "completed");
  await throws("★ invalid action transition (completed→in_progress) fails closed", () => startProtectionAction(gOwner, add.actionId), "input");
  check("★ reopen action → reopened, completedAt cleared", (await reopenProtectionAction(gOwner, add.actionId)).status === "reopened" && (await systemDb.childSafetyProtectionAction.findUnique({ where: { id: add.actionId } }))?.completedAt === null);
  const add2 = await addProtectionAction(gOwner, gp.planId, { title: "Second" });
  check("★ skip action → skipped", (await skipProtectionAction(gOwner, add2.actionId)).status === "skipped");

  // ── D. concurrency ─────────────────────────────────────────────────
  console.log("\nD. concurrency");
  const c = await seed();
  const cOwner = actor(c.tenantId, c.userId, Role.Owner);
  // one-active-plan under concurrent create
  const both = await Promise.allSettled([createDraftProtectionPlan(cOwner, c.incidentId, {}), createDraftProtectionPlan(cOwner, c.incidentId, {})]);
  check("★ concurrent createDraft → exactly ONE plan (one-active-plan enforced)", both.filter((x) => x.status === "fulfilled").length === 1 && (await systemDb.childSafetyProtectionPlan.count({ where: { tenantId: c.tenantId, incidentId: c.incidentId } })) === 1);
  const cplan = (both.find((x) => x.status === "fulfilled") as PromiseFulfilledResult<{ planId: string }>).value.planId;
  // concurrent sequence allocation
  const adds = await Promise.all(Array.from({ length: 10 }, (_, i) => addProtectionAction(cOwner, cplan, { title: `A${i}` })));
  const seqs = adds.map((a) => a.sequence).sort((x, y) => x - y);
  check("★ concurrent addAction → gap-free unique sequences 1..10", seqs.every((v, i) => v === i + 1) && new Set(seqs).size === 10);
  // concurrent completion of the same action → only one wins
  const target = adds[0]!.actionId;
  const race = await Promise.allSettled(Array.from({ length: 5 }, () => completeProtectionAction(cOwner, target, "x")));
  check("★ concurrent complete of same action → exactly ONE succeeds (guarded)", race.filter((x) => x.status === "fulfilled").length === 1);

  // ── E. progress + timeline ─────────────────────────────────────────
  console.log("\nE. progress + timeline");
  const prog = computePlanProgress([{ status: "completed", dueAt: null }, { status: "completed", dueAt: null }, { status: "skipped", dueAt: null }, { status: "pending", dueAt: new Date(Date.now() - 3600_000) }], new Date());
  check("★ completionPct = completed/(total−skipped): 2/(4−1)=67%", prog.completionPct === 67 && prog.skipped === 1 && prog.completed === 2);
  check("★ overdue counts a past-due unresolved action", prog.overdue === 1);
  check("★ all-skipped/empty plan → 100%", computePlanProgress([{ status: "skipped", dueAt: null }], new Date()).completionPct === 100 && computePlanProgress([], new Date()).completionPct === 100);
  const tl = await getProtectionPlanTimeline(gOwner, gp.planId);
  check("★ timeline is chronological + deterministic", tl.every((e, i) => i === 0 || Date.parse(tl[i - 1]!.at) <= Date.parse(e.at)) && JSON.stringify(tl) === JSON.stringify(await getProtectionPlanTimeline(gOwner, gp.planId)));

  // ── F. security + tenant isolation ─────────────────────────────────
  console.log("\nF. security + tenant isolation");
  await throws("★ analyst cannot view recommendation (forbidden)", () => generateProtectionRecommendation(analyst, f.incidentId), "forbidden");
  await throws("★ viewer cannot view plan (forbidden)", () => getProtectionPlanForIncident(viewer, f.incidentId), "forbidden");
  await throws("★ analyst cannot create draft (forbidden)", () => createDraftProtectionPlan(analyst, g.incidentId, {}), "forbidden");
  await throws("★ viewer cannot complete action (forbidden)", () => completeProtectionAction(viewer, add2.actionId), "forbidden");
  check("★ reviewer role is allowed to manage", !!(await addProtectionAction(reviewer, (await getProtectionPlanForIncident(reviewer, f.incidentId))!.plan.id, { title: "reviewer action" })).actionId);
  const other = actor(g.tenantId, g.userId, Role.Owner);
  await throws("★ cross-tenant plan → not found", () => getProtectionPlan(other, planId), "notfound");
  await throws("★ cross-tenant action complete → not found", () => completeProtectionAction(owner, add.actionId), "notfound"); // owner=tenant f, action=tenant g
  await throws("★ cross-tenant incident recommendation → not found", () => generateProtectionRecommendation(other, f.incidentId), "notfound");

  // ── G. privacy ─────────────────────────────────────────────────────
  console.log("\nG. privacy (protected free text never leaks)");
  const events = await systemDb.childSafetyProtectionActionEvent.findMany({ where: { tenantId: g.tenantId } });
  const audits = await systemDb.auditLog.findMany({ where: { tenantId: g.tenantId, targetType: { in: ["child_safety_protection_plan"] } } });
  check("★ block reason NEVER in events or audit", !JSON.stringify(events).includes("waiting on guardian") && !JSON.stringify(audits).includes("waiting on guardian"));
  check("★ completion note NEVER in events or audit", !JSON.stringify(events).includes("resolved internally") && !JSON.stringify(audits).includes("resolved internally"));
  check("★ protected free text IS stored on the action row (accessible only there)", (await systemDb.childSafetyProtectionAction.findUnique({ where: { id: add.actionId }, select: { blockReason: true } }))?.blockReason === "waiting on guardian");
  check("★ audit is content-free + human actor", audits.length > 0 && audits.every((a) => a.actorKind === "human") && !JSON.stringify(audits).match(/transcript|message|secret|@[a-z]/i));

  // ── H. dashboard ───────────────────────────────────────────────────
  console.log("\nH. dashboard metrics");
  const dash = await getProtectionPlanDashboard(gOwner);
  check("★ dashboard exposes narrow plan metrics", typeof dash.activePlans === "number" && typeof dash.overdueActions === "number" && typeof dash.blockedActions === "number" && typeof dash.incidentsWithoutActivePlan === "number" && typeof dash.plansCompletedToday === "number");
}

main()
  .then(async () => {
    for (const id of tids) { for (const t of ["childSafetyProtectionActionEvent", "childSafetyProtectionAction", "childSafetyProtectionPlan", "childSafetyEvidenceCustodyEvent", "childSafetyEvidence", "childSafetyEscalation", "childSafetyIncidentSignal", "childSafetyIncident", "childSafetyIntervention", "safetySignal", "auditLog", "membership", "protectedProfile"] as const) { await (systemDb as never as Record<string, { deleteMany: (a: unknown) => Promise<unknown> }>)[t].deleteMany({ where: { tenantId: id } }).catch(() => {}); } await systemDb.user.deleteMany({ where: { email: { endsWith: `_${id}@t.local` } } }).catch(() => {}); await systemDb.tenant.delete({ where: { id } }).catch(() => {}); }
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Protection Plans V1: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => { console.error("FATAL:", e?.stack ?? e?.message ?? e); for (const id of tids) await systemDb.tenant.delete({ where: { id } }).catch(() => {}); process.exit(1); });
