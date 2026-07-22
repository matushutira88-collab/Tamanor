import { createHash, randomBytes } from "node:crypto";
import { ActorKind, Prisma, Role as PRole } from "@prisma/client";
import {
  FamilyAction, authorizeFamilyAction, CHILD_SAFETY_AUDIT_EVENTS,
  FamilyInvitationStatus, isInvitableFamilyRole, isGuardianRole, isGuardianRelationshipType,
  membershipRoleForInvitedFamilyRole, GuardianRole, GuardianRelationshipStatus,
  normalizeEmail, isInviteExpired, inviteExpiryFrom,
  type FamilyActorContext,
} from "@guardora/core";
import { systemDb } from "./index";
import { withTenant } from "./repositories";
import { FamilyForbiddenError, FamilyNotFoundError, FamilyValidationError } from "./child-safety-family";

/**
 * CS-C8 — Family Guardian Invitation & Membership Activation. A SEPARATE, FAMILY-only, content-free domain
 * service. An invitation grants NOTHING by itself: accepting it may only (in ONE transaction) upsert a
 * Family Membership + create/reactivate a GuardianRelationship in an explicit bounded role. NOTHING is ever
 * sent externally (no email/SMS/push/webhook) — the opaque one-time link is handed over manually.
 *
 * Token: `randomBytes(32)` (256-bit) base64url, stored ONLY as its sha256 hash (never the plaintext).
 * The plaintext is revealed ONCE, at create. It is never logged, never audited, never returned by list/detail.
 *
 * Inviter operations (create/list/revoke) run through RLS (withTenant). Accept/decline are a SYSTEM path
 * (the invitee has no membership yet → RLS can't see the row) authorized by the secret token hash + a
 * session-email match — exactly like the V1.71 team-invite. Everything is fail-closed and content-free.
 */

function sha256(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function generateInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256(token) };
}
function assertFamily(actor: FamilyActorContext, action: FamilyAction): void {
  const d = authorizeFamilyAction(actor, action);
  if (!d.ok) throw new FamilyForbiddenError(d.reason);
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Tx = Prisma.TransactionClient;

/** True iff an ACTIVE (not deactivated/revoked/archived) 'primary' guardian exists on the profile. */
async function activePrimaryExistsTx(tx: Tx, tenantId: string, protectedProfileId: string, excludeId?: string): Promise<boolean> {
  const found = await tx.guardianRelationship.findFirst({
    where: {
      tenantId, protectedProfileId, guardianRole: GuardianRole.Primary,
      status: { notIn: [GuardianRelationshipStatus.Suspended, GuardianRelationshipStatus.Revoked] },
      revokedAt: null, archivedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  return found !== null;
}

// --- Content-free view models (NEVER tokenHash / raw token) ------------------

export interface FamilyInvitationVM {
  id: string; protectedProfileId: string; invitedEmailNormalized: string;
  intendedFamilyRole: string; intendedGuardianRole: string; intendedRelationshipType: string;
  status: string; expiresAt: Date; acceptedAt: Date | null; declinedAt: Date | null; revokedAt: Date | null; createdAt: Date;
}
const INVITATION_SELECT = {
  id: true, protectedProfileId: true, invitedEmailNormalized: true,
  intendedFamilyRole: true, intendedGuardianRole: true, intendedRelationshipType: true,
  status: true, expiresAt: true, acceptedAt: true, declinedAt: true, revokedAt: true, createdAt: true,
} as const;

/** Lazy expiry (ONE consistent model): any read/mutation entry point first flips stale PENDING → EXPIRED. */
async function expireStale(db: Tx, tenantId: string, now: Date): Promise<void> {
  await db.familyGuardianInvitation.updateMany({ where: { tenantId, status: "pending", expiresAt: { lte: now } }, data: { status: "expired" } });
}
async function audit(db: Tx, tenantId: string, event: string, actorUserId: string | null, invitationId: string, metadata?: Record<string, string | number | boolean>): Promise<void> {
  await db.auditLog.create({ data: { tenantId, event, actorKind: ActorKind.human, actorUserId: actorUserId ?? undefined, targetType: "family_guardian_invitation", targetId: invitationId, metadata: (metadata ?? undefined) as never } });
}

// --- Create (inviter-side; one-time token reveal) ---------------------------

export type CreateFamilyInvitationInput = {
  protectedProfileId: string; invitedEmail: string;
  intendedFamilyRole: string; intendedGuardianRole: string; intendedRelationshipType: string;
};
export type CreateFamilyInvitationResult = { invitation: FamilyInvitationVM; token: string };

export async function createFamilyGuardianInvitation(actor: FamilyActorContext, input: CreateFamilyInvitationInput, now: Date = new Date()): Promise<CreateFamilyInvitationResult> {
  assertFamily(actor, FamilyAction.FamilyInvitationCreate);
  // Bounded, server-validated inputs only (tenantId / actorMembership / status / token are NEVER from client).
  if (!isInvitableFamilyRole(input.intendedFamilyRole)) throw new FamilyValidationError("intendedFamilyRole");
  if (!isGuardianRole(input.intendedGuardianRole)) throw new FamilyValidationError("intendedGuardianRole");
  if (!isGuardianRelationshipType(input.intendedRelationshipType)) throw new FamilyValidationError("intendedRelationshipType");
  const emailN = normalizeEmail(input.invitedEmail);
  if (!EMAIL_RE.test(emailN)) throw new FamilyValidationError("invitedEmail");
  const { token, tokenHash } = generateInvitationToken();

  return withTenant(actor.tenantId, async (db) => {
    await expireStale(db, actor.tenantId, now);
    // Inviter membership + own email are SERVER-resolved (never trusted from the client).
    const me = await db.membership.findFirst({ where: { tenantId: actor.tenantId, userId: actor.userId }, select: { id: true, user: { select: { email: true } } } });
    if (!me) throw new FamilyForbiddenError("role_forbidden");
    if (me.user?.email && normalizeEmail(me.user.email) === emailN) throw new FamilyValidationError("self_invite");
    // Profile must be this tenant's and ACTIVE.
    const profile = await db.protectedProfile.findFirst({ where: { id: input.protectedProfileId, tenantId: actor.tenantId }, select: { id: true, archivedAt: true } });
    if (!profile) throw new FamilyNotFoundError("protected_profile");
    if (profile.archivedAt) throw new FamilyValidationError("archived");
    // Already an ACTIVE guardian on this profile for a user with this email? → already_guardian.
    const invitedMembership = await db.membership.findFirst({ where: { tenantId: actor.tenantId, user: { email: emailN } }, select: { id: true } });
    if (invitedMembership) {
      const activeRel = await db.guardianRelationship.findFirst({
        where: { tenantId: actor.tenantId, guardianMembershipId: invitedMembership.id, protectedProfileId: input.protectedProfileId, status: { notIn: [GuardianRelationshipStatus.Suspended, GuardianRelationshipStatus.Revoked] }, revokedAt: null, archivedAt: null },
        select: { id: true },
      });
      if (activeRel) throw new FamilyValidationError("already_guardian");
    }
    // Primary invariant already at create (don't defer a doomed invitation).
    if (input.intendedGuardianRole === GuardianRole.Primary && await activePrimaryExistsTx(db, actor.tenantId, input.protectedProfileId)) throw new FamilyValidationError("primary_conflict");

    try {
      const inv = await db.familyGuardianInvitation.create({
        data: {
          tenantId: actor.tenantId, protectedProfileId: input.protectedProfileId, invitedEmailNormalized: emailN,
          invitedByMembershipId: me.id, intendedFamilyRole: input.intendedFamilyRole, intendedGuardianRole: input.intendedGuardianRole,
          intendedRelationshipType: input.intendedRelationshipType, status: FamilyInvitationStatus.Pending, tokenHash,
          expiresAt: inviteExpiryFrom(now),
        },
        select: INVITATION_SELECT,
      });
      // Content-free audit — bounded enums only. NEVER the email, token, token hash or guardianLabel.
      await audit(db, actor.tenantId, CHILD_SAFETY_AUDIT_EVENTS.familyInvitationCreated, actor.userId, inv.id, { familyRole: input.intendedFamilyRole, guardianRole: input.intendedGuardianRole, relationshipType: input.intendedRelationshipType });
      return { invitation: inv, token };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new FamilyValidationError("duplicate_pending_invitation");
      throw e;
    }
  });
}

// --- List / counts (inviter-side; content-free, never token) ----------------

export interface FamilyInvitationFilters { status?: string; guardianRole?: string; protectedProfileId?: string; query?: string }
export async function listFamilyGuardianInvitations(actor: FamilyActorContext, filters: FamilyInvitationFilters = {}, now: Date = new Date()): Promise<FamilyInvitationVM[]> {
  assertFamily(actor, FamilyAction.FamilyInvitationView);
  if (filters.status != null && !(Object.values(FamilyInvitationStatus) as string[]).includes(filters.status)) throw new FamilyValidationError("status");
  if (filters.guardianRole != null && !isGuardianRole(filters.guardianRole)) throw new FamilyValidationError("guardianRole");
  return withTenant(actor.tenantId, async (db) => {
    await expireStale(db, actor.tenantId, now);
    const q = (filters.query ?? "").trim().slice(0, 120);
    return db.familyGuardianInvitation.findMany({
      where: {
        tenantId: actor.tenantId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.guardianRole ? { intendedGuardianRole: filters.guardianRole } : {}),
        ...(filters.protectedProfileId ? { protectedProfileId: filters.protectedProfileId } : {}),
        ...(q ? { invitedEmailNormalized: { contains: q.toLowerCase() } } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: INVITATION_SELECT,
    });
  });
}

export type FamilyInvitationCounts = Record<"pending" | "accepted" | "declined" | "revoked" | "expired", number>;
export async function getFamilyInvitationCounts(actor: FamilyActorContext, now: Date = new Date()): Promise<FamilyInvitationCounts> {
  assertFamily(actor, FamilyAction.FamilyInvitationView);
  return withTenant(actor.tenantId, async (db) => {
    await expireStale(db, actor.tenantId, now);
    const rows = await db.familyGuardianInvitation.groupBy({ by: ["status"], where: { tenantId: actor.tenantId }, _count: { _all: true } });
    const out: FamilyInvitationCounts = { pending: 0, accepted: 0, declined: 0, revoked: 0, expired: 0 };
    for (const r of rows) if (r.status in out) out[r.status as keyof FamilyInvitationCounts] = r._count._all;
    return out;
  });
}

// --- Revoke (inviter-side) --------------------------------------------------

export async function revokeFamilyGuardianInvitation(actor: FamilyActorContext, invitationId: string, now: Date = new Date()): Promise<FamilyInvitationVM> {
  assertFamily(actor, FamilyAction.FamilyInvitationRevoke);
  return withTenant(actor.tenantId, async (db) => {
    await expireStale(db, actor.tenantId, now);
    const inv = await db.familyGuardianInvitation.findFirst({ where: { id: invitationId, tenantId: actor.tenantId }, select: { id: true, status: true } });
    if (!inv) throw new FamilyNotFoundError("family_guardian_invitation");
    if (inv.status === FamilyInvitationStatus.Accepted) throw new FamilyValidationError("already_accepted");
    if (inv.status === FamilyInvitationStatus.Declined) throw new FamilyValidationError("already_declined");
    if (inv.status === FamilyInvitationStatus.Expired) throw new FamilyValidationError("expired");
    if (inv.status === FamilyInvitationStatus.Revoked) return db.familyGuardianInvitation.findFirstOrThrow({ where: { id: invitationId, tenantId: actor.tenantId }, select: INVITATION_SELECT });
    await db.familyGuardianInvitation.updateMany({ where: { id: inv.id, status: FamilyInvitationStatus.Pending }, data: { status: FamilyInvitationStatus.Revoked, revokedAt: now } });
    await audit(db, actor.tenantId, CHILD_SAFETY_AUDIT_EVENTS.familyInvitationRevoked, actor.userId, inv.id);
    return db.familyGuardianInvitation.findFirstOrThrow({ where: { id: invitationId, tenantId: actor.tenantId }, select: INVITATION_SELECT });
  });
}

// --- Token preview (invitee-side; content-free; NO mutation of a valid pending) ----

export type FamilyInvitationPreview =
  | { ok: true; profileLabel: string | null; ageBand: string; intendedGuardianRole: string; intendedRelationshipType: string; expiresAt: Date; workspaceName: string }
  | { ok: false; reason: FamilyInvitationTokenError };
export type FamilyInvitationTokenError = "invalid_token" | "expired" | "revoked" | "already_accepted" | "already_declined" | "identity_mismatch";

/** Resolve an invitation by opaque token for the ACCEPT screen. Read-only for a valid pending invite. */
export async function getFamilyInvitationPreview(token: string, sessionUserId: string, sessionEmail: string, now: Date = new Date()): Promise<FamilyInvitationPreview> {
  const tokenHash = sha256(token);
  const emailN = normalizeEmail(sessionEmail);
  const inv = await systemDb.familyGuardianInvitation.findUnique({
    where: { tokenHash },
    select: { id: true, tenantId: true, protectedProfileId: true, invitedEmailNormalized: true, intendedGuardianRole: true, intendedRelationshipType: true, status: true, expiresAt: true },
  });
  if (!inv) return { ok: false, reason: "invalid_token" };
  if (inv.invitedEmailNormalized !== emailN) return { ok: false, reason: "identity_mismatch" };
  if (inv.status === FamilyInvitationStatus.Accepted) return { ok: false, reason: "already_accepted" };
  if (inv.status === FamilyInvitationStatus.Declined) return { ok: false, reason: "already_declined" };
  if (inv.status === FamilyInvitationStatus.Revoked) return { ok: false, reason: "revoked" };
  if (inv.status === FamilyInvitationStatus.Expired || isInviteExpired(inv.expiresAt, now)) return { ok: false, reason: "expired" };
  const [profile, tenant] = await Promise.all([
    systemDb.protectedProfile.findFirst({ where: { id: inv.protectedProfileId, tenantId: inv.tenantId }, select: { guardianLabel: true, ageBand: true, archivedAt: true } }),
    systemDb.tenant.findUnique({ where: { id: inv.tenantId }, select: { name: true } }),
  ]);
  if (!profile || profile.archivedAt) return { ok: false, reason: "expired" }; // profile gone/archived → treat as no-longer-valid
  return { ok: true, profileLabel: profile.guardianLabel, ageBand: profile.ageBand, intendedGuardianRole: inv.intendedGuardianRole, intendedRelationshipType: inv.intendedRelationshipType, expiresAt: inv.expiresAt, workspaceName: tenant?.name ?? "" };
}

// --- Accept (invitee-side; SYSTEM path; atomic; idempotent) -----------------

class InvitationActivationError extends Error { constructor(public readonly reason: FamilyAcceptError) { super(reason); } }
export type FamilyAcceptError =
  | "invalid_token" | "expired" | "revoked" | "already_accepted" | "already_declined"
  | "identity_mismatch" | "invalid_state" | "already_guardian" | "primary_conflict";
export type FamilyAcceptResult = { ok: true; tenantId: string; membershipCreated: boolean; relationshipCreated: boolean; relationshipReactivated: boolean } | { ok: false; reason: FamilyAcceptError };

export async function acceptFamilyGuardianInvitation(token: string, userId: string, userEmail: string, now: Date = new Date()): Promise<FamilyAcceptResult> {
  const tokenHash = sha256(token);
  const emailN = normalizeEmail(userEmail);
  try {
    return await systemDb.$transaction(async (tx) => {
      const inv = await tx.familyGuardianInvitation.findUnique({
        where: { tokenHash },
        select: { id: true, tenantId: true, protectedProfileId: true, invitedEmailNormalized: true, intendedFamilyRole: true, intendedGuardianRole: true, intendedRelationshipType: true, status: true, expiresAt: true, acceptedByUserId: true },
      });
      if (!inv) return { ok: false, reason: "invalid_token" };
      if (inv.status === FamilyInvitationStatus.Accepted) return inv.acceptedByUserId === userId ? { ok: true, tenantId: inv.tenantId, membershipCreated: false, relationshipCreated: false, relationshipReactivated: false } : { ok: false, reason: "already_accepted" };
      if (inv.status === FamilyInvitationStatus.Declined) return { ok: false, reason: "already_declined" };
      if (inv.status === FamilyInvitationStatus.Revoked) return { ok: false, reason: "revoked" };
      if (inv.status === FamilyInvitationStatus.Expired || isInviteExpired(inv.expiresAt, now)) {
        await tx.familyGuardianInvitation.updateMany({ where: { id: inv.id, status: FamilyInvitationStatus.Pending }, data: { status: FamilyInvitationStatus.Expired } });
        return { ok: false, reason: "expired" };
      }
      if (inv.invitedEmailNormalized !== emailN) return { ok: false, reason: "identity_mismatch" };
      const bizRole = membershipRoleForInvitedFamilyRole(inv.intendedFamilyRole);
      if (!bizRole) return { ok: false, reason: "invalid_state" };
      const profile = await tx.protectedProfile.findFirst({ where: { id: inv.protectedProfileId, tenantId: inv.tenantId }, select: { id: true, archivedAt: true } });
      if (!profile || profile.archivedAt) return { ok: false, reason: "invalid_state" };

      // Single-use atomic claim: only ONE concurrent accept flips pending → accepted.
      const claimed = await tx.familyGuardianInvitation.updateMany({ where: { id: inv.id, status: FamilyInvitationStatus.Pending }, data: { status: FamilyInvitationStatus.Accepted, acceptedAt: now, acceptedByUserId: userId } });
      if (claimed.count === 0) {
        const fresh = await tx.familyGuardianInvitation.findUnique({ where: { id: inv.id }, select: { status: true, acceptedByUserId: true } });
        return fresh?.status === FamilyInvitationStatus.Accepted && fresh.acceptedByUserId === userId ? { ok: true, tenantId: inv.tenantId, membershipCreated: false, relationshipCreated: false, relationshipReactivated: false } : { ok: false, reason: "already_accepted" };
      }

      // Membership: create with the mapped (least-privilege) Business role, or REUSE an existing one
      // WITHOUT changing its role (never elevate/downgrade). No tenant/kind change; no owner minting.
      const existingM = await tx.membership.findUnique({ where: { userId_tenantId: { userId, tenantId: inv.tenantId } }, select: { id: true } });
      let membershipId: string; let membershipCreated = false;
      if (existingM) { membershipId = existingM.id; await audit(tx, inv.tenantId, CHILD_SAFETY_AUDIT_EVENTS.familyMembershipReusedFromInvitation, userId, inv.id); }
      else {
        const m = await tx.membership.create({ data: { userId, tenantId: inv.tenantId, role: bizRole as PRole } });
        membershipId = m.id; membershipCreated = true;
        await audit(tx, inv.tenantId, CHILD_SAFETY_AUDIT_EVENTS.familyMembershipCreatedFromInvitation, userId, inv.id, { familyRole: inv.intendedFamilyRole });
      }

      // GuardianRelationship: create, or reactivate an INACTIVE one, or fail-closed on a conflict.
      const rel = await tx.guardianRelationship.findFirst({ where: { tenantId: inv.tenantId, guardianMembershipId: membershipId, protectedProfileId: inv.protectedProfileId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, guardianRole: true, relationshipType: true, revokedAt: true, archivedAt: true } });
      const isActive = rel && rel.status !== GuardianRelationshipStatus.Revoked && rel.status !== GuardianRelationshipStatus.Suspended && !rel.revokedAt && !rel.archivedAt;
      const isSuspended = rel && rel.status === GuardianRelationshipStatus.Suspended && !rel.revokedAt && !rel.archivedAt;
      let relationshipCreated = false; let relationshipReactivated = false;

      if (isActive) {
        // Already an active guardian: idempotent ONLY if role + type match; otherwise fail-closed (no silent overwrite).
        if (rel!.guardianRole !== inv.intendedGuardianRole || rel!.relationshipType !== inv.intendedRelationshipType) throw new InvitationActivationError("already_guardian");
      } else if (isSuspended) {
        if (rel!.guardianRole !== inv.intendedGuardianRole || rel!.relationshipType !== inv.intendedRelationshipType) throw new InvitationActivationError("invalid_state");
        if (inv.intendedGuardianRole === GuardianRole.Primary && await activePrimaryExistsTx(tx, inv.tenantId, inv.protectedProfileId, rel!.id)) throw new InvitationActivationError("primary_conflict");
        // CS-C7 reactivate → neutral 'pending' (NEVER auto-verified; no authority escalation).
        await tx.guardianRelationship.update({ where: { id: rel!.id }, data: { status: GuardianRelationshipStatus.Pending } });
        relationshipReactivated = true;
        await audit(tx, inv.tenantId, CHILD_SAFETY_AUDIT_EVENTS.guardianRelationshipReactivatedFromInvitation, userId, inv.id, { guardianRole: inv.intendedGuardianRole });
      } else {
        // No relationship, or only terminal (revoked/archived) ones → create a fresh one.
        if (inv.intendedGuardianRole === GuardianRole.Primary && await activePrimaryExistsTx(tx, inv.tenantId, inv.protectedProfileId)) throw new InvitationActivationError("primary_conflict");
        await tx.guardianRelationship.create({
          data: {
            tenantId: inv.tenantId, guardianMembershipId: membershipId, protectedProfileId: inv.protectedProfileId,
            relationshipType: inv.intendedRelationshipType, authorityLevel: "read_only", guardianRole: inv.intendedGuardianRole,
            status: GuardianRelationshipStatus.Pending, consentStatus: "not_requested", safeRecipientEligibility: "not_verified",
          },
        });
        relationshipCreated = true;
        await audit(tx, inv.tenantId, CHILD_SAFETY_AUDIT_EVENTS.guardianRelationshipCreatedFromInvitation, userId, inv.id, { guardianRole: inv.intendedGuardianRole, relationshipType: inv.intendedRelationshipType });
      }

      await audit(tx, inv.tenantId, CHILD_SAFETY_AUDIT_EVENTS.familyInvitationAccepted, userId, inv.id);
      return { ok: true, tenantId: inv.tenantId, membershipCreated, relationshipCreated, relationshipReactivated };
    });
  } catch (e) {
    if (e instanceof InvitationActivationError) return { ok: false, reason: e.reason };
    // A concurrent create/accept hitting the primary partial-unique index also fails closed, safely.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, reason: "primary_conflict" };
    throw e;
  }
}

// --- Decline (invitee-side; SYSTEM path; terminal) --------------------------

export type FamilyDeclineResult = { ok: true } | { ok: false; reason: "invalid_token" | "expired" | "revoked" | "already_accepted" | "identity_mismatch" };
export async function declineFamilyGuardianInvitation(token: string, userId: string, userEmail: string, now: Date = new Date()): Promise<FamilyDeclineResult> {
  const tokenHash = sha256(token);
  const emailN = normalizeEmail(userEmail);
  return systemDb.$transaction(async (tx) => {
    const inv = await tx.familyGuardianInvitation.findUnique({ where: { tokenHash }, select: { id: true, tenantId: true, invitedEmailNormalized: true, status: true, expiresAt: true } });
    if (!inv) return { ok: false, reason: "invalid_token" };
    if (inv.invitedEmailNormalized !== emailN) return { ok: false, reason: "identity_mismatch" };
    if (inv.status === FamilyInvitationStatus.Accepted) return { ok: false, reason: "already_accepted" };
    if (inv.status === FamilyInvitationStatus.Revoked) return { ok: false, reason: "revoked" };
    if (inv.status === FamilyInvitationStatus.Declined) return { ok: true }; // idempotent (identity already matched)
    if (inv.status === FamilyInvitationStatus.Expired || isInviteExpired(inv.expiresAt, now)) {
      await tx.familyGuardianInvitation.updateMany({ where: { id: inv.id, status: FamilyInvitationStatus.Pending }, data: { status: FamilyInvitationStatus.Expired } });
      return { ok: false, reason: "expired" };
    }
    const claimed = await tx.familyGuardianInvitation.updateMany({ where: { id: inv.id, status: FamilyInvitationStatus.Pending }, data: { status: FamilyInvitationStatus.Declined, declinedAt: now } });
    if (claimed.count === 0) return { ok: true }; // a concurrent decline/terminal transition won; treat as done
    await audit(tx, inv.tenantId, CHILD_SAFETY_AUDIT_EVENTS.familyInvitationDeclined, userId, inv.id);
    return { ok: true };
  });
}
