import { ActorKind, Prisma } from "@prisma/client";
import { withTenant } from "./repositories";
import { enforceFamilyCapacity } from "./family-billing-guard";
import {
  FamilyAction, authorizeFamilyAction, CHILD_SAFETY_AUDIT_EVENTS,
  validateChildSafetyInput, PROTECTED_PROFILE_CREATE_FIELDS, PROTECTED_PROFILE_UPDATE_FIELDS, GUARDIAN_RELATIONSHIP_CREATE_FIELDS,
  isAgeBand, isProtectionStatus, isGuardianRelationshipType, isGuardianAuthorityLevel, isConsentType,
  isGuardianRole, isProfileLanguage,
  GUARDIAN_RELATIONSHIP_DEFAULTS, PROTECTED_PROFILE_DEFAULT_STATUS,
  GuardianRelationshipStatus, GuardianRole,
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
  | "guardian_authority_record" | "consent_record" | "safe_recipient_assessment" | "membership"
  | "safety_signal" | "family_guardian_invitation";
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
  language: string | null; // CS-C7 — bounded UI language (en|sk|de) or null. Content-free.
  createdAt: Date; updatedAt: Date; archivedAt: Date | null;
}
export interface GuardianRelationshipVM {
  id: string; guardianMembershipId: string; protectedProfileId: string;
  relationshipType: string; authorityLevel: string; guardianRole: string; status: string;
  consentStatus: string; consentType: string | null; safeRecipientEligibility: string;
  createdAt: Date; updatedAt: Date; revokedAt: Date | null; archivedAt: Date | null;
}

const PROFILE_SELECT = { id: true, guardianLabel: true, ageBand: true, protectionStatus: true, language: true, createdAt: true, updatedAt: true, archivedAt: true } as const;
const REL_SELECT = { id: true, guardianMembershipId: true, protectedProfileId: true, relationshipType: true, authorityLevel: true, guardianRole: true, status: true, consentStatus: true, consentType: true, safeRecipientEligibility: true, createdAt: true, updatedAt: true, revokedAt: true, archivedAt: true } as const;

/**
 * A relationship counts as ACTIVE only when it is not revoked, not archived, AND not deactivated
 * (CS-C7: status 'suspended' = an explicitly deactivated relationship). A deactivated guardian therefore
 * loses downstream authorization (CS-C4) until reactivated — the fail-closed behaviour.
 */
export function isActiveGuardianRelationship(r: { status: string; revokedAt: Date | null; archivedAt: Date | null }): boolean {
  return r.status !== GuardianRelationshipStatus.Revoked
    && r.status !== GuardianRelationshipStatus.Suspended
    && r.revokedAt === null && r.archivedAt === null;
}

/** CS-C7 — the two-state guardian lifecycle used by the UI/filters (derived; never stored twice). */
export type GuardianLifecycleState = "active" | "inactive";
export function guardianLifecycleState(r: { status: string; revokedAt: Date | null; archivedAt: Date | null }): GuardianLifecycleState {
  return isActiveGuardianRelationship(r) ? "active" : "inactive";
}

/**
 * CS-C7 — a unique-violation on the ACTIVE-primary partial index (columns exactly tenantId +
 * protectedProfileId) surfaces as a safe invalid-state error. Distinguished from the CS-C1
 * one-active-per-guardian/type index (which also carries guardianMembershipId + relationshipType) and
 * the composite (id,tenantId) key. Handles both the index-name and the column-list forms of meta.target.
 */
function isPrimaryConflict(e: unknown): boolean {
  // Duck-typed on the Prisma error shape (`.code` / `.meta.target`) — a plain `instanceof` can miss when a
  // known-request-error class identity differs across module resolution; the code + target are stable.
  if (!e || typeof e !== "object") return false;
  const err = e as { code?: unknown; meta?: { target?: unknown } };
  if (err.code !== "P2002") return false;
  const t = err.meta?.target;
  if (typeof t === "string") return t.includes("primary");
  if (Array.isArray(t)) {
    const set = new Set(t.map(String));
    return set.has("protectedProfileId") && set.has("tenantId")
      && !set.has("guardianMembershipId") && !set.has("relationshipType") && !set.has("id");
  }
  return false;
}

/**
 * CS-C7 — the PRIMARY invariant is enforced on two layers: (1) a deterministic in-transaction pre-check
 * here that yields a clean safe error in the normal case, and (2) the `gr_one_active_primary_per_profile`
 * partial UNIQUE index as the race-safe DB backstop (a concurrent insert still cannot create two active
 * primaries). "Active" = not deactivated ('suspended'), not revoked, not archived.
 */
async function activePrimaryExists(db: Tx, tenantId: string, protectedProfileId: string, excludeId?: string): Promise<boolean> {
  const found = await db.guardianRelationship.findFirst({
    where: {
      tenantId, protectedProfileId, guardianRole: GuardianRole.Primary,
      status: { notIn: [GuardianRelationshipStatus.Suspended, GuardianRelationshipStatus.Revoked] },
      revokedAt: null, archivedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  return found !== null;
}

// --- ProtectedProfile -------------------------------------------------------

export async function createProtectedProfile(actor: FamilyActorContext, input: { guardianLabel?: string | null; ageBand: string; protectionStatus?: string; language?: string | null }): Promise<ProtectedProfileVM> {
  assertFamily(actor, FamilyAction.ProtectedProfileManage);
  const v = validateChildSafetyInput(input, PROTECTED_PROFILE_CREATE_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$");
  if (!isAgeBand(input.ageBand)) throw new FamilyValidationError("ageBand");
  const protectionStatus = input.protectionStatus ?? PROTECTED_PROFILE_DEFAULT_STATUS;
  if (!isProtectionStatus(protectionStatus)) throw new FamilyValidationError("protectionStatus");
  if (input.language != null && !isProfileLanguage(input.language)) throw new FamilyValidationError("language");
  return withTenant(actor.tenantId, async (db) => {
    // FAMILY-BILLING S2 — enforce the protected-profile cap before creating (flag-gated, race-safe).
    await enforceFamilyCapacity(db, actor.tenantId, "protected_profile");
    const row = await db.protectedProfile.create({
      data: { tenantId: actor.tenantId, guardianLabel: input.guardianLabel ?? null, ageBand: input.ageBand, protectionStatus, language: input.language ?? null },
      select: PROFILE_SELECT,
    });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.protectedProfileCreated, "protected_profile", row.id, { ageBand: row.ageBand, protectionStatus: row.protectionStatus });
    return row;
  });
}

/**
 * CS-C7 — edit a profile's CONTENT-FREE fields (guardianLabel, ageBand, protectionStatus, language) only.
 * A ProtectedProfile is not a User: no real name, DOB, exact age, avatar, note, contact or identifier is
 * ever accepted (the allowlist + CHILD_SAFETY_FORBIDDEN_FIELDS reject them). Editing is allowed only while
 * ACTIVE (an archived profile must be restored first). The audit records ONLY the NAMES of the fields that
 * actually changed — never their old/new values.
 */
export async function updateProtectedProfile(
  actor: FamilyActorContext,
  id: string,
  patch: { guardianLabel?: string | null; ageBand?: string; protectionStatus?: string; language?: string | null },
): Promise<ProtectedProfileVM> {
  assertFamily(actor, FamilyAction.ProtectedProfileManage);
  const v = validateChildSafetyInput(patch, PROTECTED_PROFILE_UPDATE_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$");
  const data: Prisma.ProtectedProfileUpdateInput = {};
  if ("guardianLabel" in patch) data.guardianLabel = (patch.guardianLabel ?? "").toString().trim().slice(0, 80) || null;
  if ("ageBand" in patch) { if (!isAgeBand(patch.ageBand)) throw new FamilyValidationError("ageBand"); data.ageBand = patch.ageBand; }
  if ("protectionStatus" in patch) { if (!isProtectionStatus(patch.protectionStatus)) throw new FamilyValidationError("protectionStatus"); data.protectionStatus = patch.protectionStatus; }
  if ("language" in patch) { if (patch.language != null && !isProfileLanguage(patch.language)) throw new FamilyValidationError("language"); data.language = patch.language ?? null; }
  if (Object.keys(data).length === 0) throw new FamilyValidationError("$");
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.protectedProfile.findFirst({ where: { id, tenantId: actor.tenantId }, select: PROFILE_SELECT });
    if (!existing) throw new FamilyNotFoundError("protected_profile");
    if (existing.archivedAt) throw new FamilyValidationError("archived");
    // Only the fields whose value actually changes are logged — by NAME, never by value.
    const changed: string[] = [];
    if ("guardianLabel" in data && data.guardianLabel !== existing.guardianLabel) changed.push("guardianLabel");
    if ("ageBand" in data && data.ageBand !== existing.ageBand) changed.push("ageBand");
    if ("protectionStatus" in data && data.protectionStatus !== existing.protectionStatus) changed.push("protectionStatus");
    if ("language" in data && (data.language ?? null) !== existing.language) changed.push("language");
    if (changed.length === 0) return existing; // nothing actually changed → no write, no audit
    const row = await db.protectedProfile.update({ where: { id }, data, select: PROFILE_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.protectedProfileUpdated, "protected_profile", row.id, { fields: changed.sort().join(",") });
    return row;
  });
}

/** CS-C7 — restore an ARCHIVED profile (same id; never a new record). Only ARCHIVED → ACTIVE is allowed. */
export async function restoreProtectedProfile(actor: FamilyActorContext, id: string): Promise<ProtectedProfileVM> {
  assertFamily(actor, FamilyAction.ProtectedProfileManage);
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.protectedProfile.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, archivedAt: true } });
    if (!existing) throw new FamilyNotFoundError("protected_profile");
    if (!existing.archivedAt) throw new FamilyValidationError("not_archived"); // restore only an archived profile
    const row = await db.protectedProfile.update({ where: { id }, data: { archivedAt: null }, select: PROFILE_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.protectedProfileRestored, "protected_profile", row.id);
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

export async function createGuardianRelationship(actor: FamilyActorContext, input: { guardianMembershipId: string; protectedProfileId: string; relationshipType: string; authorityLevel: string; guardianRole: string; consentType?: string | null }): Promise<GuardianRelationshipVM> {
  assertFamily(actor, FamilyAction.GuardianRelationshipManage);
  const v = validateChildSafetyInput(input, GUARDIAN_RELATIONSHIP_CREATE_FIELDS);
  if (!v.ok) throw new FamilyValidationError(v.errors[0]?.field ?? "$");
  if (!isGuardianRelationshipType(input.relationshipType)) throw new FamilyValidationError("relationshipType");
  if (!isGuardianAuthorityLevel(input.authorityLevel)) throw new FamilyValidationError("authorityLevel");
  if (!isGuardianRole(input.guardianRole)) throw new FamilyValidationError("guardianRole");
  if (input.consentType != null && !isConsentType(input.consentType)) throw new FamilyValidationError("consentType");
  return withTenant(actor.tenantId, async (db) => {
    // Both ids MUST resolve WITHIN this tenant (RLS scopes the lookups; cross-tenant ids → null → reject).
    const membership = await db.membership.findFirst({ where: { id: input.guardianMembershipId, tenantId: actor.tenantId }, select: { id: true } });
    if (!membership) throw new FamilyNotFoundError("guardian_relationship");
    const profile = await db.protectedProfile.findFirst({ where: { id: input.protectedProfileId, tenantId: actor.tenantId }, select: { id: true, archivedAt: true } });
    if (!profile || profile.archivedAt) throw new FamilyNotFoundError("protected_profile");
    // At most one ACTIVE primary per profile (deterministic pre-check; index is the race-safe backstop).
    if (input.guardianRole === GuardianRole.Primary && await activePrimaryExists(db, actor.tenantId, input.protectedProfileId)) throw new FamilyValidationError("primary_guardian_conflict");
    // Defaults enforce separation: a new relationship is NEVER auto-consented or auto safe-recipient.
    // A role change/creation NEVER derives authorityLevel — the two are independent axes.
    // FAMILY-BILLING S2 — enforce the guardian cap before creating (flag-gated, race-safe).
    await enforceFamilyCapacity(db, actor.tenantId, "guardian");
    try {
      const row = await db.guardianRelationship.create({
        data: {
          tenantId: actor.tenantId,
          guardianMembershipId: input.guardianMembershipId,
          protectedProfileId: input.protectedProfileId,
          relationshipType: input.relationshipType,
          authorityLevel: input.authorityLevel,
          guardianRole: input.guardianRole,
          status: GUARDIAN_RELATIONSHIP_DEFAULTS.status,
          consentStatus: GUARDIAN_RELATIONSHIP_DEFAULTS.consentStatus,
          consentType: input.consentType ?? null,
          safeRecipientEligibility: GUARDIAN_RELATIONSHIP_DEFAULTS.safeRecipientEligibility,
        },
        select: REL_SELECT,
      });
      await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.guardianRelationshipCreated, "guardian_relationship", row.id, { relationshipType: row.relationshipType, authorityLevel: row.authorityLevel, guardianRole: row.guardianRole });
      return row;
    } catch (e) {
      if (isPrimaryConflict(e)) throw new FamilyValidationError("primary_guardian_conflict");
      throw e;
    }
  });
}

/**
 * CS-C7 — change ONLY a guardian's role (primary|secondary|emergency|view_only). It NEVER touches
 * relationshipType or authorityLevel. Setting an ACTIVE 'primary' when one already exists on the profile
 * is rejected (safe invalid-state). Idempotent for an unchanged role. The audit logs only the safe enum
 * transition (from→to).
 */
export async function updateGuardianRole(actor: FamilyActorContext, id: string, role: string): Promise<GuardianRelationshipVM> {
  assertFamily(actor, FamilyAction.GuardianRelationshipManage);
  if (!isGuardianRole(role)) throw new FamilyValidationError("guardianRole");
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.guardianRelationship.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, guardianRole: true, protectedProfileId: true, revokedAt: true, archivedAt: true } });
    if (!existing) throw new FamilyNotFoundError("guardian_relationship");
    if (existing.revokedAt || existing.archivedAt) throw new FamilyValidationError("invalid_state"); // terminal record
    if (existing.guardianRole === role) return db.guardianRelationship.findFirstOrThrow({ where: { id, tenantId: actor.tenantId }, select: REL_SELECT });
    // Changing TO primary must respect the one-active-primary invariant (exclude this record itself).
    if (role === GuardianRole.Primary && await activePrimaryExists(db, actor.tenantId, existing.protectedProfileId, id)) throw new FamilyValidationError("primary_guardian_conflict");
    try {
      const row = await db.guardianRelationship.update({ where: { id }, data: { guardianRole: role }, select: REL_SELECT });
      await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.guardianRelationshipRoleChanged, "guardian_relationship", row.id, { from: existing.guardianRole, to: role });
      return row;
    } catch (e) {
      if (isPrimaryConflict(e)) throw new FamilyValidationError("primary_guardian_conflict");
      throw e;
    }
  });
}

/**
 * CS-C7 — deactivate a guardian relationship (ACTIVE → INACTIVE). Reversible: sets status 'suspended'
 * (NOT the terminal 'revoked'), which removes downstream authorization until reactivated. Idempotent.
 * A revoked/archived (terminal) relationship cannot be deactivated.
 */
export async function deactivateGuardianRelationship(actor: FamilyActorContext, id: string): Promise<GuardianRelationshipVM> {
  assertFamily(actor, FamilyAction.GuardianRelationshipManage);
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.guardianRelationship.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, status: true, revokedAt: true, archivedAt: true } });
    if (!existing) throw new FamilyNotFoundError("guardian_relationship");
    if (existing.revokedAt || existing.archivedAt) throw new FamilyValidationError("invalid_state");
    if (existing.status === GuardianRelationshipStatus.Suspended) return db.guardianRelationship.findFirstOrThrow({ where: { id, tenantId: actor.tenantId }, select: REL_SELECT });
    const row = await db.guardianRelationship.update({ where: { id }, data: { status: GuardianRelationshipStatus.Suspended }, select: REL_SELECT });
    await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.guardianRelationshipDeactivated, "guardian_relationship", row.id);
    return row;
  });
}

/**
 * CS-C7 — reactivate a deactivated guardian (INACTIVE → ACTIVE). Restores the NEUTRAL 'pending' state
 * (never auto-'verified' — that would escalate privilege the deactivate/reactivate cycle must not grant).
 * Reactivating a 'primary' fails if another ACTIVE primary now exists. Idempotent for an already-active
 * relationship; a revoked/archived (terminal) one cannot be reactivated.
 */
export async function reactivateGuardianRelationship(actor: FamilyActorContext, id: string): Promise<GuardianRelationshipVM> {
  assertFamily(actor, FamilyAction.GuardianRelationshipManage);
  return withTenant(actor.tenantId, async (db) => {
    const existing = await db.guardianRelationship.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, status: true, guardianRole: true, protectedProfileId: true, revokedAt: true, archivedAt: true } });
    if (!existing) throw new FamilyNotFoundError("guardian_relationship");
    if (existing.revokedAt || existing.archivedAt) throw new FamilyValidationError("invalid_state");
    if (existing.status !== GuardianRelationshipStatus.Suspended) return db.guardianRelationship.findFirstOrThrow({ where: { id, tenantId: actor.tenantId }, select: REL_SELECT });
    // Reactivating a primary must not create a second ACTIVE primary on the profile.
    if (existing.guardianRole === GuardianRole.Primary && await activePrimaryExists(db, actor.tenantId, existing.protectedProfileId, id)) throw new FamilyValidationError("primary_guardian_conflict");
    try {
      const row = await db.guardianRelationship.update({ where: { id }, data: { status: GuardianRelationshipStatus.Pending }, select: REL_SELECT });
      await audit(db, actor, CHILD_SAFETY_AUDIT_EVENTS.guardianRelationshipReactivated, "guardian_relationship", row.id);
      return row;
    } catch (e) {
      if (isPrimaryConflict(e)) throw new FamilyValidationError("primary_guardian_conflict");
      throw e;
    }
  });
}

export function listRelationshipsForProfile(actor: FamilyActorContext, protectedProfileId: string, opts: { includeInactive?: boolean } = {}): Promise<GuardianRelationshipVM[]> {
  assertFamily(actor, FamilyAction.GuardianRelationshipView);
  return withTenant(actor.tenantId, (db) => db.guardianRelationship.findMany({
    // Default (active) view excludes deactivated (status 'suspended'), revoked AND archived — mirrors
    // isActiveGuardianRelationship. includeInactive returns the full history.
    where: { tenantId: actor.tenantId, protectedProfileId, ...(opts.includeInactive ? {} : { status: { notIn: [GuardianRelationshipStatus.Suspended, GuardianRelationshipStatus.Revoked] }, revokedAt: null, archivedAt: null }) },
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

// --- CS-C7 search / filters -------------------------------------------------

/**
 * CS-C7 — filtered profile search over CONTENT-FREE fields only: the guardian-chosen label (a safe
 * contains-match), age band, protection status, language, ACTIVE/ARCHIVED state, and — via a relation
 * filter — the presence of an ACTIVE guardian with a given role. Every filter is validated against the
 * bounded domain enums (an invalid value is rejected, never used as raw SQL). Nothing here reads or
 * matches PII.
 */
export interface ProtectedProfileSearch {
  query?: string;                 // matches guardianLabel (case-insensitive contains) — content-free
  ageBand?: string;
  protectionStatus?: string;
  language?: string;
  state?: "active" | "archived" | "all";  // ACTIVE = not archived
  guardianRole?: string;          // profiles with SOME active guardian of this role
}
export function searchProtectedProfiles(actor: FamilyActorContext, filters: ProtectedProfileSearch = {}): Promise<ProtectedProfileVM[]> {
  assertFamily(actor, FamilyAction.ProtectedProfileView);
  if (filters.ageBand != null && !isAgeBand(filters.ageBand)) throw new FamilyValidationError("ageBand");
  if (filters.protectionStatus != null && !isProtectionStatus(filters.protectionStatus)) throw new FamilyValidationError("protectionStatus");
  if (filters.language != null && !isProfileLanguage(filters.language)) throw new FamilyValidationError("language");
  if (filters.guardianRole != null && !isGuardianRole(filters.guardianRole)) throw new FamilyValidationError("guardianRole");
  const q = (filters.query ?? "").trim().slice(0, 80);
  const state = filters.state ?? "active";
  const where: Prisma.ProtectedProfileWhereInput = {
    tenantId: actor.tenantId,
    ...(state === "active" ? { archivedAt: null } : state === "archived" ? { archivedAt: { not: null } } : {}),
    ...(q ? { guardianLabel: { contains: q, mode: "insensitive" } } : {}),
    ...(filters.ageBand ? { ageBand: filters.ageBand } : {}),
    ...(filters.protectionStatus ? { protectionStatus: filters.protectionStatus } : {}),
    ...(filters.language ? { language: filters.language } : {}),
    // An ACTIVE guardian of the given role = not deactivated / revoked / archived (mirrors isActive*).
    ...(filters.guardianRole ? { guardianRelationships: { some: { guardianRole: filters.guardianRole, status: { notIn: [GuardianRelationshipStatus.Suspended, GuardianRelationshipStatus.Revoked] }, revokedAt: null, archivedAt: null } } } : {}),
  };
  return withTenant(actor.tenantId, (db) => db.protectedProfile.findMany({ where, orderBy: { createdAt: "desc" }, select: PROFILE_SELECT }));
}

// --- CS-C7 family members (guardian picker) ---------------------------------

export interface FamilyMemberVM { membershipId: string; label: string; role: string }
/**
 * CS-C7 — the workspace's ADULT members (account users), for the "add guardian" picker. These are the
 * family's own account holders — NOT protected children — so a display label (name or email) is
 * appropriate. Tenant-scoped; Family-view gated.
 */
export async function listFamilyMembers(actor: FamilyActorContext): Promise<FamilyMemberVM[]> {
  assertFamily(actor, FamilyAction.GuardianRelationshipView);
  return withTenant(actor.tenantId, async (db) => {
    const rows = await db.membership.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, user: { select: { name: true, email: true } } },
    });
    return rows.map((m) => ({ membershipId: m.id, label: m.user?.name || m.user?.email || m.id, role: String(m.role) }));
  });
}

// --- CS-C7 content-free profile timeline ------------------------------------

export interface ProfileTimelineEntryVM {
  id: string; event: string; actorUserId: string | null;
  targetType: string | null; targetId: string | null;
  metadata: Record<string, unknown> | null; createdAt: Date;
}
/**
 * CS-C7 — the append-only, content-free activity timeline for one profile: every audited event targeting
 * the profile OR one of its guardian relationships, newest first. The audit rows are content-free by
 * construction (enum values + changed field NAMES only), so nothing here can leak a label value or PII.
 * History is never editable.
 */
export async function listProfileTimeline(actor: FamilyActorContext, profileId: string, opts: { limit?: number } = {}): Promise<ProfileTimelineEntryVM[]> {
  assertFamily(actor, FamilyAction.ProtectedProfileView);
  return withTenant(actor.tenantId, async (db) => {
    const profile = await db.protectedProfile.findFirst({ where: { id: profileId, tenantId: actor.tenantId }, select: { id: true } });
    if (!profile) throw new FamilyNotFoundError("protected_profile");
    const rels = await db.guardianRelationship.findMany({ where: { tenantId: actor.tenantId, protectedProfileId: profileId }, select: { id: true } });
    const relIds = rels.map((r) => r.id);
    const rows = await db.auditLog.findMany({
      where: {
        tenantId: actor.tenantId,
        OR: [
          { targetType: "protected_profile", targetId: profileId },
          ...(relIds.length ? [{ targetType: "guardian_relationship", targetId: { in: relIds } }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(opts.limit ?? 100, 1), 200),
      select: { id: true, event: true, actorUserId: true, targetType: true, targetId: true, metadata: true, createdAt: true },
    });
    return rows.map((r) => ({ ...r, metadata: (r.metadata ?? null) as Record<string, unknown> | null }));
  });
}
