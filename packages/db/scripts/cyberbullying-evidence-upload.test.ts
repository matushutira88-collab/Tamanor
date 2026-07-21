/**
 * C7 — Secure evidence upload (local DB + local storage). Covers validation,
 * storage mechanics, evidence/custody/link creation, AV boundary honesty,
 * permission + subject scope, dedup, and audit/privacy. Uses a throwaway local
 * store dir under the scratchpad. Run: pnpm cyberbullying-evidence-upload:test
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
process.env.EVIDENCE_STORE_DIR = join(tmpdir(), `tamanor-evtest-${process.pid}`);

import {
  systemDb, withTenant,
  createIncidentFromManualReport, assignReviewer, transitionIncident,
  uploadAndAttachIncidentEvidence, EvidenceUploadError,
  putEvidenceObject, readEvidenceObject, safeDeleteEvidenceObjects,
  runEvidenceScan, isBlockingScanStatus,
  getTenantEntitlements,
} from "../src/index";
import {
  validateEvidenceFile, validateEvidenceBatch, EvidenceScanStatus, IncidentLifecycleStatus as ST,
  hasEntitlement, DEFAULT_EVIDENCE_RETENTION_DAYS,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function failCode(l: string, fn: () => Promise<unknown>, code: string, sub?: string) {
  try { await fn(); check(l, false, "did not throw"); }
  catch (e) {
    const f = (e as EvidenceUploadError).failure;
    const ok = f?.code === code && (!sub || JSON.stringify(f).includes(sub));
    check(l, ok, `got ${JSON.stringify(f)}`);
  }
}

const sfx = `cbev_${process.pid}`;
const tA = `tenA_${sfx}`, tB = `tenB_${sfx}`;
const owner = { tenantId: tA, userId: "u_owner", role: "owner" };
const reviewer = { tenantId: tA, userId: "u_rev", role: "reviewer" };
const reviewer2 = { tenantId: tA, userId: "u_rev2", role: "reviewer" };
const viewer = { tenantId: tA, userId: "u_view", role: "viewer" };
const ownerB = { tenantId: tB, userId: "u_ownerB", role: "owner" };

const enc = new TextEncoder();
let uniq = 0;
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...enc.encode(`png-${sfx}-${uniq++}`)]);
const pdf = () => new Uint8Array([...enc.encode("%PDF-1.4\n"), ...enc.encode(`pdf-${sfx}-${uniq++}\n%%EOF`)]);
const txt = () => new Uint8Array(enc.encode(`plain evidence text ${sfx}-${uniq++}`));
const eicar = () => new Uint8Array(enc.encode("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"));
const exe = () => new Uint8Array([0x4d, 0x5a, 0x90, 0x00, ...enc.encode("MZ-exe")]);
const file = (bytes: Uint8Array, declaredMime: string, filename = "e.bin") => ({ filename, declaredMime, bytes });

async function seedIncident(actor = owner, status: string = ST.Open): Promise<string> {
  const subj = await withTenant(tA, (db) => db.protectedSubject.create({ data: { tenantId: tA, publicIdentifier: `s-${sfx}-${uniq++}`, displayLabel: "Subj", subjectType: "individual" } }));
  const { incidentId } = await createIncidentFromManualReport(actor, { protectedSubjectId: subj.id, summary: `case ${sfx} ${uniq++}` });
  if (status !== ST.Open) {
    await transitionIncident(owner, incidentId, ST.UnderReview);
    if (status === ST.Dismissed) await transitionIncident(owner, incidentId, ST.Dismissed, "closing");
  }
  return incidentId;
}

async function main() {
  for (const id of [tA, tB]) await systemDb.tenant.upsert({ where: { id }, update: {}, create: { id, name: id, slug: id, plan: "growth" } });
  const free = `tenFree_${sfx}`;
  await systemDb.tenant.upsert({ where: { id: free }, update: {}, create: { id: free, name: free, slug: free, plan: "free_trial" } });
  for (const u of [owner, reviewer, reviewer2, viewer, ownerB]) await systemDb.user.upsert({ where: { id: u.userId }, update: {}, create: { id: u.userId, email: `${u.userId}-${sfx}@t.local` } });

  // === A. Validation (pure) ================================================
  check("A: valid png accepted", validateEvidenceFile({ filename: "a.png", declaredMime: "image/png", size: 100, bytes: png() }) === null);
  check("A: disallowed mime → type", validateEvidenceFile({ filename: "a.exe", declaredMime: "application/x-msdownload", size: 10 }) === "type");
  check("A: svg blocked → type", validateEvidenceFile({ filename: "a.svg", declaredMime: "image/svg+xml", size: 10 }) === "type");
  check("A: executable bytes → type", validateEvidenceFile({ filename: "a.png", declaredMime: "image/png", size: 10, bytes: exe() }) === "type");
  check("A: empty file → empty", validateEvidenceFile({ filename: "a.txt", declaredMime: "text/plain", size: 0 }) === "empty");
  check("A: oversized image → size", validateEvidenceFile({ filename: "a.png", declaredMime: "image/png", size: 11 * 1024 * 1024 }) === "size");
  check("A: mime/content mismatch → mismatch", validateEvidenceFile({ filename: "a.png", declaredMime: "image/png", size: 10, bytes: pdf() }) === "mismatch");
  check("A: path-traversal filename → filename", validateEvidenceFile({ filename: "../../etc/passwd", declaredMime: "text/plain", size: 10 }) === "filename");
  check("A: too many files → too_many", validateEvidenceBatch(Array.from({ length: 6 }, () => ({ size: 10 }))) === "too_many");
  check("A: total size cap → total_size", validateEvidenceBatch([{ size: 40 * 1024 * 1024 }, { size: 40 * 1024 * 1024 }]) === "total_size");

  // === B. Storage ==========================================================
  const b1 = await putEvidenceObject(png());
  const b2 = await putEvidenceObject(png());
  check("B: storage key is random shard/hex (not filename)", /^[0-9a-f]{2}\/[0-9a-f]{48}$/.test(b1.storageKey) && b1.storageKey !== b2.storageKey);
  const readBack = await readEvidenceObject(b1.storageKey);
  check("B: read-back returns the stored bytes", !!readBack && readBack.length === b1.sizeBytes);
  check("B: path traversal key rejected on read", (await readEvidenceObject("../../etc/passwd")) === null);
  const del = await safeDeleteEvidenceObjects([b1.storageKey, b2.storageKey]);
  check("B: cleanup removes objects, no failures", del.failed === 0 && (await readEvidenceObject(b1.storageKey)) === null);

  // === D. AV boundary (honest statuses) ====================================
  check("D: local scan of clean bytes → clean", runEvidenceScan(png(), "local_signature").status === EvidenceScanStatus.Clean);
  check("D: local scan of EICAR → infected", runEvidenceScan(eicar(), "local_signature").status === EvidenceScanStatus.Infected);
  check("D: no engine → pending_scan (never false clean)", runEvidenceScan(png(), "pending").status === EvidenceScanStatus.PendingScan);
  check("D: unavailable engine → scan_failed", runEvidenceScan(png(), "unavailable").status === EvidenceScanStatus.ScanFailed);
  check("D: infected + scan_failed are blocking", isBlockingScanStatus(EvidenceScanStatus.Infected) && isBlockingScanStatus(EvidenceScanStatus.ScanFailed) && !isBlockingScanStatus(EvidenceScanStatus.Clean) && !isBlockingScanStatus(EvidenceScanStatus.PendingScan));

  // === C. Evidence creation (happy path) ===================================
  const inc = await seedIncident();
  const res = await uploadAndAttachIncidentEvidence(owner, inc, [file(png(), "image/png", "shot.png"), file(pdf(), "application/pdf", "doc.pdf")]);
  check("C: 2 files created", res.created === 2 && res.duplicates === 0);
  const evs = await withTenant(tA, (db) => db.incidentEvidence.findMany({ where: { incidentId: inc, tenantId: tA }, select: { id: true, incidentId: true, storageObjectId: true, scanStatus: true, integrityStatus: true, retentionUntil: true, legalHold: true, contentHash: true, submittedByUserId: true, capturedAt: true } }));
  check("C: IncidentEvidence rows exist + linked to incident", evs.length === 2 && evs.every((e) => e.incidentId === inc));
  check("C: StorageObject created per evidence", (await withTenant(tA, (db) => db.storageObject.count({ where: { tenantId: tA, id: { in: evs.map((e) => e.storageObjectId) } } }))) === 2);
  check("C: custody 'uploaded' event per evidence", (await withTenant(tA, (db) => db.evidenceCustodyEvent.count({ where: { tenantId: tA, eventType: "uploaded", evidenceId: { in: evs.map((e) => e.id) } } }))) === 2);
  check("C: default clean scan (local engine)", evs.every((e) => e.scanStatus === EvidenceScanStatus.Clean));
  check("C: integrity verified (read-back)", evs.every((e) => e.integrityStatus === "verified"));
  check("C: retention default set (~365d), legalHold false", evs.every((e) => e.legalHold === false && e.retentionUntil !== null));
  const retDays = Math.round((evs[0]!.retentionUntil!.getTime() - Date.now()) / 86_400_000);
  check("C: retention ≈ policy default", Math.abs(retDays - DEFAULT_EVIDENCE_RETENTION_DAYS) <= 1);
  check("C: stored bytes match recorded hash (real storage)", await (async () => {
    const so = await withTenant(tA, (db) => db.storageObject.findFirst({ where: { id: evs[0]!.storageObjectId, tenantId: tA }, select: { storageKey: true } }));
    const bytes = so ? await readEvidenceObject(so.storageKey) : null;
    const { computeSha256Hex } = await import("../src/evidence-integrity");
    return !!bytes && computeSha256Hex(bytes) === evs[0]!.contentHash;
  })());

  // Dedup within the incident: same content ⇒ skipped, not overwritten.
  const dupBytes = png();
  await uploadAndAttachIncidentEvidence(owner, inc, [file(dupBytes, "image/png", "d.png")]);
  const before = await withTenant(tA, (db) => db.incidentEvidence.count({ where: { incidentId: inc, tenantId: tA } }));
  const dupRes = await uploadAndAttachIncidentEvidence(owner, inc, [file(dupBytes, "image/png", "d2.png")]);
  const after = await withTenant(tA, (db) => db.incidentEvidence.count({ where: { incidentId: inc, tenantId: tA } }));
  check("C: duplicate content reported + not re-created", dupRes.duplicates === 1 && dupRes.created === 0 && before === after);

  // === AV flow: pending attaches, infected/failed block (no evidence) ======
  const incP = await seedIncident();
  await uploadAndAttachIncidentEvidence(owner, incP, [file(png(), "image/png", "p.png")], { avMode: "pending" });
  const pendEv = await withTenant(tA, (db) => db.incidentEvidence.findMany({ where: { incidentId: incP, tenantId: tA }, select: { scanStatus: true } }));
  check("D: pending mode attaches with pending_scan status", pendEv.length === 1 && pendEv[0]!.scanStatus === EvidenceScanStatus.PendingScan);

  const incInf = await seedIncident();
  await failCode("D: EICAR upload blocked (scan)", () => uploadAndAttachIncidentEvidence(owner, incInf, [file(eicar(), "text/plain", "x.txt")]), "scan", "infected");
  check("D: infected upload created NO evidence (blocked pre-attach)", (await withTenant(tA, (db) => db.incidentEvidence.count({ where: { incidentId: incInf, tenantId: tA } }))) === 0);
  await failCode("D: scan_failed upload blocked (never clean)", () => uploadAndAttachIncidentEvidence(owner, incInf, [file(png(), "image/png", "x.png")], { avMode: "unavailable" }), "scan", "scan_failed");
  check("D: scan_failed created NO evidence", (await withTenant(tA, (db) => db.incidentEvidence.count({ where: { incidentId: incInf, tenantId: tA } }))) === 0);

  // === E. Permission + subject scope =======================================
  const incScope = await seedIncident();
  await assignReviewer(owner, incScope, reviewer.userId); // reviewer becomes assignee → in scope
  check("E: assigned reviewer can upload", (await uploadAndAttachIncidentEvidence(reviewer, incScope, [file(png(), "image/png")])) .created === 1);
  await failCode("E: unassigned reviewer blocked by scope", () => uploadAndAttachIncidentEvidence(reviewer2, incScope, [file(png(), "image/png")]), "forbidden");
  await failCode("E: viewer (no review perm) blocked", () => uploadAndAttachIncidentEvidence(viewer, incScope, [file(png(), "image/png")]), "forbidden");
  await failCode("E: cross-tenant incident rejected", () => uploadAndAttachIncidentEvidence(ownerB, incScope, [file(png(), "image/png")]), "not_found");
  check("E: entitlement OFF (free plan) has no cyberbullying capability", !hasEntitlement(await getTenantEntitlements(free), "cyberbullyingProtection") && hasEntitlement(await getTenantEntitlements(tA), "cyberbullyingProtection"));

  // Lifecycle: closed incident rejects evidence.
  const incClosed = await seedIncident(owner, ST.Dismissed);
  await failCode("E: closed (dismissed) incident rejects evidence", () => uploadAndAttachIncidentEvidence(owner, incClosed, [file(png(), "image/png")]), "invalid_status");

  // === F. Audit + privacy ==================================================
  const auditRows = await withTenant(tA, (db) => db.auditLog.findMany({ where: { tenantId: tA, targetId: { in: evs.map((e) => e.id) } } }));
  const uploaded = auditRows.filter((r) => r.event === "cyberbullying.evidence.uploaded");
  check("F: evidence.uploaded audit exists", uploaded.length === 2);
  const linked = await withTenant(tA, (db) => db.auditLog.count({ where: { tenantId: tA, targetId: inc, event: "cyberbullying.incident.evidence_linked" } }));
  check("F: evidence_linked (C3) audit exists", linked >= 2);
  const auditJson = JSON.stringify(auditRows);
  check("F: audit has NO hash", !auditJson.includes(evs[0]!.contentHash));
  const so0 = await withTenant(tA, (db) => db.storageObject.findFirst({ where: { id: evs[0]!.storageObjectId, tenantId: tA }, select: { storageKey: true } }));
  check("F: audit has NO storageKey", !auditJson.includes(so0!.storageKey));
  check("F: audit has NO original filename", !auditJson.includes("shot.png") && !auditJson.includes("doc.pdf"));
  check("F: uploaded audit metadata carries only safe fields", uploaded.every((r) => { const m = r.metadata as Record<string, unknown>; return m && "mimeCategory" in m && "sizeBytes" in m && "scanStatus" in m && !("contentHash" in m) && !("filename" in m); }));
  const tlJson = JSON.stringify(await withTenant(tA, (db) => db.incidentTimelineEvent.findMany({ where: { tenantId: tA, incidentId: inc } })));
  check("F: timeline has NO hash / storageKey", !tlJson.includes(evs[0]!.contentHash) && !tlJson.includes(so0!.storageKey));
  check("F: submittedByUserId recorded (internal, not in audit)", evs.every((e) => e.submittedByUserId === owner.userId));

  await systemDb.tenant.deleteMany({ where: { id: { in: [tA, tB, free] } } });
  await systemDb.user.deleteMany({ where: { id: { in: [owner.userId, reviewer.userId, reviewer2.userId, viewer.userId, ownerB.userId] } } });
  await rm(process.env.EVIDENCE_STORE_DIR!, { recursive: true, force: true });

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — cyberbullying evidence upload: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
