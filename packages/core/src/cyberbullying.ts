/**
 * Cyberbullying Protection — C1 Protected Subject & Access Foundation (domain).
 *
 * Scope of C1 (per docs/cyberbullying-c0): ProtectedSubject + relationship model,
 * permission vocabulary (in permissions.ts), entitlement (in entitlements.ts),
 * audit vocabulary, the legal/safeguarding hard blocker, and SERVER CONTRACTS
 * (interfaces only — no implementation).
 *
 * NOT in C1 and deliberately absent here: evidence, incidents, detections,
 * custody, storage/blob, hashing, notifications, guardian/minor/school/company
 * data flows (those are hard-blocked, see {@link assertCyberbullyingFlowAllowed}).
 */

import type { Permission } from "./permissions";

// --- Enums (single source of truth; mirror the DB string columns) ----------

/** Type of a protected subject. Minimal by design — no sensitive categorization. */
export enum ProtectedSubjectType {
  Individual = "individual",
  Other = "other",
}

/**
 * Relationship type between a protected subject and an authorized person.
 * Foundation model values only — no relationship LOGIC/authority/workflow ships in
 * C1. Note: creating `guardian`/`school`/`company` relationships is BLOCKED by the
 * legal/safeguarding gate until approved (see {@link assertCyberbullyingFlowAllowed}).
 */
export enum ProtectedSubjectRelationshipType {
  TrustedContact = "trusted_contact",
  Guardian = "guardian",
  School = "school",
  Company = "company",
}

/**
 * Subject-scope resolution result — an ADDITIONAL access dimension ABOVE tenant
 * RLS (tenant isolation does not imply subject-level access). Foundation contract
 * only; no resolver logic ships in C1.
 */
export enum SubjectScope {
  /** The subject themselves / a user acting on their own case. */
  Owner = "owner",
  /** An authorized reviewer for this subject's org/case scope. */
  Reviewer = "reviewer",
  /** A tenant security admin (config scope; NOT automatic sensitive access). */
  SecurityAdmin = "security_admin",
  /** A read-only auditor. */
  Auditor = "auditor",
  /** No subject-level relationship — access denied at the subject filter. */
  Other = "other",
}

// --- Domain shapes (plain; NOT Prisma) -------------------------------------

/** A protected subject. Minimal, non-sensitive foundation shape. */
export interface ProtectedSubject {
  id: string;
  tenantId: string;
  /** Opaque, tenant-scoped public identifier (never a real-world PII value). */
  publicIdentifier: string;
  /** Display label for the reviewer UI (no PII beyond a chosen label). */
  displayLabel: string;
  subjectType: ProtectedSubjectType;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Foundation relationship record. No counterparty PII in C1. */
export interface ProtectedSubjectRelationship {
  id: string;
  tenantId: string;
  protectedSubjectId: string;
  relationshipType: ProtectedSubjectRelationshipType;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// --- Legal / safeguarding gate (HARD BLOCKER — implemented) ----------------

/** Flows that must NOT be activated until the legal/safeguarding gate is approved. */
export type CyberbullyingBlockedFlow = "minor" | "guardian" | "school" | "company";

export const CYBERBULLYING_BLOCKED_FLOWS: readonly CyberbullyingBlockedFlow[] = ["minor", "guardian", "school", "company"];

/**
 * Thrown when a caller attempts a flow that is gated off in C1. This is the ONLY
 * behavior for minor/guardian/school/company flows — there is no functionality
 * behind them.
 */
export class FeatureBlockedError extends Error {
  readonly code = "FEATURE_BLOCKED";
  constructor(public readonly flow: CyberbullyingBlockedFlow, message?: string) {
    super(message ?? `Cyberbullying flow "${flow}" is not implemented and is blocked by the legal & safeguarding gate (C0 §14).`);
    this.name = "FeatureBlockedError";
  }
}

/** True iff a flow is currently gated off. */
export function isCyberbullyingFlowBlocked(flow: CyberbullyingBlockedFlow): boolean {
  return CYBERBULLYING_BLOCKED_FLOWS.includes(flow);
}

/** Hard blocker: throws {@link FeatureBlockedError} for any gated flow. Never a no-op. */
export function assertCyberbullyingFlowAllowed(flow: CyberbullyingBlockedFlow): never {
  throw new FeatureBlockedError(flow);
}

/**
 * Map a relationship type to its gated flow, or null when allowed. `trusted_contact`
 * is allowed as a foundation value; guardian/school/company are blocked.
 */
export function blockedFlowForRelationship(type: ProtectedSubjectRelationshipType): CyberbullyingBlockedFlow | null {
  switch (type) {
    case ProtectedSubjectRelationshipType.Guardian: return "guardian";
    case ProtectedSubjectRelationshipType.School: return "school";
    case ProtectedSubjectRelationshipType.Company: return "company";
    case ProtectedSubjectRelationshipType.TrustedContact: return null;
    default: return null;
  }
}

// --- Audit event vocabulary (C0 §08 — vocabulary ONLY, no business logic) ---

export const CYBERBULLYING_AUDIT_EVENTS = {
  protectedSubjectCreated: "cyberbullying.protected_subject.created",
  protectedSubjectUpdated: "cyberbullying.protected_subject.updated",
  protectedSubjectAnonymized: "cyberbullying.protected_subject.anonymized",
  reportSubmitted: "cyberbullying.report.submitted",
  detectionLinked: "cyberbullying.detection.linked",
  detectionUnlinked: "cyberbullying.detection.unlinked",
  incidentReviewStarted: "cyberbullying.incident.review_started",
  incidentAcknowledged: "cyberbullying.incident.acknowledged",
  incidentConfirmed: "cyberbullying.incident.confirmed",
  incidentDismissed: "cyberbullying.incident.dismissed",
  incidentActionRequired: "cyberbullying.incident.action_required",
  incidentResolved: "cyberbullying.incident.resolved",
  incidentArchived: "cyberbullying.incident.archived",
  incidentReopened: "cyberbullying.incident.reopened",
  evidenceCaptured: "cyberbullying.evidence.captured",
  evidenceUploaded: "cyberbullying.evidence.uploaded",
  evidenceVerified: "cyberbullying.evidence.verified",
  evidenceViewedSensitive: "cyberbullying.evidence.viewed_sensitive",
  evidenceRedacted: "cyberbullying.evidence.redacted",
  evidenceDeleted: "cyberbullying.evidence.deleted",
  evidenceRetentionExtended: "cyberbullying.evidence.retention_extended",
  evidenceExported: "cyberbullying.evidence.exported",
  legalHoldApplied: "cyberbullying.evidence.legal_hold_applied",
  legalHoldReleased: "cyberbullying.evidence.legal_hold_released",
  guardianAuthorityGranted: "cyberbullying.guardian_authority.granted",
  guardianAuthorityRevoked: "cyberbullying.guardian_authority.revoked",
  escalationProposed: "cyberbullying.escalation.proposed",
  escalationApproved: "cyberbullying.escalation.approved",
  escalationSent: "cyberbullying.escalation.sent",
  escalationFailed: "cyberbullying.escalation.failed",
} as const;

export type CyberbullyingAuditEvent = (typeof CYBERBULLYING_AUDIT_EVENTS)[keyof typeof CYBERBULLYING_AUDIT_EVENTS];

// --- Server CONTRACTS (interfaces only — NO implementation in C1) -----------

/** Context for resolving subject-scope access (above tenant RLS). */
export interface SubjectAccessContext {
  tenantId: string;
  userId: string;
  protectedSubjectId: string;
}

/**
 * Resolves the caller's scope over a specific protected subject. Contract only;
 * the implementation (C1+) enforces subject-level access ABOVE tenant RLS.
 */
export interface SubjectScopeResolver {
  resolve(ctx: SubjectAccessContext): Promise<SubjectScope>;
}

/** Permission-check contract used by cyberbullying services (server-side). */
export interface CyberbullyingPermissionCheck {
  /** Throws if the caller lacks the permission. Backed by RBAC `assertCan`. */
  assert(permission: Permission): void;
  /** Non-throwing capability probe. */
  has(permission: Permission): boolean;
}

/** Tenant-scoped persistence contract for protected subjects. Contract only. */
export interface ProtectedSubjectRepository {
  create(input: Pick<ProtectedSubject, "publicIdentifier" | "displayLabel" | "subjectType">): Promise<ProtectedSubject>;
  getById(id: string): Promise<ProtectedSubject | null>;
  list(opts?: { activeOnly?: boolean; limit?: number }): Promise<ProtectedSubject[]>;
  update(id: string, patch: Partial<Pick<ProtectedSubject, "displayLabel" | "active">>): Promise<ProtectedSubject>;
  deactivate(id: string): Promise<void>;
}

/**
 * Application-level contract for protected-subject operations. Contract only.
 * Implementations MUST call the legal/safeguarding gate for minor/guardian/
 * school/company flows and the permission check + subject-scope resolver.
 */
export interface ProtectedSubjectService {
  createSubject(input: { publicIdentifier: string; displayLabel: string; subjectType: ProtectedSubjectType }): Promise<ProtectedSubject>;
  getSubject(id: string): Promise<ProtectedSubject | null>;
  listSubjects(opts?: { activeOnly?: boolean }): Promise<ProtectedSubject[]>;
  updateSubject(id: string, patch: { displayLabel?: string; active?: boolean }): Promise<ProtectedSubject>;
}
