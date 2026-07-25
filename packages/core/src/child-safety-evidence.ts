/**
 * Child Safety Evidence Management V1 — pure evidence vocabulary + policy.
 *
 * A canonical evidence domain ON TOP of the canonical ChildSafetyIncident (CS-C15C). It is deliberately
 * SEPARATE from the cyberbullying evidence model (which is bound to the cyberbullying Incident /
 * ProtectedSubject — a CS-C0 boundary), while reusing the domain-agnostic storage + integrity primitives.
 * Everything here is deterministic and content-free (no raw child content; a reviewer's own manual note is
 * treated like an internal note, never a message transcript).
 */
import { Role } from "./tenant";
import { Permission, can } from "./permissions";
import { EvidenceIntegrityStatus, HashAlgorithm } from "./cyberbullying-evidence";
import { canViewChildSafetyReview, canManageChildSafetyReview } from "./child-safety-review";

// Re-export the shared integrity vocabulary so the child-safety evidence surface is self-contained.
export { EvidenceIntegrityStatus, HashAlgorithm };

/** The kinds of evidence a child-safety incident can carry. */
export enum ChildSafetyEvidenceType {
  UploadedFile = "uploaded_file",
  Screenshot = "screenshot",
  ExternalUrl = "external_url",
  Manual = "manual",   // reviewer-authored textual evidence (internal note-like)
  System = "system",   // system-generated (e.g. a snapshot the pipeline produced)
}
export const CHILD_SAFETY_EVIDENCE_TYPES: readonly ChildSafetyEvidenceType[] = Object.values(ChildSafetyEvidenceType);
export function isChildSafetyEvidenceType(v: string): v is ChildSafetyEvidenceType {
  return (CHILD_SAFETY_EVIDENCE_TYPES as readonly string[]).includes(v);
}
/** Whether this evidence type carries stored bytes (⇒ a storage object + real content hash). */
export function evidenceTypeHasFile(t: ChildSafetyEvidenceType): boolean {
  return t === ChildSafetyEvidenceType.UploadedFile || t === ChildSafetyEvidenceType.Screenshot;
}

/** Where the evidence came from. */
export enum ChildSafetyEvidenceSource {
  ReviewerUpload = "reviewer_upload",
  System = "system",
  External = "external",
}
export const CHILD_SAFETY_EVIDENCE_SOURCES: readonly ChildSafetyEvidenceSource[] = Object.values(ChildSafetyEvidenceSource);

/** Append-only chain-of-custody event kinds. */
export enum ChildSafetyEvidenceCustodyEventType {
  Created = "created",
  Verified = "verified",
  Reviewed = "reviewed",
  Referenced = "referenced",
  Exported = "exported",
  Sealed = "sealed",
}

/** Bounded, content-free audit event names for evidence operations (reuse the shared audit log). */
export const CHILD_SAFETY_EVIDENCE_AUDIT_EVENTS = {
  created: "child_safety.evidence.created",
  reviewed: "child_safety.evidence.reviewed",
  downloaded: "child_safety.evidence.downloaded",
  verified: "child_safety.evidence.verified",
  sealed: "child_safety.evidence.sealed",
  exported: "child_safety.evidence.exported",
} as const;

// ── Permissions — Owner / Administrator / Safety Reviewer only ────────────────
// Reads (list / detail / preview / download / custody) require review VIEW; writes (upload / verify /
// seal / export) require review MANAGE. Analyst / Viewer are excluded from both. Every download is
// audited regardless. A dedicated evidence-manage permission keeps the write surface explicit.

/** May read evidence (list, detail, preview, download, custody). */
export function canViewChildSafetyEvidence(role: Role): boolean {
  return canViewChildSafetyReview(role);
}
/** May write evidence (upload, verify, seal, export). */
export function canManageChildSafetyEvidence(role: Role): boolean {
  return can(role, Permission.ChildSafetyEvidenceManage) || canManageChildSafetyReview(role);
}

// ── Bounded limits ────────────────────────────────────────────────────────────
export const CHILD_SAFETY_EVIDENCE_MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file
export const CHILD_SAFETY_EVIDENCE_MAX_LABEL_LEN = 200;
export const CHILD_SAFETY_EVIDENCE_MANUAL_MAX_LEN = 8000;
export const CHILD_SAFETY_EVIDENCE_URL_MAX_LEN = 2000;

/** MIME types safe to inline-preview in the reviewer console. Everything else is download-only. */
const PREVIEWABLE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"]);
export function isPreviewableMime(mime: string | null | undefined): boolean {
  return !!mime && PREVIEWABLE_MIME.has(mime);
}

/** A safe, deterministic download/manifest filename for an evidence item (never the storage key/path). */
export function evidenceExportFilename(evidence: { chainPosition: number; evidenceType: string; id: string; mimeType?: string | null }): string {
  const ext = mimeExtension(evidence.mimeType);
  const pos = String(evidence.chainPosition).padStart(4, "0");
  return `evidence-${pos}-${evidence.id}${ext}`;
}
function mimeExtension(mime: string | null | undefined): string {
  switch (mime) {
    case "image/png": return ".png";
    case "image/jpeg": return ".jpg";
    case "image/gif": return ".gif";
    case "image/webp": return ".webp";
    case "application/pdf": return ".pdf";
    case "text/plain": return ".txt";
    default: return ".bin";
  }
}

/** Validate an external URL (http/https only, bounded length). Returns null if invalid. */
export function normalizeEvidenceUrl(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s || s.length > CHILD_SAFETY_EVIDENCE_URL_MAX_LEN) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch { return null; }
}
