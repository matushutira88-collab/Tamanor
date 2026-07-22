/**
 * Tamanor Child Safety — Safety Signal FOUNDATION (CS-C3).
 *
 * A SafetySignal is ONLY a bounded, structured record that some external or future local system
 * reported a *type* of possible safety risk for a ProtectedProfile. It is NOT a message, incident,
 * evidence, alert, AI classification result, guilt decision, or automatic action.
 *
 * CS-C3 covers only: (1) signal occurrence, (2) classification METADATA, (3) review state. It creates
 * NO delivery / alert / notification / recipient workflow / incident / case / escalation.
 *
 * Reuses the CS-0 SafetySignal contract enums instead of duplicating them: `signalType` values are the
 * CS-0 {@link RiskType} category, and `severity` is the CS-0 {@link SafetySeverity}. Only the enums the
 * CS-0 contract lacks (confidence BAND, source type, review status, resolution code) are added here.
 * Values are stored as TEXT (validated here) — never DB enum types, so CS-C4 is not locked in.
 *
 * Client-safe subpath: `@guardora/core/child-safety-safety-signal`.
 */

import { RiskType, ALL_RISK_TYPES, SafetySeverity } from "./child-safety-signal";

// --- New CS-C3 enums (only what the CS-0 contract does not already define) ----

/** A coarse confidence BAND — NOT a probability of guilt and NEVER a raw model score. */
export enum SafetyConfidenceBand {
  Unknown = "unknown",
  Low = "low",
  Medium = "medium",
  High = "high",
}
export const ALL_SAFETY_CONFIDENCE_BANDS: readonly SafetyConfidenceBand[] = Object.values(SafetyConfidenceBand);

/** Where the signal came from. CS-C3 builds NO real connector; MANUAL/INTERNAL test only. */
export enum SafetySignalSourceType {
  ManualTest = "manual_test",
  LocalDevice = "local_device",
  PlatformPartner = "platform_partner",
  ImportedSignal = "imported_signal",
  InternalRule = "internal_rule",
}
export const ALL_SAFETY_SIGNAL_SOURCE_TYPES: readonly SafetySignalSourceType[] = Object.values(SafetySignalSourceType);

/** The review lifecycle of a signal. NEW is the default; nothing auto-advances it. */
export enum SafetySignalReviewStatus {
  New = "new",
  Acknowledged = "acknowledged",
  UnderReview = "under_review",
  Dismissed = "dismissed",
  ConfirmedRisk = "confirmed_risk",
  Archived = "archived",
}
export const ALL_SAFETY_SIGNAL_REVIEW_STATUSES: readonly SafetySignalReviewStatus[] = Object.values(SafetySignalReviewStatus);

/** Final review states that MUST record who reviewed and when. */
export const SAFETY_SIGNAL_FINAL_REVIEW_STATES: readonly SafetySignalReviewStatus[] = [
  SafetySignalReviewStatus.Dismissed, SafetySignalReviewStatus.ConfirmedRisk,
];
export function isFinalSafetySignalReviewStatus(x: unknown): x is SafetySignalReviewStatus {
  return (SAFETY_SIGNAL_FINAL_REVIEW_STATES as readonly string[]).includes(x as string);
}

/** Allow-listed resolution codes — NEVER free text. Only valid on a final review state. */
export enum SafetySignalResolutionCode {
  FalsePositive = "false_positive",
  Duplicate = "duplicate",
  InsufficientInformation = "insufficient_information",
  ValidSafetyConcern = "valid_safety_concern",
  OutOfScope = "out_of_scope",
  TestSignal = "test_signal",
}
export const ALL_SAFETY_SIGNAL_RESOLUTION_CODES: readonly SafetySignalResolutionCode[] = Object.values(SafetySignalResolutionCode);

// --- Value guards (fail-closed) ---------------------------------------------

export const isSafetySignalType = (x: unknown): x is RiskType => (ALL_RISK_TYPES as readonly string[]).includes(x as string);
export const isSafetySeverity = (x: unknown): x is SafetySeverity => Object.values(SafetySeverity).includes(x as SafetySeverity);
export const isSafetyConfidenceBand = (x: unknown): x is SafetyConfidenceBand => (ALL_SAFETY_CONFIDENCE_BANDS as readonly string[]).includes(x as string);
export const isSafetySignalSourceType = (x: unknown): x is SafetySignalSourceType => (ALL_SAFETY_SIGNAL_SOURCE_TYPES as readonly string[]).includes(x as string);
export const isSafetySignalReviewStatus = (x: unknown): x is SafetySignalReviewStatus => (ALL_SAFETY_SIGNAL_REVIEW_STATUSES as readonly string[]).includes(x as string);
export const isSafetySignalResolutionCode = (x: unknown): x is SafetySignalResolutionCode => (ALL_SAFETY_SIGNAL_RESOLUTION_CODES as readonly string[]).includes(x as string);

// --- Opaque reference / bucket validation (no raw content, no correlation) ----

export const SAFETY_SIGNAL_SOURCE_REFERENCE_MAX = 64;
export const SAFETY_SIGNAL_OCCURRENCE_BUCKET_MAX = 32;
const SOURCE_REFERENCE_RE = /^[A-Za-z0-9_-]+$/;   // opaque token — NO url/username/message-id chars
const OCCURRENCE_BUCKET_RE = /^[A-Za-z0-9_:-]+$/; // safe time bucket or opaque dedupe token

/**
 * An opaque source reference: bounded length, strict char allowlist. It must NOT be a URL, username,
 * platform message id, or anything that could fetch raw content. Optional (null/undefined allowed).
 */
export function isValidSourceReference(x: unknown): boolean {
  if (x === null || x === undefined) return true;
  return typeof x === "string" && x.length >= 1 && x.length <= SAFETY_SIGNAL_SOURCE_REFERENCE_MAX && SOURCE_REFERENCE_RE.test(x);
}
/**
 * A safe occurrence bucket: a coarse time bucket (e.g. "2026-07-22" / "2026-07-22T05") or an opaque
 * dedupe token. NEVER a hash of raw content (no dictionary attack / content correlation). Optional.
 */
export function isValidOccurrenceBucket(x: unknown): boolean {
  if (x === null || x === undefined) return true;
  return typeof x === "string" && x.length >= 1 && x.length <= SAFETY_SIGNAL_OCCURRENCE_BUCKET_MAX && OCCURRENCE_BUCKET_RE.test(x);
}

// --- Strict content-free create allowlist ------------------------------------

export const SAFETY_SIGNAL_CREATE_FIELDS: readonly string[] = [
  "protectedProfileId", "signalType", "severity", "confidenceBand", "sourceType",
  "sourceReference", "occurrenceBucket", "detectedAt",
];
/** The ONLY field a review decision (dismiss/confirm) may carry — an allow-listed resolution code. */
export const SAFETY_SIGNAL_DECIDE_FIELDS: readonly string[] = ["resolutionCode"];

// --- Defaults ----------------------------------------------------------------

export const SAFETY_SIGNAL_DEFAULT_REVIEW_STATUS = SafetySignalReviewStatus.New;
export const SAFETY_SIGNAL_DEFAULT_CONFIDENCE_BAND = SafetyConfidenceBand.Unknown;

// --- List bounds -------------------------------------------------------------

export const SAFETY_SIGNAL_LIST_MAX_LIMIT = 200;
export const SAFETY_SIGNAL_LIST_DEFAULT_LIMIT = 50;
/** Clamp a caller page size into [1, MAX]. */
export function clampSafetySignalLimit(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return SAFETY_SIGNAL_LIST_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), SAFETY_SIGNAL_LIST_MAX_LIMIT);
}
