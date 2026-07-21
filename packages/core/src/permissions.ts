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
