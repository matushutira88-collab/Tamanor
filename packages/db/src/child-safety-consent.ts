import { ActorKind, Prisma } from "@prisma/client";
import { withTenant } from "./repositories";
import { FamilyForbiddenError, FamilyNotFoundError, FamilyValidationError, isActiveGuardianRelationship } from "./child-safety-family";
import {
  FamilyAction, authorizeFamilyAction, CHILD_SAFETY_AUDIT_EVENTS, validateChildSafetyInput,
  GuardianRelationshipStatus, ConsentStatus, SafetyRecipientEligibility,
  GuardianAuthorityStatus, SafeRecipientAssessmentStatus,
  isGuardianAuthorityType, isGuardianAuthorityLevel, isVerificationMethod, isConsentType, isSafeRecipientReasonCode,
  isGuardianAuthorityActive, isConsentEffective, isSafeRecipientAssessmentApproved,
  evaluateCanReceiveSafetyInformation,
  CONSENT_GRANTED_STATUS, CONSENT_REVOKED_STATUS,
  GUARDIAN_AUTHORITY_CREATE_FIELDS, GUARDIAN_AUTHORITY_VERIFY_FIELDS, GUARDIAN_AUTHORITY_GRANT_FIELDS, GUARDIAN_AUTHORITY_CHANGE_LEVEL_FIELDS,
  CONSENT_CREATE_FIELDS, CONSENT_GRANT_FIELDS,
  SAFE_RECIPIENT_ASSESSMENT_CREATE_FIELDS, SAFE_RECIPIENT_ASSESSMENT_DECIDE_FIELDS,
  type FamilyActorContext, type SafetyRecipientDenyReason,
} from "@guardora/core";

/**
 * CS-C2 — Consent, Guardian Authority & Safe Recipients service (backend, server-only). The four
 * axes (relationship / authority / consent / eligibility) are separate, explicit, audited records;
 * none is ever auto-derived. Every mutation is FAMILY-gated + FamilyRole-authorized ABOVE tenant RLS,
 * tenant-scoped via withTenant/RLS (cross-tenant ids invisible → rejected; required composite FKs
 * backstop), fail-closed, content-free audited. No alert/notification/delivery/scheduler/evidence.
 */

type Tx = Prisma.TransactionClient;

function assertFamily(actor: FamilyActorContext, action: FamilyAction): void {
  const d = authorizeFamilyAction(actor, action);
  if (!d.ok) throw new FamilyForbiddenError(d.reason);
}
// Content-free audit — ids + enum values + timestamps only. NEVER label/name/note/document/raw.
async function audit(db: Tx, actor: FamilyActorContext, event: string, targetType: string, targetId: string, metadata?: Record<string, string | number | boolean>): Promise<void> {
  await db.auditLog.create({ data: { tenantId: actor.tenantId, event, actorKind: ActorKind.human, actorUserId: actor.userId, targetType, targetId, metadata: (metadata ?? undefined) as never } });
}
/** The actor's own membership id in this tenant (RLS-scoped). Fail-closed if not a member. */
async function actorMembershipId(db: Tx, actor: FamilyActorContext): Promise<string> {
  const m = await db.membership.findFirst({ where: { userId: actor.userId, tenantId: actor.tenantId }, select: { id: true } });
  if (!m) throw new FamilyForbiddenError("role_forbidden");
  return m.id;
}
/** A relationship an authority/assessment may attach to must be VERIFIED + non-revoked/archived. */
function relationshipIsVerifiedActive(r: { status: string; revokedAt: Date | null; archivedAt: Date | null }): boolean {
  return r.status === GuardianRelationshipStatus.Verified && r.revokedAt === null && r.archivedAt === null;
}

// ============================ view models (content-free) ============================

export interface GuardianAuthorityRecordVM {
  id: string; guardianRelationshipId: string; authorityType: string; authorityLevel: string; authorityStatus: string;
  validFrom: Date; validUntil: Date | null; verifiedAt: Date | null; verificationMethod: string | null;
  createdAt: Date; updatedAt: Date; revokedAt: Date | null; archivedAt: Date | null;
}
export interface ConsentRecordVM {
  id: string; protectedProfileId: string; guardianRelationshipId: string | null; consentType: string; consentStatus: string;
  grantedByMembershipId: string | null; grantedAt: Date | null; validFrom: Date | null; validUntil: Date | null;
  revokedAt: Date | null; createdAt: Date; updatedAt: Date; archivedAt: Date | null;
}
export interface SafeRecipientAssessmentVM {
  id: string; guardianRelationshipId: string; eligibilityStatus: string; assessmentStatus: string;
  assessedByMembershipId: string | null; assessedAt: Date | null; reasonCode: string | null; validUntil: Date | null;
  revokedAt: Date | null; createdAt: Date; updatedAt: Date; archivedAt: Date | null;
}
const AUTH_SELECT = { id: true, guardianRelationshipId: true, authorityType: true, authorityLevel: true, authorityStatus: true, validFrom: true, validUntil: true, verifiedAt: true, verificationMethod: true, createdAt: true, updatedAt: true, revokedAt: true, archivedAt: true } as const;
const CONSENT_SELECT = { id: true, protectedProfileId: true, guardianRelationshipId: true, consentType: true, consentStatus: true, grantedByMembershipId: true, grantedAt: true, validFrom: true, validUntil: true, revokedAt: true, createdAt: true, updatedAt: true, archivedAt: true } as const;
const ASSESS_SELECT = { id: true, guardianRelationshipId: true, eligibilityStatus: true, assessmentStatus: true, assessedByMembershipId: true, assessedAt: true, reasonCode: true, validUntil: true, revokedAt: true, createdAt: true, updatedAt: true, archivedAt: true } as const;

// ============================ Guardian Authority ============================

export async function createGuardianAuthorityRecord(actor: FamilyActorContext, input: { guardianRelationshipId: string; authorityType: string; validFrom?: Date; validUntil?: Date }): Promise<GuardianAuthorityRecordVM> {
  assertFamily(actor, FamilyAction.GuardianAuthorityManage);
  const v = validateChildSafetyInput(input, GUARDIAN_AUTHORITY_CREATE_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$");
  if (!isGuardianAuthorityType(input.authorityType)) throw new FamilyValidationError("authorityType");
  return withTenant(actor.tenantId, async (db) => {
    const rel = await db.guardianRelationship.findFirst({ where: { id: input.guardianRelationshipId, tenantId: actor.tenantId }, select: { id: true } });
    if (!rel) throw new FamilyNotFoundError("guardian_relationship");
    const row = await db.guardianAuthorityRecord.create({
      data: { tenantId: actor.tenantId, guardianRelationshipId: input.guardianRelationshipId, authorityType: input.authorityType, authorityStatus: GuardianAuthorityStatus.Pending, ...(input.validFrom ? { validFrom: input.validFrom } : {}), validUntil: input.validUntil ?? null },
      select: AUTH_SELECT,
    });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.guardianAuthorityCreated, "guardian_authority_record", row.id, { authorityType: row.authorityType });
    return row;
  });
}

export async function verifyGuardianAuthorityRecord(actor: FamilyActorContext, id: string, input: { verificationMethod?: string; validUntil?: Date } = {}): Promise<GuardianAuthorityRecordVM> {
  assertFamily(actor, FamilyAction.GuardianAuthorityManage);
  const v = validateChildSafetyInput(input, GUARDIAN_AUTHORITY_VERIFY_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$");
  if (input.verificationMethod != null && !isVerificationMethod(input.verificationMethod)) throw new FamilyValidationError("verificationMethod");
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.guardianAuthorityRecord.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, revokedAt: true } });
    if (!existing) throw new FamilyNotFoundError("guardian_authority_record");
    if (existing.revokedAt) throw new FamilyValidationError("revoked"); // a revoked authority cannot be re-verified
    const row = await db.guardianAuthorityRecord.update({ where: { id }, data: { authorityStatus: GuardianAuthorityStatus.Verified, verifiedAt: new Date(), verificationMethod: input.verificationMethod ?? null, ...(input.validUntil ? { validUntil: input.validUntil } : {}) }, select: AUTH_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.guardianAuthorityVerified, "guardian_authority_record", row.id, input.verificationMethod ? { verificationMethod: input.verificationMethod } : undefined);
    return row;
  });
}

export async function rejectGuardianAuthorityRecord(actor: FamilyActorContext, id: string): Promise<GuardianAuthorityRecordVM> {
  assertFamily(actor, FamilyAction.GuardianAuthorityManage);
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.guardianAuthorityRecord.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true } });
    if (!existing) throw new FamilyNotFoundError("guardian_authority_record");
    const row = await db.guardianAuthorityRecord.update({ where: { id }, data: { authorityStatus: GuardianAuthorityStatus.Rejected }, select: AUTH_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.guardianAuthorityRejected, "guardian_authority_record", row.id);
    return row;
  });
}

export async function revokeGuardianAuthorityRecord(actor: FamilyActorContext, id: string): Promise<GuardianAuthorityRecordVM> {
  assertFamily(actor, FamilyAction.GuardianAuthorityManage);
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.guardianAuthorityRecord.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, revokedAt: true } });
    if (!existing) throw new FamilyNotFoundError("guardian_authority_record");
    if (existing.revokedAt) return db.guardianAuthorityRecord.findFirstOrThrow({ where: { id, tenantId: actor.tenantId }, select: AUTH_SELECT });
    const row = await db.guardianAuthorityRecord.update({ where: { id }, data: { authorityStatus: GuardianAuthorityStatus.Revoked, revokedAt: new Date() }, select: AUTH_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.guardianAuthorityRevoked, "guardian_authority_record", row.id);
    return row;
  });
}

export function listGuardianAuthorityRecords(actor: FamilyActorContext, guardianRelationshipId: string, opts: { includeInactive?: boolean } = {}): Promise<GuardianAuthorityRecordVM[]> {
  assertFamily(actor, FamilyAction.GuardianAuthorityView);
  return withTenant(actor.tenantId, (db) => db.guardianAuthorityRecord.findMany({ where: { tenantId: actor.tenantId, guardianRelationshipId, ...(opts.includeInactive ? {} : { revokedAt: null, archivedAt: null }) }, orderBy: { createdAt: "desc" }, select: AUTH_SELECT }));
}

/** The single effective (VERIFIED + time-valid) authority for a relationship, or null. */
export async function getEffectiveGuardianAuthority(actor: FamilyActorContext, guardianRelationshipId: string, now: Date = new Date()): Promise<GuardianAuthorityRecordVM | null> {
  assertFamily(actor, FamilyAction.GuardianAuthorityView);
  return withTenant(actor.tenantId, async (db) => {
    const rows = await db.guardianAuthorityRecord.findMany({ where: { tenantId: actor.tenantId, guardianRelationshipId, authorityStatus: GuardianAuthorityStatus.Verified, revokedAt: null, archivedAt: null }, orderBy: { createdAt: "desc" }, select: AUTH_SELECT });
    return rows.find((r) => isGuardianAuthorityActive(r, now)) ?? null;
  });
}

// ============================ CS-C9 — Guardian Authority activation & lifecycle ============================
//
// Authority is a SEPARATE axis: grant/change/suspend/resume/revoke NEVER touch GuardianRole,
// relationshipType or FamilyRole, and NEVER create a ConsentRecord / SafeRecipientAssessment /
// RecipientAuthorizationDecision / SafetySignalDelivery. Management is PrimaryGuardian-ONLY and forbids
// self-management. Authority is an internal PRODUCT permission — NOT a claim of state-verified legal
// authority; NO document/photo/id/free-text is ever stored (attestation is a bounded flag + timestamp).

/** Load the relationship + profile-archived + guardian membership for authority preconditions. Fail-closed. */
async function loadAuthorityContext(db: Tx, actor: FamilyActorContext, guardianRelationshipId: string): Promise<{ rel: { id: string; status: string; revokedAt: Date | null; archivedAt: Date | null; protectedProfileId: string; guardianMembershipId: string }; guardianUserId: string; profileArchived: boolean }> {
  const rel = await db.guardianRelationship.findFirst({ where: { id: guardianRelationshipId, tenantId: actor.tenantId }, select: { id: true, status: true, revokedAt: true, archivedAt: true, protectedProfileId: true, guardianMembershipId: true } });
  if (!rel) throw new FamilyNotFoundError("guardian_relationship");
  const [profile, gm] = await Promise.all([
    db.protectedProfile.findFirst({ where: { id: rel.protectedProfileId, tenantId: actor.tenantId }, select: { archivedAt: true } }),
    db.membership.findFirst({ where: { id: rel.guardianMembershipId, tenantId: actor.tenantId }, select: { id: true, userId: true } }),
  ]);
  if (!gm) throw new FamilyValidationError("inactive_membership"); // membership hard-deleted → treat as inactive
  return { rel, guardianUserId: gm.userId, profileArchived: profile?.archivedAt != null || profile == null };
}
/** The actor must never manage authority for a relationship whose guardian is the actor themselves. */
function assertNotSelfManaged(actor: FamilyActorContext, guardianUserId: string): void {
  if (guardianUserId === actor.userId) throw new FamilyValidationError("self_management_forbidden");
}

/**
 * CS-C9 — GRANT explicit, ACTIVE authority to a Guardian relationship. Requires an attestation flag; sets
 * the granted scope (authorityLevel) and an optional future expiry. Fail-closed on every precondition; at
 * most one ACTIVE (verified/suspended) authority per relationship.
 */
export async function grantGuardianAuthority(actor: FamilyActorContext, input: { guardianRelationshipId: string; authorityType: string; authorityLevel: string; validUntil?: Date; attestation?: boolean }, now: Date = new Date()): Promise<GuardianAuthorityRecordVM> {
  assertFamily(actor, FamilyAction.FamilyAuthorityGrant);
  const v = validateChildSafetyInput(input, GUARDIAN_AUTHORITY_GRANT_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$");
  if (!isGuardianAuthorityType(input.authorityType)) throw new FamilyValidationError("authorityType");
  if (!isGuardianAuthorityLevel(input.authorityLevel)) throw new FamilyValidationError("invalid_authority_level");
  if (input.attestation !== true) throw new FamilyValidationError("attestation_required");
  if (input.validUntil != null && input.validUntil.getTime() <= now.getTime()) throw new FamilyValidationError("invalid_state");
  return withTenant(actor.tenantId, async (db) => {
    const { rel, guardianUserId, profileArchived } = await loadAuthorityContext(db, actor, input.guardianRelationshipId);
    if (!isActiveGuardianRelationship(rel)) throw new FamilyValidationError("inactive_relationship");
    if (profileArchived) throw new FamilyValidationError("archived_profile");
    assertNotSelfManaged(actor, guardianUserId);
    const active = await db.guardianAuthorityRecord.findFirst({ where: { tenantId: actor.tenantId, guardianRelationshipId: rel.id, authorityStatus: { in: [GuardianAuthorityStatus.Verified, GuardianAuthorityStatus.Suspended] }, revokedAt: null, archivedAt: null }, select: { id: true } });
    if (active) throw new FamilyValidationError("authority_already_active");
    // ACTIVE = 'verified'. verifiedAt + verificationMethod=manual_review record the bounded attestation
    // (NEVER a document/photo/id/free text). NO role / relationshipType / consent / assessment is touched.
    const row = await db.guardianAuthorityRecord.create({
      data: { tenantId: actor.tenantId, guardianRelationshipId: rel.id, authorityType: input.authorityType, authorityLevel: input.authorityLevel, authorityStatus: GuardianAuthorityStatus.Verified, verifiedAt: now, verificationMethod: "manual_review", validUntil: input.validUntil ?? null },
      select: AUTH_SELECT,
    });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.guardianAuthorityGranted, "guardian_authority_record", row.id, { authorityType: row.authorityType, authorityLevel: row.authorityLevel });
    return row;
  });
}

/** CS-C9 — change the granted SCOPE (authorityLevel) on an ACTIVE or SUSPENDED authority. Never role/type. */
export async function changeGuardianAuthorityLevel(actor: FamilyActorContext, id: string, authorityLevel: string): Promise<GuardianAuthorityRecordVM> {
  assertFamily(actor, FamilyAction.FamilyAuthorityChange);
  const v = validateChildSafetyInput({ authorityLevel }, GUARDIAN_AUTHORITY_CHANGE_LEVEL_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$");
  if (!isGuardianAuthorityLevel(authorityLevel)) throw new FamilyValidationError("invalid_authority_level");
  return withTenant(actor.tenantId, async (db) => {
    const rec = await db.guardianAuthorityRecord.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, authorityStatus: true, authorityLevel: true, guardianRelationshipId: true } });
    if (!rec) throw new FamilyNotFoundError("guardian_authority_record");
    if (rec.authorityStatus !== GuardianAuthorityStatus.Verified && rec.authorityStatus !== GuardianAuthorityStatus.Suspended) throw new FamilyValidationError("invalid_state");
    const { guardianUserId } = await loadAuthorityContext(db, actor, rec.guardianRelationshipId);
    assertNotSelfManaged(actor, guardianUserId);
    if (rec.authorityLevel === authorityLevel) return db.guardianAuthorityRecord.findFirstOrThrow({ where: { id, tenantId: actor.tenantId }, select: AUTH_SELECT });
    const row = await db.guardianAuthorityRecord.update({ where: { id }, data: { authorityLevel }, select: AUTH_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.guardianAuthorityLevelChanged, "guardian_authority_record", row.id, { from: rec.authorityLevel, to: authorityLevel });
    return row;
  });
}

/** CS-C9 — suspend an ACTIVE authority (reversible). Immediately NOT effective. Idempotent. */
export async function suspendGuardianAuthority(actor: FamilyActorContext, id: string): Promise<GuardianAuthorityRecordVM> {
  assertFamily(actor, FamilyAction.FamilyAuthoritySuspend);
  return withTenant(actor.tenantId, async (db) => {
    const rec = await db.guardianAuthorityRecord.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, authorityStatus: true, guardianRelationshipId: true } });
    if (!rec) throw new FamilyNotFoundError("guardian_authority_record");
    if (rec.authorityStatus === GuardianAuthorityStatus.Suspended) return db.guardianAuthorityRecord.findFirstOrThrow({ where: { id, tenantId: actor.tenantId }, select: AUTH_SELECT });
    if (rec.authorityStatus !== GuardianAuthorityStatus.Verified) throw new FamilyValidationError("invalid_state");
    const { guardianUserId } = await loadAuthorityContext(db, actor, rec.guardianRelationshipId);
    assertNotSelfManaged(actor, guardianUserId);
    const row = await db.guardianAuthorityRecord.update({ where: { id }, data: { authorityStatus: GuardianAuthorityStatus.Suspended }, select: AUTH_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.guardianAuthoritySuspended, "guardian_authority_record", row.id);
    return row;
  });
}

/** CS-C9 — resume a SUSPENDED authority — but ONLY after re-checking every condition. Fail-closed. */
export async function resumeGuardianAuthority(actor: FamilyActorContext, id: string, now: Date = new Date()): Promise<GuardianAuthorityRecordVM> {
  assertFamily(actor, FamilyAction.FamilyAuthorityResume);
  return withTenant(actor.tenantId, async (db) => {
    const rec = await db.guardianAuthorityRecord.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, authorityStatus: true, validUntil: true, guardianRelationshipId: true } });
    if (!rec) throw new FamilyNotFoundError("guardian_authority_record");
    if (rec.authorityStatus !== GuardianAuthorityStatus.Suspended) throw new FamilyValidationError("invalid_state");
    if (rec.validUntil != null && rec.validUntil.getTime() <= now.getTime()) throw new FamilyValidationError("authority_expired");
    const { rel, guardianUserId, profileArchived } = await loadAuthorityContext(db, actor, rec.guardianRelationshipId);
    if (!isActiveGuardianRelationship(rel)) throw new FamilyValidationError("inactive_relationship");
    if (profileArchived) throw new FamilyValidationError("archived_profile");
    assertNotSelfManaged(actor, guardianUserId);
    const row = await db.guardianAuthorityRecord.update({ where: { id }, data: { authorityStatus: GuardianAuthorityStatus.Verified }, select: AUTH_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.guardianAuthorityResumed, "guardian_authority_record", row.id);
    return row;
  });
}

/** CS-C9 — revoke an ACTIVE or SUSPENDED authority (terminal). Immediately NOT effective. Idempotent. */
export async function revokeGuardianAuthority(actor: FamilyActorContext, id: string): Promise<GuardianAuthorityRecordVM> {
  assertFamily(actor, FamilyAction.FamilyAuthorityRevoke);
  return withTenant(actor.tenantId, async (db) => {
    const rec = await db.guardianAuthorityRecord.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, authorityStatus: true, revokedAt: true, guardianRelationshipId: true } });
    if (!rec) throw new FamilyNotFoundError("guardian_authority_record");
    if (rec.authorityStatus === GuardianAuthorityStatus.Revoked || rec.revokedAt != null) return db.guardianAuthorityRecord.findFirstOrThrow({ where: { id, tenantId: actor.tenantId }, select: AUTH_SELECT });
    if (rec.authorityStatus !== GuardianAuthorityStatus.Verified && rec.authorityStatus !== GuardianAuthorityStatus.Suspended) throw new FamilyValidationError("invalid_state");
    const { guardianUserId } = await loadAuthorityContext(db, actor, rec.guardianRelationshipId);
    assertNotSelfManaged(actor, guardianUserId);
    const row = await db.guardianAuthorityRecord.update({ where: { id }, data: { authorityStatus: GuardianAuthorityStatus.Revoked, revokedAt: new Date() }, select: AUTH_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.guardianAuthorityRevoked, "guardian_authority_record", row.id);
    return row;
  });
}

/**
 * CS-C9 — the FULL effective-authority evaluation for a relationship. Fail-closed: effective ONLY when the
 * workspace is FAMILY, the profile is ACTIVE, the relationship is active, the guardian membership exists,
 * and a VERIFIED, time-valid authority record exists. Returns a SAFE reason code (never internal detail).
 */
export type EffectiveAuthorityReason = "effective" | "inactive_relationship" | "archived_profile" | "inactive_membership" | "authority_not_active" | "authority_expired";
export interface EffectiveAuthorityDecision { effective: boolean; authorityLevel: string | null; reason: EffectiveAuthorityReason }
export async function evaluateEffectiveGuardianAuthority(actor: FamilyActorContext, guardianRelationshipId: string, now: Date = new Date()): Promise<EffectiveAuthorityDecision> {
  assertFamily(actor, FamilyAction.GuardianAuthorityView);
  return withTenant(actor.tenantId, async (db) => {
    const rel = await db.guardianRelationship.findFirst({ where: { id: guardianRelationshipId, tenantId: actor.tenantId }, select: { id: true, status: true, revokedAt: true, archivedAt: true, protectedProfileId: true, guardianMembershipId: true } });
    if (!rel || !isActiveGuardianRelationship(rel)) return { effective: false, authorityLevel: null, reason: "inactive_relationship" };
    const [profile, gm] = await Promise.all([
      db.protectedProfile.findFirst({ where: { id: rel.protectedProfileId, tenantId: actor.tenantId }, select: { archivedAt: true } }),
      db.membership.findFirst({ where: { id: rel.guardianMembershipId, tenantId: actor.tenantId }, select: { id: true } }),
    ]);
    if (!profile || profile.archivedAt != null) return { effective: false, authorityLevel: null, reason: "archived_profile" };
    if (!gm) return { effective: false, authorityLevel: null, reason: "inactive_membership" };
    const rows = await db.guardianAuthorityRecord.findMany({ where: { tenantId: actor.tenantId, guardianRelationshipId, authorityStatus: GuardianAuthorityStatus.Verified, revokedAt: null, archivedAt: null }, orderBy: { createdAt: "desc" }, select: AUTH_SELECT });
    const active = rows.find((r) => isGuardianAuthorityActive(r, now));
    if (!active) return { effective: false, authorityLevel: null, reason: "authority_not_active" };
    return { effective: true, authorityLevel: active.authorityLevel, reason: "effective" };
  });
}

/** CS-C9 — content-free, append-only authority timeline for one relationship (newest first). */
export interface AuthorityTimelineEntryVM { id: string; event: string; actorUserId: string | null; targetId: string | null; metadata: Record<string, unknown> | null; createdAt: Date }
export async function listGuardianAuthorityTimeline(actor: FamilyActorContext, guardianRelationshipId: string, opts: { limit?: number } = {}): Promise<AuthorityTimelineEntryVM[]> {
  assertFamily(actor, FamilyAction.GuardianAuthorityView);
  return withTenant(actor.tenantId, async (db) => {
    const recs = await db.guardianAuthorityRecord.findMany({ where: { tenantId: actor.tenantId, guardianRelationshipId }, select: { id: true } });
    const ids = recs.map((r) => r.id);
    if (ids.length === 0) return [];
    const rows = await db.auditLog.findMany({
      where: { tenantId: actor.tenantId, targetType: "guardian_authority_record", targetId: { in: ids } },
      orderBy: { createdAt: "desc" }, take: Math.min(Math.max(opts.limit ?? 100, 1), 200),
      select: { id: true, event: true, actorUserId: true, targetId: true, metadata: true, createdAt: true },
    });
    return rows.map((r) => ({ ...r, metadata: (r.metadata ?? null) as Record<string, unknown> | null }));
  });
}

// ============================ Consent ============================

export async function createConsentRecord(actor: FamilyActorContext, input: { protectedProfileId: string; guardianRelationshipId?: string | null; consentType: string; validFrom?: Date; validUntil?: Date }): Promise<ConsentRecordVM> {
  assertFamily(actor, FamilyAction.ConsentManage);
  const v = validateChildSafetyInput(input, CONSENT_CREATE_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$");
  if (!isConsentType(input.consentType)) throw new FamilyValidationError("consentType");
  return withTenant(actor.tenantId, async (db) => {
    const profile = await db.protectedProfile.findFirst({ where: { id: input.protectedProfileId, tenantId: actor.tenantId }, select: { id: true, archivedAt: true } });
    if (!profile || profile.archivedAt) throw new FamilyNotFoundError("protected_profile");
    if (input.guardianRelationshipId) {
      const rel = await db.guardianRelationship.findFirst({ where: { id: input.guardianRelationshipId, tenantId: actor.tenantId }, select: { id: true } });
      if (!rel) throw new FamilyNotFoundError("guardian_relationship"); // same-tenant enforced (optional link has no DB FK)
    }
    // NEVER auto-granted: default status only, no grantedAt/grantedBy.
    const row = await db.consentRecord.create({
      data: { tenantId: actor.tenantId, protectedProfileId: input.protectedProfileId, guardianRelationshipId: input.guardianRelationshipId ?? null, consentType: input.consentType, consentStatus: ConsentStatus.NotRequested, validFrom: input.validFrom ?? null, validUntil: input.validUntil ?? null },
      select: CONSENT_SELECT,
    });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.consentCreated, "consent_record", row.id, { consentType: row.consentType });
    return row;
  });
}

export async function grantConsent(actor: FamilyActorContext, id: string, input: { validFrom?: Date; validUntil?: Date } = {}): Promise<ConsentRecordVM> {
  assertFamily(actor, FamilyAction.ConsentManage);
  const v = validateChildSafetyInput(input, CONSENT_GRANT_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$");
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.consentRecord.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, revokedAt: true, archivedAt: true } });
    if (!existing) throw new FamilyNotFoundError("consent_record");
    if (existing.revokedAt || existing.archivedAt) throw new FamilyValidationError("inactive"); // cannot grant a revoked/archived consent
    const membershipId = await actorMembershipId(db, actor); // GRANTED must record the grantor
    const row = await db.consentRecord.update({ where: { id }, data: { consentStatus: CONSENT_GRANTED_STATUS, grantedAt: new Date(), grantedByMembershipId: membershipId, ...(input.validFrom ? { validFrom: input.validFrom } : {}), ...(input.validUntil ? { validUntil: input.validUntil } : {}) }, select: CONSENT_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.consentGranted, "consent_record", row.id, { consentType: row.consentType });
    return row;
  });
}

export async function revokeConsent(actor: FamilyActorContext, id: string): Promise<ConsentRecordVM> {
  assertFamily(actor, FamilyAction.ConsentManage);
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.consentRecord.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, revokedAt: true } });
    if (!existing) throw new FamilyNotFoundError("consent_record");
    if (existing.revokedAt) return db.consentRecord.findFirstOrThrow({ where: { id, tenantId: actor.tenantId }, select: CONSENT_SELECT });
    const row = await db.consentRecord.update({ where: { id }, data: { consentStatus: CONSENT_REVOKED_STATUS, revokedAt: new Date() }, select: CONSENT_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.consentRevoked, "consent_record", row.id);
    return row;
  });
}

export function listConsentRecords(actor: FamilyActorContext, protectedProfileId: string, opts: { includeInactive?: boolean } = {}): Promise<ConsentRecordVM[]> {
  assertFamily(actor, FamilyAction.ConsentView);
  return withTenant(actor.tenantId, (db) => db.consentRecord.findMany({ where: { tenantId: actor.tenantId, protectedProfileId, ...(opts.includeInactive ? {} : { revokedAt: null, archivedAt: null }) }, orderBy: { createdAt: "desc" }, select: CONSENT_SELECT }));
}

/** The single effective (ACTIVE + granted + time-valid) consent of a type for a profile, or null. */
export async function getEffectiveConsent(actor: FamilyActorContext, protectedProfileId: string, consentType: string, now: Date = new Date()): Promise<ConsentRecordVM | null> {
  assertFamily(actor, FamilyAction.ConsentView);
  return withTenant(actor.tenantId, async (db) => {
    const rows = await db.consentRecord.findMany({ where: { tenantId: actor.tenantId, protectedProfileId, consentType, consentStatus: ConsentStatus.Active, revokedAt: null, archivedAt: null }, orderBy: { createdAt: "desc" }, select: CONSENT_SELECT });
    return rows.find((r) => isConsentEffective(r, now)) ?? null;
  });
}

// ============================ Safe Recipient Assessment ============================

export async function createSafeRecipientAssessment(actor: FamilyActorContext, input: { guardianRelationshipId: string }): Promise<SafeRecipientAssessmentVM> {
  assertFamily(actor, FamilyAction.SafeRecipientAssess);
  const v = validateChildSafetyInput(input, SAFE_RECIPIENT_ASSESSMENT_CREATE_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$");
  return withTenant(actor.tenantId, async (db) => {
    const rel = await db.guardianRelationship.findFirst({ where: { id: input.guardianRelationshipId, tenantId: actor.tenantId }, select: { id: true } });
    if (!rel) throw new FamilyNotFoundError("guardian_relationship");
    // A guardian is NEVER automatically eligible: default not_started / not_verified.
    const row = await db.safeRecipientAssessment.create({ data: { tenantId: actor.tenantId, guardianRelationshipId: input.guardianRelationshipId, assessmentStatus: SafeRecipientAssessmentStatus.NotStarted, eligibilityStatus: SafetyRecipientEligibility.NotVerified }, select: ASSESS_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.safeRecipientAssessmentCreated, "safe_recipient_assessment", row.id);
    return row;
  });
}

export async function approveSafeRecipientAssessment(actor: FamilyActorContext, id: string, input: { reasonCode?: string; validUntil?: Date } = {}): Promise<SafeRecipientAssessmentVM> {
  assertFamily(actor, FamilyAction.SafeRecipientAssess);
  const v = validateChildSafetyInput(input, SAFE_RECIPIENT_ASSESSMENT_DECIDE_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$");
  if (input.reasonCode != null && !isSafeRecipientReasonCode(input.reasonCode)) throw new FamilyValidationError("reasonCode");
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.safeRecipientAssessment.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, revokedAt: true, archivedAt: true } });
    if (!existing) throw new FamilyNotFoundError("safe_recipient_assessment");
    if (existing.revokedAt || existing.archivedAt) throw new FamilyValidationError("inactive");
    const membershipId = await actorMembershipId(db, actor); // APPROVED must record the assessor
    const row = await db.safeRecipientAssessment.update({ where: { id }, data: { assessmentStatus: SafeRecipientAssessmentStatus.Approved, eligibilityStatus: SafetyRecipientEligibility.Eligible, assessedByMembershipId: membershipId, assessedAt: new Date(), reasonCode: input.reasonCode ?? null, ...(input.validUntil ? { validUntil: input.validUntil } : {}) }, select: ASSESS_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.safeRecipientAssessmentApproved, "safe_recipient_assessment", row.id, input.reasonCode ? { reasonCode: input.reasonCode } : undefined);
    return row;
  });
}

export async function rejectSafeRecipientAssessment(actor: FamilyActorContext, id: string, input: { reasonCode?: string } = {}): Promise<SafeRecipientAssessmentVM> {
  assertFamily(actor, FamilyAction.SafeRecipientAssess);
  const v = validateChildSafetyInput(input, SAFE_RECIPIENT_ASSESSMENT_DECIDE_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$");
  if (input.reasonCode != null && !isSafeRecipientReasonCode(input.reasonCode)) throw new FamilyValidationError("reasonCode");
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.safeRecipientAssessment.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true } });
    if (!existing) throw new FamilyNotFoundError("safe_recipient_assessment");
    const row = await db.safeRecipientAssessment.update({ where: { id }, data: { assessmentStatus: SafeRecipientAssessmentStatus.Rejected, eligibilityStatus: SafetyRecipientEligibility.NotVerified, reasonCode: input.reasonCode ?? null }, select: ASSESS_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.safeRecipientAssessmentRejected, "safe_recipient_assessment", row.id, input.reasonCode ? { reasonCode: input.reasonCode } : undefined);
    return row;
  });
}

export async function revokeSafeRecipientAssessment(actor: FamilyActorContext, id: string): Promise<SafeRecipientAssessmentVM> {
  assertFamily(actor, FamilyAction.SafeRecipientAssess);
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.safeRecipientAssessment.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, revokedAt: true } });
    if (!existing) throw new FamilyNotFoundError("safe_recipient_assessment");
    if (existing.revokedAt) return db.safeRecipientAssessment.findFirstOrThrow({ where: { id, tenantId: actor.tenantId }, select: ASSESS_SELECT });
    const row = await db.safeRecipientAssessment.update({ where: { id }, data: { assessmentStatus: SafeRecipientAssessmentStatus.Revoked, eligibilityStatus: SafetyRecipientEligibility.NotVerified, revokedAt: new Date() }, select: ASSESS_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.safeRecipientAssessmentRevoked, "safe_recipient_assessment", row.id);
    return row;
  });
}

export function listSafeRecipientAssessments(actor: FamilyActorContext, guardianRelationshipId: string, opts: { includeInactive?: boolean } = {}): Promise<SafeRecipientAssessmentVM[]> {
  assertFamily(actor, FamilyAction.SafeRecipientView);
  return withTenant(actor.tenantId, (db) => db.safeRecipientAssessment.findMany({ where: { tenantId: actor.tenantId, guardianRelationshipId, ...(opts.includeInactive ? {} : { revokedAt: null, archivedAt: null }) }, orderBy: { createdAt: "desc" }, select: ASSESS_SELECT }));
}

/** The single effective (APPROVED + eligible + time-valid) assessment for a relationship, or null. */
export async function getEffectiveSafeRecipientEligibility(actor: FamilyActorContext, guardianRelationshipId: string, now: Date = new Date()): Promise<SafeRecipientAssessmentVM | null> {
  assertFamily(actor, FamilyAction.SafeRecipientView);
  return withTenant(actor.tenantId, async (db) => {
    const rows = await db.safeRecipientAssessment.findMany({ where: { tenantId: actor.tenantId, guardianRelationshipId, assessmentStatus: SafeRecipientAssessmentStatus.Approved, revokedAt: null, archivedAt: null }, orderBy: { createdAt: "desc" }, select: ASSESS_SELECT });
    return rows.find((r) => isSafeRecipientAssessmentApproved(r, now)) ?? null;
  });
}

// ============================ Effective authorization service ============================

/** True iff the actor holds a VERIFIED, active guardian relationship over the profile. PENDING/REVOKED → false. */
export async function canGuardianManageProtectedProfile(actor: FamilyActorContext, protectedProfileId: string): Promise<boolean> {
  if (!authorizeFamilyAction(actor, FamilyAction.ProtectedProfileManage).ok) return false;
  return withTenant(actor.tenantId, async (db) => {
    const membershipId = await db.membership.findFirst({ where: { userId: actor.userId, tenantId: actor.tenantId }, select: { id: true } });
    if (!membershipId) return false;
    const rel = await db.guardianRelationship.findFirst({ where: { tenantId: actor.tenantId, protectedProfileId, guardianMembershipId: membershipId.id }, select: { status: true, revokedAt: true, archivedAt: true } });
    return rel !== null && relationshipIsVerifiedActive(rel);
  });
}

export interface SafetyInformationDecision { ok: boolean; reasons: SafetyRecipientDenyReason[] }

/**
 * The COMPLETE safe-recipient authorization decision for a guardian relationship. Fail-closed: TRUE
 * only if EVERY link holds — FAMILY workspace, active membership (same tenant), active guardian
 * relationship, valid verified authority (if the type requires it), effective consent of `consentType`
 * for the linked profile, and an approved non-expired safe-recipient assessment. NO side effects,
 * NO delivery — it is purely an authorization decision.
 */
export async function canReceiveSafetyInformation(actor: FamilyActorContext, guardianRelationshipId: string, opts: { consentType: string }, now: Date = new Date()): Promise<SafetyInformationDecision> {
  if (actor.workspaceKind !== "family") return { ok: false, reasons: ["not_family_workspace"] };
  if (!authorizeFamilyAction(actor, FamilyAction.SafeRecipientView).ok) return { ok: false, reasons: ["not_family_workspace"] };
  return withTenant(actor.tenantId, async (db) => {
    const rel = await db.guardianRelationship.findFirst({ where: { id: guardianRelationshipId, tenantId: actor.tenantId }, select: { id: true, status: true, relationshipType: true, revokedAt: true, archivedAt: true, protectedProfileId: true, guardianMembershipId: true } });
    if (!rel) return { ok: false, reasons: ["relationship_inactive"] };
    const membership = await db.membership.findFirst({ where: { id: rel.guardianMembershipId, tenantId: actor.tenantId }, select: { id: true } });

    const authorityRows = await db.guardianAuthorityRecord.findMany({ where: { tenantId: actor.tenantId, guardianRelationshipId, authorityStatus: GuardianAuthorityStatus.Verified, revokedAt: null, archivedAt: null }, select: AUTH_SELECT });
    const consentRows = await db.consentRecord.findMany({ where: { tenantId: actor.tenantId, protectedProfileId: rel.protectedProfileId, consentType: opts.consentType, consentStatus: ConsentStatus.Active, revokedAt: null, archivedAt: null }, select: CONSENT_SELECT });
    const assessRows = await db.safeRecipientAssessment.findMany({ where: { tenantId: actor.tenantId, guardianRelationshipId, assessmentStatus: SafeRecipientAssessmentStatus.Approved, revokedAt: null, archivedAt: null }, select: ASSESS_SELECT });

    return evaluateCanReceiveSafetyInformation({
      workspaceKind: actor.workspaceKind,
      relationshipActive: isActiveGuardianRelationship(rel),
      relationshipType: rel.relationshipType,
      membershipActiveSameTenant: membership !== null,
      authorityActive: authorityRows.some((r) => isGuardianAuthorityActive(r, now)),
      consentEffective: consentRows.some((r) => isConsentEffective(r, now)),
      assessmentApproved: assessRows.some((r) => isSafeRecipientAssessmentApproved(r, now)),
    });
  });
}
