/**
 * CS-C14 — Tamanor Child Safety SDK: public types. Nothing here exposes Prisma or internal DB types.
 * Canonical taxonomy + envelope + classifier types are RE-EXPORTED from @guardora/core (never
 * duplicated).
 */
import type {
  ChildSafetyClassifier, ChildSafetyClassificationInput, ChildSafetyClassificationResult,
  MinimizedSafetySignal, SafetySignalEnvelope, AgeBand,
} from "@guardora/core";

export type {
  ChildSafetyClassifier, ChildSafetyClassificationInput, ChildSafetyClassificationResult,
  MinimizedSafetySignal, SafetySignalEnvelope,
} from "@guardora/core";

/** How a failed operation is classified (never carries content or a server body). */
export type SdkFailureClass =
  | "none" | "config" | "classifier_unavailable" | "network" | "timeout" | "aborted"
  | "rejected" | "rate_limited" | "server_error";

/** The established installation session. Never exposes the installation token. */
export interface InstallationSession {
  installationId: string;
  applicationId: string;
  subjectId: string;
  endpoint: string;
  registeredAt: string;
}

/** The gateway's privacy-safe receipt (mirrors the server contract; no sensitive fields). */
export interface DeliveryReceipt {
  accepted: boolean;
  receiptId?: string;
  signalId?: string | null;
  duplicate?: boolean;
  outcome?: string;
  schemaVersion?: string;
  error?: string;
}

export interface TransportResponse { status: number; json: unknown }

/** Pluggable transport. The default is fetch/HTTPS; tests inject an in-memory mock. */
export interface ChildSafetyTransport {
  post(url: string, body: string, opts: { headers: Record<string, string>; timeoutMs: number; signal?: AbortSignal }): Promise<TransportResponse>;
}

/** A minimized, SIGNED envelope waiting to be delivered — NEVER contains raw content. */
export interface QueuedEnvelope {
  envelope: SafetySignalEnvelope;
  idempotencyKey: string;
  attempts: number;
  nextAttemptAt: number;
}

/** Adapter for future secure native persistence. The default queue is in-memory only. */
export interface QueueStorageAdapter {
  load(): Promise<QueuedEnvelope[]>;
  save(items: QueuedEnvelope[]): Promise<void>;
  clear(): Promise<void>;
}

export interface SdkDiagnostics {
  sdkVersion: string;
  signalSchemaVersion: string;
  detectorRulesetVersion: string | null;
  installationState: "unregistered" | "active" | "destroyed";
  transportState: "idle" | "sending" | "error";
  queueLength: number;
  lastSuccessAt: string | null;
  lastFailureClass: SdkFailureClass;
  classifierAvailable: boolean;
}

export interface ChildSafetyClientConfig {
  endpoint: string;
  applicationId: string;
  installationId?: string;
  installationToken?: string;
  subjectId: string;
  classifier?: ChildSafetyClassifier;
  transport?: ChildSafetyTransport;
  queueStorage?: QueueStorageAdapter;
  timeoutMs?: number;
  maxRetries?: number;
  maxQueueSize?: number;
  /** Base backoff (ms); actual delay = min(cap, base·2^(attempt-1)) + bounded jitter. Tests may set 0. */
  retryBaseMs?: number;
  /** Dead-letter callback for a permanently failed envelope. Receives NO raw content. */
  onFailure?: (item: QueuedEnvelope, failure: SdkFailureClass) => void;
}

export interface EvaluateContentInput {
  content: string;
  locale?: string;
  ageBand?: AgeBand;
  /** Pseudonymous references supplied by the integrator (never raw ids). */
  conversationRef?: string;
  actorRef?: string;
}

export interface EvaluateContentResult {
  signalCreated: boolean;
  signalCount: number;
  /** Minimized candidates — carry NO raw content. */
  candidates: MinimizedSafetySignal[];
}

export interface ChildSafetyClient {
  registerInstallation(input?: { installationId?: string; installationToken?: string }): Promise<InstallationSession>;
  evaluateContent(input: EvaluateContentInput, options?: { signal?: AbortSignal }): Promise<EvaluateContentResult>;
  submitSafetySignal(signal: MinimizedSafetySignal, refs?: { conversationRef?: string; actorRef?: string }): Promise<void>;
  flushPendingSignals(options?: { now?: number; signal?: AbortSignal }): Promise<{ sent: number; failed: number; remaining: number }>;
  getSdkDiagnostics(): SdkDiagnostics;
  destroy(): void;
}

export class SdkConfigError extends Error {
  constructor(public readonly field: string) { super(`invalid_config:${field}`); this.name = "SdkConfigError"; }
}
export class SdkStateError extends Error {
  constructor(reason: string) { super(reason); this.name = "SdkStateError"; }
}
