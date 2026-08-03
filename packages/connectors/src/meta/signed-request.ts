/**
 * META-EXTERNAL-ACCESS-V1 — verification of Meta's `signed_request`.
 *
 * Meta posts a `signed_request` to the app's **data deletion** and **deauthorize** callbacks. It is
 * `base64url(HMAC-SHA256(payload, app_secret)) + "." + base64url(json_payload)`. Verifying it is the ONLY
 * thing that authenticates those callbacks — they carry no session, no bearer token and no IP guarantee, so a
 * forged POST must be rejected before any lookup or deletion happens.
 *
 * Reuses the SAME app-secret primitive as the rest of the Meta integration. The secret, the signature and the
 * raw payload are NEVER logged, returned, or embedded in an error — callers receive a bounded reason code and,
 * on success, only the app-scoped user id.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Bounded, secret-free rejection reasons. Safe for ops labels and safe to branch on. */
export type MetaSignedRequestReason =
  | "missing"          // no signed_request supplied
  | "malformed"        // not "<sig>.<payload>", or not decodable
  | "bad_algorithm"    // payload.algorithm is not HMAC-SHA256
  | "bad_signature"    // HMAC mismatch (forged or wrong app secret)
  | "no_user"          // verified, but the payload carries no user_id
  | "expired"          // payload issued_at is outside the accepted window
  | "not_configured";  // no app secret available to verify against

export type MetaSignedRequestResult =
  | { ok: true; userId: string; issuedAt: number | null }
  | { ok: false; reason: MetaSignedRequestReason };

/** Meta's documented algorithm value. Anything else is rejected (never downgraded). */
const REQUIRED_ALGORITHM = "HMAC-SHA256";
/** Reject a replayed payload older than this. Meta stamps `issued_at`; absent stamps are accepted. */
export const SIGNED_REQUEST_MAX_AGE_SECONDS = 24 * 60 * 60;

function base64UrlDecode(input: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) return null;
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(padded, "base64");
  } catch {
    return null;
  }
}

/**
 * Verify a Meta `signed_request` and extract the app-scoped user id.
 *
 * Fail-closed at every step: an absent secret, a malformed envelope, an unexpected algorithm, a signature
 * mismatch (compared in constant time), a missing user id or a stale `issued_at` all reject. Nothing about the
 * payload is returned except the user id and the timestamp.
 */
export function verifyMetaSignedRequest(
  signedRequest: string | null | undefined,
  appSecret: string | undefined,
  opts?: { now?: () => number; maxAgeSeconds?: number },
): MetaSignedRequestResult {
  if (!appSecret) return { ok: false, reason: "not_configured" };
  if (typeof signedRequest !== "string" || signedRequest.length === 0) return { ok: false, reason: "missing" };
  // Bound the input so a hostile body can never drive a large allocation/HMAC.
  if (signedRequest.length > 8192) return { ok: false, reason: "malformed" };

  const dot = signedRequest.indexOf(".");
  if (dot <= 0 || dot === signedRequest.length - 1) return { ok: false, reason: "malformed" };
  const encodedSig = signedRequest.slice(0, dot);
  const encodedPayload = signedRequest.slice(dot + 1);
  if (encodedPayload.includes(".")) return { ok: false, reason: "malformed" };

  const providedSig = base64UrlDecode(encodedSig);
  const payloadBytes = base64UrlDecode(encodedPayload);
  if (!providedSig || !payloadBytes || providedSig.length === 0) return { ok: false, reason: "malformed" };

  let payload: { algorithm?: unknown; user_id?: unknown; issued_at?: unknown };
  try {
    payload = JSON.parse(payloadBytes.toString("utf8")) as typeof payload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!payload || typeof payload !== "object") return { ok: false, reason: "malformed" };
  if (typeof payload.algorithm !== "string" || payload.algorithm.toUpperCase() !== REQUIRED_ALGORITHM) {
    return { ok: false, reason: "bad_algorithm" };
  }

  // Signature is computed over the ENCODED payload exactly as received.
  const expected = createHmac("sha256", appSecret).update(encodedPayload).digest();
  if (expected.length !== providedSig.length || !timingSafeEqual(expected, providedSig)) {
    return { ok: false, reason: "bad_signature" };
  }

  const userId = typeof payload.user_id === "string" && payload.user_id.length > 0 && payload.user_id.length <= 64
    ? payload.user_id
    : null;
  if (!userId) return { ok: false, reason: "no_user" };

  const issuedAt = typeof payload.issued_at === "number" && Number.isFinite(payload.issued_at) ? payload.issued_at : null;
  if (issuedAt !== null) {
    const nowSeconds = Math.floor((opts?.now?.() ?? Date.now()) / 1000);
    const maxAge = opts?.maxAgeSeconds ?? SIGNED_REQUEST_MAX_AGE_SECONDS;
    // Reject a stale stamp; a small clock skew into the future is tolerated.
    if (nowSeconds - issuedAt > maxAge || issuedAt - nowSeconds > 300) return { ok: false, reason: "expired" };
  }

  return { ok: true, userId, issuedAt };
}

/**
 * A stable, non-reversible reference code for a deletion request. Derived by HMAC over the app-scoped user id
 * with the app secret, so it is deterministic (a repeated request returns the SAME code — the callback is
 * idempotent) yet reveals nothing about the identity. Contains no PII and is safe to show publicly.
 */
export function metaDeletionConfirmationCode(userId: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(`meta:deletion:${userId}`).digest("hex").slice(0, 24);
}
