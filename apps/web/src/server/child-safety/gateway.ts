// Server-internal service — imported only by the API route (apps/web/app/api/v1/child-safety/signals)
// and by local test scripts; never by a client component. (No `server-only` marker so it remains
// unit-testable under tsx; the route boundary is the server entry point.)
import { createHash } from "node:crypto";
import {
  validateSafetySignalEnvelope, verifyEnvelopeSignature, isTimestampFresh, canonicalizeEnvelope,
  SafetySignalSourceType, type ChildSafetyOutcome, SafetyConfidenceBand,
} from "@guardora/core";
import {
  authenticateChildSafetyInstallation, installationHasScope, CHILD_SAFETY_SIGNAL_SUBMIT_SCOPE,
  reserveIngestion, completeIngestion, ingestSafetySignalFromGateway, interveneOnAcceptedSafetySignal, systemDb,
  type ChildSafetyInstallationRecord, type InterventionResult,
} from "@guardora/db";

/**
 * CS-C6 — Privacy Gateway. Authenticated ingestion of a canonical, MINIMIZED, signed
 * {@link SafetySignalEnvelope}. It NEVER introduces a new envelope format, and the CS-C0 allowlist
 * validator already rejects every raw-content / unknown field — so conversation data can never enter.
 * Every failure returns a safe, stable external error code; no DB/Prisma error, stack trace, secret,
 * token, or raw content is ever exposed. Reuses the existing SafetySignal storage + the deterministic
 * policy decision; downstream notify/incident side-effects run through existing services.
 */

const MAX_BODY_BYTES = 16 * 1024;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const RATE_LIMIT = { max: 60, windowMs: 60 * 1000 };
const RECEIPT_SCHEMA_VERSION = "1";

export type GatewayErrorCode =
  | "unsupported_media_type" | "payload_too_large" | "malformed_json" | "invalid_envelope"
  | "unauthorized" | "forbidden_scope" | "installation_expired" | "installation_revoked"
  | "no_tenant_binding" | "application_mismatch" | "tenant_mismatch" | "protected_profile_mismatch"
  | "protected_profile_not_found" | "stale_timestamp" | "invalid_signature" | "replay_detected"
  | "idempotency_conflict" | "rate_limited" | "processing_error";

export type GatewayResult =
  | { status: 200 | 201 | 202; body: GatewayReceipt }
  | { status: 400 | 401 | 403 | 409 | 413 | 415 | 429 | 500; body: { accepted: false; error: GatewayErrorCode } };

export interface GatewayReceipt {
  accepted: true;
  receiptId: string;
  signalId: string | null;
  duplicate: boolean;
  outcome: ChildSafetyOutcome;
  /** "completed" once all required side effects ran; "processing" if a retryable failure left it resumable. */
  processingState: "completed" | "processing";
  receivedAt: string;
  schemaVersion: string;
}

export interface GatewayRequest {
  contentType?: string | null;
  bodyText: string;
  bearerToken?: string | null;
  applicationIdHeader?: string | null;
  idempotencyKey?: string | null;
  now?: Date;
}

/** The protective-intervention entry point invoked after persistence. Injectable for tests. */
export type InterveneFn = (input: { signalId: string; tenantId: string; now: Date }) => Promise<InterventionResult>;

// Simple deterministic per-installation limiter with a pluggable store (in-memory default). Fail-closed.
export interface RateLimiter {
  hit(key: string, now: number): boolean; // false = over limit
}
const memoryBuckets = new Map<string, number[]>();
const defaultRateLimiter: RateLimiter = {
  hit(key, now) {
    const cutoff = now - RATE_LIMIT.windowMs;
    const arr = (memoryBuckets.get(key) ?? []).filter((t) => t > cutoff);
    if (arr.length >= RATE_LIMIT.max) { memoryBuckets.set(key, arr); return false; }
    arr.push(now); memoryBuckets.set(key, arr); return true;
  },
};

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
const err = (status: GatewayResult extends { status: infer S } ? S : never, error: GatewayErrorCode): GatewayResult =>
  ({ status: status as 400, body: { accepted: false, error } });

/** Opaque, ≤64, [A-Za-z0-9_-] source reference derived from the envelope's pseudonymized actor hash. */
const toOpaqueRef = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return s.length ? s : null;
};

export interface GatewayDeps {
  /** Protective intervention entry point; defaults to the CS-C15 orchestrator. Injectable for tests. */
  intervene?: InterveneFn;
  rateLimiter?: RateLimiter;
  newReceiptId?: () => string;
}

export async function processSafetySignalIngestion(req: GatewayRequest, deps: GatewayDeps = {}): Promise<GatewayResult> {
  const now = req.now ?? new Date();
  const intervene = deps.intervene ?? interveneOnAcceptedSafetySignal;
  const rateLimiter = deps.rateLimiter ?? defaultRateLimiter;
  const newReceiptId = deps.newReceiptId ?? (() => `rcpt_${sha256(`${now.getTime()}:${Math.round(now.getTime())}`).slice(0, 24)}`);

  try {
    // 1-2. content-type + body size
    if (!req.contentType || !/^application\/json\b/i.test(req.contentType)) return err(415, "unsupported_media_type");
    if (Buffer.byteLength(req.bodyText, "utf8") > MAX_BODY_BYTES) return err(413, "payload_too_large");

    // 3. strict JSON
    let parsed: unknown;
    try { parsed = JSON.parse(req.bodyText); } catch { return err(400, "malformed_json"); }

    // 4-6. canonical allowlist validation (rejects unknown + forbidden raw-content fields)
    const validation = validateSafetySignalEnvelope(parsed);
    if (!validation.ok) return err(400, "invalid_envelope");
    const env = parsed as Record<string, unknown>;

    // 7. authenticate installation
    if (!req.bearerToken) return err(401, "unauthorized");
    const auth = await authenticateChildSafetyInstallation(req.bearerToken, now);
    if (!auth.ok) {
      if (auth.reason === "expired") return err(401, "installation_expired");
      if (auth.reason === "revoked") return err(401, "installation_revoked");
      return err(401, "unauthorized");
    }
    const inst: ChildSafetyInstallationRecord = auth.installation;

    // 8. scope
    if (!installationHasScope(inst, CHILD_SAFETY_SIGNAL_SUBMIT_SCOPE)) return err(403, "forbidden_scope");

    // 9-10. (expiration/revocation already validated in authenticate)
    // 10. tenant binding required to persist
    if (!inst.tenantId) return err(403, "no_tenant_binding");
    // application binding (optional header must match)
    if (req.applicationIdHeader && req.applicationIdHeader !== inst.applicationId) return err(403, "application_mismatch");

    // 11. protected-profile binding
    const envProfileRef = typeof env.protectedProfileReference === "string" ? env.protectedProfileReference : "";
    if (inst.subjectRef && envProfileRef !== inst.subjectRef) return err(403, "protected_profile_mismatch");
    const protectedProfileId = inst.subjectRef ?? envProfileRef;
    const profile = await systemDb.protectedProfile.findFirst({ where: { id: protectedProfileId, tenantId: inst.tenantId }, select: { id: true } }).catch(() => null);
    if (!profile) return err(403, "protected_profile_not_found");

    // 12. timestamp freshness / skew
    const fresh = isTimestampFresh(String(env.detectedAt), now, CLOCK_SKEW_MS);
    if (!fresh.ok) return err(400, "stale_timestamp");

    // 13-14. nonce present + signature verification (with the raw bearer token as HMAC key)
    if (typeof env.nonce !== "string" || env.nonce.length === 0) return err(400, "invalid_envelope");
    const sigCheck = verifyEnvelopeSignature(env, req.bearerToken);
    if (!sigCheck.ok) return err(401, "invalid_signature");

    // 17. per-installation rate limit (fail-closed on abusive volume; never keys on content)
    if (!rateLimiter.hit(`csi:${inst.id}`, now.getTime())) return err(429, "rate_limited");

    // 15-16. replay + idempotency (persistent, multi-instance safe). Reserve BEFORE creating a signal.
    const payloadHash = sha256(canonicalizeEnvelope(env));
    const receiptId = newReceiptId();
    const reservation = await reserveIngestion({
      installationId: inst.id, nonce: env.nonce, idempotencyKey: req.idempotencyKey ?? null, payloadHash, receiptId, now,
    });
    if (reservation.kind === "replay") return err(409, "replay_detected");
    if (reservation.kind === "conflict") return err(409, "idempotency_conflict");
    if (reservation.kind === "duplicate") {
      // Same idempotency key + same payload → original receipt; NO second signal created. RESUME an
      // incomplete intervention safely (the durable executor skips already-done steps); a completed
      // one returns its stored outcome with no side-effect re-runs.
      let outcome = reservation.record.outcome as ChildSafetyOutcome;
      let processingState: "completed" | "processing" = "completed";
      if (reservation.record.signalId) {
        const resumed = await intervene({ signalId: reservation.record.signalId, tenantId: inst.tenantId, now });
        outcome = resumed.outcome;
        processingState = resumed.processingState;
        if (resumed.processingState === "completed") await completeIngestion(reservation.record.id, { signalId: reservation.record.signalId, outcome });
      }
      return { status: processingState === "completed" ? 200 : 202, body: {
        accepted: true, receiptId: reservation.record.receiptId, signalId: reservation.record.signalId,
        duplicate: true, outcome, processingState, receivedAt: now.toISOString(), schemaVersion: RECEIPT_SCHEMA_VERSION,
      } };
    }

    // 18. persist the canonical minimized SafetySignal through the existing service.
    const signal = await ingestSafetySignalFromGateway({
      tenantId: inst.tenantId,
      protectedProfileId,
      signalType: String(env.riskType),
      severity: String(env.severity),
      confidenceBand: bandFromConfidence(env),
      sourceType: SafetySignalSourceType.PlatformPartner,
      sourceReference: toOpaqueRef(env.actorReferenceHash),
      occurrenceBucket: dayBucketOf(String(env.detectedAt)),
      detectedAt: fresh.ok ? new Date(String(env.detectedAt)) : undefined,
    });

    // 19. CS-C15 — run the protective intervention through the existing canonical services (consent →
    //     guardian authority → safe recipient → recipient authorization → delivery / review / incident /
    //     escalation), fail-closed. The gateway's per-signal reservation makes this run exactly once.
    const intervention = await intervene({ signalId: signal.id, tenantId: inst.tenantId, now });
    // Only record the ingestion outcome as final once the intervention completed (else it stays
    // resumable and a later idempotent retry finishes it — never claim success on an incomplete flow).
    if (intervention.processingState === "completed") await completeIngestion(reservation.id, { signalId: signal.id, outcome: intervention.outcome });

    // 20. privacy-safe receipt (no recipient details, no incident data, no internal ids beyond the signal id).
    return { status: intervention.processingState === "completed" ? 201 : 202, body: {
      accepted: true, receiptId, signalId: signal.id, duplicate: false,
      outcome: intervention.outcome, processingState: intervention.processingState, receivedAt: now.toISOString(), schemaVersion: RECEIPT_SCHEMA_VERSION,
    } };
  } catch {
    // Never leak a DB/Prisma error, stack trace, or raw content.
    return err(500, "processing_error");
  }
}

/** Map the envelope's 0..1 confidence to the coarse persisted band (never a raw score). */
function bandFromConfidence(env: Record<string, unknown>): SafetyConfidenceBand {
  const c = typeof env.confidence === "number" ? env.confidence : 0;
  if (c >= 0.8) return SafetyConfidenceBand.High;
  if (c >= 0.5) return SafetyConfidenceBand.Medium;
  if (c > 0) return SafetyConfidenceBand.Low;
  return SafetyConfidenceBand.Unknown;
}
/** Safe day bucket (≤32) from an ISO timestamp — never a raw-content hash. */
function dayBucketOf(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}
