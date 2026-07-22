/**
 * Tamanor Child Safety — Family Domain FOUNDATION (CS-C1).
 *
 * The minimum PURE, crypto-free foundation for the Family data domain: the family
 * role→action authorization model (built on the CS-C0 FamilyRole + WorkspaceCapability
 * foundations — NEVER on the Business Permission model), namespaced audit actions, and
 * strict content-free input allowlists for ProtectedProfile / GuardianRelationship.
 *
 * CS-C1 adds NO detector, endpoint, alert, notification, or raw-content storage. A
 * ProtectedProfile is NOT a User: it carries no login/email/phone/Meta id/external
 * account id/username/message/media/location — enforced by the allowlists below and by
 * the DB schema. See docs/child-safety/ and docs/adr/child-safety/.
 *
 * Client-safe subpath: `@guardora/core/child-safety-family`.
 */

import { Role } from "./tenant";
import { FamilyRole, WorkspaceCapability, WorkspaceKind, capabilityAllowedInWorkspace } from "./workspace";
import {
  AgeBand, ALL_AGE_BANDS, ProtectionStatus,
  GuardianRelationshipType, GuardianAuthorityLevel, GuardianRelationshipStatus,
  GuardianRole, ALL_GUARDIAN_ROLES,
  ConsentStatus, ConsentType, SafetyRecipientEligibility,
} from "./child-safety-signal";

// --- Family authorization model (FamilyRole → FamilyAction) -----------------

/** Fine-grained family actions. Read (`*View`, `family:view`) vs mutate (`*Manage`/`*Assess`). */
export enum FamilyAction {
  FamilyView = "family:view",
  ProtectedProfileView = "protected_profile:view",
  ProtectedProfileManage = "protected_profile:manage",
  GuardianRelationshipView = "guardian_relationship:view",
  GuardianRelationshipManage = "guardian_relationship:manage",
  // CS-C2 — consent, guardian authority & safe recipients (Family-only). `Assess` is a mutate tier.
  GuardianAuthorityView = "guardian_authority:view",
  GuardianAuthorityManage = "guardian_authority:manage",
  ConsentView = "consent:view",
  ConsentManage = "consent:manage",
  SafeRecipientView = "safe_recipient:view",
  SafeRecipientAssess = "safe_recipient:assess",
  // CS-C3 — safety signal occurrence + classification metadata + review state (Family-only).
  SafetySignalView = "safety_signal:view",
  SafetySignalCreate = "safety_signal:create",
  SafetySignalReview = "safety_signal:review",
  SafetySignalArchive = "safety_signal:archive",
  // CS-C4 — authorized recipient resolution & disclosure decisions (Family-only). Evaluate is read-only
  // (no write); Create records a decision; Revoke invalidates one.
  SafetyRecipientAuthorizationView = "safety_recipient_authorization:view",
  SafetyRecipientAuthorizationEvaluate = "safety_recipient_authorization:evaluate",
  SafetyRecipientAuthorizationCreate = "safety_recipient_authorization:create",
  SafetyRecipientAuthorizationRevoke = "safety_recipient_authorization:revoke",
  // CS-C5 — INTERNAL delivery foundation (Family-only). `Acknowledge`/`Decline` are recipient acts on
  // one's OWN delivery (repository-enforced). Nothing is ever sent externally.
  SafetyDeliveryView = "safety_delivery:view",
  SafetyDeliveryCreate = "safety_delivery:create",
  SafetyDeliveryMakeAvailable = "safety_delivery:make_available",
  SafetyDeliveryAcknowledge = "safety_delivery:acknowledge",
  SafetyDeliveryDecline = "safety_delivery:decline",
  SafetyDeliveryRevoke = "safety_delivery:revoke",
  SafetyDeliveryArchive = "safety_delivery:archive",
  // CS-C8 — internal Family guardian invitations (Family-only). Create/View/Revoke are inviter-side and
  // role-gated; ACCEPT/DECLINE are self-service, authorized by the opaque token + a session-email match
  // (the invitee has no membership yet), so they are NOT modeled as role-gated actions here.
  FamilyInvitationView = "family_invitation:view",
  FamilyInvitationCreate = "family_invitation:create",
  FamilyInvitationRevoke = "family_invitation:revoke",
  // CS-C9 — guardian AUTHORITY lifecycle management (Family-only). DELIBERATELY the highest tier:
  // grant/change/suspend/resume/revoke are PrimaryGuardian-ONLY (excluded from GUARDIAN_ACTIONS below) —
  // no ambiguous custom delegation hierarchy. Viewing reuses the CS-C2 `GuardianAuthorityView`.
  FamilyAuthorityGrant = "family_authority:grant",
  FamilyAuthorityChange = "family_authority:change",
  FamilyAuthoritySuspend = "family_authority:suspend",
  FamilyAuthorityResume = "family_authority:resume",
  FamilyAuthorityRevoke = "family_authority:revoke",
}
/** CS-C9 — the PrimaryGuardian-only authority-management actions (excluded from the plain Guardian set). */
export const FAMILY_AUTHORITY_MANAGE_ACTIONS: readonly FamilyAction[] = [
  FamilyAction.FamilyAuthorityGrant, FamilyAction.FamilyAuthorityChange, FamilyAction.FamilyAuthoritySuspend,
  FamilyAction.FamilyAuthorityResume, FamilyAction.FamilyAuthorityRevoke,
];
export const ALL_FAMILY_ACTIONS: readonly FamilyAction[] = Object.values(FamilyAction);

/**
 * Map the stored Membership Business `Role` onto a `FamilyRole` inside a FAMILY workspace.
 * CS-C1 keeps the existing Membership.role column (no schema change); the Family authority
 * tier is DERIVED. This is a role-tier translation only — the Business Permission model is
 * never consulted for family data.
 */
export function familyRoleForMembershipRole(role: string): FamilyRole {
  switch (role) {
    case Role.Owner: return FamilyRole.PrimaryGuardian;
    case Role.Admin: return FamilyRole.Guardian;
    case Role.Analyst: return FamilyRole.SafetyProfessional;
    case Role.Reviewer: return FamilyRole.TrustedAdult;
    default: return FamilyRole.FamilyViewer; // viewer / unknown → least privilege (fail closed)
  }
}

const VIEW_ONLY: readonly FamilyAction[] = [
  FamilyAction.FamilyView, FamilyAction.ProtectedProfileView, FamilyAction.GuardianRelationshipView,
  // CS-C2 — reads only. Trusted-adult / safety-professional / viewer NEVER verify/grant/approve.
  FamilyAction.GuardianAuthorityView, FamilyAction.ConsentView, FamilyAction.SafeRecipientView,
  // CS-C3 — reads only. Trusted-adult / viewer may VIEW safety signals but never create/review/archive.
  FamilyAction.SafetySignalView,
];
const FULL_MANAGE: readonly FamilyAction[] = ALL_FAMILY_ACTIONS;
// CS-C5 — a recipient (of any non-viewer role) may VIEW + ACKNOWLEDGE/DECLINE their OWN delivery (the
// "own delivery only" rule is enforced in the repository). This never bypasses the CS-C4 decision.
const DELIVERY_RECIPIENT_ACTIONS: readonly FamilyAction[] = [
  FamilyAction.SafetyDeliveryView, FamilyAction.SafetyDeliveryAcknowledge, FamilyAction.SafetyDeliveryDecline,
];
// CS-C4/C5 — a plain Guardian may do everything a PrimaryGuardian can EXCEPT revoke a recipient
// authorization decision, revoke a delivery, or archive a delivery (those stay PrimaryGuardian acts).
// CS-C9 — a plain Guardian additionally may NOT manage guardian AUTHORITY (grant/change/suspend/resume/
// revoke) — those are PrimaryGuardian-only.
const GUARDIAN_ACTIONS: readonly FamilyAction[] = ALL_FAMILY_ACTIONS.filter((a) =>
  a !== FamilyAction.SafetyRecipientAuthorizationRevoke && a !== FamilyAction.SafetyDeliveryRevoke && a !== FamilyAction.SafetyDeliveryArchive
  && !FAMILY_AUTHORITY_MANAGE_ACTIONS.includes(a));
// CS-C3/C4/C5 — a safety professional is view-only for family administration but MAY review safety
// signals, view+evaluate recipient authorization, and act on their OWN delivery — never create a
// signal/decision/delivery, never revoke, and never mutate consent/authority/relationship.
const SAFETY_PROFESSIONAL: readonly FamilyAction[] = [
  ...VIEW_ONLY, FamilyAction.SafetySignalReview,
  FamilyAction.SafetyRecipientAuthorizationView, FamilyAction.SafetyRecipientAuthorizationEvaluate,
  ...DELIVERY_RECIPIENT_ACTIONS,
];
// CS-C5 — a trusted adult may VIEW/ACKNOWLEDGE/DECLINE their OWN delivery (if a valid authorized
// recipient), on top of the CS-1..C3 read-only set. Never create/revoke/archive.
const TRUSTED_ADULT: readonly FamilyAction[] = [...VIEW_ONLY, ...DELIVERY_RECIPIENT_ACTIONS];

/** Which actions each FamilyRole may perform. Only guardians manage; everyone else is read-mostly. */
export const FAMILY_ROLE_ACTIONS: Readonly<Record<FamilyRole, readonly FamilyAction[]>> = {
  [FamilyRole.PrimaryGuardian]: FULL_MANAGE,
  [FamilyRole.Guardian]: GUARDIAN_ACTIONS,
  [FamilyRole.TrustedAdult]: TRUSTED_ADULT,
  [FamilyRole.SafetyProfessional]: SAFETY_PROFESSIONAL,
  [FamilyRole.FamilyViewer]: VIEW_ONLY,
};

/** True iff `familyRole` may perform `action`. Fail-closed default. */
export function familyRoleCan(familyRole: FamilyRole, action: FamilyAction): boolean {
  return (FAMILY_ROLE_ACTIONS[familyRole] ?? []).includes(action);
}

/** The workspace capability each family action lives under (all Family-kind only). */
export const FAMILY_ACTION_CAPABILITY: Readonly<Record<FamilyAction, WorkspaceCapability>> = {
  [FamilyAction.FamilyView]: WorkspaceCapability.FamilyDashboard,
  [FamilyAction.ProtectedProfileView]: WorkspaceCapability.ProtectedProfiles,
  [FamilyAction.ProtectedProfileManage]: WorkspaceCapability.ProtectedProfiles,
  [FamilyAction.GuardianRelationshipView]: WorkspaceCapability.GuardianRelationships,
  [FamilyAction.GuardianRelationshipManage]: WorkspaceCapability.GuardianRelationships,
  // CS-C2 — authority lives under the GuardianRelationships capability; consent + safe-recipient
  // reuse the CS-0 Family capabilities (all Family-kind only).
  [FamilyAction.GuardianAuthorityView]: WorkspaceCapability.GuardianRelationships,
  [FamilyAction.GuardianAuthorityManage]: WorkspaceCapability.GuardianRelationships,
  [FamilyAction.ConsentView]: WorkspaceCapability.ConsentManagement,
  [FamilyAction.ConsentManage]: WorkspaceCapability.ConsentManagement,
  [FamilyAction.SafeRecipientView]: WorkspaceCapability.SafeRecipientPolicies,
  [FamilyAction.SafeRecipientAssess]: WorkspaceCapability.SafeRecipientPolicies,
  // CS-C3 — all safety-signal actions live under the CS-0 SafetySignals capability (Family-kind only).
  [FamilyAction.SafetySignalView]: WorkspaceCapability.SafetySignals,
  [FamilyAction.SafetySignalCreate]: WorkspaceCapability.SafetySignals,
  [FamilyAction.SafetySignalReview]: WorkspaceCapability.SafetySignals,
  [FamilyAction.SafetySignalArchive]: WorkspaceCapability.SafetySignals,
  // CS-C4 — recipient authorization decisions live under the CS-0 SafeRecipientPolicies capability.
  [FamilyAction.SafetyRecipientAuthorizationView]: WorkspaceCapability.SafeRecipientPolicies,
  [FamilyAction.SafetyRecipientAuthorizationEvaluate]: WorkspaceCapability.SafeRecipientPolicies,
  [FamilyAction.SafetyRecipientAuthorizationCreate]: WorkspaceCapability.SafeRecipientPolicies,
  [FamilyAction.SafetyRecipientAuthorizationRevoke]: WorkspaceCapability.SafeRecipientPolicies,
  // CS-C5 — internal delivery lives under the same SafeRecipientPolicies capability (recipient-scoped).
  [FamilyAction.SafetyDeliveryView]: WorkspaceCapability.SafeRecipientPolicies,
  [FamilyAction.SafetyDeliveryCreate]: WorkspaceCapability.SafeRecipientPolicies,
  [FamilyAction.SafetyDeliveryMakeAvailable]: WorkspaceCapability.SafeRecipientPolicies,
  [FamilyAction.SafetyDeliveryAcknowledge]: WorkspaceCapability.SafeRecipientPolicies,
  [FamilyAction.SafetyDeliveryDecline]: WorkspaceCapability.SafeRecipientPolicies,
  [FamilyAction.SafetyDeliveryRevoke]: WorkspaceCapability.SafeRecipientPolicies,
  [FamilyAction.SafetyDeliveryArchive]: WorkspaceCapability.SafeRecipientPolicies,
  // CS-C8 — guardian invitation management lives under the GuardianRelationships capability (Family-only).
  [FamilyAction.FamilyInvitationView]: WorkspaceCapability.GuardianRelationships,
  [FamilyAction.FamilyInvitationCreate]: WorkspaceCapability.GuardianRelationships,
  [FamilyAction.FamilyInvitationRevoke]: WorkspaceCapability.GuardianRelationships,
  // CS-C9 — guardian authority management lives under the GuardianRelationships capability (Family-only).
  [FamilyAction.FamilyAuthorityGrant]: WorkspaceCapability.GuardianRelationships,
  [FamilyAction.FamilyAuthorityChange]: WorkspaceCapability.GuardianRelationships,
  [FamilyAction.FamilyAuthoritySuspend]: WorkspaceCapability.GuardianRelationships,
  [FamilyAction.FamilyAuthorityResume]: WorkspaceCapability.GuardianRelationships,
  [FamilyAction.FamilyAuthorityRevoke]: WorkspaceCapability.GuardianRelationships,
};

/** The actor context every Family repository operation requires. */
export interface FamilyActorContext {
  tenantId: string;
  userId: string;
  role: string;        // stored Membership Business Role (mapped to FamilyRole)
  workspaceKind: string;
}

export type FamilyAuthzDecision =
  | { ok: true }
  | { ok: false; reason: "not_family_workspace" | "capability_not_in_workspace" | "role_forbidden" };

/**
 * The single authorization gate for Family data. Fail-closed: (1) the workspace MUST be
 * FAMILY, (2) the action's capability must be allowed in that kind, (3) the derived
 * FamilyRole must hold the action. A tenantId alone is never sufficient.
 */
export function authorizeFamilyAction(actor: FamilyActorContext, action: FamilyAction): FamilyAuthzDecision {
  if (actor.workspaceKind !== WorkspaceKind.Family) return { ok: false, reason: "not_family_workspace" };
  const capability = FAMILY_ACTION_CAPABILITY[action];
  if (!capabilityAllowedInWorkspace(capability, WorkspaceKind.Family)) return { ok: false, reason: "capability_not_in_workspace" };
  if (!familyRoleCan(familyRoleForMembershipRole(actor.role), action)) return { ok: false, reason: "role_forbidden" };
  return { ok: true };
}

// --- Namespaced audit actions (content-free) --------------------------------

export const CHILD_SAFETY_AUDIT_EVENTS = {
  protectedProfileCreated: "child_safety.protected_profile.created",
  protectedProfileArchived: "child_safety.protected_profile.archived",
  guardianRelationshipCreated: "child_safety.guardian_relationship.created",
  guardianRelationshipRevoked: "child_safety.guardian_relationship.revoked",
  guardianRelationshipArchived: "child_safety.guardian_relationship.archived",
  // CS-C7 — profile edit/restore + guardian lifecycle (content-free: field NAMES + enum transitions only,
  // NEVER a label/PII value or raw input).
  protectedProfileUpdated: "child_safety.protected_profile.updated",
  protectedProfileRestored: "child_safety.protected_profile.restored",
  guardianRelationshipDeactivated: "child_safety.guardian_relationship.deactivated",
  guardianRelationshipReactivated: "child_safety.guardian_relationship.reactivated",
  guardianRelationshipRoleChanged: "child_safety.guardian_relationship.role_changed",
  // CS-C8 — Family guardian invitation lifecycle + activation (content-free: ids + bounded enums only,
  // NEVER a raw token / token hash / raw email / guardianLabel value / PII).
  familyInvitationCreated: "child_safety.family_invitation.created",
  familyInvitationAccepted: "child_safety.family_invitation.accepted",
  familyInvitationDeclined: "child_safety.family_invitation.declined",
  familyInvitationRevoked: "child_safety.family_invitation.revoked",
  familyInvitationExpired: "child_safety.family_invitation.expired",
  familyMembershipCreatedFromInvitation: "child_safety.family_membership.created_from_invitation",
  familyMembershipReusedFromInvitation: "child_safety.family_membership.reused_from_invitation",
  guardianRelationshipCreatedFromInvitation: "child_safety.guardian_relationship.created_from_invitation",
  guardianRelationshipReactivatedFromInvitation: "child_safety.guardian_relationship.reactivated_from_invitation",
  // CS-C2 — guardian authority, consent & safe-recipient assessment (content-free).
  guardianAuthorityCreated: "child_safety.guardian_authority.created",
  guardianAuthorityVerified: "child_safety.guardian_authority.verified",
  guardianAuthorityRejected: "child_safety.guardian_authority.rejected",
  guardianAuthorityRevoked: "child_safety.guardian_authority.revoked",
  // CS-C9 — authority grant/lifecycle (content-free: actor + bounded status/level transitions only).
  guardianAuthorityGranted: "child_safety.guardian_authority.granted",
  guardianAuthorityLevelChanged: "child_safety.guardian_authority.level_changed",
  guardianAuthoritySuspended: "child_safety.guardian_authority.suspended",
  guardianAuthorityResumed: "child_safety.guardian_authority.resumed",
  guardianAuthorityExpired: "child_safety.guardian_authority.expired",
  consentCreated: "child_safety.consent.created",
  consentGranted: "child_safety.consent.granted",
  consentRevoked: "child_safety.consent.revoked",
  // CS-C10 — consent lifecycle (content-free: actor + bounded status/type + timestamps only).
  consentSuspended: "child_safety.consent.suspended",
  consentResumed: "child_safety.consent.resumed",
  consentExpired: "child_safety.consent.expired",
  safeRecipientAssessmentCreated: "child_safety.safe_recipient_assessment.created",
  safeRecipientAssessmentApproved: "child_safety.safe_recipient_assessment.approved",
  safeRecipientAssessmentRejected: "child_safety.safe_recipient_assessment.rejected",
  safeRecipientAssessmentRevoked: "child_safety.safe_recipient_assessment.revoked",
  // CS-C3 — safety signal occurrence + review lifecycle (content-free).
  safetySignalCreated: "child_safety.safety_signal.created",
  safetySignalAcknowledged: "child_safety.safety_signal.acknowledged",
  safetySignalReviewStarted: "child_safety.safety_signal.review_started",
  safetySignalDismissed: "child_safety.safety_signal.dismissed",
  safetySignalConfirmed: "child_safety.safety_signal.confirmed",
  safetySignalArchived: "child_safety.safety_signal.archived",
  // CS-C4 — recipient authorization decisions (content-free; no delivery).
  recipientAuthorizationEvaluated: "child_safety.recipient_authorization.evaluated",
  recipientAuthorizationCreated: "child_safety.recipient_authorization.created",
  recipientAuthorizationDenied: "child_safety.recipient_authorization.denied",
  recipientAuthorizationAuthorized: "child_safety.recipient_authorization.authorized",
  recipientAuthorizationRevoked: "child_safety.recipient_authorization.revoked",
  recipientAuthorizationSuperseded: "child_safety.recipient_authorization.superseded",
  // CS-C5 — INTERNAL delivery foundation (content-free; NOTHING sent externally).
  deliveryEvaluated: "child_safety.delivery.evaluated",
  deliveryCreated: "child_safety.delivery.created",
  deliveryAvailable: "child_safety.delivery.available",
  deliveryAcknowledged: "child_safety.delivery.acknowledged",
  deliveryDeclined: "child_safety.delivery.declined",
  deliveryFailed: "child_safety.delivery.failed",
  deliveryRevoked: "child_safety.delivery.revoked",
  deliveryExpired: "child_safety.delivery.expired",
  deliverySuperseded: "child_safety.delivery.superseded",
  deliveryArchived: "child_safety.delivery.archived",
} as const;
export type ChildSafetyAuditEvent = (typeof CHILD_SAFETY_AUDIT_EVENTS)[keyof typeof CHILD_SAFETY_AUDIT_EVENTS];

// --- Strict content-free input allowlists -----------------------------------

/**
 * Fields that may NEVER appear on a ProtectedProfile / GuardianRelationship input or DTO.
 * Presence is a hard rejection (a ProtectedProfile is not a User; no raw content, media,
 * open identifiers, credentials, contact info, or precise location — ever).
 */
export const CHILD_SAFETY_FORBIDDEN_FIELDS: readonly string[] = [
  // identity / contact (a ProtectedProfile is not a User)
  "userId", "email", "phone", "phoneNumber", "username", "displayName", "legalName", "fullName", "firstName", "lastName",
  // external / platform identifiers
  "metaId", "platformUserId", "externalAccountId", "externalId", "facebookId", "instagramId", "accountId",
  // credentials
  "password", "passwordHash", "accessToken", "refreshToken", "token", "secret",
  // raw content / media
  "message", "text", "content", "body", "transcript", "note", "notes", "image", "video", "audio", "attachment", "filename",
  // precise location
  "latitude", "longitude", "address", "gps", "coordinates",
];

export const PROTECTED_PROFILE_CREATE_FIELDS: readonly string[] = ["guardianLabel", "ageBand", "protectionStatus", "language"];
// CS-C7 — the ONLY editable profile fields. Deliberately content-free: a guardian-chosen label, a coarse
// age band, a bounded protection status and a preferred UI language — NEVER a real name, exact age/DOB,
// avatar, free-text note, contact, identifier or raw content (those stay in CHILD_SAFETY_FORBIDDEN_FIELDS).
export const PROTECTED_PROFILE_UPDATE_FIELDS: readonly string[] = ["guardianLabel", "ageBand", "protectionStatus", "language"];
export const GUARDIAN_RELATIONSHIP_CREATE_FIELDS: readonly string[] = [
  "guardianMembershipId", "protectedProfileId", "relationshipType", "authorityLevel", "guardianRole", "consentType",
];

/**
 * CS-C7 — a ProtectedProfile's preferred UI/language is bounded to the app locales. It is a display
 * preference, NOT evidence of nationality/ethnicity, and never free text.
 */
export const PROFILE_LANGUAGES: readonly string[] = ["en", "sk", "de"];
export const isProfileLanguage = (x: unknown): x is string => typeof x === "string" && PROFILE_LANGUAGES.includes(x);

export type ChildSafetyInputErrorCode = "forbidden_field" | "unknown_field" | "invalid_value" | "not_object";
export interface ChildSafetyInputValidation { ok: boolean; errors: { code: ChildSafetyInputErrorCode; field: string }[] }

/** Strict allowlist validator — rejects forbidden + unknown keys. Never echoes values. */
export function validateChildSafetyInput(raw: unknown, allowedFields: readonly string[]): ChildSafetyInputValidation {
  const errors: ChildSafetyInputValidation["errors"] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: [{ code: "not_object", field: "$" }] };
  const forbidden = new Set(CHILD_SAFETY_FORBIDDEN_FIELDS);
  const allowed = new Set(allowedFields);
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    if (forbidden.has(key)) errors.push({ code: "forbidden_field", field: key });
    else if (!allowed.has(key)) errors.push({ code: "unknown_field", field: key });
  }
  return { ok: errors.length === 0, errors };
}

// --- Value guards for the CS-0 domain enums (fail-closed) --------------------

export const isAgeBand = (x: unknown): x is AgeBand => (ALL_AGE_BANDS as readonly string[]).includes(x as string);
export const isProtectionStatus = (x: unknown): x is ProtectionStatus => Object.values(ProtectionStatus).includes(x as ProtectionStatus);
export const isGuardianRelationshipType = (x: unknown): x is GuardianRelationshipType => Object.values(GuardianRelationshipType).includes(x as GuardianRelationshipType);
export const isGuardianAuthorityLevel = (x: unknown): x is GuardianAuthorityLevel => Object.values(GuardianAuthorityLevel).includes(x as GuardianAuthorityLevel);
export const isGuardianRelationshipStatus = (x: unknown): x is GuardianRelationshipStatus => Object.values(GuardianRelationshipStatus).includes(x as GuardianRelationshipStatus);
export const isGuardianRole = (x: unknown): x is GuardianRole => (ALL_GUARDIAN_ROLES as readonly string[]).includes(x as string);
export const isConsentStatus = (x: unknown): x is ConsentStatus => Object.values(ConsentStatus).includes(x as ConsentStatus);
export const isConsentType = (x: unknown): x is ConsentType => Object.values(ConsentType).includes(x as ConsentType);
export const isSafetyRecipientEligibility = (x: unknown): x is SafetyRecipientEligibility => Object.values(SafetyRecipientEligibility).includes(x as SafetyRecipientEligibility);

/** CS-C1 defaults — a new relationship is NEVER auto-consented or auto-eligible as a safe recipient. */
export const GUARDIAN_RELATIONSHIP_DEFAULTS = {
  status: GuardianRelationshipStatus.Pending,
  consentStatus: ConsentStatus.NotRequested,
  safeRecipientEligibility: SafetyRecipientEligibility.NotVerified,
} as const;

/** CS-C1 default protection posture for a newly created profile. */
export const PROTECTED_PROFILE_DEFAULT_STATUS = ProtectionStatus.Inactive;

// --- CS-C8 — Family guardian invitation domain (content-free) ---------------

/** The invitation lifecycle. All states except PENDING are TERMINAL (append-only; no re-opening). */
export enum FamilyInvitationStatus { Pending = "pending", Accepted = "accepted", Declined = "declined", Revoked = "revoked", Expired = "expired" }
export const ALL_FAMILY_INVITATION_STATUSES: readonly FamilyInvitationStatus[] = Object.values(FamilyInvitationStatus);
export const isFamilyInvitationStatus = (x: unknown): x is FamilyInvitationStatus => (ALL_FAMILY_INVITATION_STATUSES as readonly string[]).includes(x as string);

/**
 * FamilyRoles a guardian invitation may grant. DELIBERATELY EXCLUDES PrimaryGuardian: a new owner is never
 * mintable via an invitation (no privilege escalation). Least-privilege by construction.
 */
export const INVITABLE_FAMILY_ROLES: readonly FamilyRole[] = [
  FamilyRole.Guardian, FamilyRole.TrustedAdult, FamilyRole.SafetyProfessional, FamilyRole.FamilyViewer,
];
export const isInvitableFamilyRole = (x: unknown): x is FamilyRole => (INVITABLE_FAMILY_ROLES as readonly string[]).includes(x as string);

/**
 * Reverse of {@link familyRoleForMembershipRole} for INVITED guardians: the stored Membership Business
 * `Role` that derives the intended FamilyRole. Never `owner` — PrimaryGuardian is not invitable, so this
 * returns null for it (and for any unknown value), failing closed.
 */
export function membershipRoleForInvitedFamilyRole(familyRole: string): Role | null {
  switch (familyRole) {
    case FamilyRole.Guardian: return Role.Admin;
    case FamilyRole.TrustedAdult: return Role.Reviewer;
    case FamilyRole.SafetyProfessional: return Role.Analyst;
    case FamilyRole.FamilyViewer: return Role.Viewer;
    default: return null; // primary_guardian / unknown → not invitable (fail closed)
  }
}

/** CS-C8 — the fields a client MAY submit to create an invitation. Everything else is server-resolved. */
export const FAMILY_INVITATION_CREATE_FIELDS: readonly string[] = [
  "protectedProfileId", "invitedEmail", "intendedFamilyRole", "intendedGuardianRole", "intendedRelationshipType",
];
