/**
 * Tamanor Child Safety Partner SDK V1 — SERVER-SIDE ONLY.
 *
 * Builds, validates, signs (Ed25519), and submits a MINIMAL, content-free safety signal to the Tamanor
 * integration gateway. It is NOT a surveillance SDK: there is no field or helper for raw message content,
 * transcripts, attachments, screens, notifications, device data, credentials, tokens, or private-key
 * upload. The partner's private key stays with the partner — this SDK signs in-process via a caller-
 * provided signer/key and NEVER persists or logs it. Node-only crypto; browser usage is unsupported.
 */
import { randomUUID, createHash, sign as edSign, createPrivateKey, type KeyObject } from "node:crypto";
import {
  CHILD_SAFETY_SIGNAL_PROTOCOL, CHILD_SAFETY_SIGNAL_PROTOCOL_VERSION,
  validateSignalEnvelope, buildSigningString, INTEGRATION_LIMITS,
  type SignalEnvelope, type MinimalSignal, type ClassificationMeta, type PseudonymousSubject, type SignalContext,
  type IntegrationErrorCode,
} from "@guardora/core";

if ((globalThis as { window?: unknown }).window !== undefined) throw new Error("@guardora/child-safety-sdk/partner is server-only — do not use in a browser bundle.");

// ── Signer (caller supplies the private key IN-PROCESS; never uploaded to Tamanor) ──
export type PartnerSigner = (data: Buffer) => Buffer | Promise<Buffer>;
/** Build an Ed25519 signer from a caller-held private key (PEM string or Node KeyObject). Not persisted. */
export function createEd25519Signer(privateKey: string | KeyObject): PartnerSigner {
  const key = typeof privateKey === "string" ? createPrivateKey(privateKey) : privateKey;
  if (key.asymmetricKeyType !== "ed25519") throw new Error("partner signer requires an ed25519 private key");
  return (data: Buffer) => edSign(null, data, key);
}

// ── Strict signal input (NO raw-content fields exist in the type) ──
export interface PartnerSignalInput {
  externalSignalId: string;
  signalType: string; // PartnerRiskType
  confidenceBand: string;
  severityHint?: string;
  urgencyHint?: string;
  classification: ClassificationMeta;
  subject: PseudonymousSubject;
  context?: SignalContext;
  occurredAt?: string; // ISO; defaults to now
}

export interface PartnerAck { ok: boolean; code: IntegrationErrorCode | "TRANSPORT_ERROR"; httpStatus: number; eventId?: string; receiptId?: string; canonicalSignalId?: string; }
export type PartnerTransport = (req: { url: string; method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; body: unknown }>;

export interface PartnerClientOptions {
  endpoint: string;           // full gateway URL
  path?: string;              // signed path (defaults to the endpoint's pathname)
  applicationId: string;
  installationId: string;
  keyVersion: number;
  signer: PartnerSigner;
  transport: PartnerTransport;
  partnerId: string;
  protocolVersion?: string;
  retry?: { maxAttempts?: number };
}

const sha256hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
const RETRIABLE = new Set<string>(["INTERNAL_FAIL_CLOSED", "RATE_LIMITED", "TRANSPORT_ERROR"]);

/** Whether an outcome is a bounded TRANSIENT failure worth retrying (never retry auth/validation/idempotency). */
export function isRetriable(code: string, httpStatus: number): boolean {
  if (RETRIABLE.has(code)) return true;
  return httpStatus >= 500 || httpStatus === 429 || httpStatus === 0; // 0 = network/timeout
}

export function createPartnerSignalClient(opts: PartnerClientOptions) {
  const protocolVersion = opts.protocolVersion ?? CHILD_SAFETY_SIGNAL_PROTOCOL_VERSION;
  const path = opts.path ?? (() => { try { return new URL(opts.endpoint).pathname; } catch { return opts.endpoint; } })();
  const maxAttempts = Math.max(1, Math.min(opts.retry?.maxAttempts ?? 3, 5));

  /** Build (and strictly validate) a canonical envelope. Throws on any invalid/prohibited field. */
  function buildEnvelope(input: PartnerSignalInput, ids: { eventId: string; idempotencyKey: string; nonce: string; sentAt: string }): SignalEnvelope {
    const signal: MinimalSignal = { externalSignalId: input.externalSignalId, signalType: input.signalType, confidenceBand: input.confidenceBand, ...(input.severityHint ? { severityHint: input.severityHint } : {}), ...(input.urgencyHint ? { urgencyHint: input.urgencyHint } : {}) };
    const env: SignalEnvelope = {
      protocol: CHILD_SAFETY_SIGNAL_PROTOCOL, protocolVersion, eventId: ids.eventId, idempotencyKey: ids.idempotencyKey,
      partnerId: opts.partnerId, applicationId: opts.applicationId, installationId: opts.installationId,
      occurredAt: input.occurredAt ?? ids.sentAt, sentAt: ids.sentAt, nonce: ids.nonce,
      signal, classification: input.classification, subject: input.subject, ...(input.context ? { context: input.context } : {}),
    };
    const val = validateSignalEnvelope(env);
    if (!val.valid) throw new Error(`partner signal invalid: ${val.errors.slice(0, 5).join(", ")}`);
    return env;
  }

  /** Sign an envelope: bodyHash = sha256(body); signature = Ed25519 over the canonical signing string. */
  async function signEnvelope(env: SignalEnvelope): Promise<{ body: string; signatureBase64: string }> {
    const body = JSON.stringify(env);
    if (Buffer.byteLength(body, "utf8") > INTEGRATION_LIMITS.maxEnvelopeBytes) throw new Error("partner signal exceeds max envelope size");
    const bodyHashHex = sha256hex(body);
    const signingString = buildSigningString({ method: "POST", path, protocolVersion, applicationId: env.applicationId, installationId: env.installationId, eventId: env.eventId, idempotencyKey: env.idempotencyKey, sentAt: env.sentAt, nonce: env.nonce, bodyHashHex });
    const signatureBase64 = (await opts.signer(Buffer.from(signingString, "utf8"))).toString("base64");
    return { body, signatureBase64 };
  }

  /**
   * Submit a signal. A single logical event uses ONE (eventId, idempotencyKey, nonce, sentAt, signature);
   * a transient retry re-sends the EXACT same signed request, so the gateway's idempotency + fingerprint
   * guarantee at most one canonical signal. Only transient outcomes are retried.
   */
  async function submitSignal(input: PartnerSignalInput, override?: { eventId?: string; idempotencyKey?: string }): Promise<PartnerAck> {
    const sentAt = new Date().toISOString();
    const ids = { eventId: override?.eventId ?? randomUUID(), idempotencyKey: override?.idempotencyKey ?? randomUUID(), nonce: randomUUID(), sentAt };
    const env = buildEnvelope(input, ids);
    const { body, signatureBase64 } = await signEnvelope(env); // identical bytes reused across retries
    let last: PartnerAck = { ok: false, code: "TRANSPORT_ERROR", httpStatus: 0 };
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await opts.transport({ url: opts.endpoint, method: "POST", headers: { "content-type": "application/json", "x-cs-installation": env.installationId, "x-cs-key-version": String(opts.keyVersion), "x-cs-signature": signatureBase64 }, body });
        const b = (res.body ?? {}) as Record<string, unknown>;
        const code = (b.code as IntegrationErrorCode) ?? (res.status < 300 ? "SIGNAL_ACCEPTED" : "INTERNAL_FAIL_CLOSED");
        last = { ok: code === "SIGNAL_ACCEPTED" || code === "SIGNAL_DUPLICATE", code, httpStatus: res.status, eventId: env.eventId, receiptId: b.receiptId as string | undefined, canonicalSignalId: b.canonicalSignalId as string | undefined };
      } catch { last = { ok: false, code: "TRANSPORT_ERROR", httpStatus: 0, eventId: env.eventId }; }
      if (last.ok || !isRetriable(last.code, last.httpStatus)) return last;
    }
    return last;
  }

  return { submitSignal, buildEnvelope, signEnvelope };
}

// Note: generating a key pair for LOCAL testing lives in ./partner-test-util (never for production use).
