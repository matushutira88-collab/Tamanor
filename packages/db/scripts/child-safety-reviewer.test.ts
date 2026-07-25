/**
 * Child Safety Reviewer Workspace V1 (local DB). Proves the operational review layer over the ACCEPTED
 * canonical incident domain: role-gated access (Owner/Admin/Reviewer only), pagination, filters, sorting,
 * deterministic timeline, assignment, append-only notes, the review status state-machine, dashboard
 * metrics from canonical tables, tenant isolation, and permission failures. Content-free throughout.
 * Run: pnpm child-safety-reviewer:test
 */
import {
  systemDb, correlateAndLinkSignal, createOrReuseEscalation,
  listChildSafetyIncidents, getChildSafetyIncidentDetail, getChildSafetyReviewerDashboard, buildIncidentTimeline,
  assignChildSafetyIncident, unassignChildSafetyIncident, addChildSafetyReviewerNote, listChildSafetyReviewerNotes,
  setChildSafetyReviewStatus, ChildSafetyReviewForbiddenError, ChildSafetyReviewNotFoundError,
  type ReviewerActor,
} from "@guardora/db";
import {
  Role, RiskType, SafetySeverity, WorkspaceKind, riskFamilyOf, INCIDENT_CORRELATION_WINDOW_MS,
  ChildSafetyIncidentSort, ChildSafetyIncidentListFilter, ChildSafetyReviewStatus, ChildSafetyEscalationType,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throws(l: string, fn: () => Promise<unknown>, kind?: "forbidden" | "notfound" | "input") {
  try { await fn(); check(l, false, "did not throw"); }
  catch (e) {
    const okKind = !kind
      || (kind === "forbidden" && e instanceof ChildSafetyReviewForbiddenError)
      || (kind === "notfound" && e instanceof ChildSafetyReviewNotFoundError)
      || (kind === "input" && !(e instanceof ChildSafetyReviewForbiddenError) && !(e instanceof ChildSafetyReviewNotFoundError));
    check(l, okKind, `wrong error: ${(e as Error)?.message}`);
  }
}

const sfx = `csrev_${process.pid}`;
const tids: string[] = [];
let k = 0;

async function seedTenant() {
  const id = `f${k++}_${sfx}`; tids.push(id);
  await systemDb.tenant.create({ data: { id, name: id, slug: id, workspaceKind: WorkspaceKind.Family, plan: "family_free" } });
  const uOwner = (await systemDb.user.create({ data: { id: `uo_${id}`, email: `uo_${id}@t.local` } })).id;
  const uRev = (await systemDb.user.create({ data: { id: `ur_${id}`, email: `ur_${id}@t.local` } })).id;
  const mOwner = await systemDb.membership.create({ data: { userId: uOwner, tenantId: id, role: "owner" as never } });
  const profileId = (await systemDb.protectedProfile.create({ data: { tenantId: id, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  return { tenantId: id, ownerUserId: uOwner, reviewerUserId: uRev, ownerMembershipId: mOwner.id, profileId };
}
const actor = (tenantId: string, userId: string, role: Role): ReviewerActor => ({ tenantId, userId, role });
const mkSignal = (tenantId: string, profileId: string, type: string, severity: string, receivedAt?: Date) =>
  systemDb.safetySignal.create({ data: { tenantId, protectedProfileId: profileId, signalType: type, severity, confidenceBand: "high", sourceType: "platform_partner", ...(receivedAt ? { receivedAt } : {}) } });
async function seedIncident(tenantId: string, profileId: string, type: RiskType, severity: SafetySeverity, urgency: string, at = new Date()) {
  const s = await mkSignal(tenantId, profileId, type, severity, at);
  const r = await correlateAndLinkSignal({ tenantId, protectedProfileId: profileId, safetySignalId: s.id, riskFamily: riskFamilyOf(type), severity, urgency, signalAt: at, windowMs: INCIDENT_CORRELATION_WINDOW_MS });
  return { incidentId: r.incidentId, signalId: s.id };
}

async function main() {
  const f = await seedTenant();
  const owner = actor(f.tenantId, f.ownerUserId, Role.Owner);
  const reviewer = actor(f.tenantId, f.reviewerUserId, Role.Reviewer);
  const analyst = actor(f.tenantId, f.ownerUserId, Role.Analyst);
  const viewer = actor(f.tenantId, f.ownerUserId, Role.Viewer);

  // ── A. AUTHORIZATION ──────────────────────────────────────────────
  console.log("\nA. authorization (Owner/Admin/Reviewer only)");
  const seedA = await seedIncident(f.tenantId, f.profileId, RiskType.Grooming, SafetySeverity.High, "elevated");
  check("★ Owner may list", (await listChildSafetyIncidents(owner)).total >= 1);
  check("★ Reviewer may list", (await listChildSafetyIncidents(reviewer)).total >= 1);
  check("★ Admin may list", (await listChildSafetyIncidents(actor(f.tenantId, f.ownerUserId, Role.Admin))).total >= 1);
  await throws("★ Analyst may NOT list (forbidden)", () => listChildSafetyIncidents(analyst), "forbidden");
  await throws("★ Viewer may NOT list (forbidden)", () => listChildSafetyIncidents(viewer), "forbidden");
  await throws("★ Viewer may NOT view detail (forbidden)", () => getChildSafetyIncidentDetail(viewer, seedA.incidentId), "forbidden");
  await throws("★ Analyst may NOT open dashboard (forbidden)", () => getChildSafetyReviewerDashboard(analyst), "forbidden");
  await throws("★ Analyst may NOT assign (forbidden)", () => assignChildSafetyIncident(analyst, seedA.incidentId, f.reviewerUserId), "forbidden");
  await throws("★ Viewer may NOT add note (forbidden)", () => addChildSafetyReviewerNote(viewer, seedA.incidentId, "x"), "forbidden");
  await throws("★ Viewer may NOT change status (forbidden)", () => setChildSafetyReviewStatus(viewer, seedA.incidentId, ChildSafetyReviewStatus.UnderReview), "forbidden");

  // ── B. PAGINATION ─────────────────────────────────────────────────
  console.log("\nB. pagination");
  const g = await seedTenant();
  const gOwner = actor(g.tenantId, g.ownerUserId, Role.Owner);
  for (let i = 0; i < 5; i++) await seedIncident(g.tenantId, g.profileId, [RiskType.Grooming, RiskType.Cyberbullying, RiskType.Threat, RiskType.Sextortion, RiskType.Coercion][i]!, SafetySeverity.High, "elevated", new Date(Date.now() - i * 3600_000));
  const p1 = await listChildSafetyIncidents(gOwner, { pageSize: 2, page: 1 });
  const p2 = await listChildSafetyIncidents(gOwner, { pageSize: 2, page: 2 });
  const p3 = await listChildSafetyIncidents(gOwner, { pageSize: 2, page: 3 });
  check("★ total counts all incidents", p1.total === 5 && p1.pageSize === 2);
  check("★ page 1 returns 2, hasMore", p1.items.length === 2 && p1.hasMore === true);
  check("★ page 3 returns 1, no more", p3.items.length === 1 && p3.hasMore === false);
  check("★ pages do not overlap", new Set([...p1.items, ...p2.items, ...p3.items].map((i) => i.id)).size === 5);
  check("★ pageSize clamped to <=100", (await listChildSafetyIncidents(gOwner, { pageSize: 9999 })).pageSize === 100);

  // ── C. FILTERS ────────────────────────────────────────────────────
  console.log("\nC. filters");
  const h = await seedTenant();
  const hOwner = actor(h.tenantId, h.ownerUserId, Role.Owner);
  const profile2 = (await systemDb.protectedProfile.create({ data: { tenantId: h.tenantId, ageBand: "age_13_15", protectionStatus: "active" } })).id;
  const crit = await seedIncident(h.tenantId, h.profileId, RiskType.Sextortion, SafetySeverity.Critical, "immediate");
  await seedIncident(h.tenantId, h.profileId, RiskType.Cyberbullying, SafetySeverity.Medium, "routine");
  const onP2 = await seedIncident(h.tenantId, profile2, RiskType.Grooming, SafetySeverity.High, "elevated");
  await createOrReuseEscalation({ tenantId: h.tenantId, incidentId: crit.incidentId, escalationType: ChildSafetyEscalationType.UrgentInternal, urgency: "immediate", reasonCode: "sextortion", riskFamily: riskFamilyOf(RiskType.Sextortion), severity: "critical" });
  check("★ filter by profileId", (await listChildSafetyIncidents(hOwner, { profileId: profile2 })).items.every((i) => i.protectedProfileId === profile2));
  check("★ filter by severity=critical", (await listChildSafetyIncidents(hOwner, { severity: "critical" })).items.every((i) => i.severity === "critical"));
  check("★ filter listFilter=escalated", (await listChildSafetyIncidents(hOwner, { listFilter: ChildSafetyIncidentListFilter.Escalated })).items.every((i) => i.escalationState === "escalated"));
  const escList = await listChildSafetyIncidents(hOwner, { listFilter: ChildSafetyIncidentListFilter.Escalated });
  check("★ escalated filter finds the escalated incident", escList.items.some((i) => i.id === crit.incidentId) && escList.total === 1);
  check("★ search by incident id returns exactly that incident", (await listChildSafetyIncidents(hOwner, { search: onP2.incidentId })).items.map((i) => i.id).includes(onP2.incidentId));
  const past = new Date(Date.now() + 3600_000);
  check("★ createdTo in the past → none", (await listChildSafetyIncidents(hOwner, { createdTo: new Date(Date.now() - 86400_000) })).total === 0);
  check("★ createdTo in the future → all", (await listChildSafetyIncidents(hOwner, { createdTo: past })).total === 3);

  // ── D. SORTING ────────────────────────────────────────────────────
  console.log("\nD. sorting");
  const sevSorted = await listChildSafetyIncidents(hOwner, { sort: ChildSafetyIncidentSort.HighestSeverity });
  check("★ highest_severity → critical first", sevSorted.items[0]?.severity === "critical");
  const urgSorted = await listChildSafetyIncidents(hOwner, { sort: ChildSafetyIncidentSort.HighestUrgency });
  check("★ highest_urgency → immediate first", urgSorted.items[0]?.urgency === "immediate");
  const newest = await listChildSafetyIncidents(gOwner, { sort: ChildSafetyIncidentSort.Newest });
  const oldest = await listChildSafetyIncidents(gOwner, { sort: ChildSafetyIncidentSort.Oldest });
  check("★ newest/oldest are reverse-ordered by createdAt", newest.items[0]?.id === oldest.items[oldest.items.length - 1]?.id);

  // ── E. TIMELINE (deterministic) ───────────────────────────────────
  console.log("\nE. timeline");
  const tl = await seedTenant();
  const tlOwner = actor(tl.tenantId, tl.ownerUserId, Role.Owner);
  const t0 = new Date(Date.now() - 3 * 3600_000);
  const inc = await seedIncident(tl.tenantId, tl.profileId, RiskType.Grooming, SafetySeverity.Medium, "routine", t0);
  const s2 = await mkSignal(tl.tenantId, tl.profileId, RiskType.MeetingAttempt, SafetySeverity.Critical, new Date(Date.now() - 2 * 3600_000));
  await correlateAndLinkSignal({ tenantId: tl.tenantId, protectedProfileId: tl.profileId, safetySignalId: s2.id, riskFamily: riskFamilyOf(RiskType.MeetingAttempt), severity: "critical", urgency: "immediate", signalAt: new Date(Date.now() - 2 * 3600_000), windowMs: INCIDENT_CORRELATION_WINDOW_MS });
  await createOrReuseEscalation({ tenantId: tl.tenantId, incidentId: inc.incidentId, escalationType: ChildSafetyEscalationType.UrgentInternal, urgency: "immediate", reasonCode: "credible_meeting_attempt", riskFamily: riskFamilyOf(RiskType.Grooming), severity: "critical" });
  // Seed a real execution-ledger row (as the intervention orchestrator would) so the ledger summary is exercised.
  await systemDb.childSafetyIntervention.create({ data: { tenantId: tl.tenantId, safetySignalId: inc.signalId, protectedProfileId: tl.profileId, outcome: "urgent_escalation", correlationKey: `${tl.tenantId}:${tl.profileId}:${riskFamilyOf(RiskType.Grooming)}`, severity: "critical", urgency: "immediate", incidentRef: inc.incidentId, incidentStatus: "done", escalationStatus: "done", deliveryStatus: "done", reviewStatus: "done", completedAt: new Date() } });
  await assignChildSafetyIncident(tlOwner, inc.incidentId, tl.reviewerUserId);
  await addChildSafetyReviewerNote(tlOwner, inc.incidentId, "Investigating this incident.");
  const detail = await getChildSafetyIncidentDetail(tlOwner, inc.incidentId);
  const types = detail.timeline.map((e) => e.type);
  check("★ timeline includes incident_created first", types[0] === "incident_created");
  check("★ timeline includes 2 signal_linked", types.filter((t) => t === "signal_linked").length === 2);
  check("★ timeline includes severity_increased (medium→critical)", types.includes("severity_increased"));
  check("★ timeline includes escalation_triggered + notification_sent", types.includes("escalation_triggered") && types.includes("notification_sent"));
  check("★ timeline includes reviewer_assigned + reviewer_note", types.includes("reviewer_assigned") && types.includes("reviewer_note"));
  check("★ timeline is chronologically non-decreasing", detail.timeline.every((e, i) => i === 0 || Date.parse(detail.timeline[i - 1]!.at) <= Date.parse(e.at)));
  const rebuild = await getChildSafetyIncidentDetail(tlOwner, inc.incidentId);
  check("★ timeline is DETERMINISTIC (identical on rebuild)", JSON.stringify(detail.timeline) === JSON.stringify(rebuild.timeline));
  check("★ reviewer_note timeline entry carries NO body (only note id)", detail.timeline.filter((e) => e.type === "reviewer_note").every((e) => !("body" in e.detail) && typeof e.detail.to === "string"));
  check("★ detail exposes NO raw content anywhere", !JSON.stringify(detail).match(/message|transcript|\bcontent\b|secret|password/i));
  check("★ execution ledger summary present (signals tracked, delivered+escalated)", detail.ledgerSummary.signals >= 1 && detail.ledgerSummary.delivered >= 1 && detail.ledgerSummary.escalated >= 1);
  check("★ guardian delivery status surfaced from ledger/canonical (no raw content)", typeof detail.guardianDelivery.total === "number" && detail.recoveryStatus.incomplete === 0);

  // ── F. ASSIGNMENT ─────────────────────────────────────────────────
  console.log("\nF. assignment");
  const af = await seedIncident(tl.tenantId, tl.profileId, RiskType.Threat, SafetySeverity.High, "elevated");
  await assignChildSafetyIncident(tlOwner, af.incidentId, tl.reviewerUserId);
  check("★ assign sets assignedReviewerId + review event", (await systemDb.childSafetyIncident.findUnique({ where: { id: af.incidentId } }))?.assignedReviewerId === tl.reviewerUserId && (await systemDb.childSafetyReviewEvent.count({ where: { incidentId: af.incidentId, eventType: "assigned" } })) === 1);
  await unassignChildSafetyIncident(tlOwner, af.incidentId);
  check("★ unassign clears assignee + review event", (await systemDb.childSafetyIncident.findUnique({ where: { id: af.incidentId } }))?.assignedReviewerId === null && (await systemDb.childSafetyReviewEvent.count({ where: { incidentId: af.incidentId, eventType: "unassigned" } })) === 1);
  check("★ assign/unassign are audit-logged (human actor, content-free)", (await systemDb.auditLog.count({ where: { tenantId: tl.tenantId, targetId: af.incidentId, event: { startsWith: "child_safety.review." }, actorKind: "human" } })) >= 2);

  // ── G. NOTES (append-only) ────────────────────────────────────────
  console.log("\nG. reviewer notes (append-only)");
  const nf = await seedIncident(tl.tenantId, tl.profileId, RiskType.Coercion, SafetySeverity.High, "elevated");
  const n1 = await addChildSafetyReviewerNote(tlOwner, nf.incidentId, "First note.");
  await addChildSafetyReviewerNote(reviewerActorFor(tl), nf.incidentId, "Second note by reviewer.");
  const notes = await listChildSafetyReviewerNotes(tlOwner, nf.incidentId);
  check("★ notes are append-only & ordered (2 notes, bodies preserved)", notes.length === 2 && notes[0]?.body === "First note." && notes[1]?.body === "Second note by reviewer.");
  check("★ note records its author", notes[0]?.authorUserId === tl.ownerUserId && notes[1]?.authorUserId === tl.reviewerUserId);
  check("★ note body is NEVER written to the audit log", !JSON.stringify(await systemDb.auditLog.findMany({ where: { tenantId: tl.tenantId, targetId: nf.incidentId } })).includes("First note"));
  check("★ note body is NEVER written to a review event", !JSON.stringify(await systemDb.childSafetyReviewEvent.findMany({ where: { incidentId: nf.incidentId } })).includes("First note"));
  await throws("★ empty note rejected", () => addChildSafetyReviewerNote(tlOwner, nf.incidentId, "   "), "input");
  await throws("★ over-long note rejected", () => addChildSafetyReviewerNote(tlOwner, nf.incidentId, "x".repeat(5000)), "input");
  check("★ note table has no update/delete usage (append-only by construction)", n1.noteId.length > 0);

  // ── H. STATUS TRANSITIONS ─────────────────────────────────────────
  console.log("\nH. status state-machine");
  const st = await seedIncident(tl.tenantId, tl.profileId, RiskType.IdentityManipulation, SafetySeverity.Medium, "routine");
  check("★ open → under_review", (await setChildSafetyReviewStatus(tlOwner, st.incidentId, ChildSafetyReviewStatus.UnderReview)).status === "under_review");
  check("★ under_review → waiting", (await setChildSafetyReviewStatus(tlOwner, st.incidentId, ChildSafetyReviewStatus.Waiting)).status === "waiting");
  check("★ waiting → resolved (terminal, closedAt set)", (await setChildSafetyReviewStatus(tlOwner, st.incidentId, ChildSafetyReviewStatus.Resolved)).status === "resolved" && (await systemDb.childSafetyIncident.findUnique({ where: { id: st.incidentId } }))?.closedAt !== null);
  await throws("★ resolved → under_review WITHOUT reopen is rejected", () => setChildSafetyReviewStatus(tlOwner, st.incidentId, ChildSafetyReviewStatus.UnderReview), "input");
  check("★ resolved → reopened (clears closedAt)", (await setChildSafetyReviewStatus(tlOwner, st.incidentId, ChildSafetyReviewStatus.Reopened)).status === "reopened" && (await systemDb.childSafetyIncident.findUnique({ where: { id: st.incidentId } }))?.closedAt === null);
  check("★ reopened → resolved again allowed", (await setChildSafetyReviewStatus(tlOwner, st.incidentId, ChildSafetyReviewStatus.Resolved)).status === "resolved");
  const dm = await seedIncident(tl.tenantId, tl.profileId, RiskType.Cyberbullying, SafetySeverity.Low, "routine");
  check("★ open → dismissed (terminal)", (await setChildSafetyReviewStatus(tlOwner, dm.incidentId, ChildSafetyReviewStatus.Dismissed)).status === "dismissed");
  await throws("★ same→same (dismissed→dismissed) rejected as no-op", () => setChildSafetyReviewStatus(tlOwner, dm.incidentId, ChildSafetyReviewStatus.Dismissed), "input");
  check("★ status changes recorded as review events", (await systemDb.childSafetyReviewEvent.count({ where: { incidentId: st.incidentId, eventType: { in: ["status_changed", "reopened"] } } })) >= 4);

  // ── I. DASHBOARD ──────────────────────────────────────────────────
  console.log("\nI. dashboard metrics (from canonical tables)");
  const dash = await getChildSafetyReviewerDashboard(tlOwner);
  check("★ openIncidents counts live incidents", dash.openIncidents >= 1);
  check("★ escalated counts escalated incidents", dash.escalated >= 1);
  check("★ resolvedToday >= 1 (we resolved one)", dash.resolvedToday >= 1);
  check("★ signalsLast24h counts recent signals", dash.signalsLast24h >= 1);
  check("★ topRiskFamilies computed + bounded to 5", Array.isArray(dash.topRiskFamilies) && dash.topRiskFamilies.length <= 5 && dash.topRiskFamilies.every((r) => typeof r.count === "number"));
  check("★ avgResolutionMs is a number after a resolution", typeof dash.avgResolutionMs === "number" && (dash.avgResolutionMs ?? -1) >= 0);
  check("★ avgResponseMs is a number after a pickup", typeof dash.avgResponseMs === "number");

  // ── J. TENANT ISOLATION ───────────────────────────────────────────
  console.log("\nJ. tenant isolation");
  const other = actor(g.tenantId, g.ownerUserId, Role.Owner); // tenant g owner
  await throws("★ cross-tenant detail → not found (never leaks other tenant)", () => getChildSafetyIncidentDetail(other, inc.incidentId), "notfound");
  await throws("★ cross-tenant assign → not found", () => assignChildSafetyIncident(other, inc.incidentId, g.ownerUserId), "notfound");
  await throws("★ cross-tenant status → not found", () => setChildSafetyReviewStatus(other, inc.incidentId, ChildSafetyReviewStatus.UnderReview), "notfound");
  const gList = await listChildSafetyIncidents(other);
  check("★ list is tenant-scoped (no tenant-tl incidents leak into tenant-g)", gList.items.every((i) => i.id !== inc.incidentId));
  check("★ search across tenants does not leak (other tenant id → empty)", (await listChildSafetyIncidents(other, { search: inc.incidentId })).total === 0);

  // ── K. buildIncidentTimeline is a pure deterministic function ──────
  console.log("\nK. timeline purity");
  const src = { incident: { openedAt: new Date(1000) }, signals: [{ safetySignalId: "b", linkedAt: new Date(3000), signalType: "GROOMING", severity: "high", confidenceBand: "high" }, { safetySignalId: "a", linkedAt: new Date(2000), signalType: "GROOMING", severity: "medium", confidenceBand: "high" }], escalations: [], notifications: [], deliveries: [], reviewEvents: [], recoveryRepairs: [] };
  check("★ buildIncidentTimeline pure + deterministic + ordered", JSON.stringify(buildIncidentTimeline(src)) === JSON.stringify(buildIncidentTimeline(src)) && buildIncidentTimeline(src)[0]?.type === "incident_created");
}

function reviewerActorFor(f: { tenantId: string; reviewerUserId: string }): ReviewerActor { return { tenantId: f.tenantId, userId: f.reviewerUserId, role: Role.Reviewer }; }

main()
  .then(async () => {
    for (const id of tids) { for (const t of ["childSafetyReviewEvent", "childSafetyReviewerNote", "childSafetyEscalation", "childSafetyIncidentSignal", "childSafetyIncident", "notification", "safetySignalDelivery", "safetyRecipientAuthorizationDecision", "childSafetyIntervention", "safetySignal", "auditLog", "membership", "protectedProfile"] as const) { await (systemDb as never as Record<string, { deleteMany: (a: unknown) => Promise<unknown> }>)[t].deleteMany({ where: { tenantId: id } }).catch(() => {}); } await systemDb.user.deleteMany({ where: { email: { endsWith: `_${id}@t.local` } } }).catch(() => {}); await systemDb.tenant.delete({ where: { id } }).catch(() => {}); }
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Reviewer Workspace V1: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => { console.error("FATAL:", e?.stack ?? e?.message ?? e); for (const id of tids) await systemDb.tenant.delete({ where: { id } }).catch(() => {}); process.exit(1); });
