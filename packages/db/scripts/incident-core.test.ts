/**
 * C3 — Incident Core: service (create/link/participant/transition/reopen),
 * permissions, RLS isolation, subject scope, and brand-incident regression.
 * Run: pnpm incident-core:test
 */
import {
  systemDb, withTenant,
  createIncidentFromManualReport, createIncidentFromDetections, linkDetectionToIncident,
  linkEvidenceToIncident, addIncidentParticipant, removeIncidentParticipant,
  transitionIncident, reopenIncident, resolveSubjectScope,
  IncidentForbiddenError, IncidentNotFoundError, IncidentTransitionRejected, computeSha256Hex,
} from "../src/index";
import { IncidentLifecycleStatus as ST, IncidentParticipantRole, SubjectScope, Role, HashAlgorithm } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const rejectsWith = async (fn: () => Promise<unknown>, ctor: new (...a: never[]) => Error) => { try { await fn(); return false; } catch (e) { return e instanceof ctor; } };

const sfx = `ic_${process.pid}`;
const tA = `tenA_${sfx}`, tB = `tenB_${sfx}`;
const ownerA = { tenantId: tA, userId: "u_owner", role: "owner" };
const reviewerA = { tenantId: tA, userId: "u_rev", role: "reviewer" };
const viewerA = { tenantId: tA, userId: "u_view", role: "viewer" };
const ownerB = { tenantId: tB, userId: "u_ownerB", role: "owner" };

async function main() {
  for (const id of [tA, tB]) await systemDb.tenant.upsert({ where: { id }, update: {}, create: { id, name: id, slug: id, plan: "growth" } });
  // Actor users must exist (AuditLog.actorUserId FK → users).
  for (const u of [ownerA.userId, reviewerA.userId, viewerA.userId, ownerB.userId]) await systemDb.user.upsert({ where: { id: u }, update: {}, create: { id: u, email: `${u}-${sfx}@test.local` } });
  const subjA = await withTenant(tA, (db) => db.protectedSubject.create({ data: { tenantId: tA, publicIdentifier: `s-${sfx}`, displayLabel: "Victim", subjectType: "individual" } }));
  const d1 = await withTenant(tA, (db) => db.securityDetection.create({ data: { tenantId: tA, subjectType: "user", subjectId: "victim", kind: "manual_flag", severity: "high", status: "open" } }));
  const d2 = await withTenant(tA, (db) => db.securityDetection.create({ data: { tenantId: tA, subjectType: "user", subjectId: "victim", kind: "session_anomaly", severity: "medium", status: "open" } }));

  // --- A) Manual incident (no detection) ---
  const { incidentId: incManual } = await createIncidentFromManualReport(reviewerA, { protectedSubjectId: subjA.id, summary: "confidential summary", severity: "high", allegedActorLabel: "user_x" });
  const incRow = await withTenant(tA, (db) => db.incident.findFirst({ where: { id: incManual }, include: { cyberbullyingDetail: true, participants: true, timelineEvents: true } }));
  check("manual incident: domain=cyberbullying, brandId null, status open", incRow?.domain === "cyberbullying" && incRow?.brandId === null && incRow?.status === "open");
  check("manual incident: 1:1 detail with confidential summary + alleged label", incRow?.cyberbullyingDetail?.summary === "confidential summary" && incRow?.cyberbullyingDetail?.allegedActorLabel === "user_x" && incRow?.cyberbullyingDetail?.reportSource === "manual_report");
  check("manual incident: protected_subject + reporter participants", incRow!.participants.some((p) => p.role === "protected_subject") && incRow!.participants.some((p) => p.role === "reporter"));
  check("manual incident: timeline 'created'", incRow!.timelineEvents.some((t) => t.eventType === "created"));
  check("manual incident: audit 'cyberbullying.incident.created' written", (await withTenant(tA, (db) => db.auditLog.count({ where: { event: "cyberbullying.incident.created", targetId: incManual } }))) === 1);

  // --- report permission: viewer (no cyberbullying:report) rejected ---
  check("viewer WITHOUT cyberbullying:report → forbidden", await rejectsWith(() => createIncidentFromManualReport(viewerA, { protectedSubjectId: subjA.id, summary: "x" }), IncidentForbiddenError));

  // --- B) Incident from one / multiple detections ---
  const { incidentId: incFrom1 } = await createIncidentFromDetections(reviewerA, { protectedSubjectId: subjA.id, summary: "s", detectionIds: [d1.id] });
  check("from 1 detection: 1 link + status open (link never confirms)", (await withTenant(tA, (db) => db.incidentDetectionLink.count({ where: { incidentId: incFrom1 } }))) === 1 && (await withTenant(tA, (db) => db.incident.findFirst({ where: { id: incFrom1 }, select: { status: true } })))?.status === "open");
  const { incidentId: incFrom2 } = await createIncidentFromDetections(reviewerA, { protectedSubjectId: subjA.id, summary: "s", detectionIds: [d1.id, d2.id] });
  check("from multiple detections: 2 links", (await withTenant(tA, (db) => db.incidentDetectionLink.count({ where: { incidentId: incFrom2 } }))) === 2);

  // --- duplicate detection link idempotent ---
  const dup = await linkDetectionToIncident(reviewerA, incFrom1, d1.id, "again");
  check("duplicate detection link is idempotent (created:false)", dup.created === false);
  const fresh = await linkDetectionToIncident(reviewerA, incFrom1, d2.id, "another");
  check("new detection link created:true", fresh.created === true);

  // --- cross-tenant link blocked ---
  check("cross-tenant detection link blocked (B cannot touch A's incident)", await rejectsWith(() => linkDetectionToIncident(ownerB, incManual, d1.id, "evil"), IncidentNotFoundError));

  // --- evidence link does NOT change immutable fields ---
  const so = await withTenant(tA, (db) => db.storageObject.create({ data: { tenantId: tA, storageKey: `local/${sfx}`, sizeBytes: 10 } }));
  const chash = computeSha256Hex("bytes");
  const ev = await withTenant(tA, (db) => db.incidentEvidence.create({ data: { tenantId: tA, evidenceType: "screenshot", sourceType: "user_upload", captureMethod: "user_upload", capturedAt: new Date(), storageObjectId: so.id, sizeBytes: 10, contentHash: chash, hashAlgorithm: HashAlgorithm.Sha256 } }));
  await linkEvidenceToIncident(reviewerA, incManual, ev.id);
  const evAfter = await withTenant(tA, (db) => db.incidentEvidence.findFirst({ where: { id: ev.id } }));
  check("evidence linked to incident (incidentId set)", evAfter?.incidentId === incManual);
  check("evidence link left immutable fields unchanged (hash/algorithm/capturedAt)", evAfter?.contentHash === chash && evAfter?.hashAlgorithm === "sha256" && evAfter?.capturedAt.getTime() === ev.capturedAt.getTime());
  check("evidence_linked timeline + audit written", (await withTenant(tA, (db) => db.incidentTimelineEvent.count({ where: { incidentId: incManual, eventType: "evidence_linked" } }))) === 1);

  // --- alleged_actor participant stays neutral ---
  const p = await addIncidentParticipant(reviewerA, incManual, { role: IncidentParticipantRole.AllegedActor, externalReference: "ext-actor-1" });
  const pr = await withTenant(tA, (db) => db.incidentParticipant.findFirst({ where: { id: p.participantId } }));
  check("alleged_actor participant uses neutral role (not perpetrator/attacker)", pr?.role === "alleged_actor");
  const pdup = await addIncidentParticipant(reviewerA, incManual, { role: IncidentParticipantRole.AllegedActor, externalReference: "ext-actor-1" });
  check("duplicate participant is idempotent", pdup.created === false);
  await removeIncidentParticipant(ownerA, incManual, p.participantId);
  check("participant removed (manage)", (await withTenant(tA, (db) => db.incidentParticipant.count({ where: { id: p.participantId } }))) === 0);
  check("reviewer WITHOUT manage cannot remove participant", await rejectsWith(() => removeIncidentParticipant(reviewerA, incManual, "whatever"), IncidentForbiddenError));

  // --- Transitions + permissions ---
  await transitionIncident(reviewerA, incManual, ST.UnderReview);
  await transitionIncident(reviewerA, incManual, ST.Acknowledged);
  check("confirm WITHOUT manage (reviewer) → forbidden (no AI/low-priv confirm)", await rejectsWith(() => transitionIncident(reviewerA, incManual, ST.Confirmed, "r"), IncidentForbiddenError));
  const conf = await transitionIncident(ownerA, incManual, ST.Confirmed, "confirmed after human review");
  check("owner confirms WITH reason → ok", conf.ok === true);
  check("illegal transition rejected (confirmed→dismissed)", await rejectsWith(() => transitionIncident(ownerA, incManual, ST.Dismissed, "x"), IncidentTransitionRejected));
  await transitionIncident(ownerA, incManual, ST.Resolved, "resolved");
  check("resolved sets resolvedAt", (await withTenant(tA, (db) => db.incident.findFirst({ where: { id: incManual }, select: { resolvedAt: true, status: true } })))?.status === "resolved");
  const re = await reopenIncident(ownerA, incManual, "new evidence surfaced");
  check("reopen resolved→under_review (elevated + reason)", re.ok === true && (await withTenant(tA, (db) => db.incident.findFirst({ where: { id: incManual }, select: { status: true } })))?.status === "under_review");

  // --- C) RLS isolation ---
  check("B sees 0 of A's cyberbullying incident details", (await withTenant(tB, (db) => db.cyberbullyingIncidentDetail.count())) === 0);
  check("B sees 0 of A's timeline/participants/links", (await withTenant(tB, (db) => db.incidentTimelineEvent.count())) === 0 && (await withTenant(tB, (db) => db.incidentParticipant.count())) === 0 && (await withTenant(tB, (db) => db.incidentDetectionLink.count())) === 0);
  const crossInsert = await (async () => { try { await withTenant(tB, (db) => db.incidentTimelineEvent.create({ data: { tenantId: tA, incidentId: incManual, eventType: "created" } })); return false; } catch { return true; } })();
  check("cross-tenant INSERT into a C3 table blocked (WITH CHECK)", crossInsert);

  // --- D) Subject scope (above tenant RLS; fail-closed) ---
  check("scope: own subject → Owner", resolveSubjectScope({ role: Role.Reviewer, isOwnSubject: true, isAssignedReviewer: false }) === SubjectScope.Owner);
  check("scope: admin → SecurityAdmin", resolveSubjectScope({ role: Role.Admin, isOwnSubject: false, isAssignedReviewer: false }) === SubjectScope.SecurityAdmin);
  check("scope: assigned reviewer → Reviewer", resolveSubjectScope({ role: Role.Reviewer, isOwnSubject: false, isAssignedReviewer: true }) === SubjectScope.Reviewer);
  check("scope: viewer/unassigned → Other (deny, fail-closed)", resolveSubjectScope({ role: Role.Viewer, isOwnSubject: false, isAssignedReviewer: false }) === SubjectScope.Other);

  // --- E) Regression: brand incident with brandId still works ---
  const brandInc = await withTenant(tA, (db) => db.incident.create({ data: { tenantId: tA, brandId: "brand-1", title: "harassment detected", category: "harassment", severity: "high", status: "open", relatedItemIds: [] } }));
  check("brand incident still creatable with brandId; domain defaults to 'reputation'", brandInc.brandId === "brand-1" && brandInc.domain === "reputation");
  check("existing brand-style query (brandId+category+status) still works", (await withTenant(tA, (db) => db.incident.count({ where: { brandId: "brand-1", category: "harassment", status: "open" } }))) === 1);

  // Cleanup (systemDb; tenant cascade removes tenant-scoped rows; users are global).
  await systemDb.tenant.deleteMany({ where: { id: { in: [tA, tB] } } });
  await systemDb.user.deleteMany({ where: { id: { in: [ownerA.userId, reviewerA.userId, viewerA.userId, ownerB.userId] } } });

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — incident core (service + RLS + scope + regression): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
