/**
 * C11 — Compliance report snapshots (local DB). Builder + sections, versioning,
 * canonical hashing + chain, DB-privilege immutability, idempotency, permission/
 * scope, evidence package, chronology, audit/timeline, and privacy.
 * Run: pnpm cyberbullying-compliance:test
 */
import {
  systemDb, withTenant,
  createIncidentFromManualReport, assignReviewer, addIncidentParticipant,
  updateProtectionPlan, createCaseTask, createManualEscalation, computeSha256Hex,
  buildCyberbullyingComplianceSnapshot, computeComplianceHashHex, createCyberbullyingComplianceReport,
  listIncidentComplianceReports, getComplianceReportDetail, verifyComplianceReportChain, verifyComplianceSnapshotPayload,
  ComplianceError,
} from "../src/index";
import {
  ComplianceReportType, ComplianceVerificationStatus as VS, RedactionState, OmissionReason,
  IncidentParticipantRole, CaseRiskLevel, EscalationSeverity, EscalationReason,
  canonicalStringify, COMPLIANCE_SCHEMA_VERSION,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function reject(l: string, fn: () => Promise<unknown>, code?: string) {
  try { await fn(); check(l, false, "did not throw"); }
  catch (e) { const c = (e as { code?: string }).code; check(l, code ? c === code : true, `code=${c}`); }
}

const sfx = `cbcr_${process.pid}`;
const tA = `tenA_${sfx}`, tB = `tenB_${sfx}`;
const owner = { tenantId: tA, userId: "u_owner", role: "owner" };
const reviewer = { tenantId: tA, userId: "u_rev", role: "reviewer" };
const reviewer2 = { tenantId: tA, userId: "u_rev2", role: "reviewer" };
const viewer = { tenantId: tA, userId: "u_view", role: "viewer" };
const ownerB = { tenantId: tB, userId: "u_ownerB", role: "owner" };
let u = 0;
const SECRET_SUMMARY = `SUMMARY-SECRET-${sfx}`, SECRET_OBJ = `OBJ-SECRET-${sfx}`, SECRET_NOTE = `NOTE-SECRET-${sfx}`, SECRET_TASK = `TASKDESC-SECRET-${sfx}`, SECRET_ESC = `ESCNOTE-SECRET-${sfx}`;

async function mkMember(a: { tenantId: string; userId: string; role: string }) {
  await systemDb.user.upsert({ where: { id: a.userId }, update: {}, create: { id: a.userId, email: `${a.userId}-${sfx}@t.local` } });
  await systemDb.membership.upsert({ where: { userId_tenantId: { userId: a.userId, tenantId: a.tenantId } }, update: { role: a.role as never }, create: { userId: a.userId, tenantId: a.tenantId, role: a.role as never } });
}
async function mkIncident(actor = owner, summary = `case ${sfx} ${u++}`): Promise<string> {
  const subj = await withTenant(tA, (db) => db.protectedSubject.create({ data: { tenantId: tA, publicIdentifier: `s-${sfx}-${u++}`, displayLabel: "Alex", subjectType: "individual" } }));
  return (await createIncidentFromManualReport(actor, { protectedSubjectId: subj.id, summary })).incidentId;
}
async function addEvidence(incidentId: string): Promise<void> {
  await withTenant(tA, async (db) => {
    const so = await db.storageObject.create({ data: { tenantId: tA, storageKey: `ab/${"f".repeat(48)}-${u++}`, sizeBytes: 10, mimeType: "image/png" } });
    const ev = await db.incidentEvidence.create({ data: { tenantId: tA, incidentId, evidenceType: "screenshot", sourceType: "user_upload", captureMethod: "user_upload", capturedAt: new Date(), storageObjectId: so.id, sizeBytes: 10, contentHash: computeSha256Hex(`bytes-${u++}`), hashAlgorithm: "sha256", integrityStatus: "verified", scanStatus: "clean" } });
    await db.evidenceCustodyEvent.create({ data: { tenantId: tA, evidenceId: ev.id, eventType: "uploaded", actorUserId: owner.userId, resultingHash: ev.contentHash } });
  });
}

async function main() {
  for (const id of [tA, tB]) await systemDb.tenant.upsert({ where: { id }, update: {}, create: { id, name: id, slug: id, plan: "growth" } });
  for (const a of [owner, reviewer, reviewer2, viewer, ownerB]) await mkMember(a);

  // Fully-populated incident.
  const inc = await mkIncident(owner, SECRET_SUMMARY);
  await assignReviewer(owner, inc, reviewer.userId);
  await addIncidentParticipant(owner, inc, { role: IncidentParticipantRole.Reviewer, userId: reviewer2.userId });
  await updateProtectionPlan(owner, inc, { riskLevel: CaseRiskLevel.Critical, objective: SECRET_OBJ, notes: SECRET_NOTE });
  await createCaseTask(owner, inc, { title: "do X", description: SECRET_TASK, dueDate: new Date(Date.now() - 3_600_000).toISOString() }); // overdue
  await createManualEscalation(owner, inc, { severity: EscalationSeverity.Urgent, reasonCode: EscalationReason.Other, note: SECRET_ESC });
  await addEvidence(inc);

  // === A. Builder ==========================================================
  const payload = await withTenant(tA, (db) => buildCyberbullyingComplianceSnapshot(db, owner, inc, ComplianceReportType.CaseSummary, { version: 1, previousHash: null, generatedAt: new Date(), tenantTimezone: "UTC" }));
  const keys = Object.keys(payload).sort();
  check("A: all top-level sections present", ["assignments", "caseManagement", "chronology", "custodySummary", "detections", "evidenceInventory", "incident", "integrity", "omissions", "protectedSubject", "reportMetadata", "slaAndEscalation"].every((k) => keys.includes(k)));
  const dump = JSON.stringify(payload);
  check("A: no confidential summary/objective/notes/task-desc/escalation-note in payload", ![SECRET_SUMMARY, SECRET_OBJ, SECRET_NOTE, SECRET_TASK, SECRET_ESC].some((s) => dump.includes(s)));
  check("A: omissions record the excluded fields", payload.omissions.some((o) => o.reason === OmissionReason.IncidentSummaryExcluded) && payload.omissions.some((o) => o.reason === OmissionReason.ConfidentialEscalationNoteExcluded) && payload.omissions.some((o) => o.reason === OmissionReason.EvidenceContentExcluded));
  check("A: evidence inventory has metadata + hash, no storageKey", payload.evidenceInventory.length === 1 && !!payload.evidenceInventory[0]!.contentHash && !dump.includes("storageKey"));
  check("A: SLA uses generatedAt as now (task overdue counted)", payload.slaAndEscalation.taskOverdue === 1);
  check("A: critical-risk SLA is applicable", payload.slaAndEscalation.criticalRisk !== "not_applicable");

  // === B. Versioning + C. Hashing + create =================================
  const r1 = await createCyberbullyingComplianceReport(owner, inc, { reportType: ComplianceReportType.CaseSummary });
  const r2 = await createCyberbullyingComplianceReport(owner, inc, { reportType: ComplianceReportType.CaseSummary });
  check("B: version starts at 1, increments to 2", r1.version === 1 && r2.version === 2);
  check("B: version scoped per (incident, reportType)", (await createCyberbullyingComplianceReport(owner, inc, { reportType: ComplianceReportType.EvidencePackage })).version === 1);
  check("C: v2 previousSnapshotHash = v1 hash (chain)", r2.previousSnapshotHash === r1.snapshotHash);
  check("C: deterministic hash — same payload same hash", computeComplianceHashHex(payload, null) === computeComplianceHashHex(payload, null));
  check("C: canonical stringify ignores key order", canonicalStringify({ b: 1, a: { d: 2, c: 3 } }) === canonicalStringify({ a: { c: 3, d: 2 }, b: 1 }));
  const tampered = JSON.parse(JSON.stringify(payload)); tampered.incident.severity = "tampered";
  check("C: tampering detected (hash differs)", computeComplianceHashHex(tampered, null) !== computeComplianceHashHex(payload, null));
  check("C: unsupported schema detected", verifyComplianceSnapshotPayload(payload, computeComplianceHashHex(payload, null), null, "9.9.9") === VS.UnsupportedSchema);
  check("C: valid chain verifies", (await verifyComplianceReportChain(owner, inc, ComplianceReportType.CaseSummary)) === VS.Verified);
  check("C: chain incomplete for unknown incident", (await verifyComplianceReportChain(owner, "nope", ComplianceReportType.CaseSummary)) === VS.ChainIncomplete);

  // === D. Immutability (DB privilege — no UPDATE/DELETE for app role) =======
  await reject("D: payload UPDATE rejected (privilege)", () => withTenant(tA, (db) => db.complianceReportSnapshot.update({ where: { id: r1.reportId }, data: { snapshotHash: "x" } })));
  await reject("D: DELETE rejected (privilege)", () => withTenant(tA, (db) => db.complianceReportSnapshot.delete({ where: { id: r1.reportId } })));

  // === E. Idempotency ======================================================
  const key = `idem-${sfx}`;
  const i1 = await createCyberbullyingComplianceReport(owner, inc, { reportType: ComplianceReportType.CaseSummary, idempotencyKey: key });
  const i2 = await createCyberbullyingComplianceReport(owner, inc, { reportType: ComplianceReportType.CaseSummary, idempotencyKey: key });
  check("E: same idempotency key returns the SAME report (replay)", i1.reportId === i2.reportId && i2.duplicate === true);
  const i3 = await createCyberbullyingComplianceReport(owner, inc, { reportType: ComplianceReportType.CaseSummary, idempotencyKey: `other-${sfx}` });
  check("E: a different key creates a NEW version", i3.reportId !== i1.reportId && i3.version > i1.version);
  const other = await createCyberbullyingComplianceReport(reviewer, inc, { reportType: ComplianceReportType.CaseSummary, idempotencyKey: key });
  check("E: same key by a different USER is a distinct report", other.reportId !== i1.reportId);

  // === F. Permission + scope ===============================================
  const scopeInc = await mkIncident();
  await assignReviewer(owner, scopeInc, reviewer.userId);
  check("F: reviewer in scope can create", (await createCyberbullyingComplianceReport(reviewer, scopeInc, { reportType: ComplianceReportType.CaseSummary })).version === 1);
  await reject("F: reviewer out of scope denied", () => createCyberbullyingComplianceReport(reviewer2, scopeInc, { reportType: ComplianceReportType.CaseSummary }), "forbidden");
  await reject("F: viewer denied", () => createCyberbullyingComplianceReport(viewer, scopeInc, { reportType: ComplianceReportType.CaseSummary }), "forbidden");
  await reject("F: unsupported report type rejected", () => createCyberbullyingComplianceReport(owner, scopeInc, { reportType: "bogus" }), "unsupported_type");
  await reject("F: cross-tenant create denied (not found)", () => createCyberbullyingComplianceReport(ownerB, scopeInc, { reportType: ComplianceReportType.CaseSummary }), "not_found");

  // === G. Evidence package + H. Chronology =================================
  check("G: evidence hash + AV status included, content not", payload.evidenceInventory[0]!.scanStatus === "clean" && payload.integrity.evidenceIntegrityVerified === 1 && !("bytes" in payload.evidenceInventory[0]!));
  check("G: custody chronological", payload.custodySummary.length === 1 && payload.custodySummary[0]!.eventType === "uploaded");
  const times = payload.chronology.map((c) => c.occurredAt);
  check("H: chronology deterministically ordered", JSON.stringify(times) === JSON.stringify([...times].sort()));
  check("H: chronology has no notes/descriptions", !JSON.stringify(payload.chronology).match(/SECRET/));

  // === Read models =========================================================
  const list = await listIncidentComplianceReports(owner, inc);
  check("read: list newest-version first, bounded", list.items.length > 0 && list.items[0]!.version >= list.items[list.items.length - 1]!.version);
  const detail = await getComplianceReportDetail(owner, r1.reportId);
  check("read: detail returns payload + verified status", !!detail && detail.verificationStatus === VS.Verified && detail.redactionState === RedactionState.UnredactedInternal);
  await reject("read: viewer denied detail", () => getComplianceReportDetail(viewer, r1.reportId), "forbidden");

  // === I. Audit + timeline =================================================
  const audit = await withTenant(tA, (db) => db.auditLog.findMany({ where: { tenantId: tA, event: { startsWith: "cyberbullying.compliance_report." } } }));
  check("I: created + idempotent_replay audits exist", audit.some((r) => r.event === "cyberbullying.compliance_report.created") && audit.some((r) => r.event === "cyberbullying.compliance_report.idempotent_replay"));
  check("I: audit carries NO snapshot payload / secrets", !JSON.stringify(audit).includes(SECRET_SUMMARY) && !JSON.stringify(audit).includes("snapshotPayload") && !JSON.stringify(audit).includes(SECRET_ESC));
  const tl = await withTenant(tA, (db) => db.incidentTimelineEvent.findMany({ where: { tenantId: tA, incidentId: inc, eventType: "compliance_report_created" } }));
  check("I: timeline records compliance_report_created (metadata only)", tl.length >= 1 && !JSON.stringify(tl).includes(SECRET_SUMMARY));

  // === Cross-tenant isolation ==============================================
  check("cross-tenant: tenant B has no compliance reports", (await withTenant(tB, (db) => db.complianceReportSnapshot.count())) === 0);
  check("schema version constant", COMPLIANCE_SCHEMA_VERSION === "1.0.0");

  await systemDb.tenant.deleteMany({ where: { id: { in: [tA, tB] } } });
  await systemDb.user.deleteMany({ where: { id: { in: [owner.userId, reviewer.userId, reviewer2.userId, viewer.userId, ownerB.userId] } } });

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — cyberbullying compliance: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
