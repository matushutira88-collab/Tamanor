import { createHash, randomBytes } from "node:crypto";
import { Prisma, ActorKind, Role as PRole } from "@prisma/client";
import {
  normalizeEmail, seatUsage, seatsAvailable, seatsRemaining, isOverSeatLimit, isLastOwner,
  selectOverLimitMemberships, isInviteExpired, inviteExpiryFrom, isAssignableRole, INVITE_RESEND_COOLDOWN_MS,
  type TeamRole, type MemberRef,
} from "@guardora/core";
import { systemDb } from "./index";
import { withTenant } from "./repositories";
import { getTenantEntitlements } from "./billing-repo";

/**
 * V1.71 (Release B / B4) — team membership + invite repository. Tenant-scoped operations run inside
 * withTenant (RLS). Seat enforcement is TRANSACTIONAL + advisory-locked per tenant (usage = active
 * members + pending invites; owner always counts; expired/revoked invites free the seat). Invite tokens
 * are stored ONLY as a sha256 hash; accept is a SYSTEM path (the accepting user has no membership yet, so
 * RLS can't see the invite — the secret token hash is the authorization) and is transactional, single-use
 * and idempotent. The last owner can never be removed or demoted.
 */

function sha256(s: string): string { return createHash("sha256").update(s).digest("hex"); }
/** Fresh opaque invite token: the plaintext is returned once (for the email link); only its hash persists. */
export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256(token) };
}

async function seatLock(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tamanor:seats:${tenantId}`})::bigint)`;
}
async function countActiveMembers(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
  return tx.membership.count({ where: { tenantId } });
}
async function countPendingInvites(tx: Prisma.TransactionClient, tenantId: string, now = new Date()): Promise<number> {
  return tx.invite.count({ where: { tenantId, status: "pending", expiresAt: { gt: now } } });
}
async function countOwners(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
  return tx.membership.count({ where: { tenantId, role: "owner" } });
}

export type SeatSummary = {
  activeMembers: number; pendingInvites: number; usage: number;
  maxSeats: number | null; remaining: number | null; overLimit: boolean; overLimitMemberIds: string[];
};

/** Seat accounting for the team UI + enforcement. Over-limit members (after a downgrade) are identified
 *  deterministically (owners kept, oldest non-owners kept); they keep access — new seats are blocked. */
export async function getSeatSummary(tenantId: string): Promise<SeatSummary> {
  const ent = await getTenantEntitlements(tenantId);
  const maxSeats = ent.maxTeamMembers;
  return withTenant(tenantId, async (tx) => {
    const [members, pendingInvites] = await Promise.all([
      tx.membership.findMany({ where: { tenantId }, select: { id: true, role: true, createdAt: true } }),
      countPendingInvites(tx, tenantId),
    ]);
    const usage = seatUsage(members.length, pendingInvites);
    const refs: MemberRef[] = members.map((m) => ({ id: m.id, role: m.role as TeamRole, createdAt: m.createdAt }));
    return {
      activeMembers: members.length, pendingInvites, usage, maxSeats,
      remaining: seatsRemaining(usage, maxSeats),
      overLimit: isOverSeatLimit(members.length, maxSeats),
      overLimitMemberIds: selectOverLimitMemberships(refs, maxSeats),
    };
  });
}

export type CreateInviteResult =
  | { ok: true; inviteId: string; token: string }
  | { ok: false; reason: "invalid_role" | "already_member" | "already_invited" | "seat_limit_reached" };

/** Create a pending invite (transactional, advisory-locked, seat-checked). Returns the plaintext token ONCE. */
export async function createInvite(
  tenantId: string, input: { email: string; role: string; invitedByUserId: string | null }, now: Date = new Date(),
): Promise<CreateInviteResult> {
  if (!isAssignableRole(input.role)) return { ok: false, reason: "invalid_role" };
  const emailN = normalizeEmail(input.email);
  const ent = await getTenantEntitlements(tenantId);
  const maxSeats = ent.maxTeamMembers;
  const { token, tokenHash } = generateInviteToken();

  return withTenant(tenantId, async (tx) => {
    await seatLock(tx, tenantId);
    // Already an active member with this email? (no duplicate seat / no re-invite of an existing member)
    const existing = await tx.membership.findFirst({ where: { tenantId, user: { email: emailN } }, select: { id: true } });
    if (existing) return { ok: false, reason: "already_member" as const };

    const usage = seatUsage(await countActiveMembers(tx, tenantId), await countPendingInvites(tx, tenantId, now));
    if (!seatsAvailable(usage, maxSeats)) return { ok: false, reason: "seat_limit_reached" as const };

    try {
      const inv = await tx.invite.create({
        data: {
          tenantId, emailNormalized: emailN, role: input.role as PRole, tokenHash, status: "pending",
          invitedByUserId: input.invitedByUserId, expiresAt: inviteExpiryFrom(now), lastSentAt: now,
        },
        select: { id: true },
      });
      await tx.auditLog.create({ data: { tenantId, event: "team.invite_created", actorKind: ActorKind.human, actorUserId: input.invitedByUserId ?? undefined, targetType: "invite", targetId: inv.id, metadata: { role: input.role } } });
      return { ok: true as const, inviteId: inv.id, token };
    } catch (e) {
      // Partial-unique guard → a pending invite for this (tenant, email) already exists.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, reason: "already_invited" as const };
      throw e;
    }
  });
}

export type AcceptInviteResult =
  | { ok: true; tenantId: string; role: TeamRole }
  | { ok: false; reason: "not_found" | "expired" | "revoked" | "already_used" | "wrong_email" };

/**
 * Accept an invite — SYSTEM path (the user isn't a member yet). Transactional, single-use, idempotent:
 * a replayed accept by the SAME user returns ok; the token can never mint a second membership. Verifies
 * token hash + status + expiry + that the invite's email matches the accepting user's email.
 */
export async function acceptInvite(token: string, userId: string, userEmail: string, now: Date = new Date()): Promise<AcceptInviteResult> {
  const tokenHash = sha256(token);
  const emailN = normalizeEmail(userEmail);
  return systemDb.$transaction(async (tx) => {
    const inv = await tx.invite.findUnique({ where: { tokenHash }, select: { id: true, tenantId: true, emailNormalized: true, role: true, status: true, expiresAt: true } });
    if (!inv) return { ok: false, reason: "not_found" };
    if (inv.status === "accepted") {
      const m = await tx.membership.findUnique({ where: { userId_tenantId: { userId, tenantId: inv.tenantId } }, select: { id: true } });
      return m ? { ok: true, tenantId: inv.tenantId, role: inv.role as TeamRole } : { ok: false, reason: "already_used" };
    }
    if (inv.status === "revoked") return { ok: false, reason: "revoked" };
    if (inv.status === "expired" || isInviteExpired(inv.expiresAt, now)) {
      await tx.invite.updateMany({ where: { id: inv.id, status: "pending" }, data: { status: "expired" } });
      return { ok: false, reason: "expired" };
    }
    if (inv.emailNormalized !== emailN) return { ok: false, reason: "wrong_email" };
    // Single-use: only transition from pending. If 0 rows changed, another accept won the race.
    const claimed = await tx.invite.updateMany({ where: { id: inv.id, status: "pending" }, data: { status: "accepted", acceptedAt: now } });
    if (claimed.count === 0) {
      const m = await tx.membership.findUnique({ where: { userId_tenantId: { userId, tenantId: inv.tenantId } }, select: { id: true } });
      return m ? { ok: true, tenantId: inv.tenantId, role: inv.role as TeamRole } : { ok: false, reason: "already_used" };
    }
    await tx.membership.upsert({ where: { userId_tenantId: { userId, tenantId: inv.tenantId } }, create: { userId, tenantId: inv.tenantId, role: inv.role as PRole }, update: {} });
    await tx.auditLog.create({ data: { tenantId: inv.tenantId, event: "team.invite_accepted", actorKind: ActorKind.human, actorUserId: userId, targetType: "invite", targetId: inv.id, metadata: { role: inv.role } } });
    return { ok: true, tenantId: inv.tenantId, role: inv.role as TeamRole };
  });
}

/** Revoke a pending invite (frees its reserved seat). Tenant-scoped. Returns rows changed. */
export async function revokeInvite(tenantId: string, inviteId: string, actorUserId: string, now: Date = new Date()): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const n = (await tx.invite.updateMany({ where: { id: inviteId, tenantId, status: "pending" }, data: { status: "revoked", revokedAt: now } })).count;
    if (n > 0) await tx.auditLog.create({ data: { tenantId, event: "team.invite_revoked", actorKind: ActorKind.human, actorUserId, targetType: "invite", targetId: inviteId } });
    return n;
  });
}

export type ResendInviteResult = { ok: true; token: string } | { ok: false; reason: "not_found" | "rate_limited" };
/** Resend a pending invite: rate-limited, and ROTATES the token (the old link stops working). */
export async function resendInvite(tenantId: string, inviteId: string, now: Date = new Date()): Promise<ResendInviteResult> {
  const { token, tokenHash } = generateInviteToken();
  return withTenant(tenantId, async (tx) => {
    const inv = await tx.invite.findFirst({ where: { id: inviteId, tenantId, status: "pending" }, select: { lastSentAt: true } });
    if (!inv) return { ok: false, reason: "not_found" as const };
    if (now.getTime() - inv.lastSentAt.getTime() < INVITE_RESEND_COOLDOWN_MS) return { ok: false, reason: "rate_limited" as const };
    await tx.invite.updateMany({ where: { id: inviteId, tenantId, status: "pending" }, data: { tokenHash, lastSentAt: now, expiresAt: inviteExpiryFrom(now) } });
    return { ok: true as const, token };
  });
}

export type RemoveMemberResult = { ok: true } | { ok: false; reason: "not_found" | "last_owner" };
/** Remove a member. The LAST owner can never be removed. Never deletes tenant data. */
export async function removeMember(tenantId: string, membershipId: string, actorUserId: string): Promise<RemoveMemberResult> {
  return withTenant(tenantId, async (tx) => {
    const m = await tx.membership.findFirst({ where: { id: membershipId, tenantId }, select: { role: true, userId: true } });
    if (!m) return { ok: false, reason: "not_found" as const };
    if (isLastOwner(m.role as TeamRole, await countOwners(tx, tenantId))) return { ok: false, reason: "last_owner" as const };
    await tx.membership.deleteMany({ where: { id: membershipId, tenantId } });
    await tx.auditLog.create({ data: { tenantId, event: "team.member_removed", actorKind: ActorKind.human, actorUserId, targetType: "membership", targetId: membershipId, metadata: { removedUserId: m.userId } } });
    return { ok: true as const };
  });
}

export type ChangeRoleResult = { ok: true } | { ok: false; reason: "not_found" | "invalid_role" | "last_owner" };
/** Change a member's role. Demoting the LAST owner is forbidden. */
export async function changeMemberRole(tenantId: string, membershipId: string, newRole: string, actorUserId: string): Promise<ChangeRoleResult> {
  if (newRole !== "owner" && !isAssignableRole(newRole)) return { ok: false, reason: "invalid_role" };
  return withTenant(tenantId, async (tx) => {
    const m = await tx.membership.findFirst({ where: { id: membershipId, tenantId }, select: { role: true } });
    if (!m) return { ok: false, reason: "not_found" as const };
    if (m.role === "owner" && newRole !== "owner" && isLastOwner("owner", await countOwners(tx, tenantId))) return { ok: false, reason: "last_owner" as const };
    await tx.membership.updateMany({ where: { id: membershipId, tenantId }, data: { role: newRole as PRole } });
    await tx.auditLog.create({ data: { tenantId, event: "team.role_changed", actorKind: ActorKind.human, actorUserId, targetType: "membership", targetId: membershipId, metadata: { role: newRole } } });
    return { ok: true as const };
  });
}

export async function listPendingInvites(tenantId: string, now: Date = new Date()) {
  return withTenant(tenantId, (tx) => tx.invite.findMany({
    where: { tenantId, status: "pending", expiresAt: { gt: now } },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, emailNormalized: true, role: true, expiresAt: true, createdAt: true, lastSentAt: true },
  }));
}

/** Maintenance: mark pending invites past expiry as expired (frees their reserved seat). Bounded. */
export async function expireStaleInvites(now: Date = new Date()): Promise<number> {
  return (await systemDb.invite.updateMany({ where: { status: "pending", expiresAt: { lt: now } }, data: { status: "expired" } })).count;
}
