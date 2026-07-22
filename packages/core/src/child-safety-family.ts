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
}
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
];
const FULL_MANAGE: readonly FamilyAction[] = ALL_FAMILY_ACTIONS;

/** Which actions each FamilyRole may perform. Only guardians manage; everyone else is read-only. */
export const FAMILY_ROLE_ACTIONS: Readonly<Record<FamilyRole, readonly FamilyAction[]>> = {
  [FamilyRole.PrimaryGuardian]: FULL_MANAGE,
  [FamilyRole.Guardian]: FULL_MANAGE,
  [FamilyRole.TrustedAdult]: VIEW_ONLY,
  [FamilyRole.SafetyProfessional]: VIEW_ONLY,
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
  // CS-C2 — guardian authority, consent & safe-recipient assessment (content-free).
  guardianAuthorityCreated: "child_safety.guardian_authority.created",
  guardianAuthorityVerified: "child_safety.guardian_authority.verified",
  guardianAuthorityRejected: "child_safety.guardian_authority.rejected",
  guardianAuthorityRevoked: "child_safety.guardian_authority.revoked",
  consentCreated: "child_safety.consent.created",
  consentGranted: "child_safety.consent.granted",
  consentRevoked: "child_safety.consent.revoked",
  safeRecipientAssessmentCreated: "child_safety.safe_recipient_assessment.created",
  safeRecipientAssessmentApproved: "child_safety.safe_recipient_assessment.approved",
  safeRecipientAssessmentRejected: "child_safety.safe_recipient_assessment.rejected",
  safeRecipientAssessmentRevoked: "child_safety.safe_recipient_assessment.revoked",
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

export const PROTECTED_PROFILE_CREATE_FIELDS: readonly string[] = ["guardianLabel", "ageBand", "protectionStatus"];
export const GUARDIAN_RELATIONSHIP_CREATE_FIELDS: readonly string[] = [
  "guardianMembershipId", "protectedProfileId", "relationshipType", "authorityLevel", "consentType",
];

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
