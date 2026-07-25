/**
 * Child Safety Evidence Management V1 — the operational service (SYSTEM-scoped, systemDb).
 *
 * A canonical, IMMUTABLE evidence domain over the canonical ChildSafetyIncident. Reuses the domain-agnostic
 * secure storage (`putEvidenceObject`/`readEvidenceObject`) + sha256 integrity primitives. Every operation
 * is tenant-isolated (explicit tenantId + composite (id,tenantId) FKs — these are SYSTEM tables, so RLS is
 * not the enforcement), permission-checked, and appends an APPEND-ONLY chain-of-custody event + a
 * content-free audit entry. There is NO edit and NO delete path. Storage keys/paths are NEVER returned.
 */
import { ActorKind, Prisma } from "@prisma/client";
import {
  Role, EvidenceIntegrityStatus,
  ChildSafetyEvidenceType, ChildSafetyEvidenceSource, ChildSafetyEvidenceCustodyEventType,
  canViewChildSafetyEvidence, canManageChildSafetyEvidence, evidenceTypeHasFile, isChildSafetyEvidenceType,
  normalizeEvidenceUrl, evidenceExportFilename, isPreviewableMime,
  CHILD_SAFETY_EVIDENCE_AUDIT_EVENTS, CHILD_SAFETY_EVIDENCE_MAX_BYTES, CHILD_SAFETY_EVIDENCE_MAX_LABEL_LEN,
  CHILD_SAFETY_EVIDENCE_MANUAL_MAX_LEN,
} from "@guardora/core";
import { systemDb } from "./index";
import { putEvidenceObject, readEvidenceObject } from "./evidence-storage";
import { computeSha256Hex } from "./evidence-integrity";
import { buildDeterministicZip, type ZipEntry } from "./deterministic-zip";

export interface EvidenceActor { tenantId: string; userId: string; role: Role; }
export class ChildSafetyEvidenceForbiddenError extends Error { constructor(public readonly reason: string) { super("child_safety_evidence_forbidden"); } }
export class ChildSafetyEvidenceNotFoundError extends Error { constructor() { super("child_safety_evidence_not_found"); } }
class EvidenceInputError extends Error {}

function assertView(a: EvidenceActor): void { if (!canViewChildSafetyEvidence(a.role)) throw new ChildSafetyEvidenceForbiddenError("view"); }
function assertManage(a: EvidenceActor): void { if (!canManageChildSafetyEvidence(a.role)) throw new ChildSafetyEvidenceForbiddenError("manage"); }

async function audit(tenantId: string, actorUserId: string | null, event: string, evidenceId: string, metadata: Record<string, string | number | boolean>): Promise<void> {
  await systemDb.auditLog.create({ data: { tenantId, event, actorKind: actorUserId ? ActorKind.human : ActorKind.system, actorUserId, targetType: "child_safety_evidence", targetId: evidenceId, metadata: metadata as never } }).catch(() => {});
}
async function custody(tenantId: string, evidenceId: string, eventType: ChildSafetyEvidenceCustodyEventType, actorUserId: string | null, actorRole: string | null, reason?: string): Promise<void> {
  await systemDb.childSafetyEvidenceCustodyEvent.create({ data: { tenantId, evidenceId, eventType, actorUserId, actorRole, reason: reason ?? null } });
}
async function requireIncident(tenantId: string, incidentId: string) {
  const inc = await systemDb.childSafetyIncident.findFirst({ where: { id: incidentId, tenantId }, select: { id: true, status: true, severity: true, urgency: true, riskFamily: true, signalCount: true, openedAt: true } });
  if (!inc) throw new ChildSafetyEvidenceNotFoundError();
  return inc;
}
async function requireEvidence(tenantId: string, evidenceId: string) {
  const ev = await systemDb.childSafetyEvidence.findFirst({ where: { id: evidenceId, tenantId } });
  if (!ev) throw new ChildSafetyEvidenceNotFoundError();
  return ev;
}

// ── Create ────────────────────────────────────────────────────────────────────
export interface CreateEvidenceInput {
  incidentId: string;
  type: ChildSafetyEvidenceType;
  label?: string;
  bytes?: Uint8Array;      // file/screenshot
  mimeType?: string;       // file/screenshot
  url?: string;            // external_url
  bodyText?: string;       // manual/system
  system?: boolean;        // mark source=system (system-generated)
}

/** Create an immutable evidence record + its "created" custody event. Content-hashed on the way in. */
export async function createChildSafetyEvidence(actor: EvidenceActor, input: CreateEvidenceInput): Promise<{ evidenceId: string; chainPosition: number }> {
  assertManage(actor);
  if (!isChildSafetyEvidenceType(input.type)) throw new EvidenceInputError("invalid_type");
  const label = (input.label ?? "").trim().slice(0, CHILD_SAFETY_EVIDENCE_MAX_LABEL_LEN) || null;
  await requireIncident(actor.tenantId, input.incidentId);

  let storageKey: string | null = null, externalUrl: string | null = null, bodyText: string | null = null;
  let mimeType: string | null = null, sizeBytes: number | null = null, contentHash: string;
  let integrityStatus: string = EvidenceIntegrityStatus.Unverified;
  const sourceType = input.system ? ChildSafetyEvidenceSource.System : (input.type === ChildSafetyEvidenceType.ExternalUrl ? ChildSafetyEvidenceSource.External : ChildSafetyEvidenceSource.ReviewerUpload);

  if (evidenceTypeHasFile(input.type)) {
    if (!input.bytes || input.bytes.length === 0) throw new EvidenceInputError("file_required");
    if (input.bytes.length > CHILD_SAFETY_EVIDENCE_MAX_BYTES) throw new EvidenceInputError("file_too_large");
    contentHash = computeSha256Hex(input.bytes);
    const blob = await putEvidenceObject(input.bytes);
    storageKey = blob.storageKey; sizeBytes = blob.sizeBytes; mimeType = input.mimeType ?? "application/octet-stream";
    integrityStatus = EvidenceIntegrityStatus.Unverified; // requires a storage re-read to confirm
  } else if (input.type === ChildSafetyEvidenceType.ExternalUrl) {
    const u = normalizeEvidenceUrl(input.url ?? "");
    if (!u) throw new EvidenceInputError("invalid_url");
    externalUrl = u; contentHash = computeSha256Hex(u); integrityStatus = EvidenceIntegrityStatus.Verified;
  } else {
    // manual | system — reviewer/system-authored internal text (never a child message transcript)
    const text = (input.bodyText ?? "").trim();
    if (!text) throw new EvidenceInputError("text_required");
    if (text.length > CHILD_SAFETY_EVIDENCE_MANUAL_MAX_LEN) throw new EvidenceInputError("text_too_long");
    bodyText = text; contentHash = computeSha256Hex(text); integrityStatus = EvidenceIntegrityStatus.Verified;
  }

  // Assign the next chain position atomically; unique (incidentId, chainPosition) is the backstop.
  const created = await systemDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`csev:${actor.tenantId}:${input.incidentId}`}, 0))`;
    const last = await tx.childSafetyEvidence.findFirst({ where: { tenantId: actor.tenantId, incidentId: input.incidentId }, orderBy: { chainPosition: "desc" }, select: { chainPosition: true } });
    const chainPosition = (last?.chainPosition ?? 0) + 1;
    return tx.childSafetyEvidence.create({
      data: {
        tenantId: actor.tenantId, incidentId: input.incidentId, evidenceType: input.type, sourceType,
        label, storageKey, externalUrl, bodyText, mimeType, sizeBytes, contentHash, hashAlgorithm: "sha256",
        integrityStatus, chainPosition, uploaderUserId: input.system ? null : actor.userId,
      },
      select: { id: true, chainPosition: true },
    });
  });

  await custody(actor.tenantId, created.id, ChildSafetyEvidenceCustodyEventType.Created, input.system ? null : actor.userId, actor.role, sourceType);
  await audit(actor.tenantId, input.system ? null : actor.userId, CHILD_SAFETY_EVIDENCE_AUDIT_EVENTS.created, created.id, { type: input.type, chainPosition: created.chainPosition });
  return { evidenceId: created.id, chainPosition: created.chainPosition };
}

// ── Read (list / detail / custody) ──────────────────────────────────────────────
const PUBLIC_SELECT = { id: true, incidentId: true, evidenceType: true, sourceType: true, label: true, externalUrl: true, mimeType: true, sizeBytes: true, contentHash: true, hashAlgorithm: true, integrityStatus: true, chainPosition: true, uploaderUserId: true, sealed: true, sealedAt: true, capturedAt: true, createdAt: true } as const;

export interface EvidenceListInput { type?: string; source?: string; search?: string; }
export async function listChildSafetyEvidence(actor: EvidenceActor, incidentId: string, filters: EvidenceListInput = {}) {
  assertView(actor);
  await requireIncident(actor.tenantId, incidentId);
  const where: Record<string, unknown> = { tenantId: actor.tenantId, incidentId };
  if (filters.type) where.evidenceType = filters.type;
  if (filters.source) where.sourceType = filters.source;
  if (filters.search) where.OR = [{ id: filters.search }, { label: { contains: filters.search, mode: "insensitive" } }];
  const rows = await systemDb.childSafetyEvidence.findMany({ where, orderBy: [{ chainPosition: "asc" }], select: PUBLIC_SELECT });
  return rows.map(toPublic);
}
function toPublic(r: { id: string; incidentId: string; evidenceType: string; sourceType: string; label: string | null; externalUrl: string | null; mimeType: string | null; sizeBytes: number | null; contentHash: string; hashAlgorithm: string; integrityStatus: string; chainPosition: number; uploaderUserId: string | null; sealed: boolean; sealedAt: Date | null; capturedAt: Date; createdAt: Date }) {
  return {
    id: r.id, incidentId: r.incidentId, evidenceType: r.evidenceType, sourceType: r.sourceType, label: r.label,
    externalUrl: r.externalUrl, mimeType: r.mimeType, sizeBytes: r.sizeBytes, contentHash: r.contentHash,
    hashAlgorithm: r.hashAlgorithm, integrityStatus: r.integrityStatus, chainPosition: r.chainPosition,
    uploaderUserId: r.uploaderUserId, sealed: r.sealed, sealedAt: r.sealedAt?.toISOString() ?? null,
    capturedAt: r.capturedAt.toISOString(), createdAt: r.createdAt.toISOString(),
    previewable: isPreviewableMime(r.mimeType), downloadable: r.evidenceType === "uploaded_file" || r.evidenceType === "screenshot" || r.evidenceType === "manual" || r.evidenceType === "system",
  };
}

export async function listChildSafetyEvidenceCustody(actor: EvidenceActor, evidenceId: string) {
  assertView(actor);
  await requireEvidence(actor.tenantId, evidenceId);
  const rows = await systemDb.childSafetyEvidenceCustodyEvent.findMany({ where: { tenantId: actor.tenantId, evidenceId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, eventType: true, actorUserId: true, actorRole: true, reason: true, createdAt: true } });
  return rows.map((e) => ({ id: e.id, eventType: e.eventType, actorUserId: e.actorUserId, actorRole: e.actorRole, reason: e.reason, createdAt: e.createdAt.toISOString() }));
}

export async function getChildSafetyEvidence(actor: EvidenceActor, evidenceId: string) {
  assertView(actor);
  const ev = await requireEvidence(actor.tenantId, evidenceId);
  return { evidence: toPublic(ev), custody: await listChildSafetyEvidenceCustody(actor, evidenceId) };
}

// ── Preview (reviewed) + Download (referenced) ───────────────────────────────────
/** Preview an evidence item; appends a "reviewed" custody event. Returns bytes only for previewable files. */
export async function previewChildSafetyEvidence(actor: EvidenceActor, evidenceId: string): Promise<{ mimeType: string | null; bytes: Uint8Array | null; text: string | null; url: string | null }> {
  assertView(actor);
  const ev = await requireEvidence(actor.tenantId, evidenceId);
  let bytes: Uint8Array | null = null;
  if (ev.storageKey && isPreviewableMime(ev.mimeType)) bytes = await readEvidenceObject(ev.storageKey);
  await custody(actor.tenantId, evidenceId, ChildSafetyEvidenceCustodyEventType.Reviewed, actor.userId, actor.role);
  await audit(actor.tenantId, actor.userId, CHILD_SAFETY_EVIDENCE_AUDIT_EVENTS.reviewed, evidenceId, { type: ev.evidenceType });
  return { mimeType: ev.mimeType, bytes, text: ev.bodyText, url: ev.externalUrl };
}

/** Authorized download; appends a "referenced" custody event + a download audit. Storage path never exposed. */
export async function downloadChildSafetyEvidence(actor: EvidenceActor, evidenceId: string): Promise<{ filename: string; mimeType: string; bytes: Uint8Array }> {
  assertView(actor);
  const ev = await requireEvidence(actor.tenantId, evidenceId);
  let bytes: Uint8Array | null = null; let mimeType = ev.mimeType ?? "application/octet-stream";
  if (ev.storageKey) { bytes = await readEvidenceObject(ev.storageKey); }
  else if (ev.bodyText != null) { bytes = new TextEncoder().encode(ev.bodyText); mimeType = "text/plain"; }
  if (!bytes) throw new EvidenceInputError("not_downloadable");
  await custody(actor.tenantId, evidenceId, ChildSafetyEvidenceCustodyEventType.Referenced, actor.userId, actor.role);
  await audit(actor.tenantId, actor.userId, CHILD_SAFETY_EVIDENCE_AUDIT_EVENTS.downloaded, evidenceId, { type: ev.evidenceType, bytes: bytes.length });
  return { filename: evidenceExportFilename({ chainPosition: ev.chainPosition, evidenceType: ev.evidenceType, id: ev.id, mimeType: ev.mimeType }), mimeType, bytes };
}

// ── Verify integrity ─────────────────────────────────────────────────────────────
export async function verifyChildSafetyEvidenceIntegrity(actor: EvidenceActor, evidenceId: string): Promise<{ integrityStatus: string }> {
  assertManage(actor);
  const ev = await requireEvidence(actor.tenantId, evidenceId);
  let actual: string | null = null;
  if (ev.storageKey) { const b = await readEvidenceObject(ev.storageKey); actual = b ? computeSha256Hex(b) : null; }
  else if (ev.externalUrl != null) actual = computeSha256Hex(ev.externalUrl);
  else if (ev.bodyText != null) actual = computeSha256Hex(ev.bodyText);
  const status = actual !== null && actual === ev.contentHash ? EvidenceIntegrityStatus.Verified : EvidenceIntegrityStatus.Failed;
  await systemDb.childSafetyEvidence.update({ where: { id: evidenceId }, data: { integrityStatus: status } });
  await custody(actor.tenantId, evidenceId, ChildSafetyEvidenceCustodyEventType.Verified, actor.userId, actor.role, status);
  await audit(actor.tenantId, actor.userId, CHILD_SAFETY_EVIDENCE_AUDIT_EVENTS.verified, evidenceId, { integrityStatus: status });
  return { integrityStatus: status };
}

// ── Seal ─────────────────────────────────────────────────────────────────────────
export async function sealChildSafetyEvidence(actor: EvidenceActor, evidenceId: string, reason?: string): Promise<{ sealed: boolean }> {
  assertManage(actor);
  const ev = await requireEvidence(actor.tenantId, evidenceId);
  if (ev.sealed) return { sealed: true }; // idempotent
  await systemDb.childSafetyEvidence.update({ where: { id: evidenceId }, data: { sealed: true, sealedAt: new Date() } });
  await custody(actor.tenantId, evidenceId, ChildSafetyEvidenceCustodyEventType.Sealed, actor.userId, actor.role, reason);
  await audit(actor.tenantId, actor.userId, CHILD_SAFETY_EVIDENCE_AUDIT_EVENTS.sealed, evidenceId, {});
  return { sealed: true };
}

// ── Deterministic export package ─────────────────────────────────────────────────
function stableStringify(v: unknown): string {
  const seen = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(seen);
    if (x && typeof x === "object") return Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, seen((x as Record<string, unknown>)[k])]));
    return x;
  };
  return JSON.stringify(seen(v), null, 2);
}

/** A frozen, serializable snapshot of everything an export package needs (no DB, no clock). */
export interface EvidencePackageSnapshot {
  incident: { id: string; status: string; severity: string; urgency: string; riskFamily: string; signalCount: number; openedAt: string };
  items: Array<{ id: string; evidenceType: string; sourceType: string; label: string | null; mimeType: string | null; sizeBytes: number | null; contentHash: string; hashAlgorithm: string; integrityStatus: string; sealed: boolean; uploaderUserId: string | null; externalUrl: string | null; capturedAt: string; chainPosition: number; file: Uint8Array | null; fileName: string | null }>;
  custodyByEvidence: Record<string, Array<{ eventType: string; actorUserId: string | null; actorRole: string | null; reason: string | null; createdAt: string }>>;
}

/**
 * PURE, DETERMINISTIC evidence package builder. Given the same snapshot it returns byte-identical ZIP
 * bytes (stable JSON key order + fixed ZIP timestamps + stable entry order). No DB, no clock, no I/O.
 * Contains metadata.json, manifest.json, hashes.txt, custody-log.json and the selected files. Storage
 * keys/paths are never included.
 */
export function buildEvidencePackage(snapshot: EvidencePackageSnapshot): Uint8Array {
  const enc = new TextEncoder();
  const items = [...snapshot.items].sort((a, b) => a.chainPosition - b.chainPosition);
  const manifest = items.map((it) => ({
    chainPosition: it.chainPosition, id: it.id, evidenceType: it.evidenceType, sourceType: it.sourceType, label: it.label,
    mimeType: it.mimeType, sizeBytes: it.sizeBytes, contentHash: it.contentHash, hashAlgorithm: it.hashAlgorithm,
    integrityStatus: it.integrityStatus, sealed: it.sealed, uploaderUserId: it.uploaderUserId,
    externalUrl: it.externalUrl, capturedAt: it.capturedAt, file: it.fileName,
  }));
  const metadata = { incident: snapshot.incident, evidenceCount: items.length, hashAlgorithm: "sha256" };
  const hashes = manifest.map((m) => `${m.contentHash}  ${m.file ?? m.externalUrl ?? m.id}`).join("\n") + "\n";
  const entries: ZipEntry[] = [
    { name: "metadata.json", data: enc.encode(stableStringify(metadata)) },
    { name: "manifest.json", data: enc.encode(stableStringify(manifest)) },
    { name: "hashes.txt", data: enc.encode(hashes) },
    { name: "custody-log.json", data: enc.encode(stableStringify(snapshot.custodyByEvidence)) },
  ];
  for (const it of items) if (it.file && it.fileName) entries.push({ name: it.fileName, data: it.file });
  return buildDeterministicZip(entries);
}

/**
 * Build a deterministic evidence export ZIP for an incident (optionally a subset), then append an
 * "exported" custody event to each included item. The ZIP itself is produced by the pure
 * {@link buildEvidencePackage} from a snapshot taken BEFORE this export's custody events, so a given DB
 * state always yields identical bytes.
 */
export async function exportChildSafetyEvidencePackage(actor: EvidenceActor, incidentId: string, evidenceIds?: string[]): Promise<{ filename: string; bytes: Uint8Array; count: number }> {
  assertManage(actor);
  const incident = await requireIncident(actor.tenantId, incidentId);
  const where: Record<string, unknown> = { tenantId: actor.tenantId, incidentId };
  if (evidenceIds && evidenceIds.length) where.id = { in: evidenceIds };
  const items = await systemDb.childSafetyEvidence.findMany({ where, orderBy: [{ chainPosition: "asc" }] });
  if (items.length === 0) throw new EvidenceInputError("no_evidence");

  const custodyByEvidence: EvidencePackageSnapshot["custodyByEvidence"] = {};
  const snapItems: EvidencePackageSnapshot["items"] = [];
  for (const it of items) {
    const events = await systemDb.childSafetyEvidenceCustodyEvent.findMany({ where: { tenantId: actor.tenantId, evidenceId: it.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { eventType: true, actorUserId: true, actorRole: true, reason: true, createdAt: true } });
    custodyByEvidence[it.id] = events.map((e) => ({ eventType: e.eventType, actorUserId: e.actorUserId, actorRole: e.actorRole, reason: e.reason, createdAt: e.createdAt.toISOString() }));
    const fileName = it.storageKey ? `files/${evidenceExportFilename({ chainPosition: it.chainPosition, evidenceType: it.evidenceType, id: it.id, mimeType: it.mimeType })}` : it.bodyText != null ? `files/evidence-${String(it.chainPosition).padStart(4, "0")}-${it.id}.txt` : null;
    const file = it.storageKey ? await readEvidenceObject(it.storageKey) : it.bodyText != null ? new TextEncoder().encode(it.bodyText) : null;
    snapItems.push({ id: it.id, evidenceType: it.evidenceType, sourceType: it.sourceType, label: it.label, mimeType: it.mimeType, sizeBytes: it.sizeBytes, contentHash: it.contentHash, hashAlgorithm: it.hashAlgorithm, integrityStatus: it.integrityStatus, sealed: it.sealed, uploaderUserId: it.uploaderUserId, externalUrl: it.externalUrl, capturedAt: it.capturedAt.toISOString(), chainPosition: it.chainPosition, file, fileName });
  }

  const snapshot: EvidencePackageSnapshot = { incident: { id: incident.id, status: incident.status, severity: incident.severity, urgency: incident.urgency, riskFamily: incident.riskFamily, signalCount: incident.signalCount, openedAt: incident.openedAt.toISOString() }, items: snapItems, custodyByEvidence };
  const bytes = buildEvidencePackage(snapshot);

  for (const it of items) await custody(actor.tenantId, it.id, ChildSafetyEvidenceCustodyEventType.Exported, actor.userId, actor.role);
  await audit(actor.tenantId, actor.userId, CHILD_SAFETY_EVIDENCE_AUDIT_EVENTS.exported, incidentId, { count: items.length });
  return { filename: `evidence-package-${incidentId}.zip`, bytes, count: items.length };
}

void Prisma;
