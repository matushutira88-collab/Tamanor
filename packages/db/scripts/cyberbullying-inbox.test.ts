/**
 * C4 — Cyberbullying dashboard/inbox READ-MODEL query semantics (local DB).
 * Seeds via the real C3 service, then exercises the exact tenant/scope/KPI/filter/
 * pagination queries the read model uses. Validates subject-scope (participant vs
 * tenant-wide), KPI counts, without-evidence, manual-only, and cross-tenant.
 * Run: pnpm cyberbullying-inbox:test
 */
import {
  systemDb, withTenant,
  createIncidentFromManualReport, createIncidentFromDetections, transitionIncident, computeSha256Hex,
} from "../src/index";
import { IncidentLifecycleStatus as ST, IncidentCategory, HashAlgorithm } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const sfx = `cbx_${process.pid}`;
const tA = `tenA_${sfx}`, tB = `tenB_${sfx}`;
const ownerA = { tenantId: tA, userId: "u_own", role: "owner" };
const reviewerA = { tenantId: tA, userId: "u_rev", role: "reviewer" };
const DOMAIN = IncidentCategory.Cyberbullying;
const ACTIVE = [ST.Open, ST.UnderReview, ST.Acknowledged, ST.Confirmed, ST.ActionRequired] as string[];

// Mirror of read-model scope (participant vs tenant-wide).
const scopeWhere = (a: { tenantId: string; userId: string; role: string }) => {
  const w: Record<string, unknown> = { tenantId: a.tenantId, domain: DOMAIN };
  if (a.role !== "owner" && a.role !== "admin") w.participants = { some: { userId: a.userId } };
  return w;
};

async function main() {
  for (const id of [tA, tB]) await systemDb.tenant.upsert({ where: { id }, update: {}, create: { id, name: id, slug: id, plan: "growth" } });
  for (const u of [ownerA.userId, reviewerA.userId]) await systemDb.user.upsert({ where: { id: u }, update: {}, create: { id: u, email: `${u}-${sfx}@t.local` } });
  const subj = await withTenant(tA, (db) => db.protectedSubject.create({ data: { tenantId: tA, publicIdentifier: `s-${sfx}`, displayLabel: "Alex", subjectType: "individual" } }));
  const det = await withTenant(tA, (db) => db.securityDetection.create({ data: { tenantId: tA, subjectType: "user", subjectId: "x", kind: "manual_flag", severity: "high", status: "open" } }));

  // Seed: ownerA opens 2 (manual + from detection), reviewerA opens 1 (manual).
  const { incidentId: i1 } = await createIncidentFromManualReport(ownerA, { protectedSubjectId: subj.id, summary: "s1" });          // open, ownerA participant
  const { incidentId: i2 } = await createIncidentFromDetections(ownerA, { protectedSubjectId: subj.id, summary: "s2", detectionIds: [det.id] }); // open, has detection
  const { incidentId: i3 } = await createIncidentFromManualReport(reviewerA, { protectedSubjectId: subj.id, summary: "s3" });        // open, reviewerA participant

  // Move i1 → action_required (ownerA), i2 → resolved.
  await transitionIncident(ownerA, i1, ST.UnderReview);
  await transitionIncident(ownerA, i1, ST.Acknowledged);
  await transitionIncident(ownerA, i1, ST.ActionRequired, "needs action");
  await transitionIncident(ownerA, i2, ST.UnderReview);
  await transitionIncident(ownerA, i2, ST.Acknowledged);
  await transitionIncident(ownerA, i2, ST.Resolved, "handled");
  // Attach evidence to i3.
  const so = await withTenant(tA, (db) => db.storageObject.create({ data: { tenantId: tA, storageKey: `l/${sfx}`, sizeBytes: 5 } }));
  await withTenant(tA, (db) => db.incidentEvidence.create({ data: { tenantId: tA, incidentId: i3, evidenceType: "screenshot", sourceType: "user_upload", captureMethod: "user_upload", capturedAt: new Date(), storageObjectId: so.id, sizeBytes: 5, contentHash: computeSha256Hex("b"), hashAlgorithm: HashAlgorithm.Sha256 } }));

  // --- KPIs (tenant-wide, ownerA scope) ---
  const wOwner = scopeWhere(ownerA);
  const [open, actionReq, resolved, withoutEv, links] = await Promise.all([
    withTenant(tA, (db) => db.incident.count({ where: { ...wOwner, status: ST.Open } })),
    withTenant(tA, (db) => db.incident.count({ where: { ...wOwner, status: ST.ActionRequired } })),
    withTenant(tA, (db) => db.incident.count({ where: { ...wOwner, status: ST.Resolved } })),
    withTenant(tA, (db) => db.incident.count({ where: { ...wOwner, status: { in: ACTIVE }, evidence: { none: {} } } })),
    withTenant(tA, (db) => db.incidentDetectionLink.count({ where: { tenantId: tA, incident: { is: wOwner } } })),
  ]);
  check("KPI open = 1 (i3 only still open)", open === 1);
  check("KPI action_required = 1 (i1)", actionReq === 1);
  check("KPI resolved = 1 (i2)", resolved === 1);
  check("KPI without-evidence (active, no evidence) = 1 (i1 active w/o evidence; i3 has evidence)", withoutEv === 1);
  check("KPI linked detections = 1 (i2)", links === 1);

  // --- Subject scope: participant (reviewerA) sees ONLY own incident (i3) ---
  const reviewerList = await withTenant(tA, (db) => db.incident.findMany({ where: scopeWhere(reviewerA), select: { id: true } }));
  check("participant scope: reviewer sees only own incident (i3)", reviewerList.length === 1 && reviewerList[0]!.id === i3);
  const ownerList = await withTenant(tA, (db) => db.incident.findMany({ where: wOwner, select: { id: true } }));
  check("tenant-wide scope: owner sees all 3 cyberbullying incidents", ownerList.length === 3);

  // --- Filters: manual-only + has-evidence ---
  const manualOnly = await withTenant(tA, (db) => db.incident.count({ where: { ...wOwner, detectionLinks: { none: {} } } }));
  check("filter manual-only = 2 (i1, i3; i2 has a detection)", manualOnly === 2);
  const hasEvidence = await withTenant(tA, (db) => db.incident.count({ where: { ...wOwner, evidence: { some: {} } } }));
  check("filter has-evidence = 1 (i3)", hasEvidence === 1);

  // --- Pagination + sort (newest first) ---
  const p1 = await withTenant(tA, (db) => db.incident.findMany({ where: wOwner, orderBy: { createdAt: "desc" }, skip: 0, take: 2, select: { id: true } }));
  const p2 = await withTenant(tA, (db) => db.incident.findMany({ where: wOwner, orderBy: { createdAt: "desc" }, skip: 2, take: 2, select: { id: true } }));
  check("pagination: page1 has 2, page2 has 1 (total 3)", p1.length === 2 && p2.length === 1);
  check("newest sort: i3 (last created) first", p1[0]!.id === i3);

  // --- Cross-tenant: tenant B sees nothing ---
  check("cross-tenant: B sees 0 cyberbullying incidents / details", (await withTenant(tB, (db) => db.incident.count({ where: { tenantId: tB, domain: DOMAIN } }))) === 0 && (await withTenant(tB, (db) => db.cyberbullyingIncidentDetail.count())) === 0);

  await systemDb.tenant.deleteMany({ where: { id: { in: [tA, tB] } } });
  await systemDb.user.deleteMany({ where: { id: { in: [ownerA.userId, reviewerA.userId] } } });

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — cyberbullying inbox read-model: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
