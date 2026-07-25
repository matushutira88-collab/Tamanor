/**
 * CS-C3/CS-C6 — the ONE canonical serialization + signing procedure shared by the SDK (producer) and
 * the Privacy Gateway (verifier). CS-C0 leaves the algorithm open (the envelope only declares a
 * `signature` string), so this defines it explicitly: HMAC-SHA-256 over a deterministic serialization
 * of the envelope with the `signature` field excluded. Algorithm + version are encoded in the
 * signature string itself (`hmac-sha256:v1:<hex>`) so unsupported algorithms are rejected, not
 * silently trusted. Verification is constant-time. No secret ever appears in a return value or error.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SAFETY_SIGNING_ALGORITHM = "hmac-sha256";
export const SAFETY_SIGNING_VERSION = "v1";
const SIGNATURE_PREFIX = `${SAFETY_SIGNING_ALGORITHM}:${SAFETY_SIGNING_VERSION}:`;

/** Deterministic, recursively key-sorted JSON. Stable across producer/verifier for identical inputs. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Canonical bytes an envelope is signed over: the whole object EXCEPT the `signature` field. */
export function canonicalizeEnvelope(envelope: Record<string, unknown>): string {
  const rest: Record<string, unknown> = {};
  for (const k of Object.keys(envelope)) if (k !== "signature") rest[k] = envelope[k];
  return stableStringify(rest);
}

/** Produce the canonical signature string for an envelope with the given installation secret. */
export function signEnvelope(envelope: Record<string, unknown>, secret: string): string {
  const mac = createHmac("sha256", secret).update(canonicalizeEnvelope(envelope)).digest("hex");
  return `${SIGNATURE_PREFIX}${mac}`;
}

export type SignatureVerifyReason = "malformed" | "unsupported_algorithm" | "mismatch";
export type SignatureVerifyResult = { ok: true } | { ok: false; reason: SignatureVerifyReason };

/**
 * Constant-time verification. Rejects a malformed signature, an unsupported algorithm/version prefix,
 * and a value mismatch. Never reveals the expected MAC or the secret.
 */
export function verifyEnvelopeSignature(envelope: Record<string, unknown>, secret: string): SignatureVerifyResult {
  const sig = envelope.signature;
  if (typeof sig !== "string" || sig.length === 0) return { ok: false, reason: "malformed" };
  if (!sig.startsWith(SIGNATURE_PREFIX)) {
    // A declared but different algorithm ("alg:ver:...") is unsupported; anything else is malformed.
    return { ok: false, reason: /^[a-z0-9-]+:[a-z0-9-]+:/i.test(sig) ? "unsupported_algorithm" : "malformed" };
  }
  const provided = sig.slice(SIGNATURE_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(provided)) return { ok: false, reason: "malformed" };
  const expected = createHmac("sha256", secret).update(canonicalizeEnvelope(envelope)).digest("hex");
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return { ok: false, reason: "mismatch" };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "mismatch" };
}

/** Whether an ISO timestamp is within ±skewMs of `now`. Used by the gateway for freshness/skew. */
export function isTimestampFresh(iso: string, now: Date, skewMs: number): { ok: boolean; reason?: "unparseable" | "expired" | "future" } {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return { ok: false, reason: "unparseable" };
  const delta = t - now.getTime();
  if (delta > skewMs) return { ok: false, reason: "future" };
  if (-delta > skewMs) return { ok: false, reason: "expired" };
  return { ok: true };
}
