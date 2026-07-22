/**
 * Tamanor Child Safety — Safety Signal contract FOUNDATION (CS-C0).
 *
 * A privacy-safe, strict-allowlist contract for the future Privacy Gateway. CS-C0
 * ships the TYPES + a pure validator ONLY — there is NO endpoint, NO storage, NO
 * detector, NO dataset. Raw message content, media, open identifiers, credentials,
 * and precise location are FORBIDDEN and rejected (never silently stored). Unknown
 * fields are rejected. Pure + crypto-free (subpath `@guardora/core/child-safety-signal`).
 *
 * See docs/child-safety/contracts/safety-signal-v1.md and privacy-invariants.md.
 */

export const SAFETY_SIGNAL_CONTRACT_VERSION = "safety-signal-v1";

// --- Terminology (locked in CS-C0) ------------------------------------------

/** A single observed, safety-relevant event. */
export enum SafetySignalCode {
  AgeProbe = "AGE_PROBE",
  ParentalMonitoringProbe = "PARENTAL_MONITORING_PROBE",
  SecrecyRequest = "SECRECY_REQUEST",
  IntimateImageRequest = "INTIMATE_IMAGE_REQUEST",
  OffPlatformMove = "OFF_PLATFORM_MOVE",
  MeetingProposal = "MEETING_PROPOSAL",
  Threat = "THREAT",
  SelfHarmEncouragement = "SELF_HARM_ENCOURAGEMENT",
}
export const ALL_SAFETY_SIGNAL_CODES: readonly SafetySignalCode[] = Object.values(SafetySignalCode);

/** The resulting safety category (from one or more signals; never a legal verdict). */
export enum RiskType {
  Grooming = "GROOMING",
  SexualSolicitation = "SEXUAL_SOLICITATION",
  Sextortion = "SEXTORTION",
  MeetingAttempt = "MEETING_ATTEMPT",
  Cyberbullying = "CYBERBULLYING",
  Threat = "THREAT",
  IdentityManipulation = "IDENTITY_MANIPULATION",
}
export const ALL_RISK_TYPES: readonly RiskType[] = Object.values(RiskType);

export enum SafetySeverity { Low = "low", Medium = "medium", High = "high", Critical = "critical" }
export enum SafetyUrgency { Routine = "routine", Elevated = "elevated", Immediate = "immediate" }

// --- Envelope (strict allowlist) --------------------------------------------

/** The ONLY fields a Safety Signal may carry. No raw content, media, or open IDs. */
export interface SafetySignalEnvelope {
  contractVersion: string;
  eventId: string;
  sourcePlatform: string;
  sourceEnvironment: string;
  protectedProfileReference: string; // pseudonymized
  conversationReferenceHash: string; // pseudonymized
  actorReferenceHash: string;        // pseudonymized
  riskType: RiskType;
  severity: SafetySeverity;
  urgency: SafetyUrgency;
  confidence: number; // 0..1 calibrated band
  signalCodes: SafetySignalCode[];
  detectedAt: string; // ISO
  taxonomyVersion: string;
  detectorVersion: string;
  nonce: string;      // anti-replay
  signature: string;  // integrity
}

export const SAFETY_SIGNAL_ALLOWED_FIELDS: readonly string[] = [
  "contractVersion", "eventId", "sourcePlatform", "sourceEnvironment", "protectedProfileReference",
  "conversationReferenceHash", "actorReferenceHash", "riskType", "severity", "urgency", "confidence",
  "signalCodes", "detectedAt", "taxonomyVersion", "detectorVersion", "nonce", "signature",
];

/** Fields that must NEVER appear — presence is a hard rejection (privacy invariant). */
export const SAFETY_SIGNAL_FORBIDDEN_FIELDS: readonly string[] = [
  "message", "text", "body", "content", "transcript", "image", "video", "audio", "attachment", "filename",
  "email", "phone", "username", "displayName", "platformUserId", "accessToken", "refreshToken", "latitude", "longitude",
];

export type SafetySignalValidationErrorCode = "forbidden_field" | "unknown_field" | "missing_required" | "invalid_value" | "not_object";
export interface SafetySignalValidation {
  ok: boolean;
  errors: { code: SafetySignalValidationErrorCode; field: string }[];
}

/**
 * Validate a raw payload against the strict allowlist. FAIL-CLOSED, no storage:
 * a forbidden field, an unknown field, a missing required field, or an invalid enum
 * value is rejected. This is the shape the future Privacy Gateway will enforce
 * before anything is accepted. Pure — returns codes, never echoes values.
 */
export function validateSafetySignalEnvelope(raw: unknown): SafetySignalValidation {
  const errors: SafetySignalValidation["errors"] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: [{ code: "not_object", field: "$" }] };
  const obj = raw as Record<string, unknown>;
  const forbidden = new Set(SAFETY_SIGNAL_FORBIDDEN_FIELDS);
  const allowed = new Set(SAFETY_SIGNAL_ALLOWED_FIELDS);

  for (const key of Object.keys(obj)) {
    if (forbidden.has(key)) errors.push({ code: "forbidden_field", field: key });
    else if (!allowed.has(key)) errors.push({ code: "unknown_field", field: key });
  }
  for (const req of SAFETY_SIGNAL_ALLOWED_FIELDS) {
    if (obj[req] === undefined || obj[req] === null) errors.push({ code: "missing_required", field: req });
  }
  if (obj.riskType !== undefined && !(ALL_RISK_TYPES as readonly string[]).includes(obj.riskType as string)) errors.push({ code: "invalid_value", field: "riskType" });
  if (obj.confidence !== undefined && (typeof obj.confidence !== "number" || (obj.confidence as number) < 0 || (obj.confidence as number) > 1)) errors.push({ code: "invalid_value", field: "confidence" });
  if (obj.signalCodes !== undefined && (!Array.isArray(obj.signalCodes) || (obj.signalCodes as unknown[]).some((c) => !(ALL_SAFETY_SIGNAL_CODES as readonly string[]).includes(c as string)))) errors.push({ code: "invalid_value", field: "signalCodes" });

  return { ok: errors.length === 0, errors };
}

// --- Guardian / consent / age-band foundation (concepts locked; no tables) ---

export enum AgeBand { Under10 = "under_10", Age10to12 = "age_10_12", Age13to15 = "age_13_15", Age16to17 = "age_16_17" }
export const ALL_AGE_BANDS: readonly AgeBand[] = Object.values(AgeBand);

export enum ConsentStatus { NotRequested = "not_requested", Pending = "pending", Active = "active", Withdrawn = "withdrawn", Expired = "expired", Disputed = "disputed", Suspended = "suspended" }

export enum ConsentType { Guardian = "guardian", ChildAssent = "child_assent", Platform = "platform", PilotParticipation = "pilot_participation", EvidenceSharing = "evidence_sharing", ExpertReview = "expert_review" }
export const ALL_CONSENT_TYPES: readonly ConsentType[] = Object.values(ConsentType);

export enum GuardianRelationshipType { Parent = "parent", LegalGuardian = "legal_guardian", TrustedAdult = "trusted_adult", SafetyProfessional = "safety_professional" }
export enum GuardianAuthorityLevel { Full = "full", Limited = "limited", ReadOnly = "read_only" }
export const ALL_GUARDIAN_AUTHORITY_LEVELS: readonly GuardianAuthorityLevel[] = Object.values(GuardianAuthorityLevel);
export enum GuardianRelationshipStatus { Pending = "pending", Verified = "verified", Suspended = "suspended", Revoked = "revoked" }

/**
 * CS-C7 — the guardian's ROLE within a ProtectedProfile's circle. This is a SEPARATE axis from
 * `relationshipType` (legal nature) and `authorityLevel` (permission depth): it never derives or
 * changes either. At most ONE ACTIVE `Primary` guardian may exist per profile (DB partial-unique
 * index + repository check). A `ViewOnly` role grants no management ability by itself — Family
 * role/permission gating still applies above it.
 */
export enum GuardianRole { Primary = "primary", Secondary = "secondary", Emergency = "emergency", ViewOnly = "view_only" }
export const ALL_GUARDIAN_ROLES: readonly GuardianRole[] = Object.values(GuardianRole);

/** A guardian is NOT automatically a safe recipient — eligibility is evaluated (no auto-decision in CS-C0). */
export enum SafetyRecipientEligibility { Eligible = "eligible", RequiresExpertReview = "requires_expert_review", Suppressed = "suppressed", NotVerified = "not_verified", Conflicted = "conflicted" }

export enum ProtectionStatus { Inactive = "inactive", Monitoring = "monitoring", Active = "active", Paused = "paused" }
