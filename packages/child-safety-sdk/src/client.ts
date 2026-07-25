/**
 * CS-C14 — the Tamanor Child Safety SDK client. Local classification → minimized, signed envelope →
 * bounded offline queue → authenticated delivery. Raw content is passed ONLY to the injected
 * classifier, in memory, and is NEVER serialized, queued, logged, thrown, or sent. Evidence escalation
 * is a SEPARATE explicit operation (not here). Installation tokens never appear in diagnostics, errors,
 * or serialization.
 */
import { randomUUID, createHash } from "node:crypto";
import {
  SAFETY_SIGNAL_CONTRACT_VERSION, SAFETY_TAXONOMY_VERSION, DETERMINISTIC_DETECTOR_VERSION,
  signEnvelope, toMinimizedSignals,
  type SafetySignalEnvelope, type MinimizedSafetySignal,
} from "@guardora/core";
import { createFetchTransport } from "./transport";
import {
  SdkConfigError, SdkStateError,
  type ChildSafetyClient, type ChildSafetyClientConfig, type ChildSafetyTransport,
  type DeliveryReceipt, type EvaluateContentInput, type EvaluateContentResult,
  type InstallationSession, type QueuedEnvelope, type SdkDiagnostics, type SdkFailureClass,
} from "./types";

const SDK_VERSION = "0.1.0";
const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

export function createTamanorChildSafetyClient(config: ChildSafetyClientConfig): ChildSafetyClient {
  // --- strict config validation ---
  if (!config || typeof config !== "object") throw new SdkConfigError("config");
  if (!config.endpoint || typeof config.endpoint !== "string") throw new SdkConfigError("endpoint");
  if (!config.applicationId) throw new SdkConfigError("applicationId");
  if (!config.subjectId) throw new SdkConfigError("subjectId");
  const timeoutMs = config.timeoutMs ?? 8000;
  const maxRetries = config.maxRetries ?? 4;
  const maxQueueSize = config.maxQueueSize ?? 500;
  const retryBaseMs = config.retryBaseMs ?? 250;
  if (timeoutMs <= 0) throw new SdkConfigError("timeoutMs");
  if (maxQueueSize <= 0) throw new SdkConfigError("maxQueueSize");
  if (maxRetries < 0) throw new SdkConfigError("maxRetries");

  const transport: ChildSafetyTransport = config.transport ?? createFetchTransport();
  const endpoint = config.endpoint;

  // --- private runtime state (never exposed) ---
  let token: string | null = config.installationToken ?? null;
  let installationId: string | null = config.installationId ?? null;
  let queue: QueuedEnvelope[] = [];
  let state: SdkDiagnostics["installationState"] = token && installationId ? "active" : "unregistered";
  let transportState: SdkDiagnostics["transportState"] = "idle";
  let lastSuccessAt: string | null = null;
  let lastFailureClass: SdkFailureClass = "none";
  let destroyed = false;

  const requireLive = () => { if (destroyed) throw new SdkStateError("destroyed"); };
  const requireSession = () => { if (!token || !installationId) throw new SdkStateError("not_registered"); };

  function buildSignedEnvelope(sig: MinimizedSafetySignal, refs?: { conversationRef?: string; actorRef?: string }): SafetySignalEnvelope {
    const base: Omit<SafetySignalEnvelope, "signature"> = {
      contractVersion: SAFETY_SIGNAL_CONTRACT_VERSION,
      eventId: `evt_${randomUUID()}`,
      sourcePlatform: "sdk",
      sourceEnvironment: "sdk",
      protectedProfileReference: config.subjectId,
      conversationReferenceHash: sha256(`conv:${refs?.conversationRef ?? config.subjectId}`),
      actorReferenceHash: sha256(`actor:${refs?.actorRef ?? "unknown"}`),
      riskType: sig.riskType,
      severity: sig.severity,
      urgency: sig.urgency,
      confidence: sig.confidence,
      signalCodes: sig.signalCodes,
      detectedAt: sig.detectedAt,
      taxonomyVersion: sig.taxonomyVersion,
      detectorVersion: sig.detectorVersion,
      nonce: `nonce_${randomUUID()}`,
    };
    return { ...base, signature: signEnvelope(base as unknown as Record<string, unknown>, token!) };
  }

  function enqueue(envelope: SafetySignalEnvelope): void {
    const item: QueuedEnvelope = { envelope, idempotencyKey: envelope.eventId, attempts: 0, nextAttemptAt: 0 };
    queue.push(item);
    // Deterministic overflow: drop OLDEST beyond the bound (keep the newest signals).
    if (queue.length > maxQueueSize) queue.splice(0, queue.length - maxQueueSize);
  }

  const client: ChildSafetyClient = {
    async registerInstallation(input): Promise<InstallationSession> {
      requireLive();
      // Registration is issued out-of-band by the operator (createChildSafetyInstallation). The SDK
      // adopts the issued credential; it never mints its own. A transport-based register flow can be
      // layered later behind this same method without changing the public shape.
      const t = input?.installationToken ?? config.installationToken ?? token;
      const id = input?.installationId ?? config.installationId ?? installationId;
      if (!t || !id) throw new SdkStateError("registration_requires_installation_credentials");
      token = t; installationId = id; state = "active";
      return { installationId: id, applicationId: config.applicationId, subjectId: config.subjectId, endpoint, registeredAt: new Date().toISOString() };
    },

    async evaluateContent(input, options): Promise<EvaluateContentResult> {
      requireLive(); requireSession();
      if (!config.classifier) throw new SdkStateError("classifier_unavailable");
      if (!input || typeof input.content !== "string") throw new SdkConfigError("content");
      let result;
      try {
        // Raw content passes ONLY to the classifier, in memory.
        result = await config.classifier.classify({ content: input.content, locale: input.locale, ageBand: input.ageBand }, { signal: options?.signal });
      } catch (e) {
        lastFailureClass = "classifier_unavailable";
        throw new SdkStateError("classifier_failed");
      }
      const minimized = toMinimizedSignals(result); // no raw content
      for (const sig of minimized) enqueue(buildSignedEnvelope(sig, { conversationRef: input.conversationRef, actorRef: input.actorRef }));
      // `input.content` is now out of scope; nothing retained it.
      return { signalCreated: minimized.length > 0, signalCount: minimized.length, candidates: minimized };
    },

    async submitSafetySignal(sig, refs): Promise<void> {
      requireLive(); requireSession();
      enqueue(buildSignedEnvelope(sig, refs));
    },

    async flushPendingSignals(options): Promise<{ sent: number; failed: number; remaining: number }> {
      requireLive();
      const now = options?.now ?? Date.now();
      let sent = 0, failed = 0;
      transportState = "sending";
      const survivors: QueuedEnvelope[] = [];
      for (const item of queue) {
        if (options?.signal?.aborted) { survivors.push(item); continue; }
        if (item.nextAttemptAt > now) { survivors.push(item); continue; }
        let receipt: DeliveryReceipt | null = null;
        let failure: SdkFailureClass = "none";
        try {
          const res = await transport.post(`${endpoint}`, JSON.stringify(item.envelope), {
            headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-application-id": config.applicationId, "idempotency-key": item.idempotencyKey },
            timeoutMs, signal: options?.signal,
          });
          if (res.status >= 200 && res.status < 300) receipt = res.json as DeliveryReceipt;
          else if (res.status === 429) failure = "rate_limited";
          else if (res.status >= 500) failure = "server_error";
          else failure = "rejected"; // 4xx (bad/invalid) — non-retryable
        } catch (e) {
          const f = (e as { failure?: string }).failure;
          failure = f === "timeout" ? "timeout" : f === "aborted" ? "aborted" : "network";
        }
        if (receipt) { sent++; lastSuccessAt = new Date(now).toISOString(); lastFailureClass = "none"; continue; }
        lastFailureClass = failure;
        const retryable = failure === "network" || failure === "timeout" || failure === "rate_limited" || failure === "server_error";
        item.attempts += 1;
        if (!retryable || item.attempts > maxRetries) {
          failed++;
          try { config.onFailure?.(item, failure); } catch { /* dead-letter callback must not throw */ }
          continue; // dropped (dead-lettered)
        }
        const backoff = Math.min(30_000, retryBaseMs * 2 ** (item.attempts - 1)) + boundedJitter(item.idempotencyKey);
        item.nextAttemptAt = now + backoff;
        survivors.push(item);
        failed++;
      }
      queue = survivors;
      transportState = lastFailureClass === "none" ? "idle" : "error";
      return { sent, failed, remaining: queue.length };
    },

    getSdkDiagnostics(): SdkDiagnostics {
      return {
        sdkVersion: SDK_VERSION,
        signalSchemaVersion: SAFETY_SIGNAL_CONTRACT_VERSION,
        detectorRulesetVersion: config.classifier ? DETERMINISTIC_DETECTOR_VERSION : null,
        installationState: destroyed ? "destroyed" : state,
        transportState,
        queueLength: queue.length,
        lastSuccessAt,
        lastFailureClass,
        classifierAvailable: !!config.classifier,
      };
    },

    destroy(): void {
      destroyed = true;
      state = "destroyed";
      queue = [];
      token = null; // clear sensitive runtime state
      installationId = null;
    },
  };
  return client;
}

/** Bounded, deterministic jitter (0..250ms) derived from the item key — no Math.random dependency. */
function boundedJitter(key: string): number {
  return parseInt(sha256(key).slice(0, 4), 16) % 250;
}

export { SAFETY_TAXONOMY_VERSION };
