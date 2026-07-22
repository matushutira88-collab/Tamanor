/**
 * Tamanor Child Safety — Authorized Recipient Resolution & Disclosure Decisions FOUNDATION (CS-C4).
 *
 * For a specific SafetySignal, CS-C4 computes and RECORDS whether an authorized safe recipient exists.
 * It answers ONE question: "Is this membership, right now, authorized to receive a specific SCOPE of
 * information about this SafetySignal?" — and NOTHING is ever delivered.
 *
 * The seven axes stay strictly separate: (1) signal, (2) relationship, (3) authority, (4) consent,
 * (5) safe-recipient assessment, (6) recipient authorization DECISION, (7) delivery. CS-C4 is ONLY
 * point 6. It reuses the CS-C2 effective evaluators (never duplicates or weakens them). Decisions are
 * HISTORICAL snapshots of record IDs + safe enum values — never PII, raw content, or record copies.
 *
 * Client-safe subpath: `@guardora/core/child-safety-recipient-authorization`.
 */

import { RiskType, SafetySeverity } from "./child-safety-signal";
import type { SafetyRecipientDenyReason } from "./child-safety-consent";

// --- Disclosure scope (allow-listed; NO raw content ever) --------------------

/**
 * The ONLY scopes that may ever be disclosed. RAW_CONTENT / MESSAGE_TEXT / IMAGE / VIDEO / AUDIO /
 * PLATFORM_USERNAME / PROFILE_IDENTIFIER / EXACT_LOCATION / CONTACT_DETAILS / PLATFORM_MESSAGE_ID /
 * EXTERNAL_URL / EVIDENCE deliberately DO NOT EXIST in this enum — they can never be produced.
 */
export enum SafetyDisclosureScope {
  SignalExistence = "signal_existence",
  RiskCategory = "risk_category",
  Severity = "severity",
  TimingBucket = "timing_bucket",
  RecommendedActionClass = "recommended_action_class",
}
export const ALL_SAFETY_DISCLOSURE_SCOPES: readonly SafetyDisclosureScope[] = Object.values(SafetyDisclosureScope);
export const isSafetyDisclosureScope = (x: unknown): x is SafetyDisclosureScope => (ALL_SAFETY_DISCLOSURE_SCOPES as readonly string[]).includes(x as string);

// --- Decision status + reason code (allow-listed) ----------------------------

export enum RecipientAuthorizationDecisionStatus {
  Pending = "pending",
  Authorized = "authorized",
  Denied = "denied",
  Revoked = "revoked",
  Expired = "expired",
  Superseded = "superseded",
}
export const ALL_RECIPIENT_AUTHORIZATION_DECISION_STATUSES: readonly RecipientAuthorizationDecisionStatus[] = Object.values(RecipientAuthorizationDecisionStatus);
export const isRecipientAuthorizationDecisionStatus = (x: unknown): x is RecipientAuthorizationDecisionStatus => (ALL_RECIPIENT_AUTHORIZATION_DECISION_STATUSES as readonly string[]).includes(x as string);

export enum RecipientAuthorizationReasonCode {
  CompleteAuthorizationChain = "complete_authorization_chain",
  NoActiveGuardianRelationship = "no_active_guardian_relationship",
  NoValidAuthority = "no_valid_authority",
  NoValidConsent = "no_valid_consent",
  NoApprovedSafeRecipient = "no_approved_safe_recipient",
  InactiveMembership = "inactive_membership",
  TenantMismatch = "tenant_mismatch",
  ProfileMismatch = "profile_mismatch",
  SignalArchived = "signal_archived",
  ConsentScopeInsufficient = "consent_scope_insufficient",
  RecipientRoleNotAllowed = "recipient_role_not_allowed",
  AuthorizationRevoked = "authorization_revoked",
  SupersededByNewDecision = "superseded_by_new_decision",
}
export const ALL_RECIPIENT_AUTHORIZATION_REASON_CODES: readonly RecipientAuthorizationReasonCode[] = Object.values(RecipientAuthorizationReasonCode);
export const isRecipientAuthorizationReasonCode = (x: unknown): x is RecipientAuthorizationReasonCode => (ALL_RECIPIENT_AUTHORIZATION_REASON_CODES as readonly string[]).includes(x as string);

/** Map a CS-C2 chain deny reason to a CS-C4 reason code (fail-closed default). */
export function reasonCodeForDenyReason(r: SafetyRecipientDenyReason): RecipientAuthorizationReasonCode {
  switch (r) {
    case "relationship_inactive": return RecipientAuthorizationReasonCode.NoActiveGuardianRelationship;
    case "membership_invalid": return RecipientAuthorizationReasonCode.InactiveMembership;
    case "authority_missing": return RecipientAuthorizationReasonCode.NoValidAuthority;
    case "consent_missing": return RecipientAuthorizationReasonCode.NoValidConsent;
    case "assessment_not_approved": return RecipientAuthorizationReasonCode.NoApprovedSafeRecipient;
    case "not_family_workspace": return RecipientAuthorizationReasonCode.TenantMismatch;
    default: return RecipientAuthorizationReasonCode.NoApprovedSafeRecipient; // fail closed
  }
}

// --- Deterministic disclosure policy (explicit, testable, no AI, no free text) ----

const DISCLOSURE_POLICY_BY_SEVERITY: Readonly<Record<SafetySeverity, readonly SafetyDisclosureScope[]>> = {
  [SafetySeverity.Low]: [SafetyDisclosureScope.SignalExistence, SafetyDisclosureScope.RiskCategory],
  [SafetySeverity.Medium]: [SafetyDisclosureScope.SignalExistence, SafetyDisclosureScope.RiskCategory, SafetyDisclosureScope.Severity],
  [SafetySeverity.High]: [SafetyDisclosureScope.SignalExistence, SafetyDisclosureScope.RiskCategory, SafetyDisclosureScope.Severity, SafetyDisclosureScope.TimingBucket],
  [SafetySeverity.Critical]: [SafetyDisclosureScope.SignalExistence, SafetyDisclosureScope.RiskCategory, SafetyDisclosureScope.Severity, SafetyDisclosureScope.TimingBucket, SafetyDisclosureScope.RecommendedActionClass],
};

/** Deterministic, sorted MAX disclosure scope for a signal. Unknown severity → minimal (fail-closed). */
export function maxDisclosureScopesForSignal(severity: string, signalType: string): SafetyDisclosureScope[] {
  const base = DISCLOSURE_POLICY_BY_SEVERITY[severity as SafetySeverity] ?? [SafetyDisclosureScope.SignalExistence];
  let scopes = [...base];
  // Stricter rule: identity manipulation is minimized regardless of severity (never timing/action class).
  if (signalType === RiskType.IdentityManipulation) {
    scopes = scopes.filter((s) => s === SafetyDisclosureScope.SignalExistence || s === SafetyDisclosureScope.RiskCategory);
  }
  return sortScopes([...new Set(scopes)]);
}

/** A DENIED decision may never carry a wider scope than the safe default (nothing). */
export const DENIED_DISCLOSURE_SCOPES: readonly SafetyDisclosureScope[] = [];

// --- Bounded scalar serialization (no JSON, deterministic, validated) --------

export const SAFETY_DISCLOSURE_SCOPE_MAX_LEN = 200;
function sortScopes(scopes: SafetyDisclosureScope[]): SafetyDisclosureScope[] {
  return [...scopes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
/** Serialize a scope set to a deterministic, comma-joined, sorted, deduped bounded string. */
export function serializeDisclosureScopes(scopes: readonly SafetyDisclosureScope[]): string {
  return sortScopes([...new Set(scopes)]).join(",");
}
/** Parse + STRICTLY validate a serialized scope string. Any unknown token → throws-free empty via ok:false. */
export function parseDisclosureScopes(raw: string | null | undefined): { ok: boolean; scopes: SafetyDisclosureScope[] } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, scopes: [] };
  if (typeof raw !== "string" || raw.length > SAFETY_DISCLOSURE_SCOPE_MAX_LEN) return { ok: false, scopes: [] };
  const parts = raw.split(",");
  const scopes: SafetyDisclosureScope[] = [];
  for (const p of parts) {
    if (!isSafetyDisclosureScope(p)) return { ok: false, scopes: [] };
    scopes.push(p);
  }
  return { ok: true, scopes: sortScopes([...new Set(scopes)]) };
}
/** True iff every requested scope is within `allowed` (subset check). */
export function scopesWithin(requested: readonly SafetyDisclosureScope[], allowed: readonly SafetyDisclosureScope[]): boolean {
  const set = new Set<string>(allowed);
  return requested.every((s) => set.has(s));
}

// --- Recipient role eligibility ---------------------------------------------

/** FamilyRole values (from @guardora/core workspace) that MAY ever be an information recipient. */
export const RECIPIENT_ELIGIBLE_FAMILY_ROLES: readonly string[] = [
  "primary_guardian", "guardian", "safety_professional", "trusted_adult",
]; // NOT family_viewer — a viewer is never an information recipient.
export function isRecipientEligibleFamilyRole(familyRole: string): boolean {
  return RECIPIENT_ELIGIBLE_FAMILY_ROLES.includes(familyRole);
}

// --- Pure effective-decision evaluator (row-level; DB re-checks the CS-2 chain) ----

export interface RecipientAuthorizationDecisionState {
  decisionStatus: string; validUntil: Date | null; revokedAt: Date | null; supersededAt: Date | null; archivedAt: Date | null;
}
/**
 * Row-level effectiveness: AUTHORIZED, not revoked/superseded/archived, and time-valid. Unknown status
 * → false (fail-closed). NOTE: the DB layer ADDITIONALLY re-evaluates the live CS-2 chain, so a decision
 * whose underlying consent/authority/relationship/assessment was later revoked is NOT effective.
 */
export function isRecipientAuthorizationDecisionRowEffective(d: RecipientAuthorizationDecisionState, now: Date): boolean {
  if (!isRecipientAuthorizationDecisionStatus(d.decisionStatus)) return false;
  if (d.decisionStatus !== RecipientAuthorizationDecisionStatus.Authorized) return false;
  if (d.revokedAt !== null || d.supersededAt !== null || d.archivedAt !== null) return false;
  if (d.validUntil !== null && d.validUntil.getTime() <= now.getTime()) return false;
  return true;
}

// --- Input allowlists --------------------------------------------------------

export const RECIPIENT_AUTHORIZATION_EVALUATE_FIELDS: readonly string[] = [
  "safetySignalId", "recipientMembershipId", "guardianRelationshipId", "consentType", "requestedScopes",
];
export const RECIPIENT_AUTHORIZATION_CREATE_FIELDS: readonly string[] = [
  "safetySignalId", "recipientMembershipId", "guardianRelationshipId", "consentType", "requestedScopes", "validUntil",
];

// --- Bounds ------------------------------------------------------------------

export const RECIPIENT_AUTHORIZATION_LIST_MAX_LIMIT = 200;
export const RECIPIENT_AUTHORIZATION_LIST_DEFAULT_LIMIT = 50;
export function clampRecipientAuthorizationLimit(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return RECIPIENT_AUTHORIZATION_LIST_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), RECIPIENT_AUTHORIZATION_LIST_MAX_LIMIT);
}
