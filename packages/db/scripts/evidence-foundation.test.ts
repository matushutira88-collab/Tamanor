/**
 * C2 — Evidence Foundation: hashing + model + RLS + custody + retention (local DB).
 * Run: pnpm evidence-foundation:test
 */
import { systemDb, withTenant, computeSha256Hex, verifyEvidenceIntegrity } from "../src/index";
import { HashAlgorithm, EvidenceIntegrityStatus } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const rejects = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };

const sfx = `ev_${process.pid}`;
const tA = `tenA_${sfx}`;
const tB = `tenB_${sfx}`;

async function main() {
  // --- Hashing (deterministic SHA-256) ---
  check("SHA-256('abc') matches the known vector", computeSha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  check("hashing is deterministic", computeSha256Hex("tamanor") === computeSha256Hex("tamanor"));
  const h = computeSha256Hex("evidence-bytes");
  check("verify OK when bytes match", verifyEvidenceIntegrity(h, HashAlgorithm.Sha256, "evidence-bytes") === EvidenceIntegrityStatus.Verified);
  check("verify FAILED when bytes differ", verifyEvidenceIntegrity(h, HashAlgorithm.Sha256, "tampered") === EvidenceIntegrityStatus.Failed);
  check("verify FAILED (fail-closed) for a non-sha256 algorithm", verifyEvidenceIntegrity(h, "md5", "evidence-bytes") === EvidenceIntegrityStatus.Failed);

  // --- DB fixtures ---
  for (const id of [tA, tB]) await systemDb.tenant.upsert({ where: { id }, update: {}, create: { id, name: id, slug: id, plan: "growth" } });

  // Storage object (LOCAL reference) + immutable evidence under tenant A.
  const so = await withTenant(tA, (db) => db.storageObject.create({ data: { tenantId: tA, storageKey: `local/${sfx}/a.png`, sizeBytes: 1024, mimeType: "image/png" } }));
  const contentHash = computeSha256Hex("the-bytes");
  const ev = await withTenant(tA, (db) => db.incidentEvidence.create({ data: {
    tenantId: tA, evidenceType: "screenshot", sourceType: "user_upload", captureMethod: "user_upload",
    capturedAt: new Date(), storageObjectId: so.id, mimeType: "image/png", sizeBytes: 1024,
    contentHash, hashAlgorithm: HashAlgorithm.Sha256,
  } }));
  check("evidence created with pending_scan + unverified defaults", ev.scanStatus === "pending_scan" && ev.integrityStatus === "unverified" && ev.legalHold === false && ev.deletedAt === null);
  check("binary content is NOT stored in the DB (only a storage reference + hash)", ev.storageObjectId === so.id && ev.contentHash === contentHash && !("bytes" in ev));

  // --- RLS isolation ---
  check("A sees its evidence", (await withTenant(tA, (db) => db.incidentEvidence.findMany({ where: {} }))).length === 1);
  check("B sees 0 of A's evidence (tenant isolation)", (await withTenant(tB, (db) => db.incidentEvidence.findMany({ where: {} }))).length === 0);
  check("A sees its storage object; B sees none", (await withTenant(tA, (db) => db.storageObject.count())) === 1 && (await withTenant(tB, (db) => db.storageObject.count())) === 0);
  const blockedInsert = await rejects(() => withTenant(tB, (db) => db.storageObject.create({ data: { tenantId: tA, storageKey: "x", sizeBytes: 1 } })));
  check("B cannot INSERT a storage object for tenant A (WITH CHECK)", blockedInsert);

  // --- Custody append-only ledger ---
  for (const eventType of ["captured", "uploaded", "viewed_sensitive"]) {
    await withTenant(tA, (db) => db.evidenceCustodyEvent.create({ data: { tenantId: tA, evidenceId: ev.id, eventType, actorRole: "reviewer", resultingHash: contentHash } }));
  }
  const custody = await withTenant(tA, (db) => db.evidenceCustodyEvent.findMany({ where: { evidenceId: ev.id }, orderBy: { createdAt: "asc" } }));
  check("custody events accumulate (append) for the evidence", custody.length === 3 && custody[0]!.eventType === "captured");
  check("B sees 0 custody events of A (isolation)", (await withTenant(tB, (db) => db.evidenceCustodyEvent.count())) === 0);

  // --- Context items (before/primary/after) ---
  await withTenant(tA, (db) => db.evidenceContextItem.create({ data: { tenantId: tA, evidenceId: ev.id, relation: "primary", sequencePosition: 0 } }));
  check("context item created", (await withTenant(tA, (db) => db.evidenceContextItem.count())) === 1);

  // --- Retention / governance metadata (mutable) vs immutable original ---
  const until = new Date(Date.now() + 86_400_000);
  const upd = await withTenant(tA, (db) => db.incidentEvidence.update({ where: { id: ev.id }, data: { integrityStatus: "verified", scanStatus: "clean", legalHold: true, retentionUntil: until, deletedAt: new Date() } }));
  check("governance metadata is mutable (integrity/scan/legalHold/retention/deletedAt)", upd.integrityStatus === "verified" && upd.scanStatus === "clean" && upd.legalHold === true && upd.retentionUntil != null && upd.deletedAt != null);
  check("immutable integrity facts unchanged after governance update", upd.contentHash === contentHash && upd.hashAlgorithm === "sha256" && upd.capturedAt.getTime() === ev.capturedAt.getTime());

  // --- Composite-FK cascade: deleting the storage object cascades evidence (+ its context/custody) ---
  await withTenant(tA, (db) => db.storageObject.delete({ where: { id: so.id } }));
  check("deleting the storage object cascades evidence", (await withTenant(tA, (db) => db.incidentEvidence.count())) === 0);
  check("cascade also removes custody + context (via evidence)", (await withTenant(tA, (db) => db.evidenceCustodyEvent.count())) === 0 && (await withTenant(tA, (db) => db.evidenceContextItem.count())) === 0);

  // Cleanup.
  await systemDb.evidenceCustodyEvent.deleteMany({ where: { tenantId: { in: [tA, tB] } } });
  await systemDb.evidenceContextItem.deleteMany({ where: { tenantId: { in: [tA, tB] } } });
  await systemDb.incidentEvidence.deleteMany({ where: { tenantId: { in: [tA, tB] } } });
  await systemDb.storageObject.deleteMany({ where: { tenantId: { in: [tA, tB] } } });
  await systemDb.tenant.deleteMany({ where: { id: { in: [tA, tB] } } });

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — evidence foundation (hash + model + RLS + custody + retention): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
