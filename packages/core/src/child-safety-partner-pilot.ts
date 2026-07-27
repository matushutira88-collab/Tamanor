/**
 * Child Safety Partner Pilot & Integration Operations V1 — PURE governance vocabulary + deterministic
 * state machine + readiness evaluator. This is the OPERATIONS/GOVERNANCE layer on top of the Integration
 * Signal Protocol: it turns a completed protocol/SDK into a controlled, auditable partner-onboarding and
 * pilot-management workflow. It NEVER ingests raw content and contains NO I/O, NO clock, NO randomness, and
 * NO `node:crypto` — only bounded enums, an explicit transition graph, and a pure readiness function.
 *
 * Privacy by construction: nothing here accepts or stores message content, transcripts, media, credentials,
 * private keys, child identities, or guardian data. Server-internal defensive thresholds are DELIBERATELY
 * kept out of this shared module (they live in the DB layer) so the band→threshold mapping is never revealed
 * to a client bundle.
 */
import { Role } from "./tenant";
import { Permission, can } from "./permissions";

// ── Permissions (narrowly scoped; enforced in service + API layers, never UI-only) ──
export const canViewChildSafetyPilot = (r: Role): boolean => can(r, Permission.ChildSafetyIntegrationPilotView);
export const canManageChildSafetyPilot = (r: Role): boolean => can(r, Permission.ChildSafetyIntegrationPilotManage);
export const canReviewChildSafetyPilot = (r: Role): boolean => can(r, Permission.ChildSafetyIntegrationPilotReview);
export const canActivateChildSafetyPilot = (r: Role): boolean => can(r, Permission.ChildSafetyIntegrationPilotActivate);
export const canSuspendChildSafetyPilot = (r: Role): boolean => can(r, Permission.ChildSafetyIntegrationPilotSuspend);
export const canViewChildSafetyPilotAudit = (r: Role): boolean => can(r, Permission.ChildSafetyIntegrationPilotAuditView);

// ═══════════════════════════════════════════════════════════════════════════════
// Bounded enums
// ═══════════════════════════════════════════════════════════════════════════════
export const PILOT_STATUSES = [
  "DRAFT", "SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUIRED", "APPROVED_FOR_SANDBOX", "SANDBOX_ACTIVE",
  "READINESS_REVIEW", "READY_FOR_PILOT", "PILOT_ACTIVE", "PILOT_PAUSED", "SUSPENDED", "TERMINATED", "REJECTED",
] as const;
export type PilotStatus = (typeof PILOT_STATUSES)[number];

/** Terminal states can never be reopened. */
export const TERMINAL_PILOT_STATUSES: readonly PilotStatus[] = ["TERMINATED", "REJECTED"];
export const isTerminalPilotStatus = (s: string): boolean => (TERMINAL_PILOT_STATUSES as readonly string[]).includes(s);

/** Operational (non-terminal, post-approval) states that may be SUSPENDED or TERMINATED. */
const OPERATIONAL_STATUSES: readonly PilotStatus[] = ["APPROVED_FOR_SANDBOX", "SANDBOX_ACTIVE", "READINESS_REVIEW", "READY_FOR_PILOT", "PILOT_ACTIVE", "PILOT_PAUSED"];

export const PILOT_CHECK_TYPES = [
  "AUTHORIZATION_CONFIRMED", "DATA_MINIMIZATION_CONFIRMED", "RAW_CONTENT_EXCLUSION_CONFIRMED",
  "PRIVATE_KEY_OWNERSHIP_CONFIRMED", "SIGNATURE_COMPATIBILITY_CONFIRMED", "REPLAY_PROTECTION_CONFIRMED",
  "IDEMPOTENCY_CONFIRMED", "RATE_LIMIT_PLAN_CONFIRMED", "SUBJECT_LINKING_MODEL_CONFIRMED",
  "INCIDENT_ROUTING_CONFIRMED", "SANDBOX_TEST_COMPLETED", "OPERATIONAL_CONTACT_CONFIRMED",
  "INCIDENT_RESPONSE_CONTACT_CONFIRMED", "DATA_RETENTION_CONFIRMED", "REGIONAL_SCOPE_CONFIRMED",
  "PILOT_EXIT_PLAN_CONFIRMED",
] as const;
export type PilotCheckType = (typeof PILOT_CHECK_TYPES)[number];

export const PILOT_CHECK_STATUSES = ["NOT_STARTED", "IN_REVIEW", "PASSED", "FAILED", "WAIVED"] as const;
export type PilotCheckStatus = (typeof PILOT_CHECK_STATUSES)[number];

/** Critical checks that can NEVER be waived — they must be explicitly PASSED. */
export const NON_WAIVABLE_CHECKS: readonly PilotCheckType[] = [
  "AUTHORIZATION_CONFIRMED", "DATA_MINIMIZATION_CONFIRMED", "RAW_CONTENT_EXCLUSION_CONFIRMED",
  "PRIVATE_KEY_OWNERSHIP_CONFIRMED", "SIGNATURE_COMPATIBILITY_CONFIRMED",
];
export const isNonWaivableCheck = (t: string): boolean => (NON_WAIVABLE_CHECKS as readonly string[]).includes(t);
/** Every check type is mandatory for activation (non-waivable → PASSED; the rest → PASSED or WAIVED). */
export const MANDATORY_CHECKS: readonly PilotCheckType[] = PILOT_CHECK_TYPES;

export const PILOT_EVENT_TYPES = [
  "PILOT_REQUESTED", "REVIEW_STARTED", "CHECK_UPDATED", "CHECK_WAIVED", "PILOT_APPROVED", "SANDBOX_ENABLED",
  "READINESS_VERIFIED", "PILOT_ACTIVATED", "PILOT_PAUSED", "PILOT_RESUMED", "PILOT_SUSPENDED",
  "PILOT_TERMINATED", "CAPABILITIES_CHANGED", "VOLUME_LIMIT_CHANGED", "CONTACT_CHANGED", "SECURITY_ALERT_RECORDED",
  "CHANGES_REQUESTED", "PILOT_REJECTED", "READINESS_EVALUATED", "TEST_RUN_RECORDED", "SCOPE_CHANGED", "ALERT_RESOLVED",
] as const;
export type PilotEventType = (typeof PILOT_EVENT_TYPES)[number];

export const PILOT_CONTACT_ROLES = ["TECHNICAL", "SECURITY", "PRIVACY", "INCIDENT_RESPONSE", "LEGAL_AUTHORIZATION"] as const;
export type PilotContactRole = (typeof PILOT_CONTACT_ROLES)[number];

export const PILOT_TEST_TYPES = [
  "SIGNATURE_COMPATIBILITY", "TIMESTAMP_WINDOW", "NONCE_REPLAY", "IDEMPOTENCY_DUPLICATE", "IDEMPOTENCY_CONFLICT",
  "PAYLOAD_VALIDATION", "CAPABILITY_ENFORCEMENT", "SUBJECT_LINKING", "RATE_LIMIT_BEHAVIOR",
] as const;
export type PilotTestType = (typeof PILOT_TEST_TYPES)[number];
export const PILOT_TEST_RESULTS = ["PASSED", "FAILED", "SKIPPED"] as const;
export type PilotTestResult = (typeof PILOT_TEST_RESULTS)[number];
/** Tests that must have PASSED before a pilot is ready. */
export const REQUIRED_READINESS_TESTS: readonly PilotTestType[] = [
  "SIGNATURE_COMPATIBILITY", "NONCE_REPLAY", "IDEMPOTENCY_DUPLICATE", "IDEMPOTENCY_CONFLICT", "PAYLOAD_VALIDATION",
];

export const PILOT_ALERT_TYPES = [
  "INVALID_SIGNATURE_SPIKE", "REPLAY_ATTEMPT_SPIKE", "IDEMPOTENCY_CONFLICT_SPIKE", "RATE_LIMIT_SPIKE",
  "REVOKED_KEY_USAGE", "SUSPENDED_INSTALLATION_USAGE", "PROTOCOL_VERSION_MISMATCH", "PILOT_SCOPE_VIOLATION",
  "SUBJECT_LINKING_FAILURE_SPIKE",
] as const;
export type PilotAlertType = (typeof PILOT_ALERT_TYPES)[number];
export const PILOT_ALERT_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
export type PilotAlertSeverity = (typeof PILOT_ALERT_SEVERITIES)[number];

// Server-controlled bands (LABELS only — the band→threshold numbers live server-side and are never revealed).
export const PILOT_VOLUME_BANDS = ["VERY_LOW", "LOW", "MEDIUM", "HIGH"] as const;
export type PilotVolumeBand = (typeof PILOT_VOLUME_BANDS)[number];
export const PILOT_RATE_BANDS = ["VERY_LOW", "LOW", "MEDIUM", "HIGH"] as const;
export type PilotRateBand = (typeof PILOT_RATE_BANDS)[number];

export const PILOT_ASSESSMENT_STATUSES = ["NOT_STARTED", "IN_REVIEW", "APPROVED", "REJECTED"] as const;
export type PilotAssessmentStatus = (typeof PILOT_ASSESSMENT_STATUSES)[number];

export const PILOT_SUSPENSION_REASON_CODES = ["SECURITY_CONCERN", "PRIVACY_CONCERN", "SCOPE_VIOLATION", "OPERATIONAL_ISSUE", "PARTNER_REQUEST", "AUTHORIZATION_LAPSED", "OTHER"] as const;
export type PilotSuspensionReasonCode = (typeof PILOT_SUSPENSION_REASON_CODES)[number];
export const PILOT_TERMINATION_REASON_CODES = ["PILOT_COMPLETED", "PARTNER_WITHDREW", "FAILED_ASSESSMENT", "AUTHORIZATION_REVOKED", "SECURITY_INCIDENT", "PRIVACY_INCIDENT", "OTHER"] as const;
export type PilotTerminationReasonCode = (typeof PILOT_TERMINATION_REASON_CODES)[number];
export const PILOT_CHECK_WAIVER_REASON_CODES = ["NOT_APPLICABLE", "COMPENSATING_CONTROL", "DEFERRED_WITH_APPROVAL", "OTHER"] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// Status machine (explicit, server-validated; no client-selected status)
// ═══════════════════════════════════════════════════════════════════════════════
const BASE_TRANSITIONS: Record<PilotStatus, PilotStatus[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["CHANGES_REQUIRED", "APPROVED_FOR_SANDBOX", "REJECTED"],
  CHANGES_REQUIRED: ["SUBMITTED"],
  APPROVED_FOR_SANDBOX: ["SANDBOX_ACTIVE"],
  SANDBOX_ACTIVE: ["READINESS_REVIEW"],
  READINESS_REVIEW: ["READY_FOR_PILOT", "CHANGES_REQUIRED"],
  READY_FOR_PILOT: ["PILOT_ACTIVE"],
  PILOT_ACTIVE: ["PILOT_PAUSED"],
  PILOT_PAUSED: ["PILOT_ACTIVE"],
  SUSPENDED: ["READINESS_REVIEW"], // resumption only through explicit re-review
  TERMINATED: [],
  REJECTED: [],
};

/** Full allowed target set for a status: base transitions + SUSPEND/TERMINATE for operational/non-terminal. */
export function allowedPilotTransitions(from: PilotStatus): readonly PilotStatus[] {
  const set = new Set<PilotStatus>(BASE_TRANSITIONS[from] ?? []);
  if (OPERATIONAL_STATUSES.includes(from)) set.add("SUSPENDED");
  if (!isTerminalPilotStatus(from) && from !== "DRAFT" && from !== "SUBMITTED" && from !== "UNDER_REVIEW" && from !== "CHANGES_REQUIRED") set.add("TERMINATED");
  // Early-lifecycle records may still be terminated (withdrawal) but never after a terminal state.
  if (from === "SUBMITTED" || from === "UNDER_REVIEW" || from === "CHANGES_REQUIRED" || from === "DRAFT") set.add("TERMINATED");
  return [...set];
}

export function canTransitionPilot(from: string, to: string): boolean {
  if (!(PILOT_STATUSES as readonly string[]).includes(from) || !(PILOT_STATUSES as readonly string[]).includes(to)) return false;
  if (isTerminalPilotStatus(from)) return false;
  return (allowedPilotTransitions(from as PilotStatus) as readonly string[]).includes(to);
}

/** The named lifecycle action → the (from,to) transition it performs (drives the API + UI controls). */
export const PILOT_ACTIONS = {
  submit: { to: "SUBMITTED" as PilotStatus, from: ["DRAFT", "CHANGES_REQUIRED"] as PilotStatus[] },
  begin_review: { to: "UNDER_REVIEW" as PilotStatus, from: ["SUBMITTED"] as PilotStatus[] },
  request_changes: { to: "CHANGES_REQUIRED" as PilotStatus, from: ["UNDER_REVIEW", "READINESS_REVIEW"] as PilotStatus[] },
  approve_sandbox: { to: "APPROVED_FOR_SANDBOX" as PilotStatus, from: ["UNDER_REVIEW"] as PilotStatus[] },
  activate_sandbox: { to: "SANDBOX_ACTIVE" as PilotStatus, from: ["APPROVED_FOR_SANDBOX"] as PilotStatus[] },
  start_readiness: { to: "READINESS_REVIEW" as PilotStatus, from: ["SANDBOX_ACTIVE", "SUSPENDED"] as PilotStatus[] },
  mark_ready: { to: "READY_FOR_PILOT" as PilotStatus, from: ["READINESS_REVIEW"] as PilotStatus[] },
  activate: { to: "PILOT_ACTIVE" as PilotStatus, from: ["READY_FOR_PILOT"] as PilotStatus[] },
  pause: { to: "PILOT_PAUSED" as PilotStatus, from: ["PILOT_ACTIVE"] as PilotStatus[] },
  resume: { to: "PILOT_ACTIVE" as PilotStatus, from: ["PILOT_PAUSED"] as PilotStatus[] },
  suspend: { to: "SUSPENDED" as PilotStatus, from: [...OPERATIONAL_STATUSES] as PilotStatus[] },
  terminate: { to: "TERMINATED" as PilotStatus, from: [] as PilotStatus[] },
  reject: { to: "REJECTED" as PilotStatus, from: ["UNDER_REVIEW"] as PilotStatus[] },
} as const;
export type PilotActionName = keyof typeof PILOT_ACTIONS;

// ═══════════════════════════════════════════════════════════════════════════════
// Readiness engine (PURE — advisory only; never auto-activates)
// ═══════════════════════════════════════════════════════════════════════════════
export const READINESS_STATES = ["READY", "BLOCKED", "NOT_EVALUATED"] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];

export const READINESS_BLOCKING_CODES = [
  "AUTHORIZATION_INCOMPLETE", "PRIVACY_REVIEW_INCOMPLETE", "SECURITY_REVIEW_INCOMPLETE", "REQUIRED_CHECK_FAILED",
  "REQUIRED_CHECK_MISSING", "CAPABILITIES_NOT_APPROVED", "INSTALLATION_INACTIVE", "ACTIVE_KEY_MISSING",
  "COMPATIBILITY_TEST_MISSING", "IDEMPOTENCY_TEST_MISSING", "REPLAY_TEST_MISSING", "RATE_LIMIT_PROFILE_MISSING",
  "SUBJECT_LINKING_NOT_READY", "REQUIRED_CONTACT_MISSING", "CRITICAL_ALERT_OPEN",
] as const;
export type ReadinessBlockingCode = (typeof READINESS_BLOCKING_CODES)[number];
export const READINESS_WARNING_CODES = ["PILOT_WINDOW_UNSET", "REVIEW_DATE_UNSET", "OPTIONAL_CHECK_INCOMPLETE", "SANDBOX_TEST_STALE"] as const;
export type ReadinessWarningCode = (typeof READINESS_WARNING_CODES)[number];

export const READINESS_EVALUATOR_VERSION = "cs-pilot-readiness-1";

export interface ReadinessInput {
  status: string;
  checks: { checkType: string; status: string }[];
  privacyAssessmentStatus: string;
  securityAssessmentStatus: string;
  legalAuthorizationStatus: string;
  approvedCapabilities: string[];
  hasActiveInstallation: boolean;
  hasActiveKey: boolean;
  passedTestTypes: string[]; // test types with a PASSED result
  rateLimitProfileSet: boolean; // both volume + rate bands chosen
  subjectLinkingReady: boolean;
  requiredContactRolesPresent: boolean; // TECHNICAL + INCIDENT_RESPONSE present + active
  openCriticalAlertCount: number;
  pilotWindowSet: boolean;
  reviewDateSet: boolean;
}
export interface ReadinessResult {
  state: ReadinessState;
  blocking: ReadinessBlockingCode[];
  warnings: ReadinessWarningCode[];
  evaluatorVersion: string;
}

/**
 * Deterministic, side-effect-free readiness evaluation. Produces stable blocking CODES (never free strings).
 * ADVISORY ONLY: a READY result never activates a pilot — an authorized user must perform the explicit
 * activation transition. Fail-closed: any missing/failed input contributes a blocking reason.
 */
export function evaluatePilotReadiness(i: ReadinessInput): ReadinessResult {
  const blocking = new Set<ReadinessBlockingCode>();
  const warnings = new Set<ReadinessWarningCode>();
  const byType = new Map(i.checks.map((c) => [c.checkType, c.status] as const));

  // Assessments
  if (i.legalAuthorizationStatus !== "APPROVED") blocking.add("AUTHORIZATION_INCOMPLETE");
  if (i.privacyAssessmentStatus !== "APPROVED") blocking.add("PRIVACY_REVIEW_INCOMPLETE");
  if (i.securityAssessmentStatus !== "APPROVED") blocking.add("SECURITY_REVIEW_INCOMPLETE");

  // Mandatory checks
  for (const t of MANDATORY_CHECKS) {
    const st = byType.get(t);
    if (st === undefined || st === "NOT_STARTED" || st === "IN_REVIEW") { blocking.add("REQUIRED_CHECK_MISSING"); continue; }
    if (st === "FAILED") { blocking.add("REQUIRED_CHECK_FAILED"); continue; }
    if (st === "WAIVED" && isNonWaivableCheck(t)) blocking.add("REQUIRED_CHECK_FAILED"); // a non-waivable check can never be satisfied by a waiver
  }
  // Optional-completeness warning (any mandatory check waived where allowed)
  for (const t of MANDATORY_CHECKS) if (byType.get(t) === "WAIVED" && !isNonWaivableCheck(t)) warnings.add("OPTIONAL_CHECK_INCOMPLETE");

  // Capabilities + installation + key
  if (!i.approvedCapabilities.includes("signal.submit")) blocking.add("CAPABILITIES_NOT_APPROVED");
  if (!i.hasActiveInstallation) blocking.add("INSTALLATION_INACTIVE");
  if (!i.hasActiveKey) blocking.add("ACTIVE_KEY_MISSING");

  // Required compatibility tests — EVERY REQUIRED_READINESS_TESTS entry must have PASSED (a SKIPPED run is
  // result "SKIPPED", never "PASSED", so it can never satisfy a requirement). Signature + payload-validation
  // both map to COMPATIBILITY_TEST_MISSING to keep the stable blocking-code set at 15.
  if (!i.passedTestTypes.includes("SIGNATURE_COMPATIBILITY") || !i.passedTestTypes.includes("PAYLOAD_VALIDATION")) blocking.add("COMPATIBILITY_TEST_MISSING");
  if (!i.passedTestTypes.includes("IDEMPOTENCY_DUPLICATE") || !i.passedTestTypes.includes("IDEMPOTENCY_CONFLICT")) blocking.add("IDEMPOTENCY_TEST_MISSING");
  if (!i.passedTestTypes.includes("NONCE_REPLAY")) blocking.add("REPLAY_TEST_MISSING");

  // Config + contacts + alerts
  if (!i.rateLimitProfileSet) blocking.add("RATE_LIMIT_PROFILE_MISSING");
  if (!i.subjectLinkingReady) blocking.add("SUBJECT_LINKING_NOT_READY");
  if (!i.requiredContactRolesPresent) blocking.add("REQUIRED_CONTACT_MISSING");
  if (i.openCriticalAlertCount > 0) blocking.add("CRITICAL_ALERT_OPEN");

  if (!i.pilotWindowSet) warnings.add("PILOT_WINDOW_UNSET");
  if (!i.reviewDateSet) warnings.add("REVIEW_DATE_UNSET");

  const state: ReadinessState = blocking.size === 0 ? "READY" : "BLOCKED";
  return { state, blocking: [...blocking], warnings: [...warnings], evaluatorVersion: READINESS_EVALUATOR_VERSION };
}

// ── Bounded-notes guard (shared by service + API) ─────────────────────────────
export const PILOT_MAX_NOTE_LEN = 500;
/** A bounded internal note must be short and must NOT contain raw-content/PII/credential markers. Reuses the
 *  protocol's prohibited-key vocabulary conceptually; here we scan for obvious sensitive tokens as a
 *  defense-in-depth guard (the field is operational metadata only). */
const NOTE_PROHIBITED = /\b(BEGIN [A-Z ]*PRIVATE KEY|password|passwd|api[_-]?key|secret|bearer|ssn|credit\s*card)\b/i;
export function isSafeBoundedNote(v: unknown): v is string {
  return typeof v === "string" && v.length <= PILOT_MAX_NOTE_LEN && !NOTE_PROHIBITED.test(v) && !CONTROL_CHARS.test(v);
}
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
