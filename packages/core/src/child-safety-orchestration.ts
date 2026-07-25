/**
 * CS-C6 — deterministic policy decision for an accepted safety signal. PURE: given the signal's
 * severity/urgency/confidence and the AUTHORIZATION facts gathered from the existing canonical services
 * (guardian authority, recipient authorization, safe-recipient assessment, consent), it returns exactly
 * one canonical outcome + whether a guardian may be notified. This is NOT a parallel intervention engine
 * — it only decides; the gateway then routes the decision through the existing domain services.
 *
 * Mandatory, fail-closed rules encoded here:
 *   • low-confidence signals never notify a guardian;
 *   • no notification without valid guardian authority AND recipient authorization AND a safe recipient
 *     AND valid (non-expired/revoked) consent;
 *   • repeated eligible signals escalate deterministically;
 *   • urgent eligible signals escalate.
 */
import { SafetySeverity, SafetyUrgency, RiskType } from "./child-safety-signal";
import { SafetyConfidenceBand } from "./child-safety-safety-signal";

/** The canonical outcomes. A discriminated label only — never a persisted domain status. */
export enum ChildSafetyOutcome {
  NoAction = "NO_ACTION",
  LocalSafetyGuidance = "LOCAL_SAFETY_GUIDANCE",
  QueueForReview = "QUEUE_FOR_REVIEW",
  NotifyAuthorizedGuardian = "NOTIFY_AUTHORIZED_GUARDIAN",
  CreateOrUpdateIncident = "CREATE_OR_UPDATE_INCIDENT",
  UrgentEscalation = "URGENT_ESCALATION",
}
export const ALL_CHILD_SAFETY_OUTCOMES: readonly ChildSafetyOutcome[] = Object.values(ChildSafetyOutcome);

/** Authorization facts, each derived from an EXISTING canonical service (never invented here). */
export interface ChildSafetyPolicyFacts {
  severity: SafetySeverity;
  urgency: SafetyUrgency;
  confidenceBand: SafetyConfidenceBand;
  /** An active, non-revoked guardian with authority over this profile. */
  hasValidGuardianAuthority: boolean;
  /** A recipient-authorization decision resolving to authorized. */
  hasRecipientAuthorization: boolean;
  /** The safe-recipient assessment is eligible (not suppressed/conflicted/unverified). */
  recipientSafe: boolean;
  /** Consent is active (not expired, withdrawn, suspended, or disputed). */
  consentValid: boolean;
  /** Count of prior eligible signals for this profile (drives deterministic repeat-escalation). */
  repeatedSignalCount: number;
}

/** Bounded reason code — never a free-text explanation. */
export type ChildSafetyPolicyReason =
  | "low_confidence_review" | "authorization_blocked" | "urgent" | "repeated_escalation"
  | "high_confidence" | "notify";

export interface ChildSafetyPolicyDecision {
  outcome: ChildSafetyOutcome;
  notifyGuardian: boolean;
  reasonCode: ChildSafetyPolicyReason;
}

const REPEAT_ESCALATION_THRESHOLD = 3;

export function decideChildSafetyOutcome(f: ChildSafetyPolicyFacts): ChildSafetyPolicyDecision {
  const lowConfidence = f.confidenceBand === SafetyConfidenceBand.Unknown || f.confidenceBand === SafetyConfidenceBand.Low;
  const critical = f.severity === SafetySeverity.Critical || f.urgency === SafetyUrgency.Immediate;
  const elevated = f.severity === SafetySeverity.High || f.urgency === SafetyUrgency.Elevated;
  const authorizationOk = f.hasValidGuardianAuthority && f.hasRecipientAuthorization && f.recipientSafe && f.consentValid;

  // 1) Low confidence → review only; NEVER notify a guardian.
  if (lowConfidence) return { outcome: ChildSafetyOutcome.QueueForReview, notifyGuardian: false, reasonCode: "low_confidence_review" };

  // 2) Authorization gate (fail-closed): missing authority / recipient authorization / safe recipient /
  //    valid consent → record + review or incident, but NEVER notify.
  if (!authorizationOk) {
    return { outcome: critical ? ChildSafetyOutcome.CreateOrUpdateIncident : ChildSafetyOutcome.QueueForReview, notifyGuardian: false, reasonCode: "authorization_blocked" };
  }

  // 3) Authorized + confident.
  if (critical) return { outcome: ChildSafetyOutcome.UrgentEscalation, notifyGuardian: true, reasonCode: "urgent" };
  if (f.repeatedSignalCount >= REPEAT_ESCALATION_THRESHOLD) return { outcome: ChildSafetyOutcome.CreateOrUpdateIncident, notifyGuardian: true, reasonCode: "repeated_escalation" };
  if (elevated) return { outcome: ChildSafetyOutcome.CreateOrUpdateIncident, notifyGuardian: true, reasonCode: "high_confidence" };
  return { outcome: ChildSafetyOutcome.NotifyAuthorizedGuardian, notifyGuardian: true, reasonCode: "notify" };
}

// ─────────────────────────────────────────────────────────────────────────────
// CS-C15 — enriched deterministic intervention policy (pure). Extends the CS-C6 decision with risk
// family, urgent-risk types, existing-incident correlation, and escalation state, and returns the
// concrete side-effect flags the orchestrator must execute exactly-once. Preserves every mandatory
// fail-closed rule; NEVER lowers an existing incident's severity/urgency (the orchestrator enforces).
// ─────────────────────────────────────────────────────────────────────────────

/** Coarse risk family — used ONLY for deterministic incident correlation (never a legal verdict). */
export enum ChildSafetyRiskFamily {
  Sexual = "sexual",
  Grooming = "grooming",
  Violence = "violence",
  Coercion = "coercion",
  Scam = "scam",
  Bullying = "bullying",
  Identity = "identity",
}

/** Documented risk-family mapping (stable). */
export function riskFamilyOf(riskType: RiskType): ChildSafetyRiskFamily {
  switch (riskType) {
    case RiskType.SexualSolicitation:
    case RiskType.Sextortion:
      return ChildSafetyRiskFamily.Sexual;
    case RiskType.Grooming:
    case RiskType.MeetingAttempt:
      return ChildSafetyRiskFamily.Grooming;
    case RiskType.Threat:
      return ChildSafetyRiskFamily.Violence;
    case RiskType.Coercion:
      return ChildSafetyRiskFamily.Coercion;
    case RiskType.ScamExploitation:
      return ChildSafetyRiskFamily.Scam;
    case RiskType.Cyberbullying:
      return ChildSafetyRiskFamily.Bullying;
    case RiskType.IdentityManipulation:
      return ChildSafetyRiskFamily.Identity;
  }
}

/** Documented incident correlation window: signals of the same risk family within 30 days correlate. */
export const INCIDENT_CORRELATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Risk types that are inherently urgent (escalation-eligible) when confidently detected. */
const INHERENTLY_URGENT = new Set<RiskType>([RiskType.Sextortion, RiskType.MeetingAttempt]);

export interface InterventionFacts extends ChildSafetyPolicyFacts {
  riskType: RiskType;
  /** At least one FULLY-authorized safe recipient exists (resolved from canonical services). */
  hasAuthorizedRecipient: boolean;
  /** An existing active/non-terminal incident for this profile + related risk family, if any. */
  existingActiveIncidentId?: string | null;
  /** Whether an urgent escalation already fired for the correlated incident (idempotency). */
  alreadyEscalated: boolean;
}

export interface InterventionDecision {
  outcome: ChildSafetyOutcome;
  /** Deliver to an authorized safe recipient (only ever true with full authorization + confidence). */
  notifyGuardian: boolean;
  /** Create or update the canonical incident. */
  createOrUpdateIncident: boolean;
  /** Invoke the existing internal escalation service (never external reporting). */
  escalate: boolean;
  reasonCode: ChildSafetyPolicyReason | "urgent_risk_type";
}

/**
 * The full CS-C15 decision. Deterministic from canonical facts. Notification requires the SAME
 * authorization gate as CS-C6 (guardian authority + recipient authorization + safe recipient + consent)
 * AND a concretely authorized recipient AND non-low confidence. Urgent risks create/update an incident
 * and escalate once; a delivery only ever reaches an authorized safe recipient — otherwise the action
 * is internal (review / incident / internal escalation) with no unauthorized disclosure.
 */
export function decideIntervention(f: InterventionFacts): InterventionDecision {
  const authorizationOk = f.hasValidGuardianAuthority && f.hasRecipientAuthorization && f.recipientSafe && f.consentValid && f.hasAuthorizedRecipient;
  const lowConfidence = f.confidenceBand === SafetyConfidenceBand.Unknown || f.confidenceBand === SafetyConfidenceBand.Low;
  const critical = f.severity === SafetySeverity.Critical || f.urgency === SafetyUrgency.Immediate;
  const elevated = f.severity === SafetySeverity.High || f.urgency === SafetyUrgency.Elevated;
  const urgent = !lowConfidence && (critical || INHERENTLY_URGENT.has(f.riskType));
  const notify = !lowConfidence && authorizationOk;

  // 1) Low confidence → never notify, never auto-incident (unless an existing incident already exists).
  if (lowConfidence) {
    return { outcome: f.existingActiveIncidentId ? ChildSafetyOutcome.QueueForReview : ChildSafetyOutcome.LocalSafetyGuidance, notifyGuardian: false, createOrUpdateIncident: false, escalate: false, reasonCode: "low_confidence_review" };
  }

  // 2) Urgent risk → incident + escalation (escalate once); notify only an authorized safe recipient.
  if (urgent) {
    return { outcome: ChildSafetyOutcome.UrgentEscalation, notifyGuardian: notify, createOrUpdateIncident: true, escalate: !f.alreadyEscalated, reasonCode: INHERENTLY_URGENT.has(f.riskType) ? "urgent_risk_type" : "urgent" };
  }

  // 3) High/elevated OR repeated OR an existing correlated incident → create/update incident (+notify if authorized).
  if (elevated || f.repeatedSignalCount >= 3 || f.existingActiveIncidentId) {
    return { outcome: ChildSafetyOutcome.CreateOrUpdateIncident, notifyGuardian: notify, createOrUpdateIncident: true, escalate: false, reasonCode: f.repeatedSignalCount >= 3 ? "repeated_escalation" : "high_confidence" };
  }

  // 4) Moderate → review; notify only when fully authorized.
  return notify
    ? { outcome: ChildSafetyOutcome.NotifyAuthorizedGuardian, notifyGuardian: true, createOrUpdateIncident: false, escalate: false, reasonCode: "notify" }
    : { outcome: ChildSafetyOutcome.QueueForReview, notifyGuardian: false, createOrUpdateIncident: false, escalate: false, reasonCode: "authorization_blocked" };
}

// ─────────────────────────────────────────────────────────────────────────────
// CS-C15C — canonical child-safety INCIDENT + ESCALATION domain vocabulary (pure).
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical child-safety incident lifecycle. Terminal states are never reused for a new signal. */
export enum ChildSafetyIncidentStatus {
  Open = "open",
  UnderReview = "under_review",
  ActionRequired = "action_required",
  Monitoring = "monitoring",
  Resolved = "resolved",
  Closed = "closed",
}
export const CHILD_SAFETY_TERMINAL_INCIDENT_STATUSES: readonly ChildSafetyIncidentStatus[] = [
  ChildSafetyIncidentStatus.Resolved, ChildSafetyIncidentStatus.Closed,
];
export function isTerminalChildSafetyIncidentStatus(s: string): boolean {
  return (CHILD_SAFETY_TERMINAL_INCIDENT_STATUSES as readonly string[]).includes(s);
}

/** Internal escalation type — INTERNAL only; never external authority/police/school reporting. */
export enum ChildSafetyEscalationType { UrgentInternal = "urgent_internal" }
export enum ChildSafetyEscalationStatus { Triggered = "triggered", Acknowledged = "acknowledged", Resolved = "resolved" }
export enum ChildSafetyEscalationReason {
  Sextortion = "sextortion",
  CredibleMeetingAttempt = "credible_meeting_attempt",
  CriticalSexualSolicitation = "critical_sexual_solicitation",
  SevereCoerciveThreat = "severe_coercive_threat",
  CriticalViolenceThreat = "critical_violence_threat",
  RepeatedUrgent = "repeated_urgent",
}

/**
 * Two risk families CORRELATE into one incident iff they are the SAME family. `riskFamilyOf` already
 * groups the sub-risks that belong together (grooming + meeting-attempt → grooming; sexual solicitation
 * + sextortion → sexual; scam + phishing → scam), so same-family correlation implements the documented
 * matrix while keeping unrelated risks (e.g. cyberbullying vs scam; impersonation vs sexual) separate.
 */
export function areRiskFamiliesCompatible(a: ChildSafetyRiskFamily, b: ChildSafetyRiskFamily): boolean {
  return a === b;
}

/** Map an intervention reason to a bounded escalation reason code (deterministic). */
export function escalationReasonForRisk(riskType: RiskType, severity: SafetySeverity, repeated: boolean): ChildSafetyEscalationReason {
  if (riskType === RiskType.Sextortion) return ChildSafetyEscalationReason.Sextortion;
  if (riskType === RiskType.MeetingAttempt) return ChildSafetyEscalationReason.CredibleMeetingAttempt;
  if (riskType === RiskType.SexualSolicitation) return ChildSafetyEscalationReason.CriticalSexualSolicitation;
  if (riskType === RiskType.Coercion) return ChildSafetyEscalationReason.SevereCoerciveThreat;
  if (riskType === RiskType.Threat) return ChildSafetyEscalationReason.CriticalViolenceThreat;
  if (repeated) return ChildSafetyEscalationReason.RepeatedUrgent;
  return ChildSafetyEscalationReason.RepeatedUrgent;
}
