/**
 * Tamanor Workspace Architecture (Child Safety CS-C0).
 *
 * A workspace is an existing Tenant with exactly one IMMUTABLE `WorkspaceKind`.
 * BUSINESS and FAMILY data never share a tenant; one User may hold Membership in
 * many workspaces of different kinds, but a Membership in one kind grants NO access
 * to another. Capabilities are gated by BOTH tenant RLS AND workspace kind — a
 * tenantId alone is never sufficient for domain separation. This module is the
 * single, machine-readable source of truth for kinds, capabilities, and their kind
 * bindings. Pure + crypto-free (client-safe subpath `@guardora/core/workspace`).
 *
 * See docs/child-safety/ and docs/adr/child-safety/ for the locked decisions.
 */

// --- Workspace kinds --------------------------------------------------------

export enum WorkspaceKind {
  /** A company / agency managing business social profiles (the current default). */
  Business = "business",
  /** A parent / guardian's family safety space (Child Safety track). */
  Family = "family",
  /** A child-safety expert / partner organization (invite-only; not in public registration). */
  ChildSafetyOrganization = "child_safety_organization",
  /** Tamanor internal / platform administration only. */
  Internal = "internal",
}
export const ALL_WORKSPACE_KINDS: readonly WorkspaceKind[] = Object.values(WorkspaceKind);
export function isWorkspaceKind(x: unknown): x is WorkspaceKind {
  return typeof x === "string" && (ALL_WORKSPACE_KINDS as readonly string[]).includes(x);
}
/** The default for every existing tenant + any legacy row (backward-compatible). */
export const DEFAULT_WORKSPACE_KIND = WorkspaceKind.Business;
/** Kinds a user may create via public self-service registration. */
export const PUBLIC_WORKSPACE_KINDS: readonly WorkspaceKind[] = [WorkspaceKind.Business, WorkspaceKind.Family];
/** Kinds that are invite-only or system-managed (never public registration). */
export const INVITE_ONLY_WORKSPACE_KINDS: readonly WorkspaceKind[] = [WorkspaceKind.ChildSafetyOrganization];
export const SYSTEM_WORKSPACE_KINDS: readonly WorkspaceKind[] = [WorkspaceKind.Internal];
export function isPubliclyCreatableWorkspaceKind(kind: WorkspaceKind): boolean {
  return (PUBLIC_WORKSPACE_KINDS as readonly WorkspaceKind[]).includes(kind);
}

// --- Capabilities (machine-readable registry) -------------------------------

export enum WorkspaceCapability {
  // BUSINESS
  BusinessDashboard = "business_dashboard",
  SocialAccounts = "social_accounts",
  FacebookAccounts = "facebook_accounts",
  InstagramAccounts = "instagram_accounts",
  CommentModeration = "comment_moderation",
  BusinessIncidents = "business_incidents",
  CyberbullyingCaseManagement = "cyberbullying_case_management",
  EvidenceManagement = "evidence_management",
  ComplianceReports = "compliance_reports",
  RedactionWorkflow = "redaction_workflow",
  ExportAuthorization = "export_authorization",
  TeamManagement = "team_management",
  BusinessBilling = "business_billing",
  // FAMILY (foundation — no features implemented in CS-C0)
  FamilyDashboard = "family_dashboard",
  ProtectedProfiles = "protected_profiles",
  GuardianRelationships = "guardian_relationships",
  SafetyPlatformConnections = "safety_platform_connections",
  SafetySignals = "safety_signals",
  ChildSafetyIncidents = "child_safety_incidents",
  GuardianAlerts = "guardian_alerts",
  ConsentManagement = "consent_management",
  SafeRecipientPolicies = "safe_recipient_policies",
  FamilyAudit = "family_audit",
  // CHILD_SAFETY_ORGANIZATION (foundation)
  ExpertValidation = "expert_validation",
  ScenarioReview = "scenario_review",
  TaxonomyReview = "taxonomy_review",
  ProtocolReview = "protocol_review",
  PilotManagement = "pilot_management",
  ReferralReview = "referral_review",
  // INTERNAL (foundation)
  PlatformAdministration = "platform_administration",
  InternalSecurity = "internal_security",
  TenantSupport = "tenant_support",
  TaxonomyReleaseManagement = "taxonomy_release_management",
}

/** Each capability maps to the EXACT set of workspace kinds allowed to use it. */
export const WORKSPACE_CAPABILITIES: Readonly<Record<WorkspaceCapability, readonly WorkspaceKind[]>> = {
  [WorkspaceCapability.BusinessDashboard]: [WorkspaceKind.Business],
  [WorkspaceCapability.SocialAccounts]: [WorkspaceKind.Business],
  [WorkspaceCapability.FacebookAccounts]: [WorkspaceKind.Business],
  [WorkspaceCapability.InstagramAccounts]: [WorkspaceKind.Business],
  [WorkspaceCapability.CommentModeration]: [WorkspaceKind.Business],
  [WorkspaceCapability.BusinessIncidents]: [WorkspaceKind.Business],
  [WorkspaceCapability.CyberbullyingCaseManagement]: [WorkspaceKind.Business],
  [WorkspaceCapability.EvidenceManagement]: [WorkspaceKind.Business],
  [WorkspaceCapability.ComplianceReports]: [WorkspaceKind.Business],
  [WorkspaceCapability.RedactionWorkflow]: [WorkspaceKind.Business],
  [WorkspaceCapability.ExportAuthorization]: [WorkspaceKind.Business],
  [WorkspaceCapability.TeamManagement]: [WorkspaceKind.Business],
  [WorkspaceCapability.BusinessBilling]: [WorkspaceKind.Business],

  [WorkspaceCapability.FamilyDashboard]: [WorkspaceKind.Family],
  [WorkspaceCapability.ProtectedProfiles]: [WorkspaceKind.Family],
  [WorkspaceCapability.GuardianRelationships]: [WorkspaceKind.Family],
  [WorkspaceCapability.SafetyPlatformConnections]: [WorkspaceKind.Family],
  [WorkspaceCapability.SafetySignals]: [WorkspaceKind.Family],
  [WorkspaceCapability.ChildSafetyIncidents]: [WorkspaceKind.Family],
  [WorkspaceCapability.GuardianAlerts]: [WorkspaceKind.Family],
  [WorkspaceCapability.ConsentManagement]: [WorkspaceKind.Family],
  [WorkspaceCapability.SafeRecipientPolicies]: [WorkspaceKind.Family],
  [WorkspaceCapability.FamilyAudit]: [WorkspaceKind.Family],

  [WorkspaceCapability.ExpertValidation]: [WorkspaceKind.ChildSafetyOrganization],
  [WorkspaceCapability.ScenarioReview]: [WorkspaceKind.ChildSafetyOrganization],
  [WorkspaceCapability.TaxonomyReview]: [WorkspaceKind.ChildSafetyOrganization],
  [WorkspaceCapability.ProtocolReview]: [WorkspaceKind.ChildSafetyOrganization],
  [WorkspaceCapability.PilotManagement]: [WorkspaceKind.ChildSafetyOrganization],
  [WorkspaceCapability.ReferralReview]: [WorkspaceKind.ChildSafetyOrganization],

  [WorkspaceCapability.PlatformAdministration]: [WorkspaceKind.Internal],
  [WorkspaceCapability.InternalSecurity]: [WorkspaceKind.Internal],
  [WorkspaceCapability.TenantSupport]: [WorkspaceKind.Internal],
  [WorkspaceCapability.TaxonomyReleaseManagement]: [WorkspaceKind.Internal],
};

/** True iff `capability` is permitted in a workspace of `kind`. Fail-closed default. */
export function capabilityAllowedInWorkspace(capability: WorkspaceCapability, kind: WorkspaceKind): boolean {
  return (WORKSPACE_CAPABILITIES[capability] ?? []).includes(kind);
}
/** All capabilities available to a given workspace kind. */
export function capabilitiesForWorkspaceKind(kind: WorkspaceKind): WorkspaceCapability[] {
  return (Object.keys(WORKSPACE_CAPABILITIES) as WorkspaceCapability[]).filter((c) => capabilityAllowedInWorkspace(c, kind));
}

// --- Role families (bound to a workspace kind; never move between kinds) -----

/** Family safety roles (CS-C0 foundation). A Protected Child is NOT one of these. */
export enum FamilyRole {
  PrimaryGuardian = "primary_guardian",
  Guardian = "guardian",
  TrustedAdult = "trusted_adult",
  SafetyProfessional = "safety_professional",
  FamilyViewer = "family_viewer",
}
export const ALL_FAMILY_ROLES: readonly FamilyRole[] = Object.values(FamilyRole);

/** Child-safety organization roles (CS-C0 foundation). */
export enum OrganizationRole {
  OrganizationOwner = "organization_owner",
  SafetyLead = "safety_lead",
  ExpertReviewer = "expert_reviewer",
  PilotCoordinator = "pilot_coordinator",
  OrganizationViewer = "organization_viewer",
}
export const ALL_ORGANIZATION_ROLES: readonly OrganizationRole[] = Object.values(OrganizationRole);

/** Which role family is valid for a workspace kind. Business roles live in @guardora/core Role. */
export function roleFamilyForWorkspaceKind(kind: WorkspaceKind): "business" | "family" | "organization" | "internal" {
  switch (kind) {
    case WorkspaceKind.Family: return "family";
    case WorkspaceKind.ChildSafetyOrganization: return "organization";
    case WorkspaceKind.Internal: return "internal";
    default: return "business";
  }
}

// --- Navigation registries (foundation; kind-separated) ----------------------

export interface WorkspaceNavItem { href: string; labelKey: string; capability: WorkspaceCapability | null }

/** BUSINESS navigation — the existing dashboard sections. */
export const BUSINESS_NAV: readonly WorkspaceNavItem[] = [
  { href: "/dashboard", labelKey: "nav.overview", capability: WorkspaceCapability.BusinessDashboard },
  { href: "/dashboard/accounts", labelKey: "nav.accounts", capability: WorkspaceCapability.SocialAccounts },
  { href: "/dashboard/comments", labelKey: "nav.comments", capability: WorkspaceCapability.CommentModeration },
  { href: "/dashboard/incidents", labelKey: "nav.incidents", capability: WorkspaceCapability.BusinessIncidents },
  { href: "/dashboard/security/cyberbullying", labelKey: "nav.cyberbullying", capability: WorkspaceCapability.CyberbullyingCaseManagement },
  { href: "/dashboard/team", labelKey: "nav.team", capability: WorkspaceCapability.TeamManagement },
  { href: "/dashboard/billing", labelKey: "nav.billing", capability: WorkspaceCapability.BusinessBilling },
  { href: "/dashboard/settings", labelKey: "nav.settings", capability: null },
];

/** FAMILY navigation FOUNDATION — no Family pages ship in CS-C0 (settings only). */
export const FAMILY_NAV: readonly WorkspaceNavItem[] = [
  { href: "/dashboard/family", labelKey: "familyNav.overview", capability: WorkspaceCapability.FamilyDashboard },
  { href: "/dashboard/family/profiles", labelKey: "familyNav.profiles", capability: WorkspaceCapability.ProtectedProfiles },
  { href: "/dashboard/family/safety", labelKey: "familyNav.safety", capability: WorkspaceCapability.ChildSafetyIncidents },
  { href: "/dashboard/family/alerts", labelKey: "familyNav.alerts", capability: WorkspaceCapability.GuardianAlerts },
  { href: "/dashboard/family/guardians", labelKey: "familyNav.guardians", capability: WorkspaceCapability.GuardianRelationships },
  { href: "/dashboard/family/consent", labelKey: "familyNav.consent", capability: WorkspaceCapability.ConsentManagement },
  { href: "/dashboard/settings", labelKey: "nav.settings", capability: null },
];

/** The nav registry for a workspace kind. Business + Internal use BUSINESS_NAV in CS-C0. */
export function navForWorkspaceKind(kind: WorkspaceKind): readonly WorkspaceNavItem[] {
  return kind === WorkspaceKind.Family ? FAMILY_NAV : BUSINESS_NAV;
}
