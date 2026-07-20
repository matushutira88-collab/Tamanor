/**
 * S2 — Account-Takeover detection repository (DB integration, LOCAL Postgres only). Proves: dedup-aware
 * ingest (created → merged via the partial-unique guard), evidence sanitization on persist, strict tenant
 * isolation through `withTenant` (RLS), ATO-only listing, the validated status lifecycle (+ illegal/terminal
 * rejection), the dedupe guard freeing on a terminal status, cross-tenant safety, and audit writes.
 * Run: pnpm security-detection:test
 */
import { systemDb } from "../src/index";
import { ingestDetectionCandidate, listAtoDetections, countOpenAtoDetections, transitionAtoDetection } from "../src/security-detection";
import {
  SecurityDetectionKind, SecurityDetectionStatus, SecurityDetectionSubjectType, DetectionSource, RiskLevel,
  detectionDedupeKey, type DetectionCandidate,
} from "@guardora/core";

// LOCAL-DB SAFETY: refuse to run against anything but a local Postgres (never a remote/prod DB).
const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) {
  console.error(`REFUSING to run: DATABASE_URL is not a local database (${DB.replace(/:\/\/[^@]*@/, "://***@")})`);
  process.exit(1);
}

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
};

const cand = (over: Partial<DetectionCandidate> = {}): DetectionCandidate => ({
  subjectType: SecurityDetectionSubjectType.User, subjectId: "u1", brandId: null,
  kind: SecurityDetectionKind.NewDevice, severity: RiskLevel.High, confidence: 70, source: DetectionSource.Session,
  evidence: [{ code: "new_device_summary", detail: { token: "eyJabc.def.ghi", device: "Safari on macOS", count: 2 } }],
  dedupeKey: detectionDedupeKey({ kind: SecurityDetectionKind.NewDevice, subjectType: SecurityDetectionSubjectType.User, subjectId: "u1", scope: "dev1" }),
  ...over,
});

async function run() {
  const sfx = Date.now().toString(36);
  const A = await systemDb.tenant.create({ data: { name: "SdA", slug: `sd-a-${sfx}` } });
  const B = await systemDb.tenant.create({ data: { name: "SdB", slug: `sd-b-${sfx}` } });
  const reviewer = await systemDb.user.create({ data: { email: `rev-${sfx}@t.local` } });
  await systemDb.membership.create({ data: { userId: reviewer.id, tenantId: A.id } });

  try {
    // 1) dedup-aware ingest -------------------------------------------------------------------------
    const r1 = await ingestDetectionCandidate(A.id, cand(), "engine@s2");
    check("ingest → created (occurrenceCount 1)", r1.outcome === "created" && r1.occurrenceCount === 1);
    const r2 = await ingestDetectionCandidate(A.id, cand());
    check("ingest same dedupeKey → merged, same id, occurrenceCount 2", r2.outcome === "merged" && r2.id === r1.id && r2.occurrenceCount === 2);

    const rowsA = await listAtoDetections(A.id);
    check("list returns exactly ONE deduped detection", rowsA.length === 1);
    check("evidence is SANITIZED on persist (no token value)", !JSON.stringify(rowsA[0]!.evidence).includes("eyJabc"));
    check("safe evidence field survives (device)", JSON.stringify(rowsA[0]!.evidence).includes("Safari on macOS"));
    check("occurrenceCount persisted = 2", rowsA[0]!.occurrenceCount === 2);
    check("confidence + source persisted", rowsA[0]!.confidence === 70 && rowsA[0]!.source === DetectionSource.Session);

    // 2) tenant isolation ---------------------------------------------------------------------------
    check("tenant isolation: B sees 0 ATO detections", (await listAtoDetections(B.id)).length === 0);
    check("countOpen: A=1, B=0", (await countOpenAtoDetections(A.id)) === 1 && (await countOpenAtoDetections(B.id)) === 0);

    // 3) ATO-only listing (a brand-abuse row must NOT appear) ---------------------------------------
    await systemDb.securityDetection.create({ data: { tenantId: A.id, subjectType: "brand", subjectId: "br1", kind: SecurityDetectionKind.Impersonation, status: "open" } });
    check("list excludes non-ATO (brand-abuse) kinds", (await listAtoDetections(A.id)).length === 1);

    // 4) validated status lifecycle -----------------------------------------------------------------
    check("transition open→acknowledged ok", (await transitionAtoDetection(A.id, r1.id, SecurityDetectionStatus.Acknowledged, reviewer.id)).ok === true);
    check("transition acknowledged→resolved ok", (await transitionAtoDetection(A.id, r1.id, SecurityDetectionStatus.Resolved, reviewer.id, "handled")).ok === true);
    const resolved = (await listAtoDetections(A.id, { statuses: [SecurityDetectionStatus.Resolved] }))[0];
    check("resolved row has resolvedAt + status resolved", !!resolved?.resolvedAt && resolved!.status === SecurityDetectionStatus.Resolved);
    const illegal = await transitionAtoDetection(A.id, r1.id, SecurityDetectionStatus.Open, reviewer.id);
    check("illegal transition resolved→open rejected (terminal)", illegal.ok === false && !illegal.ok && illegal.reason === "terminal");

    // 5) the dedupe guard frees once terminal → a fresh ingest CREATES again -------------------------
    const r3 = await ingestDetectionCandidate(A.id, cand());
    check("terminal status frees (tenantId,dedupeKey) → new ingest CREATES", r3.outcome === "created" && r3.id !== r1.id);

    // 6) cross-tenant transition is impossible (RLS: B cannot see A's row) ---------------------------
    const cross = await transitionAtoDetection(B.id, r3.id, SecurityDetectionStatus.Acknowledged, reviewer.id);
    check("cross-tenant transition → not_found (RLS)", cross.ok === false && !cross.ok && cross.reason === "not_found");

    // 7) audit trail --------------------------------------------------------------------------------
    const audits = await systemDb.auditLog.count({ where: { tenantId: A.id, targetType: "security_detection" } });
    check("audit rows written (opened + lifecycle transitions)", audits >= 4);
  } finally {
    await systemDb.auditLog.deleteMany({ where: { tenantId: { in: [A.id, B.id] } } });
    await systemDb.securityDetection.deleteMany({ where: { tenantId: { in: [A.id, B.id] } } });
    await systemDb.membership.deleteMany({ where: { tenantId: A.id } });
    await systemDb.user.deleteMany({ where: { id: reviewer.id } });
    await systemDb.tenant.deleteMany({ where: { id: { in: [A.id, B.id] } } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — S2 detection repository (dedup, RLS, lifecycle)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error(String(e).slice(0, 400)); await systemDb.$disconnect(); process.exit(1); });
