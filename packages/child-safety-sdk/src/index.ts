/**
 * CS-C14 — Tamanor Child Safety SDK. Public surface only; no Prisma or internal DB types are exposed.
 * Canonical taxonomy, envelope, detector, and signing come from @guardora/core (re-exported, never
 * duplicated). See ./README.md for the privacy model, threat model, and integration example.
 */
export * from "./types";
export { createFetchTransport, createMemoryTransport, TransportError } from "./transport";
export { createTamanorChildSafetyClient } from "./client";

// Canonical taxonomy + detector + versions (VALUE exports so integrators can build/classify).
export {
  RiskType, SafetySignalCode, SafetySeverity, SafetyUrgency, SafetyConfidenceBand,
  DeterministicChildSafetyClassifier, DETERMINISTIC_DETECTOR_VERSION,
  ChildSafetyReasonCode, confidenceBandToNumber, toMinimizedSignals,
  SAFETY_SIGNAL_CONTRACT_VERSION, SAFETY_TAXONOMY_VERSION,
} from "@guardora/core";
