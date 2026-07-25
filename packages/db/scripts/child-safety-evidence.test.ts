/**
 * Child Safety Evidence Management V1 (local DB). Proves the canonical evidence domain over
 * ChildSafetyIncident: creation of all 5 types, real file upload → secure storage + sha256 hash,
 * preview + download authorization (audited), append-only chain-of-custody, integrity verification
 * (pass + tamper→fail), the DETERMINISTIC export package, tenant isolation, and permission failures.
 * Run: pnpm child-safety-evidence:test
 */
import {
  systemDb, correlateAndLinkSignal, buildEvidencePackage,
  createChildSafetyEvidence, listChildSafetyEvidence, getChildSafetyEvidence, listChildSafetyEvidenceCustody,
  previewChildSafetyEvidence, downloadChildSafetyEvidence, verifyChildSafetyEvidenceIntegrity,
  sealChildSafetyEvidence, exportChildSafetyEvidencePackage,
  ChildSafetyEvidenceForbiddenError, ChildSafetyEvidenceNotFoundError, type EvidenceActor,
} from "@guardora/db";
import {
  Role, RiskType, SafetySeverity, WorkspaceKind, riskFamilyOf, INCIDENT_CORRELATION_WINDOW_MS,
  ChildSafetyEvidenceType, computeSha256Hex,
} from "@guardora/core";
import { createHash } from "node:crypto";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throws(l: string, fn: () => Promise<unknown>, kind?: "forbidden" | "notfound" | "input") {
  try { await fn(); check(l, false, "did not throw"); }
  catch (e) {
    const ok = !kind || (kind === "forbidden" && e instanceof ChildSafetyEvidenceForbiddenError) || (kind === "notfound" && e instanceof ChildSafetyEvidenceNotFoundError) || (kind === "input" && !(e instanceof ChildSafetyEvidenceForbiddenError) && !(e instanceof ChildSafetyEvidenceNotFoundError));
    check(l, ok, `wrong error: ${(e as Error)?.message}`);
  }
}
const sha = (s: string | Uint8Array) => createHash("sha256").update(typeof s === "string" ? Buffer.from(s) : Buffer.from(s)).digest("hex");

const sfx = `csev_${process.pid}`;
const tids: string[] = [];
let k = 0;
async function seed() {
  const id = `f${k++}_${sfx}`; tids.push(id);
  await systemDb.tenant.create({ data: { id, name: id, slug: id, workspaceKind: WorkspaceKind.Family, plan: "family_free" } });
  const uOwner = (await systemDb.user.create({ data: { id: `uo_${id}`, email: `uo_${id}@t.local` } })).id;
  await systemDb.membership.create({ data: { userId: uOwner, tenantId: id, role: "owner" as never } });
  const profileId = (await systemDb.protectedProfile.create({ data: { tenantId: id, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  const at = new Date();
  const s = await systemDb.safetySignal.create({ data: { tenantId: id, protectedProfileId: profileId, signalType: RiskType.Grooming, severity: SafetySeverity.High, confidenceBand: "high", sourceType: "platform_partner" } });
  const r = await correlateAndLinkSignal({ tenantId: id, protectedProfileId: profileId, safetySignalId: s.id, riskFamily: riskFamilyOf(RiskType.Grooming), severity: "high", urgency: "elevated", signalAt: at, windowMs: INCIDENT_CORRELATION_WINDOW_MS });
  return { tenantId: id, ownerUserId: uOwner, incidentId: r.incidentId };
}
const actor = (tenantId: string, userId: string, role: Role): EvidenceActor => ({ tenantId, userId, role });

async function main() {
  const f = await seed();
  const owner = actor(f.tenantId, f.ownerUserId, Role.Owner);
  const reviewer = actor(f.tenantId, f.ownerUserId, Role.Reviewer);
  const analyst = actor(f.tenantId, f.ownerUserId, Role.Analyst);
  const viewer = actor(f.tenantId, f.ownerUserId, Role.Viewer);

  // ── A. creation of all 5 types + upload ────────────────────────────
  console.log("\nA. evidence creation (5 types) + upload");
  const fileBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5]); // pretend PNG
  const fileEv = await createChildSafetyEvidence(reviewer, { incidentId: f.incidentId, type: ChildSafetyEvidenceType.UploadedFile, label: "chat.png", bytes: fileBytes, mimeType: "image/png" });
  check("★ uploaded_file → stored + hashed, chainPosition 1", fileEv.chainPosition === 1);
  const stored = await systemDb.childSafetyEvidence.findUnique({ where: { id: fileEv.evidenceId } });
  check("★ file bytes stored in secure storage (storageKey set, hash = sha256(bytes))", !!stored?.storageKey && stored?.contentHash === sha(fileBytes) && stored?.sizeBytes === fileBytes.length);
  const shot = await createChildSafetyEvidence(reviewer, { incidentId: f.incidentId, type: ChildSafetyEvidenceType.Screenshot, bytes: new Uint8Array([9, 8, 7]), mimeType: "image/png" });
  const url = await createChildSafetyEvidence(reviewer, { incidentId: f.incidentId, type: ChildSafetyEvidenceType.ExternalUrl, url: "https://example.com/report" });
  const man = await createChildSafetyEvidence(reviewer, { incidentId: f.incidentId, type: ChildSafetyEvidenceType.Manual, bodyText: "Reviewer observed grooming pattern." });
  const sys = await createChildSafetyEvidence(reviewer, { incidentId: f.incidentId, type: ChildSafetyEvidenceType.System, bodyText: "System snapshot.", system: true });
  check("★ chain positions are 1..5 gap-free", shot.chainPosition === 2 && url.chainPosition === 3 && man.chainPosition === 4 && sys.chainPosition === 5);
  const sysRow = await systemDb.childSafetyEvidence.findUnique({ where: { id: sys.evidenceId } });
  check("★ system evidence has source=system + no uploader", sysRow?.sourceType === "system" && sysRow?.uploaderUserId === null);
  const urlRow = await systemDb.childSafetyEvidence.findUnique({ where: { id: url.evidenceId } });
  check("★ external_url stored + hash over url + verified", urlRow?.externalUrl === "https://example.com/report" && urlRow?.contentHash === sha("https://example.com/report") && urlRow?.integrityStatus === "verified");
  const list = await listChildSafetyEvidence(owner, f.incidentId);
  check("★ list returns 5 items ordered by chain, NO storageKey exposed", list.length === 5 && list.every((e, i) => e.chainPosition === i + 1) && !JSON.stringify(list).includes("storageKey"));
  await throws("★ file without bytes rejected", () => createChildSafetyEvidence(reviewer, { incidentId: f.incidentId, type: ChildSafetyEvidenceType.UploadedFile }), "input");
  await throws("★ invalid url rejected", () => createChildSafetyEvidence(reviewer, { incidentId: f.incidentId, type: ChildSafetyEvidenceType.ExternalUrl, url: "javascript:alert(1)" }), "input");
  await throws("★ empty manual text rejected", () => createChildSafetyEvidence(reviewer, { incidentId: f.incidentId, type: ChildSafetyEvidenceType.Manual, bodyText: "   " }), "input");

  // ── B. custody chain ───────────────────────────────────────────────
  console.log("\nB. chain of custody (append-only)");
  const cust0 = await listChildSafetyEvidenceCustody(owner, fileEv.evidenceId);
  check("★ create appended a 'created' custody event", cust0.length === 1 && cust0[0]?.eventType === "created");
  check("★ getChildSafetyEvidence returns evidence + custody", (await getChildSafetyEvidence(owner, fileEv.evidenceId)).custody.length >= 1);

  // ── C. preview authorization ───────────────────────────────────────
  console.log("\nC. preview authorization");
  const prev = await previewChildSafetyEvidence(reviewer, fileEv.evidenceId);
  check("★ preview returns bytes for a previewable image", !!prev.bytes && prev.mimeType === "image/png");
  check("★ preview appended a 'reviewed' custody event", (await listChildSafetyEvidenceCustody(owner, fileEv.evidenceId)).some((e) => e.eventType === "reviewed"));
  await throws("★ analyst cannot preview (forbidden)", () => previewChildSafetyEvidence(analyst, fileEv.evidenceId), "forbidden");
  await throws("★ viewer cannot preview (forbidden)", () => previewChildSafetyEvidence(viewer, fileEv.evidenceId), "forbidden");

  // ── D. download authorization ──────────────────────────────────────
  console.log("\nD. download authorization (audited)");
  const dl = await downloadChildSafetyEvidence(reviewer, fileEv.evidenceId);
  check("★ download returns the exact stored bytes + safe filename (no storage path)", sha(dl.bytes) === sha(fileBytes) && dl.filename.startsWith("evidence-0001-") && !dl.filename.includes("/"));
  check("★ download appended a 'referenced' custody event + audit", (await listChildSafetyEvidenceCustody(owner, fileEv.evidenceId)).some((e) => e.eventType === "referenced") && (await systemDb.auditLog.count({ where: { tenantId: f.tenantId, targetId: fileEv.evidenceId, event: "child_safety.evidence.downloaded" } })) === 1);
  const dlMan = await downloadChildSafetyEvidence(reviewer, man.evidenceId);
  check("★ manual evidence downloads as its text", new TextDecoder().decode(dlMan.bytes) === "Reviewer observed grooming pattern.");
  await throws("★ external_url is not downloadable", () => downloadChildSafetyEvidence(reviewer, url.evidenceId), "input");
  await throws("★ analyst cannot download (forbidden)", () => downloadChildSafetyEvidence(analyst, fileEv.evidenceId), "forbidden");

  // ── E. integrity verification ──────────────────────────────────────
  console.log("\nE. integrity verification");
  check("★ verify file → reads storage, matches → verified", (await verifyChildSafetyEvidenceIntegrity(reviewer, fileEv.evidenceId)).integrityStatus === "verified");
  check("★ verify manual (self-contained) → verified", (await verifyChildSafetyEvidenceIntegrity(reviewer, man.evidenceId)).integrityStatus === "verified");
  await systemDb.childSafetyEvidence.update({ where: { id: shot.evidenceId }, data: { contentHash: "deadbeef" } }); // tamper the recorded hash
  check("★ tampered hash → verify FAILS (fail-closed)", (await verifyChildSafetyEvidenceIntegrity(reviewer, shot.evidenceId)).integrityStatus === "failed");
  check("★ verify appended 'verified' custody events", (await listChildSafetyEvidenceCustody(owner, fileEv.evidenceId)).some((e) => e.eventType === "verified"));
  await throws("★ analyst cannot verify (forbidden)", () => verifyChildSafetyEvidenceIntegrity(analyst, fileEv.evidenceId), "forbidden");

  // ── F. seal ────────────────────────────────────────────────────────
  console.log("\nF. seal");
  check("★ seal marks sealed + custody 'sealed'", (await sealChildSafetyEvidence(reviewer, man.evidenceId, "final")).sealed === true && (await listChildSafetyEvidenceCustody(owner, man.evidenceId)).some((e) => e.eventType === "sealed"));
  check("★ seal is idempotent", (await sealChildSafetyEvidence(reviewer, man.evidenceId)).sealed === true);

  // ── G. deterministic export ────────────────────────────────────────
  console.log("\nG. deterministic export package");
  const snapshot = { incident: { id: "i", status: "open", severity: "high", urgency: "elevated", riskFamily: "grooming", signalCount: 1, openedAt: "2026-01-01T00:00:00.000Z" }, items: [{ id: "e2", evidenceType: "manual", sourceType: "reviewer_upload", label: null, mimeType: null, sizeBytes: null, contentHash: sha("b"), hashAlgorithm: "sha256", integrityStatus: "verified", sealed: false, uploaderUserId: "u", externalUrl: null, capturedAt: "2026-01-01T00:00:00.000Z", chainPosition: 2, file: new TextEncoder().encode("b"), fileName: "files/e2.txt" }, { id: "e1", evidenceType: "manual", sourceType: "reviewer_upload", label: null, mimeType: null, sizeBytes: null, contentHash: sha("a"), hashAlgorithm: "sha256", integrityStatus: "verified", sealed: false, uploaderUserId: "u", externalUrl: null, capturedAt: "2026-01-01T00:00:00.000Z", chainPosition: 1, file: new TextEncoder().encode("a"), fileName: "files/e1.txt" }], custodyByEvidence: {} };
  const z1 = buildEvidencePackage(snapshot); const z2 = buildEvidencePackage(snapshot);
  check("★ buildEvidencePackage is DETERMINISTIC (byte-identical, order-independent)", sha(z1) === sha(z2) && z1.length > 0);
  check("★ zip has valid local-file-header + EOCD signatures", z1[0] === 0x50 && z1[1] === 0x4b && z1[2] === 0x03 && z1[3] === 0x04);
  const exp = await exportChildSafetyEvidencePackage(owner, f.incidentId);
  check("★ export produces a non-empty ZIP for all 5 items", exp.count === 5 && exp.bytes.length > 0 && exp.filename === `evidence-package-${f.incidentId}.zip`);
  check("★ export appended an 'exported' custody event to items", (await listChildSafetyEvidenceCustody(owner, fileEv.evidenceId)).some((e) => e.eventType === "exported"));
  const zipText = Buffer.from(exp.bytes).toString("latin1");
  check("★ export ZIP contains manifest/hashes/custody/metadata + never a storage key", zipText.includes("manifest.json") && zipText.includes("hashes.txt") && zipText.includes("custody-log.json") && zipText.includes("metadata.json") && !zipText.includes(stored!.storageKey!));
  await throws("★ analyst cannot export (forbidden)", () => exportChildSafetyEvidencePackage(analyst, f.incidentId), "forbidden");

  // ── H. tenant isolation ────────────────────────────────────────────
  console.log("\nH. tenant isolation");
  const g = await seed();
  const gOwner = actor(g.tenantId, g.ownerUserId, Role.Owner);
  await throws("★ cross-tenant evidence detail → not found", () => getChildSafetyEvidence(gOwner, fileEv.evidenceId), "notfound");
  await throws("★ cross-tenant download → not found", () => downloadChildSafetyEvidence(gOwner, fileEv.evidenceId), "notfound");
  await throws("★ cross-tenant list (other incident) → not found", () => listChildSafetyEvidence(gOwner, f.incidentId), "notfound");
  check("★ list is tenant-scoped (tenant g sees none of tenant f's evidence)", (await listChildSafetyEvidence(gOwner, g.incidentId)).length === 0);

  // ── I. permission failures ─────────────────────────────────────────
  console.log("\nI. permission failures");
  await throws("★ analyst cannot list (forbidden)", () => listChildSafetyEvidence(analyst, f.incidentId), "forbidden");
  await throws("★ viewer cannot create (forbidden)", () => createChildSafetyEvidence(viewer, { incidentId: f.incidentId, type: ChildSafetyEvidenceType.Manual, bodyText: "x" }), "forbidden");
  await throws("★ analyst cannot seal (forbidden)", () => sealChildSafetyEvidence(analyst, fileEv.evidenceId), "forbidden");
  check("★ all evidence audit is content-free (no raw content markers)", !JSON.stringify(await systemDb.auditLog.findMany({ where: { tenantId: f.tenantId, targetType: "child_safety_evidence" } })).match(/transcript|message|secret|password/i));
}

main()
  .then(async () => {
    for (const id of tids) { for (const t of ["childSafetyEvidenceCustodyEvent", "childSafetyEvidence", "childSafetyReviewEvent", "childSafetyReviewerNote", "childSafetyEscalation", "childSafetyIncidentSignal", "childSafetyIncident", "childSafetyIntervention", "safetySignal", "auditLog", "membership", "protectedProfile"] as const) { await (systemDb as never as Record<string, { deleteMany: (a: unknown) => Promise<unknown> }>)[t].deleteMany({ where: { tenantId: id } }).catch(() => {}); } await systemDb.user.deleteMany({ where: { email: { endsWith: `_${id}@t.local` } } }).catch(() => {}); await systemDb.tenant.delete({ where: { id } }).catch(() => {}); }
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Evidence Management V1: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => { console.error("FATAL:", e?.stack ?? e?.message ?? e); for (const id of tids) await systemDb.tenant.delete({ where: { id } }).catch(() => {}); process.exit(1); });
