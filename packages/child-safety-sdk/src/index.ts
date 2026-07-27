/**
 * CS-C14 — Tamanor Child Safety SDK. Public surface only; no Prisma or internal DB types are exposed.
 * Canonical taxonomy, envelope, detector, and signing come from @guardora/core (re-exported, never
 * duplicated). See ./README.md for the privacy model, threat model, and integration example.
 */
export * from "./types";
export { createFetchTransport, createMemoryTransport, TransportError } from "./transport";
export { createTamanorChildSafetyClient } from "./client";

// Integration Signal Protocol V1 — the server-only Partner SDK (build/sign/submit minimal safety signals).
export {
  createPartnerSignalClient, createEd25519Signer, isRetriable,
  type PartnerSigner, type PartnerSignalInput, type PartnerAck, type PartnerTransport, type PartnerClientOptions,
} from "./partner";
export { generateEphemeralPartnerKeyPair, type TestKeyPair } from "./partner-test-util";
// Protocol vocabulary re-exported (value + type) so integrators build strictly-typed signals.
export {
  CHILD_SAFETY_SIGNAL_PROTOCOL, CHILD_SAFETY_SIGNAL_PROTOCOL_VERSION, PartnerRiskType,
  PARTNER_RISK_TYPES, PARTNER_CONFIDENCE_BANDS, PARTNER_SEVERITY_HINTS, PARTNER_URGENCY_HINTS,
  INTEGRATION_ERROR_CODES, validateSignalEnvelope, buildSigningString, INTEGRATION_LIMITS,
  type SignalEnvelope, type MinimalSignal, type IntegrationErrorCode,
} from "@guardora/core";

// Canonical taxonomy + detector + versions (VALUE exports so integrators can build/classify).
export {
  RiskType, SafetySignalCode, SafetySeverity, SafetyUrgency, SafetyConfidenceBand,
  DeterministicChildSafetyClassifier, DETERMINISTIC_DETECTOR_VERSION,
  ChildSafetyReasonCode, confidenceBandToNumber, toMinimizedSignals,
  SAFETY_SIGNAL_CONTRACT_VERSION, SAFETY_TAXONOMY_VERSION,
} from "@guardora/core";
