import { createHash } from "node:crypto";
import { HashAlgorithm, EvidenceIntegrityStatus } from "@guardora/core";

/**
 * C2 — deterministic evidence integrity (SHA-256 ONLY). Server-side (node:crypto);
 * lives in @guardora/db so node:crypto never enters the pure core module or any
 * client bundle. Never recalculates or overwrites a hash silently — callers
 * compare and set an explicit {@link EvidenceIntegrityStatus}.
 */

/** Compute the lowercase hex SHA-256 of bytes or a UTF-8 string. Deterministic. */
export function computeSha256Hex(data: Uint8Array | string): string {
  const h = createHash("sha256");
  h.update(typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data));
  return h.digest("hex");
}

/** The single supported algorithm. */
export const EVIDENCE_HASH_ALGORITHM = HashAlgorithm.Sha256;

/** Hash contract shape returned by a hasher (mirrors core EvidenceHasher). */
export function hashEvidenceBytes(data: Uint8Array | string): { hash: string; algorithm: HashAlgorithm } {
  return { hash: computeSha256Hex(data), algorithm: HashAlgorithm.Sha256 };
}

/**
 * Verify stored bytes against a recorded hash. Returns an explicit status; does
 * NOT mutate anything. Only `sha256` is verifiable; any other algorithm → Failed
 * (fail-closed — never assume integrity for an unknown algorithm).
 */
export function verifyEvidenceIntegrity(
  recordedHash: string,
  algorithm: HashAlgorithm | string,
  actualBytes: Uint8Array | string,
): EvidenceIntegrityStatus {
  if (algorithm !== HashAlgorithm.Sha256) return EvidenceIntegrityStatus.Failed;
  return computeSha256Hex(actualBytes) === recordedHash
    ? EvidenceIntegrityStatus.Verified
    : EvidenceIntegrityStatus.Failed;
}
