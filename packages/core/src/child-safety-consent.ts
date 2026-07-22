/**
 * Tamanor Child Safety — Consent, Guardian Authority & Safe Recipients FOUNDATION (CS-C2).
 *
 * PURE, crypto-free domain model that STRICTLY separates four axes that must never be conflated or
 * auto-derived from one another:
 *   1) guardian relationship (CS-C1)      — a link exists,
 *   2) guardian AUTHORITY                 — a verified legal/delegated right to act,
 *   3) CONSENT                            — an explicit, time-bounded permission,
 *   4) safe-recipient ELIGIBILITY         — an explicit assessment to receive safety information.
 *
 * CS-C2 ships types + fail-closed pure evaluators ONLY. No alert/notification/delivery, no evidence
 * or document storage, no scheduler, no auto-grant, no auto safe-recipient. `verificationMethod` and
 * `reasonCode` are process metadata (allow-listed enums) — never proof, free text, or raw content.
 *
 * Client-safe subpath: `@guardora/core/child-safety-consent`.
 */

import { ConsentStatus, SafetyRecipientEligibility } from "./child-safety-signal";

// --- New CS-C2 enums (only what CS-0 did not already define) -----------------

/** WHY a guardian may act. Distinct from GuardianRelationshipType (WHAT the relationship is). */
export enum GuardianAuthorityType {
  LegalGuardian = "legal_guardian",
  ParentalResponsibility = "parental_responsibility",
  CourtAppointed = "court_appointed",
  DelegatedCare = "delegated_care",
  TemporaryCare = "temporary_care",
  OtherVerified = "other_verified",
}
export const ALL_GUARDIAN_AUTHORITY_TYPES: readonly GuardianAuthorityType[] = Object.values(GuardianAuthorityType);

/** Lifecycle of an authority record. Only VERIFIED (and time-valid) is ever "active". */
export enum GuardianAuthorityStatus {
  Pending = "pending",
  Verified = "verified",
  Revoked = "revoked",
  Expired = "expired",
  Rejected = "rejected",
}
export const ALL_GUARDIAN_AUTHORITY_STATUSES: readonly GuardianAuthorityStatus[] = Object.values(GuardianAuthorityStatus);

/** Process metadata about HOW an authority was checked — NOT the proof/document itself. */
export enum VerificationMethod {
  ManualReview = "manual_review",
  DocumentCheck = "document_check",
  OrganizationConfirmation = "organization_confirmation",
  Other = "other",
}
export const ALL_VERIFICATION_METHODS: readonly VerificationMethod[] = Object.values(VerificationMethod);

/** Lifecycle of a safe-recipient assessment. Eligibility itself reuses SafetyRecipientEligibility. */
export enum SafeRecipientAssessmentStatus {
  NotStarted = "not_started",
  Pending = "pending",
  Approved = "approved",
  Rejected = "rejected",
  Revoked = "revoked",
  Expired = "expired",
}
export const ALL_SAFE_RECIPIENT_ASSESSMENT_STATUSES: readonly SafeRecipientAssessmentStatus[] = Object.values(SafeRecipientAssessmentStatus);

/** Allow-listed, content-free reason codes for an assessment outcome. NEVER free text / notes. */
export enum SafeRecipientReasonCode {
  IdentityUnverified = "identity_unverified",
  InsufficientAuthority = "insufficient_authority",
  ConsentMissing = "consent_missing",
  ConflictOfInterest = "conflict_of_interest",
  PolicyRestriction = "policy_restriction",
  GuardianRequest = "guardian_request",
  ExpertReferral = "expert_referral",
  Other = "other",
}
export const ALL_SAFE_RECIPIENT_REASON_CODES: readonly SafeRecipientReasonCode[] = Object.values(SafeRecipientReasonCode);

// --- Value guards (fail-closed) ---------------------------------------------

export const isGuardianAuthorityType = (x: unknown): x is GuardianAuthorityType => (ALL_GUARDIAN_AUTHORITY_TYPES as readonly string[]).includes(x as string);
export const isGuardianAuthorityStatus = (x: unknown): x is GuardianAuthorityStatus => (ALL_GUARDIAN_AUTHORITY_STATUSES as readonly string[]).includes(x as string);
export const isVerificationMethod = (x: unknown): x is VerificationMethod => (ALL_VERIFICATION_METHODS as readonly string[]).includes(x as string);
export const isSafeRecipientAssessmentStatus = (x: unknown): x is SafeRecipientAssessmentStatus => (ALL_SAFE_RECIPIENT_ASSESSMENT_STATUSES as readonly string[]).includes(x as string);
export const isSafeRecipientReasonCode = (x: unknown): x is SafeRecipientReasonCode => (ALL_SAFE_RECIPIENT_REASON_CODES as readonly string[]).includes(x as string);

// --- Strict content-free input allowlists (validated with validateChildSafetyInput) ----

export const GUARDIAN_AUTHORITY_CREATE_FIELDS: readonly string[] = ["guardianRelationshipId", "authorityType", "validFrom", "validUntil"];
export const GUARDIAN_AUTHORITY_VERIFY_FIELDS: readonly string[] = ["verificationMethod", "validUntil"];
export const CONSENT_CREATE_FIELDS: readonly string[] = ["protectedProfileId", "guardianRelationshipId", "consentType", "validFrom", "validUntil"];
export const CONSENT_GRANT_FIELDS: readonly string[] = ["validFrom", "validUntil"];
export const SAFE_RECIPIENT_ASSESSMENT_CREATE_FIELDS: readonly string[] = ["guardianRelationshipId"];
export const SAFE_RECIPIENT_ASSESSMENT_DECIDE_FIELDS: readonly string[] = ["reasonCode", "validUntil"];

// --- CS-C2 defaults (nothing is auto-granted / auto-eligible) ----------------

export const GUARDIAN_AUTHORITY_DEFAULT_STATUS = GuardianAuthorityStatus.Pending;
export const CONSENT_DEFAULT_STATUS = ConsentStatus.NotRequested;      // maps to "not requested" (CS-0 term)
export const CONSENT_GRANTED_STATUS = ConsentStatus.Active;            // CS-0 "active" == GRANTED (documented mapping)
export const CONSENT_REVOKED_STATUS = ConsentStatus.Withdrawn;        // CS-0 "withdrawn" == REVOKED (documented mapping)
export const ASSESSMENT_DEFAULT_STATUS = SafeRecipientAssessmentStatus.NotStarted;

/**
 * Which relationship types require a VERIFIED authority record before a safe-recipient decision.
 * CS-C2 is maximally fail-closed: EVERY type requires verified authority. Kept as a helper so CS-C3
 * can refine (e.g. inherent parental responsibility) WITHOUT weakening the current default.
 */
export function relationshipTypeRequiresAuthority(_relationshipType: string): boolean {
  return true;
}

// --- Pure effective-state evaluators (fail-closed; no side effects) ----------

export interface AuthorityRecordState {
  authorityStatus: string; validFrom: Date | null; validUntil: Date | null; revokedAt: Date | null; archivedAt: Date | null;
}
/** Active iff VERIFIED, not revoked/archived, and within [validFrom, validUntil). Unknown status → false. */
export function isGuardianAuthorityActive(r: AuthorityRecordState, now: Date): boolean {
  if (!isGuardianAuthorityStatus(r.authorityStatus)) return false;             // fail closed
  if (r.authorityStatus !== GuardianAuthorityStatus.Verified) return false;
  if (r.revokedAt !== null || r.archivedAt !== null) return false;
  if (r.validFrom !== null && r.validFrom.getTime() > now.getTime()) return false;
  if (r.validUntil !== null && r.validUntil.getTime() <= now.getTime()) return false; // EXPIRED even if status stayed VERIFIED
  return true;
}

const ALL_CONSENT_STATUSES: readonly string[] = Object.values(ConsentStatus);
export interface ConsentRecordState {
  consentStatus: string; grantedAt: Date | null; grantedByMembershipId: string | null;
  validFrom: Date | null; validUntil: Date | null; revokedAt: Date | null; archivedAt: Date | null;
}
/** Effective iff ACTIVE, granted (grantedAt + grantedBy present), time-valid, not revoked/archived. */
export function isConsentEffective(r: ConsentRecordState, now: Date): boolean {
  if (!ALL_CONSENT_STATUSES.includes(r.consentStatus)) return false; // fail closed
  if (r.consentStatus !== ConsentStatus.Active) return false;
  if (r.grantedAt === null || r.grantedByMembershipId === null) return false; // GRANTED must be provable
  if (r.revokedAt !== null || r.archivedAt !== null) return false;
  if (r.validFrom !== null && r.validFrom.getTime() > now.getTime()) return false;
  if (r.validUntil !== null && r.validUntil.getTime() <= now.getTime()) return false; // EXPIRED
  return true;
}

export interface AssessmentRecordState {
  assessmentStatus: string; eligibilityStatus: string; assessedAt: Date | null; assessedByMembershipId: string | null;
  validUntil: Date | null; revokedAt: Date | null; archivedAt: Date | null;
}
/** Approved-active iff APPROVED + eligibility ELIGIBLE + assessedBy/assessedAt present + time-valid. */
export function isSafeRecipientAssessmentApproved(r: AssessmentRecordState, now: Date): boolean {
  if (!isSafeRecipientAssessmentStatus(r.assessmentStatus)) return false; // fail closed
  if (r.assessmentStatus !== SafeRecipientAssessmentStatus.Approved) return false;
  if (r.eligibilityStatus !== SafetyRecipientEligibility.Eligible) return false;
  if (r.assessedAt === null || r.assessedByMembershipId === null) return false;
  if (r.revokedAt !== null || r.archivedAt !== null) return false;
  if (r.validUntil !== null && r.validUntil.getTime() <= now.getTime()) return false; // EXPIRED
  return true;
}

/** All conditions for `canReceiveSafetyInformation`, evaluated from already-loaded state. */
export interface SafetyRecipientChain {
  workspaceKind: string;
  relationshipActive: boolean;                 // CS-C1 active guardian relationship
  relationshipType: string;
  membershipActiveSameTenant: boolean;
  authorityActive: boolean;                    // effective verified authority present
  consentEffective: boolean;                   // effective granted consent present
  assessmentApproved: boolean;                 // effective approved assessment present
}
export type SafetyRecipientDenyReason =
  | "not_family_workspace" | "relationship_inactive" | "membership_invalid"
  | "authority_missing" | "consent_missing" | "assessment_not_approved";

/**
 * The ONLY sanctioned safe-recipient authorization decision. TRUE iff the COMPLETE chain holds.
 * Pure — no side effects, no delivery. Fail-closed: any missing/invalid link → false + a reason.
 */
export function evaluateCanReceiveSafetyInformation(c: SafetyRecipientChain): { ok: boolean; reasons: SafetyRecipientDenyReason[] } {
  const reasons: SafetyRecipientDenyReason[] = [];
  if (c.workspaceKind !== "family") reasons.push("not_family_workspace");
  if (!c.relationshipActive) reasons.push("relationship_inactive");
  if (!c.membershipActiveSameTenant) reasons.push("membership_invalid");
  if (relationshipTypeRequiresAuthority(c.relationshipType) && !c.authorityActive) reasons.push("authority_missing");
  if (!c.consentEffective) reasons.push("consent_missing");
  if (!c.assessmentApproved) reasons.push("assessment_not_approved");
  return { ok: reasons.length === 0, reasons };
}
