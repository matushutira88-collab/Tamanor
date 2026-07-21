/**
 * C6 — Manual incident reporting (local DB). Exercises the real create path,
 * subject-scope enforcement, permission gating, pure input validation, and the
 * durable double-submit (idempotency) guard — sequential AND concurrent.
 * Run: pnpm cyberbullying-manual-report:test
 */
import {
  systemDb, withTenant,
  createIncidentFromManualReport, listReportableSubjects, assertReportableSubject, canReportManualIncident,
} from "../src/index";
import {
  validateManualReportInput, CyberbullyingCategory, IncidentReportSource, IncidentCategory, IncidentLifecycleStatus as ST,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function expectReject(l: string, fn: () => Promise<unknown>, code?: string) {
  try { await fn(); check(l, false, "did not throw"); }
  catch (e) { const ec = (e as { code?: string }).code; check(l, code ? ec === code : true, `code=${ec}`); }
}

const sfx = `cbmr_${process.pid}`;
const tA = `tenA_${sfx}`, tB = `tenB_${sfx}`;
const owner = { tenantId: tA, userId: "u_owner", role: "owner" };
const reviewer = { tenantId: tA, userId: "u_reviewer", role: "reviewer" };
const viewer = { tenantId: tA, userId: "u_viewer", role: "viewer" };
const ownerB = { tenantId: tB, userId: "u_ownerB", role: "owner" };

async function mkSubject(actor: { tenantId: string }, active = true, label = "Subject") {
  return withTenant(actor.tenantId, (db) => db.protectedSubject.create({ data: { tenantId: actor.tenantId, publicIdentifier: `s-${sfx}-${Math.round(performance.now() * 1000)}`, displayLabel: label, subjectType: "individual", active } }));
}
const validInput = (subjectId: string, key: string) => ({
  protectedSubjectId: subjectId, reportSource: IncidentReportSource.ManualReport, category: CyberbullyingCategory.Harassment,
  summary: "A sustained pattern of hurtful messages over several days.", allegedActorLabel: "reported_handle", allegedActorExternalReference: "acct-123", idempotencyKey: key,
});

async function main() {
  for (const id of [tA, tB]) await systemDb.tenant.upsert({ where: { id }, update: {}, create: { id, name: id, slug: id, plan: "growth" } });
  for (const u of [owner, reviewer, viewer, ownerB]) await systemDb.user.upsert({ where: { id: u.userId }, update: {}, create: { id: u.userId, email: `${u.userId}-${sfx}@t.local` } });

  const SECRET = "SECRET-summary-should-never-leak-" + sfx;

  // === A. Service ==========================================================
  const s1 = await mkSubject(owner);
  const { incidentId } = await createIncidentFromManualReport(owner, { protectedSubjectId: s1.id, summary: SECRET, category: CyberbullyingCategory.Threats, allegedActorLabel: "x", allegedActorExternalReference: "y", idempotencyKey: `k-${sfx}-a` });
  const inc = await withTenant(tA, (db) => db.incident.findFirst({ where: { id: incidentId, tenantId: tA }, select: { domain: true, status: true, category: true, cyberbullyingDetail: { select: { assignedReviewerUserId: true, reportSource: true } }, _count: { select: { evidence: true, detectionLinks: true, participants: true } } } }));
  check("A: incident created", !!inc);
  check("A: domain = cyberbullying", inc?.domain === IncidentCategory.Cyberbullying);
  check("A: status = open", inc?.status === ST.Open);
  check("A: category persisted from report", inc?.category === CyberbullyingCategory.Threats);
  check("A: reportSource = manual_report", inc?.cyberbullyingDetail?.reportSource === IncidentReportSource.ManualReport);
  check("A: no evidence", inc?._count.evidence === 0);
  check("A: no detection links", inc?._count.detectionLinks === 0);
  check("A: no reviewer assignment", inc?.cyberbullyingDetail?.assignedReviewerUserId == null);
  const tlCreated = await withTenant(tA, (db) => db.incidentTimelineEvent.count({ where: { incidentId, tenantId: tA, eventType: "created" } }));
  check("A: timeline created event exists", tlCreated === 1);
  const auditCreated = await withTenant(tA, (db) => db.auditLog.findMany({ where: { tenantId: tA, targetId: incidentId, event: "cyberbullying.incident.created" }, select: { metadata: true } }));
  check("A: audit created event exists", auditCreated.length === 1);
  // Confidential: SECRET summary never in audit metadata or timeline.
  const allAudit = await withTenant(tA, (db) => db.auditLog.findMany({ where: { tenantId: tA } }));
  const allTimeline = await withTenant(tA, (db) => db.incidentTimelineEvent.findMany({ where: { tenantId: tA } }));
  check("A: summary NOT in audit payload", !JSON.stringify(allAudit).includes(SECRET));
  check("A: summary NOT in timeline metadata", !JSON.stringify(allTimeline).includes(SECRET));

  // === B. Permission =======================================================
  check("B: owner can report (matrix)", canReportManualIncident("owner"));
  check("B: admin can report (matrix)", canReportManualIncident("admin"));
  check("B: reviewer can report (matrix)", canReportManualIncident("reviewer"));
  check("B: viewer cannot report (matrix)", !canReportManualIncident("viewer"));
  const s2 = await mkSubject(owner);
  await expectReject("B: viewer submit forbidden", () => createIncidentFromManualReport(viewer, { protectedSubjectId: s2.id, summary: "x".repeat(20), category: CyberbullyingCategory.Other, idempotencyKey: `k-${sfx}-b` }), "FORBIDDEN");
  const revRes = await createIncidentFromManualReport(reviewer, { protectedSubjectId: s2.id, summary: "reviewer can file this report ok", category: CyberbullyingCategory.Other, idempotencyKey: `k-${sfx}-b2` });
  check("B: reviewer submit creates incident", !!revRes.incidentId);

  // === C. Subject-scope ====================================================
  const active = await mkSubject(owner, true);
  const inactive = await mkSubject(owner, false);
  const subjB = await mkSubject(ownerB, true);
  check("C: assertReportableSubject accepts an active own-tenant subject", (await assertReportableSubject(owner, active.id)).id === active.id);
  await expectReject("C: inactive subject fail-closed", () => assertReportableSubject(owner, inactive.id), "SUBJECT_NOT_ALLOWED");
  await expectReject("C: nonexistent subject fail-closed", () => assertReportableSubject(owner, "does-not-exist"), "SUBJECT_NOT_ALLOWED");
  await expectReject("C: cross-tenant subject fail-closed", () => assertReportableSubject(owner, subjB.id), "SUBJECT_NOT_ALLOWED");
  const reportable = await listReportableSubjects(owner);
  check("C: listReportableSubjects excludes inactive + cross-tenant", reportable.some((s) => s.id === active.id) && !reportable.some((s) => s.id === inactive.id) && !reportable.some((s) => s.id === subjB.id));
  await expectReject("C: viewer cannot list reportable subjects", () => listReportableSubjects(viewer), "FORBIDDEN");

  // === D. Validation (pure) ================================================
  check("D: valid input ok", validateManualReportInput(validInput("abc123", "key-1")).ok);
  check("D: empty summary → required", validateManualReportInput({ ...validInput("abc", "k"), summary: "" }).errors.summary === "required");
  check("D: short summary → too_short", validateManualReportInput({ ...validInput("abc", "k"), summary: "short" }).errors.summary === "too_short");
  check("D: long summary → too_long", validateManualReportInput({ ...validInput("abc", "k"), summary: "x".repeat(4001) }).errors.summary === "too_long");
  check("D: unknown category → invalid", validateManualReportInput({ ...validInput("abc", "k"), category: "made_up" }).errors.category === "invalid");
  check("D: unknown reportSource → invalid", validateManualReportInput({ ...validInput("abc", "k"), reportSource: "detection" }).errors.reportSource === "invalid");
  check("D: malformed subject id → invalid", validateManualReportInput({ ...validInput("bad id!", "k") }).errors.protectedSubjectId === "invalid");
  check("D: oversized actor label → too_long", validateManualReportInput({ ...validInput("abc", "k"), allegedActorLabel: "x".repeat(201) }).errors.allegedActorLabel === "too_long");
  check("D: oversized actor ref → too_long", validateManualReportInput({ ...validInput("abc", "k"), allegedActorExternalReference: "x".repeat(201) }).errors.allegedActorExternalReference === "too_long");
  check("D: missing idempotency key → required", validateManualReportInput({ ...validInput("abc", "") }).errors.idempotencyKey === "required");

  // === E. Double-submit protection (idempotency) ===========================
  const sDup = await mkSubject(owner);
  const dupKey = `dup-${sfx}`;
  const first = await createIncidentFromManualReport(owner, validInput(sDup.id, dupKey));
  const second = await createIncidentFromManualReport(owner, validInput(sDup.id, dupKey)); // sequential resubmit
  check("E: sequential duplicate returns SAME incident", first.incidentId === second.incidentId);
  check("E: sequential duplicate flagged", second.duplicate === true);
  const dupCount = await withTenant(tA, (db) => db.incident.count({ where: { tenantId: tA, cyberbullyingDetail: { is: { protectedSubjectId: sDup.id } } } }));
  check("E: only ONE incident exists for the subject after duplicate", dupCount === 1);
  const subCount = await withTenant(tA, (db) => db.cyberbullyingReportSubmission.count({ where: { tenantId: tA, userId: owner.userId, idempotencyKey: dupKey } }));
  check("E: exactly one idempotency claim row", subCount === 1);

  // Concurrent double-submit (race): both resolve to the same incident, one created.
  const sRace = await mkSubject(owner);
  const raceKey = `race-${sfx}`;
  const [r1, r2] = await Promise.all([
    createIncidentFromManualReport(owner, validInput(sRace.id, raceKey)),
    createIncidentFromManualReport(owner, validInput(sRace.id, raceKey)),
  ]);
  check("E: concurrent duplicate resolves to same incident", r1.incidentId === r2.incidentId);
  const raceCount = await withTenant(tA, (db) => db.incident.count({ where: { tenantId: tA, cyberbullyingDetail: { is: { protectedSubjectId: sRace.id } } } }));
  check("E: concurrent double-submit created exactly ONE incident (no orphan)", raceCount === 1);

  // Cross-tenant: same raw key in tenant B does NOT collide (tenant-scoped guard).
  const sB = await mkSubject(ownerB);
  const bRes = await createIncidentFromManualReport(ownerB, validInput(sB.id, raceKey));
  check("E: same key in another tenant creates its own incident (tenant-scoped)", !!bRes.incidentId && bRes.incidentId !== r1.incidentId);

  await systemDb.tenant.deleteMany({ where: { id: { in: [tA, tB] } } });
  await systemDb.user.deleteMany({ where: { id: { in: [owner.userId, reviewer.userId, viewer.userId, ownerB.userId] } } });

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — cyberbullying manual report: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
