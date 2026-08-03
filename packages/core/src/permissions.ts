import { Role } from "./tenant";
import { ModerationAction } from "./moderation";
import { RiskLevel } from "./reputation";

/**
 * Permissions are expressed as coarse capabilities. The dashboard and server
 * actions check these via {@link can} rather than switching on Role directly,
 * so the role→capability mapping lives in exactly one place.
 */
export enum Permission {
  // Brands & connectors
  BrandView = "brand:view",
  BrandManage = "brand:manage",
  ConnectorManage = "connector:manage",
  // Inbox
  InboxView = "inbox:view",
  /** Immediate, Guardora-side actions: mark resolved, ignore, escalate. */
  InboxAct = "inbox:act",
  // Approval workflow
  /** See the approval queue and proposals. */
  ProposalView = "proposal:view",
  /** Create a proposal (draft reply / hide / delete → queued for approval). */
  ProposalPropose = "proposal:propose",
  /** Approve or reject proposals (subject to {@link canApproveDecision}). */
  ProposalApprove = "proposal:approve",
  /** Execute an approved proposal (mock in V1.1). */
  ProposalExecute = "proposal:execute",
  // Rules
  RuleView = "rule:view",
  RuleManage = "rule:manage",
  // Audit & reports
  AuditView = "audit:view",
  ReportView = "report:view",
  // Security Suite (S0) — read = Analyst+; manage = Admin+/Owner. Plan-gated
  // separately by the `security_suite` entitlement. Detection & response only:
  // these never grant new platform-mutation power.
  /** View Security Center, Security Score, and detections. */
  SecurityView = "security:view",
  /** Acknowledge/dismiss/confirm detections, manage brand-protection cases. */
  SecurityManage = "security:manage",
  /** View security incidents and their timeline. */
  IncidentView = "incident:view",
  /** Manage incident lifecycle (assign, transition, resolve). */
  IncidentManage = "incident:manage",
  // Cyberbullying Protection (C1 foundation). Server-enforced; subject-scope filter
  // runs ABOVE tenant RLS. The two most sensitive — viewing unredacted sensitive
  // evidence and exporting evidence — are OWNER-EXCLUSIVE (granted only via
  // OWNER_ALL, absent from every role list below), because an admin must NOT get
  // sensitive-evidence access automatically.
  CyberbullyingViewOwn = "cyberbullying:view_own",
  CyberbullyingReport = "cyberbullying:report",
  CyberbullyingReview = "cyberbullying:review",
  CyberbullyingManage = "cyberbullying:manage",
  CyberbullyingEscalate = "cyberbullying:escalate",
  CyberbullyingViewSensitiveEvidence = "cyberbullying:view_sensitive_evidence",
  CyberbullyingExportEvidence = "cyberbullying:export_evidence",
  CyberbullyingManageRetention = "cyberbullying:manage_retention",
  CyberbullyingManageGuardianAccess = "cyberbullying:manage_guardian_access",
  CyberbullyingAudit = "cyberbullying:audit",
  // C12 — compliance redaction / four-eyes approval / export authorization. `redact`
  // is reviewer-level (author of a draft); `approve` and `export_authorize` are
  // ELEVATED (Admin/Owner) so a reviewer can never approve their own draft — the
  // author≠approver four-eyes rule is ALSO enforced server-side regardless of role.
  CyberbullyingComplianceRedact = "cyberbullying:compliance_redact",
  CyberbullyingComplianceApprove = "cyberbullying:compliance_approve",
  CyberbullyingComplianceExportAuthorize = "cyberbullying:compliance_export_authorize",
  // Child Safety Reviewer Workspace (V1) — operational review of canonical child-safety incidents.
  // Owner / Administrator / Safety Reviewer (Role.reviewer) ONLY. Never public / guardian / SDK /
  // gateway. `view` reads incidents + timeline + dashboard; `manage` assigns, notes, and transitions
  // review status. Both are additive read/operational capabilities — they grant NO platform mutation
  // and NO access to raw content (a SafetySignal is content-free by construction).
  ChildSafetyReviewView = "child_safety:review_view",
  ChildSafetyReviewManage = "child_safety:review_manage",
  // Child Safety Evidence Management (V1) — upload/verify/seal/export evidence on canonical incidents.
  // Same audience (Owner / Administrator / Safety Reviewer). Reads reuse review_view; this gates writes.
  ChildSafetyEvidenceManage = "child_safety:evidence_manage",
  // Child Safety Protection Plans (V1) — internal protective-action coordination on canonical incidents.
  // Same audience (Owner / Administrator / Safety Reviewer). `view` reads plan/actions/timeline; `manage`
  // creates/activates/completes plans and manages actions. Internal-only; no autonomous external effect.
  ChildSafetyProtectionPlanView = "child_safety:protection_plan_view",
  ChildSafetyProtectionPlanManage = "child_safety:protection_plan_manage",
  // Child Safety Analytics & Trends (V1) — INTERNAL OPERATIONAL analytics over the SAME canonical data
  // (no new analytical truth, no child profiling/scoring/ranking, no reviewer leaderboard). `view` opens
  // the aggregated, privacy-suppressed dashboard (Owner / Administrator / Safety Reviewer). `export` (CSV
  // of aggregated metrics ONLY) is ELEVATED to Owner / Administrator — deliberately withheld from the
  // Reviewer role (granted to Admin below + Owner via OWNER_ALL). Content-free; server-authoritative.
  ChildSafetyAnalyticsView = "child_safety:analytics_view",
  ChildSafetyAnalyticsExport = "child_safety:analytics_export",
  // Child Safety Policy Engine (V1) — centralized, versioned, immutable-after-activation, tenant-scoped
  // decision policy over canonical facts. `view`/`decision_view` read; `manage` creates/edits drafts;
  // `submit` moves a draft to approval; `approve`/`reject` are the independent-approver gate; `activate`
  // publishes an approved version (two-person control: the submitter cannot be the sole activator);
  // `simulate` runs side-effect-free evaluation. Policy is DATA (never executable). Server-authoritative.
  ChildSafetyPolicyView = "child_safety:policy_view",
  ChildSafetyPolicyManage = "child_safety:policy_manage",
  ChildSafetyPolicySubmit = "child_safety:policy_submit",
  ChildSafetyPolicyApprove = "child_safety:policy_approve",
  ChildSafetyPolicyActivate = "child_safety:policy_activate",
  ChildSafetyPolicySimulate = "child_safety:policy_simulate",
  ChildSafetyPolicyDecisionView = "child_safety:policy_decision_view",
  // Child Safety Integration Signal Protocol + Partner SDK (V1) — authorized partner platforms send minimal,
  // content-free structured safety signals. These USER-session capabilities gate the internal registry/
  // sandbox/receipts UI; the partner gateway itself authenticates by per-installation Ed25519 signature
  // (NOT a user session). `keys_manage` (public-key registration/rotation/revocation) is the most sensitive
  // and is Owner/Admin only. Tamanor never receives raw content, credentials, tokens, or private keys.
  ChildSafetyIntegrationView = "child_safety:integration_view",
  ChildSafetyIntegrationManage = "child_safety:integration_manage",
  ChildSafetyIntegrationKeysManage = "child_safety:integration_keys_manage",
  ChildSafetyIntegrationReceiptsView = "child_safety:integration_receipts_view",
  ChildSafetyIntegrationSandboxUse = "child_safety:integration_sandbox_use",
  // Child Safety Partner Pilot & Integration Operations (V1) — the GOVERNANCE layer that turns the signal
  // protocol into a controlled, auditable partner-onboarding + pilot lifecycle. `view` reads pilots/scope/
  // readiness/alerts (aggregated for Analyst — sensitive notes/contacts are review-gated in the service);
  // `manage` edits draft/scope/config + contacts; `review` updates readiness checks + assessments (Safety
  // Reviewer); `activate` performs the pilot-activation transition (Owner/Admin only — two-eyes with review);
  // `suspend` is the fail-closed emergency stop (also granted to the Safety Reviewer); `audit_view` reads the
  // immutable operational history. All are content-free operational capabilities — no raw data, no key access.
  ChildSafetyIntegrationPilotView = "child_safety:integration_pilot_view",
  ChildSafetyIntegrationPilotManage = "child_safety:integration_pilot_manage",
  ChildSafetyIntegrationPilotReview = "child_safety:integration_pilot_review",
  ChildSafetyIntegrationPilotActivate = "child_safety:integration_pilot_activate",
  ChildSafetyIntegrationPilotSuspend = "child_safety:integration_pilot_suspend",
  ChildSafetyIntegrationPilotAuditView = "child_safety:integration_pilot_audit_view",
  // Members
  MemberManage = "member:manage",
  // V1.45C1 — irreversible workspace/tenant deletion. OWNER-EXCLUSIVE: granted only via OWNER_ALL
  // and deliberately absent from every other role's list below (Admin included). Server authorization
  // remains authoritative — this is the UI/gating capability.
  TenantDelete = "tenant:delete",
  // V1.50D — subscription billing (checkout, portal, plan change). OWNER-EXCLUSIVE like TenantDelete:
  // granted only via OWNER_ALL and absent from every other role below. No Viewer/Analyst/Reviewer/
  // Admin billing writes; server authorization is authoritative.
  BillingManage = "billing:manage",
  // BUSINESS Connected Platforms & Contacts V1 — additive Business capabilities. Contacts hold PII, so read is
  // limited to Owner/Admin/Analyst and manage to Owner/Admin (conservative; Owner is auto via OWNER_ALL).
  BusinessContactsRead = "business.contacts.read",
  BusinessContactsManage = "business.contacts.manage",
  /**
   * BUSINESS-CRM-V2 (Phase B) — bulk CSV export of contacts. DELIBERATELY SEPARATE from
   * {@link BusinessContactsRead}: paginated reading of leads is not the same act as egressing every matching
   * lead's name, e-mail, phone and company in one file. Granted to Owner (via OWNER_ALL) and Admin only —
   * Analyst keeps read access WITHOUT export.
   */
  BusinessContactsExport = "business.contacts.export",
  BusinessPlatformsRead = "business.platforms.read",
  BusinessPlatformsManage = "business.platforms.manage",
}

const OWNER_ALL: readonly Permission[] = Object.values(Permission);

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [Role.Owner]: OWNER_ALL,
  [Role.Admin]: [
    Permission.BrandView,
    Permission.BrandManage,
    Permission.ConnectorManage,
    Permission.InboxView,
    Permission.InboxAct,
    Permission.ProposalView,
    Permission.ProposalPropose,
    Permission.ProposalApprove,
    Permission.ProposalExecute,
    Permission.RuleView,
    Permission.RuleManage,
    Permission.AuditView,
    Permission.ReportView,
    Permission.SecurityView,
    Permission.SecurityManage,
    Permission.IncidentView,
    Permission.IncidentManage,
    // Business Connected Platforms & Contacts V1 — Admin gets full read + manage.
    Permission.BusinessContactsRead,
    Permission.BusinessContactsManage,
    // Bulk PII egress — Admin and Owner only; Analyst deliberately excluded.
    Permission.BusinessContactsExport,
    Permission.BusinessPlatformsRead,
    Permission.BusinessPlatformsManage,
    // Cyberbullying — Admin gets the operational set, NOT sensitive-evidence view
    // or export (those stay owner-exclusive via OWNER_ALL).
    Permission.CyberbullyingViewOwn,
    Permission.CyberbullyingReport,
    Permission.CyberbullyingReview,
    Permission.CyberbullyingManage,
    Permission.CyberbullyingEscalate,
    Permission.CyberbullyingManageRetention,
    Permission.CyberbullyingManageGuardianAccess,
    Permission.CyberbullyingAudit,
    // C12 — Admin can author, approve others' drafts, and authorize exports.
    Permission.CyberbullyingComplianceRedact,
    Permission.CyberbullyingComplianceApprove,
    Permission.CyberbullyingComplianceExportAuthorize,
    // Child-safety review — Admin is a full reviewer.
    Permission.ChildSafetyReviewView,
    Permission.ChildSafetyReviewManage,
    Permission.ChildSafetyEvidenceManage,
    Permission.ChildSafetyProtectionPlanView,
    Permission.ChildSafetyProtectionPlanManage,
    // Analytics — Admin may view AND export aggregated metrics.
    Permission.ChildSafetyAnalyticsView,
    Permission.ChildSafetyAnalyticsExport,
    // Policy Engine — Admin holds the full policy governance set (incl. approve + activate).
    Permission.ChildSafetyPolicyView,
    Permission.ChildSafetyPolicyManage,
    Permission.ChildSafetyPolicySubmit,
    Permission.ChildSafetyPolicyApprove,
    Permission.ChildSafetyPolicyActivate,
    Permission.ChildSafetyPolicySimulate,
    Permission.ChildSafetyPolicyDecisionView,
    // Integration — Admin holds the full integration governance set (incl. key management).
    Permission.ChildSafetyIntegrationView,
    Permission.ChildSafetyIntegrationManage,
    Permission.ChildSafetyIntegrationKeysManage,
    Permission.ChildSafetyIntegrationReceiptsView,
    Permission.ChildSafetyIntegrationSandboxUse,
    // Partner Pilot Operations — Admin holds the full pilot governance set (incl. activate + suspend).
    Permission.ChildSafetyIntegrationPilotView,
    Permission.ChildSafetyIntegrationPilotManage,
    Permission.ChildSafetyIntegrationPilotReview,
    Permission.ChildSafetyIntegrationPilotActivate,
    Permission.ChildSafetyIntegrationPilotSuspend,
    Permission.ChildSafetyIntegrationPilotAuditView,
    Permission.MemberManage,
  ],
  [Role.Analyst]: [
    Permission.BrandView,
    Permission.InboxView,
    Permission.InboxAct,
    Permission.ProposalView,
    Permission.ProposalPropose,
    Permission.RuleView,
    Permission.RuleManage,
    Permission.AuditView,
    Permission.ReportView,
    Permission.SecurityView,
    Permission.IncidentView,
    // Business Connected Platforms & Contacts V1 — Analyst gets READ only (no status/assignment/connection mutation).
    Permission.BusinessContactsRead,
    Permission.BusinessPlatformsRead,
    // Partner Pilot Operations — Analyst gets AGGREGATED read-only pilot status only. The service withholds
    // sensitive fields (operational contacts, review notes, bounded comments) from a view-only role, so an
    // Analyst can see lifecycle/scope/readiness/alert severity but never notes or contacts, and never mutates.
    Permission.ChildSafetyIntegrationPilotView,
  ],
  [Role.Reviewer]: [
    Permission.BrandView,
    Permission.InboxView,
    Permission.InboxAct,
    Permission.ProposalView,
    Permission.ProposalPropose,
    // Reviewer may approve, but scope is limited by canApproveDecision().
    Permission.ProposalApprove,
    Permission.RuleView,
    Permission.AuditView,
    Permission.ReportView,
    Permission.SecurityView,
    Permission.IncidentView,
    // Cyberbullying — Reviewer may see own, report, and review.
    Permission.CyberbullyingViewOwn,
    Permission.CyberbullyingReport,
    Permission.CyberbullyingReview,
    // C12 — Reviewer may author redaction drafts (but NOT approve them).
    Permission.CyberbullyingComplianceRedact,
    // Child-safety review — the Safety Reviewer role is a full reviewer.
    Permission.ChildSafetyReviewView,
    Permission.ChildSafetyReviewManage,
    Permission.ChildSafetyEvidenceManage,
    Permission.ChildSafetyProtectionPlanView,
    Permission.ChildSafetyProtectionPlanManage,
    // Analytics — the Safety Reviewer may VIEW the aggregated dashboard, but NOT export (export is
    // Owner/Admin only; deliberately omitted here).
    Permission.ChildSafetyAnalyticsView,
    // Policy Engine — the Safety Reviewer may VIEW, SIMULATE, and read decisions, but NOT manage, submit,
    // approve, or activate (governance is Owner/Admin; two-person control is enforced separately).
    Permission.ChildSafetyPolicyView,
    Permission.ChildSafetyPolicySimulate,
    Permission.ChildSafetyPolicyDecisionView,
    // Integration — the Safety Reviewer may VIEW the registry, view receipts, and use the local sandbox,
    // but NOT manage partners/applications/installations or keys (governance is Owner/Admin).
    Permission.ChildSafetyIntegrationView,
    Permission.ChildSafetyIntegrationReceiptsView,
    Permission.ChildSafetyIntegrationSandboxUse,
    // Partner Pilot Operations — the Safety Reviewer may VIEW pilots, REVIEW readiness checks/assessments,
    // read the operational history (audit_view), and trigger the fail-closed emergency SUSPEND. They may NOT
    // manage scope/contacts or ACTIVATE a pilot (activation stays Owner/Admin — a two-eyes control on top of
    // the reviewer's own readiness sign-off).
    Permission.ChildSafetyIntegrationPilotView,
    Permission.ChildSafetyIntegrationPilotReview,
    Permission.ChildSafetyIntegrationPilotAuditView,
    Permission.ChildSafetyIntegrationPilotSuspend,
  ],
  [Role.Viewer]: [
    Permission.BrandView,
    Permission.InboxView,
    Permission.ProposalView,
    Permission.RuleView,
    Permission.AuditView,
    Permission.ReportView,
  ],
};

/** True if the role grants the permission. */
export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** All permissions granted to a role (useful for UI gating). */
export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/** Throwing guard for server actions. */
export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) {
    throw new Error(`Forbidden: role "${role}" lacks "${permission}"`);
  }
}

/**
 * Fine-grained approval policy on top of {@link Permission.ProposalApprove}.
 *
 * - VIEWER / ANALYST: cannot approve at all.
 * - REVIEWER: may approve, EXCEPT destructive deletes and high/critical risk —
 *   those must go to an Admin or Owner.
 * - ADMIN / OWNER: may approve anything.
 *
 * This keeps role logic out of the UI/server actions — they call this helper.
 */
export function canApproveDecision(
  role: Role,
  action: ModerationAction,
  riskLevel: RiskLevel,
): boolean {
  if (!can(role, Permission.ProposalApprove)) return false;
  if (role === Role.Owner || role === Role.Admin) return true;
  if (role === Role.Reviewer) {
    if (action === ModerationAction.Delete) return false;
    if (riskLevel === RiskLevel.High || riskLevel === RiskLevel.Critical) {
      return false;
    }
    return true;
  }
  return false;
}

/** Human-readable reason a role cannot approve a given decision (for UI). */
export function approvalDenialReason(
  role: Role,
  action: ModerationAction,
  riskLevel: RiskLevel,
): string | null {
  if (canApproveDecision(role, action, riskLevel)) return null;
  if (!can(role, Permission.ProposalApprove)) {
    return `Role "${role}" cannot approve proposals.`;
  }
  if (action === ModerationAction.Delete) {
    return "Deletes must be approved by an Admin or Owner.";
  }
  return "High/critical-risk proposals must be approved by an Admin or Owner.";
}
