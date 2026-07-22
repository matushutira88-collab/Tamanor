import { ActorKind, Prisma } from "@prisma/client";
import { withTenant } from "./repositories";
import {
  FamilyAction, authorizeFamilyAction, CHILD_SAFETY_AUDIT_EVENTS,
  validateChildSafetyInput, PROTECTED_PROFILE_CREATE_FIELDS, GUARDIAN_RELATIONSHIP_CREATE_FIELDS,
  isAgeBand, isProtectionStatus, isGuardianRelationshipType, isGuardianAuthorityLevel, isConsentType,
  GUARDIAN_RELATIONSHIP_DEFAULTS, PROTECTED_PROFILE_DEFAULT_STATUS,
  GuardianRelationshipStatus,
  type FamilyActorContext,
} from "@guardora/core";

/**
 * CS-C1 — Child Safety Family domain service (backend, server-only). Every operation is:
 *  - FAMILY-workspace-gated + FamilyRole-authorized ABOVE tenant RLS (a tenantId is never enough),
 *  - tenant-scoped via withTenant/RLS (cross-tenant ids are invisible → rejected, plus composite-FK
 *    backstop), fail-closed, and content-free audited.
 * No UI, endpoint, alert, notification, classifier, or raw-content storage is added here.
 */

export type FamilyForbiddenReason = "not_family_workspace" | "capability_not_in_workspace" | "role_forbidden";
export class FamilyForbiddenError extends Error {
  readonly code = "FORBIDDEN";
  constructor(public readonly reason: FamilyForbiddenReason) { super(`forbidden: ${reason}`); this.name = "FamilyForbiddenError"; }
}
export type FamilyRecordKind =
  | "protected_profile" | "guardian_relationship"
  | "guardian_authority_record" | "consent_record" | "safe_recipient_assessment" | "membership";
export class FamilyNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  constructor(kind: FamilyRecordKind) { super(`${kind} not found in this tenant`); this.name = "FamilyNotFoundError"; }
}
export class FamilyValidationError extends Error {
  readonly code = "INVALID";
  constructor(public readonly field: string) { super(`invalid input: ${field}`); this.name = "FamilyValidationError"; }
}

function assertFamily(actor: FamilyActorContext, action: FamilyAction): void {
  const d = authorizeFamilyAction(actor, action);
  if (!d.ok) throw new FamilyForbiddenError(d.reason);
}

type Tx = Prisma.TransactionClient;
// Content-free audit — ids + enum values only. NEVER label/consent value/PII/raw content.
async function audit(db: Tx, actor: FamilyActorContext, event: string, targetType: string, targetId: string, metadata?: Record<string, string | number | boolean>): Promise<void> {
  await db.auditLog.create({ data: { tenantId: actor.tenantId, event, actorKind: ActorKind.human, actorUserId: actor.userId, targetType, targetId, metadata: (metadata ?? undefined) as never } });
}

// --- View models (content-free by construction) -----------------------------

export interface ProtectedProfileVM {
  id: string; guardianLabel: string | null; ageBand: string; protectionStatus: string;
  createdAt: Date; updatedAt: Date; archivedAt: Date | null;
}
export interface GuardianRelationshipVM {
  id: string; guardianMembershipId: string; protectedProfileId: string;
  relationshipType: string; authorityLevel: string; status: string;
  consentStatus: string; consentType: string | null; safeRecipientEligibility: string;
  createdAt: Date; updatedAt: Date; revokedAt: Date | null; archivedAt: Date | null;
}

const PROFILE_SELECT = { id: true, guardianLabel: true, ageBand: true, protectionStatus: true, createdAt: true, updatedAt: true, archivedAt: true } as const;
const REL_SELECT = { id: true, guardianMembershipId: true, protectedProfileId: true, relationshipType: true, authorityLevel: true, status: true, consentStatus: true, consentType: true, safeRecipientEligibility: true, createdAt: true, updatedAt: true, revokedAt: true, archivedAt: true } as const;

/** A relationship counts as active only when not revoked and not archived. */
export function isActiveGuardianRelationship(r: { status: string; revokedAt: Date | null; archivedAt: Date | null }): boolean {
  return r.status !== GuardianRelationshipStatus.Revoked && r.revokedAt === null && r.archivedAt === null;
}

// --- ProtectedProfile -------------------------------------------------------

export async function createProtectedProfile(actor: FamilyActorContext, input: { guardianLabel?: string | null; ageBand: string; protectionStatus?: string }): Promise<ProtectedProfileVM> {
  assertFamily(actor, FamilyAction.ProtectedProfileManage);
  const v = validateChildSafetyInput(input, PROTECTED_PROFILE_CREATE_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$");
  if (!isAgeBand(input.ageBand)) throw new FamilyValidationError("ageBand");
  const protectionStatus = input.protectionStatus ?? PROTECTED_PROFILE_DEFAULT_STATUS;
  if (!isProtectionStatus(protectionStatus)) throw new FamilyValidationError("protectionStatus");
  return withTenant(actor.tenantId, async (db) => {
    const row = await db.protectedProfile.create({
      data: { tenantId: actor.tenantId, guardianLabel: input.guardianLabel ?? null, ageBand: input.ageBand, protectionStatus },
      select: PROFILE_SELECT,
    });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.protectedProfileCreated, "protected_profile", row.id, { ageBand: row.ageBand, protectionStatus: row.protectionStatus });
    return row;
  });
}

export function listProtectedProfiles(actor: FamilyActorContext, opts: { includeArchived?: boolean } = {}): Promise<ProtectedProfileVM[]> {
  assertFamily(actor, FamilyAction.ProtectedProfileView);
  return withTenant(actor.tenantId, (db) => db.protectedProfile.findMany({
    where: { tenantId: actor.tenantId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
    orderBy: { createdAt: "desc" },
    select: PROFILE_SELECT,
  }));
}

export async function getProtectedProfile(actor: FamilyActorContext, id: string): Promise<ProtectedProfileVM> {
  assertFamily(actor, FamilyAction.ProtectedProfileView);
  const row = await withTenant(actor.tenantId, (db) => db.protectedProfile.findFirst({ where: { id, tenantId: actor.tenantId }, select: PROFILE_SELECT }));
  if (!row) throw new FamilyNotFoundError("protected_profile");
  return row;
}

/** Soft archive. Idempotent. Historical guardian relationships are NEVER deleted. */
export async function archiveProtectedProfile(actor: FamilyActorContext, id: string): Promise<ProtectedProfileVM> {
  assertFamily(actor, FamilyAction.ProtectedProfileManage);
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.protectedProfile.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, archivedAt: true } });
    if (!existing) throw new FamilyNotFoundError("protected_profile");
    if (existing.archivedAt) return db.protectedProfile.findFirstOrThrow({ where: { id, tenantId: actor.tenantId }, select: PROFILE_SELECT });
    const row = await db.protectedProfile.update({ where: { id }, data: { archivedAt: new Date() }, select: PROFILE_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.protectedProfileArchived, "protected_profile", row.id);
    return row;
  });
}

// --- GuardianRelationship ---------------------------------------------------

export async function createGuardianRelationship(actor: FamilyActorContext, input: { guardianMembershipId: string; protectedProfileId: string; relationshipType: string; authorityLevel: string; consentType?: string | null }): Promise<GuardianRelationshipVM> {
  assertFamily(actor, FamilyAction.GuardianRelationshipManage);
  const v = validateChildSafetyInput(input, GUARDIAN_RELATIONSHIP_CREATE_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$");
  if (!isGuardianRelationshipType(input.relationshipType)) throw new FamilyValidationError("relationshipType");
  if (!isGuardianAuthorityLevel(input.authorityLevel)) throw new FamilyValidationError("authorityLevel");
  if (input.consentType != null && !isConsentType(input.consentType)) throw new FamilyValidationError("consentType");
  return withTenant(actor.tenantId, async (db) => {
    // Both ids MUST resolve WITHIN this tenant (RLS scopes the lookups; cross-tenant ids → null → reject).
    const membership = await db.membership.findFirst({ where: { id: input.guardianMembershipId, tenantId: actor.tenantId }, select: { id: true } });
    if (!membership) throw new FamilyNotFoundError("guardian_relationship");
    const profile = await db.protectedProfile.findFirst({ where: { id: input.protectedProfileId, tenantId: actor.tenantId }, select: { id: true, archivedAt: true } });
    if (!profile || profile.archivedAt) throw new FamilyNotFoundError("protected_profile");
    // Defaults enforce separation: a new relationship is NEVER auto-consented or auto safe-recipient.
    const row = await db.guardianRelationship.create({
      data: {
        tenantId: actor.tenantId,
        guardianMembershipId: input.guardianMembershipId,
        protectedProfileId: input.protectedProfileId,
        relationshipType: input.relationshipType,
        authorityLevel: input.authorityLevel,
        status: GUARDIAN_RELATIONSHIP_DEFAULTS.status,
        consentStatus: GUARDIAN_RELATIONSHIP_DEFAULTS.consentStatus,
        consentType: input.consentType ?? null,
        safeRecipientEligibility: GUARDIAN_RELATIONSHIP_DEFAULTS.safeRecipientEligibility,
      },
      select: REL_SELECT,
    });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.guardianRelationshipCreated, "guardian_relationship", row.id, { relationshipType: row.relationshipType, authorityLevel: row.authorityLevel });
    return row;
  });
}

export function listRelationshipsForProfile(actor: FamilyActorContext, protectedProfileId: string, opts: { includeInactive?: boolean } = {}): Promise<GuardianRelationshipVM[]> {
  assertFamily(actor, FamilyAction.GuardianRelationshipView);
  return withTenant(actor.tenantId, (db) => db.guardianRelationship.findMany({
    where: { tenantId: actor.tenantId, protectedProfileId, ...(opts.includeInactive ? {} : { revokedAt: null, archivedAt: null }) },
    orderBy: { createdAt: "desc" },
    select: REL_SELECT,
  }));
}

/** Explicit revoke (never automatic). Idempotent. Sets status=revoked + revokedAt. */
export async function revokeGuardianRelationship(actor: FamilyActorContext, id: string): Promise<GuardianRelationshipVM> {
  assertFamily(actor, FamilyAction.GuardianRelationshipManage);
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.guardianRelationship.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, status: true, revokedAt: true } });
    if (!existing) throw new FamilyNotFoundError("guardian_relationship");
    if (existing.revokedAt) return db.guardianRelationship.findFirstOrThrow({ where: { id, tenantId: actor.tenantId }, select: REL_SELECT });
    const row = await db.guardianRelationship.update({ where: { id }, data: { status: GuardianRelationshipStatus.Revoked, revokedAt: new Date() }, select: REL_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.guardianRelationshipRevoked, "guardian_relationship", row.id);
    return row;
  });
}

/** Soft archive of a relationship (history preserved). Idempotent. */
export async function archiveGuardianRelationship(actor: FamilyActorContext, id: string): Promise<GuardianRelationshipVM> {
  assertFamily(actor, FamilyAction.GuardianRelationshipManage);
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.guardianRelationship.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, archivedAt: true } });
    if (!existing) throw new FamilyNotFoundError("guardian_relationship");
    if (existing.archivedAt) return db.guardianRelationship.findFirstOrThrow({ where: { id, tenantId: actor.tenantId }, select: REL_SELECT });
    const row = await db.guardianRelationship.update({ where: { id }, data: { archivedAt: new Date() }, select: REL_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.guardianRelationshipArchived, "guardian_relationship", row.id);
    return row;
  });
}
