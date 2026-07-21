import { ActorKind, Prisma } from "@prisma/client";
import {
  Permission, Role, can, IncidentCategory, CYBERBULLYING_AUDIT_EVENTS,
  EvidenceScanStatus, EvidenceIntegrityStatus, EvidenceCustodyEventType,
  EvidenceSourceType, EvidenceCaptureMethod, HashAlgorithm,
  evidenceTypeForMime, evidenceMimeCategory, canAttachEvidenceToStatus,
  validateEvidenceFile, validateEvidenceBatch, DEFAULT_EVIDENCE_RETENTION_DAYS,
  type EvidenceUploadErrorCode, type IncidentActorContext,
} from "@guardora/core";
import { withTenant } from "./repositories";
import { hashEvidenceBytes, computeSha256Hex } from "./evidence-integrity";
import { putEvidenceObject, readEvidenceObject, deleteEvidenceObject, safeDeleteEvidenceObjects } from "./evidence-storage";
import { runEvidenceScan, isBlockingScanStatus, type AvMode } from "./evidence-antivirus";
import { linkEvidenceToIncidentTx } from "./cyberbullying-incident";

/**
 * C7 — the SINGLE authoritative server flow that stores uploaded files locally and
 * attaches them to a cyberbullying incident. One authorization boundary, then a
 * bounded batch. Fail-closed + all-or-nothing: files are written to local storage,
 * a single DB transaction creates StorageObject + IncidentEvidence + custody +
 * (C3) incident link + sanitized audit, and ANY failure triggers a compensating
 * filesystem cleanup (no orphan bytes, no partial DB state). Bytes never enter the
 * DB; hash/storageKey/filename never enter the audit. INFECTED / scan-failed files
 * are blocked outright (never usable evidence).
 */

const DOMAIN = IncidentCategory.Cyberbullying;
type Tx = Prisma.TransactionClient;

export type EvidenceScanBlock = "infected" | "scan_failed";
export type EvidenceUploadFailure =
  | { code: "forbidden" }
  | { code: "not_found" }
  | { code: "invalid_status" }
  | { code: "batch"; batchError: EvidenceUploadErrorCode }
  | { code: "validation"; fileErrors: { index: number; code: EvidenceUploadErrorCode }[] }
  | { code: "scan"; fileErrors: { index: number; code: EvidenceScanBlock }[] }
  | { code: "storage" }
  | { code: "hash" };

export class EvidenceUploadError extends Error {
  readonly code: string;
  constructor(public readonly failure: EvidenceUploadFailure) {
    super(`evidence upload rejected: ${failure.code}`);
    this.code = failure.code;
    this.name = "EvidenceUploadError";
  }
}

export interface EvidenceFileUpload { filename: string; declaredMime: string; bytes: Uint8Array }
export interface EvidenceUploadResult { created: number; duplicates: number; evidenceIds: string[] }

/** Load the incident + enforce cyberbullying domain, subject scope, and attachable status. */
async function loadAndAuthorizeIncident(db: Tx, actor: IncidentActorContext, incidentId: string): Promise<{ status: string }> {
  const inc = await db.incident.findFirst({
    where: { id: incidentId, tenantId: actor.tenantId, domain: DOMAIN },
    select: {
      status: true,
      cyberbullyingDetail: { select: { assignedReviewerUserId: true } },
      participants: { where: { userId: actor.userId }, select: { id: true } },
    },
  });
  if (!inc) throw new EvidenceUploadError({ code: "not_found" });
  const role = actor.role as Role;
  const tenantWide = role === Role.Owner || role === Role.Admin;
  const isParticipant = inc.participants.length > 0;
  const isAssignee = inc.cyberbullyingDetail?.assignedReviewerUserId === actor.userId;
  if (!tenantWide && !isParticipant && !isAssignee) throw new EvidenceUploadError({ code: "forbidden" }); // subject scope
  if (!canAttachEvidenceToStatus(inc.status)) throw new EvidenceUploadError({ code: "invalid_status" });
  return inc;
}

export async function uploadAndAttachIncidentEvidence(
  actor: IncidentActorContext,
  incidentId: string,
  files: EvidenceFileUpload[],
  opts: { avMode?: AvMode } = {},
): Promise<EvidenceUploadResult> {
  // (1-3) One authorization boundary: report/review permission (auditor/viewer denied).
  if (!can(actor.role as Role, Permission.CyberbullyingReview)) throw new EvidenceUploadError({ code: "forbidden" });

  // (8) Batch shape.
  const batchError = validateEvidenceBatch(files.map((f) => ({ size: f.bytes.length })));
  if (batchError) throw new EvidenceUploadError({ code: "batch", batchError });

  // (8) Per-file validation WITH bytes (magic sniff, dangerous-signature, mismatch).
  const fileErrors = files.flatMap((f, index) => {
    const code = validateEvidenceFile({ filename: f.filename, declaredMime: f.declaredMime, size: f.bytes.length, bytes: f.bytes });
    return code ? [{ index, code }] : [];
  });
  if (fileErrors.length) throw new EvidenceUploadError({ code: "validation", fileErrors });

  // (AV) Scan every file; block infected / scan_failed outright.
  const scans = files.map((f) => runEvidenceScan(f.bytes, opts.avMode));
  const scanErrors = scans.flatMap((r, index) => (isBlockingScanStatus(r.status)
    ? [{ index, code: (r.status === EvidenceScanStatus.Infected ? "infected" : "scan_failed") as EvidenceScanBlock }]
    : []));
  if (scanErrors.length) throw new EvidenceUploadError({ code: "scan", fileErrors: scanErrors });

  // (10) Hash from the real bytes (never a client-supplied hash).
  const hashes = files.map((f) => hashEvidenceBytes(f.bytes).hash);

  // (4-7) Authorize the incident + read existing hashes (dedup within incident).
  const existingHashes = await withTenant(actor.tenantId, async (db) => {
    await loadAndAuthorizeIncident(db, actor, incidentId);
    const rows = await db.incidentEvidence.findMany({ where: { incidentId, tenantId: actor.tenantId, deletedAt: null }, select: { contentHash: true } });
    return new Set(rows.map((r) => r.contentHash));
  });

  // Dedup (best-effort, tenant-scoped): same content already attached ⇒ skip, never overwrite.
  const seen = new Set<string>();
  const plan = files.map((f, i) => {
    const hash = hashes[i]!;
    const duplicate = existingHashes.has(hash) || seen.has(hash);
    seen.add(hash);
    return { f, hash, scan: scans[i]!, duplicate };
  });
  const toStore = plan.filter((p) => !p.duplicate);
  const duplicates = plan.length - toStore.length;

  // (9) Store non-duplicate bytes locally + read-back integrity verify. Track keys.
  const written: { p: (typeof toStore)[number]; storageKey: string; sizeBytes: number }[] = [];
  try {
    for (const p of toStore) {
      const blob = await putEvidenceObject(p.f.bytes);
      const readBack = await readEvidenceObject(blob.storageKey);
      if (!readBack || computeSha256Hex(readBack) !== p.hash) {
        await deleteEvidenceObject(blob.storageKey);
        throw new EvidenceUploadError({ code: "hash" });
      }
      written.push({ p, storageKey: blob.storageKey, sizeBytes: blob.sizeBytes });
    }
  } catch (e) {
    await safeDeleteEvidenceObjects(written.map((w) => w.storageKey)); // compensating cleanup
    throw e instanceof EvidenceUploadError ? e : new EvidenceUploadError({ code: "storage" });
  }

  // (11-18) One atomic DB transaction. On any failure, roll back AND clean up files.
  const evidenceIds: string[] = [];
  const retentionUntil = new Date(Date.now() + DEFAULT_EVIDENCE_RETENTION_DAYS * 86_400_000);
  try {
    await withTenant(actor.tenantId, async (db) => {
      const inc = await loadAndAuthorizeIncident(db, actor, incidentId); // re-assert inside the tx
      void inc;
      for (const w of written) {
        const mime = w.p.f.declaredMime;
        const so = await db.storageObject.create({ data: { tenantId: actor.tenantId, storageKey: w.storageKey, sizeBytes: w.sizeBytes, mimeType: mime } });
        const ev = await db.incidentEvidence.create({ data: {
          tenantId: actor.tenantId, incidentId: null, protectedSubjectId: null,
          evidenceType: evidenceTypeForMime(mime), sourceType: EvidenceSourceType.UserUpload, captureMethod: EvidenceCaptureMethod.UserUpload,
          capturedAt: new Date(), submittedByUserId: actor.userId,
          storageObjectId: so.id, mimeType: mime, sizeBytes: w.sizeBytes,
          contentHash: w.p.hash, hashAlgorithm: HashAlgorithm.Sha256,
          integrityStatus: EvidenceIntegrityStatus.Verified, // read-back verified above
          scanStatus: w.p.scan.status, // clean OR pending_scan (blocking statuses never reach here)
          retentionUntil, legalHold: false, // server-set policy; client can NEVER set these
        } });
        // Custody: append-only receipt (resultingHash belongs in the forensic ledger, NOT the audit).
        await db.evidenceCustodyEvent.create({ data: { tenantId: actor.tenantId, evidenceId: ev.id, eventType: EvidenceCustodyEventType.Uploaded, actorUserId: actor.userId, actorRole: actor.role, resultingHash: w.p.hash } });
        // C3 link (sets incidentId + timeline EvidenceLinked + audit evidence_linked).
        await linkEvidenceToIncidentTx(db, actor, incidentId, ev.id);
        // Sanitized upload audit — ids/category/size/status ONLY. NO filename/hash/storageKey/content.
        await db.auditLog.create({ data: {
          tenantId: actor.tenantId, event: CYBERBULLYING_AUDIT_EVENTS.evidenceUploaded, actorKind: ActorKind.human, actorUserId: actor.userId,
          targetType: "incident_evidence", targetId: ev.id,
          metadata: { incidentId, mimeCategory: evidenceMimeCategory(mime), sizeBytes: w.sizeBytes, scanStatus: w.p.scan.status, integrityStatus: EvidenceIntegrityStatus.Verified } as never,
        } });
        evidenceIds.push(ev.id);
      }
    });
  } catch (e) {
    await safeDeleteEvidenceObjects(written.map((w) => w.storageKey)); // rollback left the files ⇒ remove them
    throw e instanceof EvidenceUploadError ? e : new EvidenceUploadError({ code: "storage" });
  }

  return { created: evidenceIds.length, duplicates, evidenceIds };
}
