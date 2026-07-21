/**
 * C8 — Detection triage (local DB). Human triage of existing SecurityDetections:
 * transitions, create-incident-from-detection, duplicate protection, bulk ops,
 * permission + scope, and audit/timeline side effects. No AI, no automatic incidents.
 * Run: pnpm cyberbullying-detection-triage:test
 */
import {
  systemDb, withTenant,
  triageDetection, bulkTriageDetections, createIncidentFromDetectionTriage, DetectionTriageError,
} from "../src/index";
import { CyberbullyingDetectionStatus as DS, IncidentCategory, IncidentLifecycleStatus as ST } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function reject(l: string, fn: () => Promise<unknown>, code: string) {
  try { await fn(); check(l, false, "did not throw"); }
  catch (e) { const c = (e as DetectionTriageError).code; check(l, c === code, `code=${c}`); }
}

const sfx = `cbdt_${process.pid}`;
const tA = `tenA_${sfx}`, tB = `tenB_${sfx}`;
const owner = { tenantId: tA, userId: "u_owner", role: "owner" };
const reviewer = { tenantId: tA, userId: "u_rev", role: "reviewer" };
const viewer = { tenantId: tA, userId: "u_view", role: "viewer" };
const ownerB = { tenantId: tB, userId: "u_ownerB", role: "owner" };
let u = 0;

async function mkDetection(actor = owner): Promise<string> {
  const det = await withTenant(actor.tenantId, (db) => db.securityDetection.create({ data: { tenantId: actor.tenantId, subjectType: "user", subjectId: `acct-${sfx}-${u++}`, kind: "manual_flag", severity: "high", status: "open" } }));
  return det.id;
}
const triageStatus = (id: string) => withTenant(tA, (db) => db.cyberbullyingDetectionTriage.findFirst({ where: { securityDetectionId: id, tenantId: tA }, select: { status: true, incidentId: true } }));

async function main() {
  for (const id of [tA, tB]) await systemDb.tenant.upsert({ where: { id }, update: {}, create: { id, name: id, slug: id, plan: "growth" } });
  for (const a of [owner, reviewer, viewer, ownerB]) await systemDb.user.upsert({ where: { id: a.userId }, update: {}, create: { id: a.userId, email: `${a.userId}-${sfx}@t.local` } });
  const subj = await withTenant(tA, (db) => db.protectedSubject.create({ data: { tenantId: tA, publicIdentifier: `s-${sfx}`, displayLabel: "Alex", subjectType: "individual" } }));

  // === Transitions =========================================================
  const d1 = await mkDetection();
  check("transition: default status is NEW (no triage row)", (await triageStatus(d1)) === null);
  check("start_review: new → under_review", (await triageDetection(reviewer, d1, "start_review")).status === DS.UnderReview);
  await reject("start_review from under_review rejected", () => triageDetection(reviewer, d1, "start_review"), "invalid_transition");
  check("ignore: under_review → ignored", (await triageDetection(reviewer, d1, "ignore")).status === DS.Ignored);
  check("reopen: ignored → under_review", (await triageDetection(reviewer, d1, "reopen")).status === DS.UnderReview);
  check("false_positive: under_review → false_positive", (await triageDetection(reviewer, d1, "false_positive")).status === DS.FalsePositive);
  check("reopen: false_positive → under_review", (await triageDetection(reviewer, d1, "reopen")).status === DS.UnderReview);
  await reject("reopen from active rejected", () => triageDetection(reviewer, d1, "reopen"), "invalid_transition");

  const d1events = await withTenant(tA, (db) => db.cyberbullyingDetectionTriageEvent.count({ where: { securityDetectionId: d1, tenantId: tA } }));
  check("timeline: append-only event per successful op", d1events === 5);
  const d1audit = await withTenant(tA, (db) => db.auditLog.count({ where: { tenantId: tA, targetId: d1, event: { startsWith: "cyberbullying.detection." } } }));
  check("audit: one audit per successful op", d1audit === 5);

  // === Create incident from detection ======================================
  const d2 = await mkDetection();
  const { incidentId } = await createIncidentFromDetectionTriage(reviewer, d2, { protectedSubjectId: subj.id, summary: "reported abusive messages from this account" });
  const inc = await withTenant(tA, (db) => db.incident.findFirst({ where: { id: incidentId, tenantId: tA }, select: { domain: true, status: true, cyberbullyingDetail: { select: { assignedReviewerUserId: true } } } }));
  check("create incident: cyberbullying domain + open", inc?.domain === IncidentCategory.Cyberbullying && inc?.status === ST.Open);
  check("create incident: NO auto reviewer assignment", inc?.cyberbullyingDetail?.assignedReviewerUserId == null);
  check("create incident: detection linked via IncidentDetectionLink", (await withTenant(tA, (db) => db.incidentDetectionLink.count({ where: { tenantId: tA, incidentId, securityDetectionId: d2 } }))) === 1);
  const d2t = await triageStatus(d2);
  check("create incident: triage → linked_to_incident + incidentId", d2t?.status === DS.LinkedToIncident && d2t?.incidentId === incidentId);

  // === Duplicate protection ================================================
  await reject("create again on linked detection rejected (already_linked)", () => createIncidentFromDetectionTriage(reviewer, d2, { protectedSubjectId: subj.id, summary: "second attempt at duplicate incident" }), "already_linked");
  await reject("single-op on linked detection rejected (invalid_transition)", () => triageDetection(reviewer, d2, "ignore"), "invalid_transition");
  // A detection already linked via a raw IncidentDetectionLink (no triage row) is also blocked.
  const d3 = await mkDetection();
  await withTenant(tA, (db) => db.incidentDetectionLink.create({ data: { tenantId: tA, incidentId, securityDetectionId: d3, linkReason: "manual" } }));
  await reject("create blocked when a raw incident link already exists", () => createIncidentFromDetectionTriage(reviewer, d3, { protectedSubjectId: subj.id, summary: "should be blocked by existing link" }), "already_linked");

  // === Permission + scope ==================================================
  const d4 = await mkDetection();
  await reject("viewer (no review perm) blocked", () => triageDetection(viewer, d4, "start_review"), "forbidden");
  await reject("viewer bulk blocked", () => bulkTriageDetections(viewer, [d4], "ignore"), "forbidden");
  await reject("cross-tenant detection rejected", () => triageDetection(ownerB, d4, "start_review"), "not_found");
  await reject("viewer create-incident blocked", () => createIncidentFromDetectionTriage(viewer, d4, { protectedSubjectId: subj.id, summary: "viewer cannot create an incident here" }), "forbidden");

  // === Bulk ================================================================
  const b1 = await mkDetection(), b2 = await mkDetection(), b3 = await mkDetection();
  await triageDetection(reviewer, b3, "start_review");
  await triageDetection(reviewer, b3, "ignore"); // b3 already ignored → bulk ignore should skip it
  const bulk = await bulkTriageDetections(reviewer, [b1, b2, b3], "ignore");
  check("bulk ignore: applies to valid, skips invalid", bulk.applied === 2 && bulk.skipped === 1);
  check("bulk: b1/b2 now ignored", (await triageStatus(b1))?.status === DS.Ignored && (await triageStatus(b2))?.status === DS.Ignored);
  const bulkStart = await bulkTriageDetections(reviewer, [await mkDetection(), await mkDetection()], "start_review");
  check("bulk start_review applies", bulkStart.applied === 2 && bulkStart.skipped === 0);

  // === Audit/privacy =======================================================
  const auditAll = await withTenant(tA, (db) => db.auditLog.findMany({ where: { tenantId: tA, event: { startsWith: "cyberbullying.detection." } } }));
  check("audit: linked_to_incident event exists with incidentId", auditAll.some((r) => r.event === "cyberbullying.detection.linked_to_incident" && (r.metadata as Record<string, unknown>)?.incidentId === incidentId));
  check("audit: no signal evidence / subjectId leaked", !JSON.stringify(auditAll).includes(`acct-${sfx}`));
  check("audit: targetType is security_detection", auditAll.every((r) => r.targetType === "security_detection"));

  // === Cross-tenant isolation ==============================================
  check("cross-tenant: tenant B has no triage rows/events", (await withTenant(tB, (db) => db.cyberbullyingDetectionTriage.count())) === 0 && (await withTenant(tB, (db) => db.cyberbullyingDetectionTriageEvent.count())) === 0);

  await systemDb.tenant.deleteMany({ where: { id: { in: [tA, tB] } } });
  await systemDb.user.deleteMany({ where: { id: { in: [owner.userId, reviewer.userId, viewer.userId, ownerB.userId] } } });

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — cyberbullying detection triage: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
