/**
 * Cyberbullying Protection — C7 Secure Evidence Upload (domain).
 *
 * PURE + crypto-free (client-safe via the `@guardora/core/cyberbullying-evidence-upload`
 * subpath): the allowlist, size/count limits, retention default, attachable-status
 * rule, magic-byte sniffing, dangerous-signature detection, filename sanitization,
 * and the single fail-closed `validateEvidenceFile`. The server passes real bytes
 * (authoritative); the client may pre-check type/size only. No IO, no node APIs.
 */

import { IncidentLifecycleStatus } from "./security";
import { EvidenceType } from "./cyberbullying-evidence";

// --- Allowlist + limits (server-authoritative; client mirrors for UX) -------

/** MIME allowlist. Conservative C7 scope: images + PDF + plain text. Video/audio
 *  are intentionally EXCLUDED (a whole-file in-memory buffer per file makes 50 MB
 *  media unsafe on the current runtime — documented, deferred). */
export const EVIDENCE_ALLOWED_MIME = [
  "image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain",
] as const;
export type EvidenceAllowedMime = (typeof EVIDENCE_ALLOWED_MIME)[number];

export function isAllowedEvidenceMime(mime: string): mime is EvidenceAllowedMime {
  return (EVIDENCE_ALLOWED_MIME as readonly string[]).includes(mime);
}

export type EvidenceMimeCategory = "image" | "document" | "text";
/** Coarse category — the ONLY MIME info that may enter an audit payload. */
export function evidenceMimeCategory(mime: string): EvidenceMimeCategory {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "document";
  return "text";
}

const MB = 1024 * 1024;
export const EVIDENCE_SIZE_LIMITS = { image: 10 * MB, document: 15 * MB, text: 15 * MB } as const;
export const EVIDENCE_MAX_FILES = 5;
export const EVIDENCE_MAX_TOTAL_BYTES = 60 * MB;
/** Absolute hard request ceiling for the route handler's content-length guard. */
export const EVIDENCE_REQUEST_HARD_CAP_BYTES = 75 * MB;

export function evidenceSizeLimitFor(mime: string): number {
  return EVIDENCE_SIZE_LIMITS[evidenceMimeCategory(mime)];
}

/** Default retention window applied by the SERVER. The client can never set this. */
export const DEFAULT_EVIDENCE_RETENTION_DAYS = 365;

/** Map an allowed MIME to its C2 EvidenceType. */
export function evidenceTypeForMime(mime: string): EvidenceType {
  return mime.startsWith("image/") ? EvidenceType.Screenshot : EvidenceType.File;
}

// --- Attachable lifecycle statuses (C0/C3 — no evidence on a closed case) ----

/** Evidence may be attached only to an active case — never a resolved/terminal one. */
export const EVIDENCE_ATTACHABLE_STATUSES: readonly IncidentLifecycleStatus[] = [
  IncidentLifecycleStatus.Open,
  IncidentLifecycleStatus.UnderReview,
  IncidentLifecycleStatus.Acknowledged,
  IncidentLifecycleStatus.Confirmed,
  IncidentLifecycleStatus.ActionRequired,
];
export function canAttachEvidenceToStatus(status: string): boolean {
  return (EVIDENCE_ATTACHABLE_STATUSES as readonly string[]).includes(status);
}

// --- Magic-byte sniffing + dangerous-signature detection (pure) -------------

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** Best-effort content-type sniff. Returns the canonical allowed MIME or null. */
export function sniffEvidenceMime(bytes: Uint8Array): EvidenceAllowedMime | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(bytes, ascii("%PDF-"))) return "application/pdf";
  return null; // text/plain has no magic — validated separately
}

/** Detect known-dangerous content regardless of the declared MIME. Returns a tag or null. */
export function detectDangerousSignature(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x4d, 0x5a])) return "executable";                    // MZ (PE/DOS)
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return "executable";        // ELF
  if (startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe])) return "executable";        // Mach-O universal / Java class
  if (startsWith(bytes, [0xfe, 0xed, 0xfa, 0xce]) || startsWith(bytes, [0xfe, 0xed, 0xfa, 0xcf])) return "executable"; // Mach-O
  if (startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe]) || startsWith(bytes, [0xce, 0xfa, 0xed, 0xfe])) return "executable"; // Mach-O
  if (startsWith(bytes, [0x23, 0x21])) return "script";                        // #! shebang
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])) return "archive"; // ZIP/office/jar
  if (startsWith(bytes, [0x1f, 0x8b])) return "archive";                       // gzip
  if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21])) return "archive";           // RAR
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "archive"; // 7z
  // Markup that can carry active content (HTML/SVG). Look at the leading text window.
  const head = leadingText(bytes, 512).trimStart().toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<svg") ||
      (head.startsWith("<?xml") && head.includes("<svg"))) return "markup";
  return null;
}

/** Decode the leading `n` bytes as latin1-ish text for signature checks (no throw). */
function leadingText(bytes: Uint8Array, n: number): string {
  const len = Math.min(bytes.length, n);
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

/** Plain-text plausibility: no NUL byte and no dangerous signature in the leading window. */
export function looksLikePlainText(bytes: Uint8Array): boolean {
  const len = Math.min(bytes.length, 8192);
  for (let i = 0; i < len; i++) if (bytes[i] === 0x00) return false; // NUL ⇒ binary
  return detectDangerousSignature(bytes) === null;
}

// --- Filename sanitization --------------------------------------------------

/** Sanitize an uploaded filename to a safe basename, or null if unusable/suspicious. */
export function sanitizeEvidenceFilename(name: string): string | null {
  if (!name) return null;
  // Reject path separators / traversal / control chars outright (suspicious).
  if (/[\\/]/.test(name) || name.includes("..") || /[\x00-\x1f]/.test(name)) return null;
  const trimmed = name.trim().replace(/[^A-Za-z0-9._ ()\-]/g, "_").slice(0, 128);
  return trimmed.length ? trimmed : null;
}

// --- Single fail-closed file validator --------------------------------------

export type EvidenceUploadErrorCode =
  | "type" | "size" | "empty" | "too_many" | "total_size" | "mismatch" | "filename" | "malformed";

export interface EvidenceFileInput {
  filename: string;
  declaredMime: string;
  size: number;
  /** Present ONLY server-side. The client validates type/size/filename without bytes. */
  bytes?: Uint8Array;
}

/**
 * Validate ONE file. Fail-closed. `bytes` present ⇒ full server check (magic sniff,
 * dangerous-signature, declared/sniffed mismatch, plain-text plausibility). Returns
 * the first error code, or null when valid.
 */
export function validateEvidenceFile(f: EvidenceFileInput): EvidenceUploadErrorCode | null {
  if (sanitizeEvidenceFilename(f.filename) === null) return "filename";
  if (!isAllowedEvidenceMime(f.declaredMime)) return "type";
  if (f.size <= 0) return "empty";
  if (f.size > evidenceSizeLimitFor(f.declaredMime)) return "size";

  if (f.bytes) {
    if (f.bytes.length === 0) return "empty";
    if (detectDangerousSignature(f.bytes)) return "type";
    const sniffed = sniffEvidenceMime(f.bytes);
    if (f.declaredMime === "text/plain") {
      if (sniffed !== null || !looksLikePlainText(f.bytes)) return "mismatch";
    } else if (sniffed !== f.declaredMime) {
      return "mismatch"; // declared image/pdf must match the real magic bytes
    }
  }
  return null;
}

/** Validate the whole batch (count + total size). Returns a code or null. */
export function validateEvidenceBatch(files: { size: number }[]): EvidenceUploadErrorCode | null {
  if (files.length === 0) return "malformed";
  if (files.length > EVIDENCE_MAX_FILES) return "too_many";
  const total = files.reduce((s, f) => s + Math.max(0, f.size), 0);
  if (total > EVIDENCE_MAX_TOTAL_BYTES) return "total_size";
  return null;
}
