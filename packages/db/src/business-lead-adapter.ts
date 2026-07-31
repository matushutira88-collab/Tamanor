/**
 * BUSINESS — provider LEAD-INGESTION adapter contract (server-only). ONE internal contract for all providers,
 * rather than four unrelated implementations. Each adapter: identifies its provider, verifies the request
 * signature (constant-time HMAC), parses with a STRICT bounded schema, normalizes to one internal
 * `BusinessContactInput`, and declares a stable idempotency identity + provider-safe error mapping.
 *
 * TRUTHFULNESS: the four real providers (Meta/Google/TikTok/LinkedIn) are NOT activated here — their exact
 * webhook headers/signatures/OAuth scopes require official credentials + provider approval that are unavailable,
 * so their adapters are declared but marked unavailable. The DETERMINISTIC TEST adapter below proves the shared
 * architecture and one complete safe ingestion path (verify → parse → normalize → idempotent insert → event)
 * using a real HMAC-SHA256 signature over a fixture — never an unsigned/mocked "accepted".
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { BusinessProvider, BusinessContactSource, BusinessIngestionResult } from "@guardora/core";
import type { BusinessContactInput } from "./business-contacts-repo";

/** Max accepted body size (bytes) — oversized payloads are rejected before parsing. */
export const MAX_LEAD_BODY_BYTES = 64 * 1024;

export type AdapterFailure =
  | BusinessIngestionResult.InvalidSignature
  | BusinessIngestionResult.InvalidPayload
  | BusinessIngestionResult.Rejected;

export interface AdapterVerifyInput {
  rawBody: string;
  headers: Record<string, string | undefined>;
  /** The shared secret for this tenant+provider. Never logged. */
  secret: string;
}

export interface AdapterParseResult {
  /** Stable provider event id for idempotency/audit (null if the provider gives none). */
  providerEventId: string | null;
  contact: BusinessContactInput;
}

export interface BusinessLeadAdapter {
  provider: BusinessProvider;
  /** True only when a live, credential-backed integration is genuinely implemented (all false in this checkpoint). */
  live: boolean;
  /** Constant-time signature verification. Returns true only for a valid signature over the exact raw body. */
  verifySignature(input: AdapterVerifyInput): boolean;
  /** Strict parse + normalize. Throws nothing — returns a failure code or the parsed result. */
  parse(rawBody: string): { ok: true; value: AdapterParseResult } | { ok: false; reason: AdapterFailure };
}

/** Constant-time hex-HMAC compare (mirrors the Meta webhook `verifySignature` pattern). */
export function verifyHmacSha256(rawBody: string, providedHex: string | undefined, secret: string): boolean {
  if (!providedHex || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(providedHex.trim().toLowerCase(), "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * DETERMINISTIC TEST ADAPTER — a real, self-contained lead source used to prove the shared ingestion path end to
 * end. It is NOT a production provider (its `provider` is Meta for typing, but `live=false`). Signature: header
 * `x-tamanor-test-signature: sha256=<hex hmac of the raw body>`. Payload: strict JSON with an explicit field
 * allow-list; oversized/invalid JSON/missing required fields → invalid_payload. Never accepts an unsigned event.
 */
export const TEST_LEAD_ADAPTER: BusinessLeadAdapter = {
  provider: BusinessProvider.Meta,
  live: false,
  verifySignature({ rawBody, headers, secret }) {
    const header = headers["x-tamanor-test-signature"];
    const hex = header?.startsWith("sha256=") ? header.slice("sha256=".length) : undefined;
    return verifyHmacSha256(rawBody, hex, secret);
  },
  parse(rawBody) {
    if (Buffer.byteLength(rawBody, "utf8") > MAX_LEAD_BODY_BYTES) return { ok: false, reason: BusinessIngestionResult.Rejected };
    let obj: unknown;
    try { obj = JSON.parse(rawBody); } catch { return { ok: false, reason: BusinessIngestionResult.InvalidPayload }; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, reason: BusinessIngestionResult.InvalidPayload };
    const o = obj as Record<string, unknown>;
    const str = (k: string): string | null => (typeof o[k] === "string" && (o[k] as string).length <= 2048 ? (o[k] as string) : null);
    const leadId = str("leadId");
    // Require a stable external id OR enough to build a deterministic fingerprint.
    const receivedRaw = str("receivedAt");
    const receivedAt = receivedRaw ? new Date(receivedRaw) : new Date();
    if (Number.isNaN(receivedAt.getTime())) return { ok: false, reason: BusinessIngestionResult.InvalidPayload };
    const contact: BusinessContactInput = {
      provider: BusinessProvider.Meta,
      sourcePlatform: BusinessContactSource.WebForm,
      externalLeadId: leadId,
      contentFingerprint: str("fingerprint"),
      fullName: str("fullName"),
      email: str("email"),
      phone: str("phone"),
      company: str("company"),
      messageSummary: str("message"),
      campaignName: str("campaignName"),
      formName: str("formName"),
      receivedAt,
      // Consent is taken ONLY if explicitly present as a boolean — never inferred.
      consentValue: typeof o.consent === "boolean" ? (o.consent as boolean) : null,
      consentReference: str("consentReference"),
      consentVersion: str("consentVersion"),
    };
    if (!contact.externalLeadId && !contact.contentFingerprint && !contact.email) {
      return { ok: false, reason: BusinessIngestionResult.InvalidPayload };
    }
    return { ok: true, value: { providerEventId: leadId, contact } };
  },
};

/** Sign a raw body the way the test adapter expects — used by tests/fixtures only. */
export function signTestLeadBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}
