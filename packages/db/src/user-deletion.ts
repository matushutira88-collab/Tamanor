/**
 * V1.45C2 — global User identity ERASURE (DB-only; NO external cleanup, NO queue, NO deletion state).
 *
 * Erasure is a SINGLE ATOMIC transaction hard-delete. The database is already erasure-safe: memberships
 * and sessions CASCADE on user delete, historical actor/author refs SET NULL, and direct User PII is
 * only `users.email`/`users.name` (removed with the row). So the whole operation is one transaction:
 *   lock user → lock owner memberships + affected tenants → atomic sole-owner check → revoke sessions →
 *   hard-delete user (cascade) → write a privacy-safe receipt → commit.
 *
 * The PRIMARY safety invariant is the ATOMIC sole-owner guard (Phase 5): a user who is the sole Owner
 * of any tenant whose row still exists is BLOCKED — never a non-atomic "count then delete". All the
 * relevant rows are locked FOR UPDATE inside the transaction, so a concurrent owner promotion, owner
 * deletion, membership creation, or tenant deletion cannot race the check into an ownerless tenant.
 *
 * Runs on the system client (owner) — it crosses the global User/sessions/receipt and tenant-scoped
 * memberships/tenants, exactly like the V1.45C1 tenant-deletion finalizer. NEVER logs/returns PII.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import { PrismaClient, Prisma, UserDeletionInitiator } from "@prisma/client";
import { systemDb } from "./index";
import { requirePlatformCapability } from "./platform-repo";

export type UserDeletionAuthority = "self" | "platform_admin";

export type UserErasureErrorCode =
  | "user_not_found"
  | "confirmation_mismatch"
  | "sole_owner_blocked"
  | "self_delete_not_allowed_via_platform";

/** Carries a normalized code (+ safe blockers) only — never email/name/tokens/raw errors. */
export class UserErasureError extends Error {
  readonly code: UserErasureErrorCode;
  /** Populated only for `sole_owner_blocked`. tenantName is safe to show the OWNER (their own membership). */
  readonly blockers?: SoleOwnerBlocker[];
  constructor(code: UserErasureErrorCode, blockers?: SoleOwnerBlocker[]) {
    super(`user_erasure_error:${code}`);
    this.name = "UserErasureError";
    this.code = code;
    this.blockers = blockers;
  }
}
export function isUserErasureError(e: unknown): e is UserErasureError {
  return e instanceof UserErasureError;
}

/** A tenant the target solely owns (deletion would leave it ownerless). Shown only to that owner. */
export interface SoleOwnerBlocker {
  tenantId: string;
  tenantName: string;
  deletionState: string; // "active" | "deleting" — a deleting tenant still blocks while its row exists
}

export interface UserErasabilityReport {
  erasable: boolean;
  /** Blockers the user is entitled to see (their own owned tenants). NEVER put in receipt/log/error. */
  blockers: SoleOwnerBlocker[];
  membershipCount: number;
}

/**
 * NON-locking preview for the UI: would erasing this user leave any tenant ownerless? Advisory only —
 * `eraseUserIdentity` re-checks atomically with row locks. Reads via the system client.
 */
export async function analyzeUserErasability(targetUserId: string, client: PrismaClient = systemDb): Promise<UserErasabilityReport> {
  const memberships = await client.membership.findMany({
    where: { userId: targetUserId },
    select: { tenantId: true, role: true },
  });
  const ownedTenantIds = memberships.filter((m) => m.role === "owner").map((m) => m.tenantId);
  const blockers = await computeSoleOwnerBlockers(client, targetUserId, ownedTenantIds);
  return { erasable: blockers.length === 0, blockers, membershipCount: memberships.length };
}

/** Shared blocker computation. A tenant blocks iff its row exists AND it has NO owner other than the target. */
async function computeSoleOwnerBlockers(
  client: PrismaClient | Prisma.TransactionClient,
  targetUserId: string,
  ownedTenantIds: string[],
): Promise<SoleOwnerBlocker[]> {
  if (ownedTenantIds.length === 0) return [];
  const tenants = await client.tenant.findMany({
    where: { id: { in: ownedTenantIds } },
    select: { id: true, name: true, deletionState: true },
  });
  const otherOwners = await client.membership.groupBy({
    by: ["tenantId"],
    where: { tenantId: { in: ownedTenantIds }, role: "owner", userId: { not: targetUserId } },
    _count: { _all: true },
  });
  const coOwnerCount = new Map(otherOwners.map((o) => [o.tenantId, o._count._all]));
  const blockers: SoleOwnerBlocker[] = [];
  for (const t of tenants) {
    if ((coOwnerCount.get(t.id) ?? 0) === 0) {
      blockers.push({ tenantId: t.id, tenantName: t.name, deletionState: t.deletionState as string });
    }
  }
  return blockers;
}

export interface EraseUserInput {
  targetUserId: string;
  /** Opaque actor id for the receipt (nullable for pure system callers). For `self`, equals targetUserId. */
  actorUserId: string | null;
  authority: UserDeletionAuthority;
  /** Optional defence-in-depth: re-verify the (already boundary-validated) email confirmation in-tx. */
  confirmEmail?: string;
}

export interface EraseUserResult {
  /** true when the user was already gone (a concurrent/repeat erase) — the caller converges. */
  converged: boolean;
  operationId: string | null;
  membershipCount: number;
  sessionCount: number;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(String(a ?? ""), "utf8");
  const y = Buffer.from(String(b ?? ""), "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** Reusable: revoke every non-revoked session for a user. Idempotent. */
export async function revokeAllSessionsForUser(userId: string, client: PrismaClient = systemDb): Promise<number> {
  const res = await client.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return res.count;
}

/** A transient Postgres deadlock (40P01) / serialization failure (40001) — safe to retry the whole tx. */
function isRetryableTxError(e: unknown): boolean {
  if (isUserErasureError(e)) return false; // a business outcome (blocked / mismatch) is NEVER retried
  const meta = JSON.stringify((e as { meta?: unknown })?.meta ?? "");
  const blob = `${meta} ${String((e as Error)?.message ?? "")}`;
  return /40P01|40001|deadlock detected|could not serialize/i.test(blob);
}

/**
 * ATOMIC user erasure. Hard-deletes the user in ONE transaction with FOR UPDATE locks so the sole-owner
 * invariant cannot be raced. Blocks (rolls back, nothing deleted) if any owned tenant would be left
 * ownerless. Idempotent/convergent: a concurrent or repeat erase of an already-gone user returns
 * `converged:true` with the existing receipt's operation, never a second deletion.
 *
 * Lock order (tenant rows sorted, BEFORE any membership row) is deadlock-free by construction; the
 * bounded retry is defence-in-depth against a transient serialization/deadlock from another writer.
 */
export async function eraseUserIdentity(input: EraseUserInput): Promise<EraseUserResult> {
  const { targetUserId, actorUserId, authority, confirmEmail } = input;
  if (!targetUserId || typeof targetUserId !== "string") throw new UserErasureError("user_not_found");

  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await runEraseTx(targetUserId, actorUserId, authority, confirmEmail);
    } catch (e) {
      if (!isRetryableTxError(e)) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

async function runEraseTx(
  targetUserId: string,
  actorUserId: string | null,
  authority: UserDeletionAuthority,
  confirmEmail: string | undefined,
): Promise<EraseUserResult> {
  return systemDb.$transaction(async (tx) => {
    // 1) Lock the target User row. A concurrent erase blocks here; after it commits, this sees 0 rows.
    const locked = await tx.$queryRaw<Array<{ id: string; email: string }>>(
      Prisma.sql`SELECT id, email FROM users WHERE id = ${targetUserId} FOR UPDATE`,
    );
    if (locked.length === 0) {
      // Already gone → converge on the existing receipt (if any).
      const existing = await tx.userDeletionReceipt.findFirst({ where: { deletedUserId: targetUserId }, orderBy: { createdAt: "desc" } });
      return { converged: true, operationId: existing?.operationId ?? null, membershipCount: existing?.membershipCount ?? 0, sessionCount: existing?.sessionCount ?? 0 };
    }

    // Optional in-tx re-verification of the confirmation against the FRESH email (defence-in-depth).
    if (confirmEmail !== undefined && !safeEqual(confirmEmail, locked[0]!.email)) {
      throw new UserErasureError("confirmation_mismatch");
    }

    // 2) Discover the target's owned tenants with a PLAIN read (no FOR UPDATE here). The user-row lock
    //    above already blocks a concurrent membership INSERT for the target (the FK check needs a
    //    conflicting FOR KEY SHARE on the locked user row), so no phantom target-membership can appear.
    const memberships = await tx.$queryRaw<Array<{ id: string; tenantId: string; role: string }>>(
      Prisma.sql`SELECT id, "tenantId", role FROM memberships WHERE "userId" = ${targetUserId}`,
    );
    // Sorted, de-duplicated owned tenant ids → a DETERMINISTIC lock-acquisition order across all txns.
    const ownedTenantIds = [...new Set(memberships.filter((m) => m.role === "owner").map((m) => m.tenantId))].sort();

    // 3) Lock the affected TENANT rows FIRST — the single serialization point — ONE BY ONE in sorted
    //    order. Locking the tenant before any membership row is what prevents the dual-owner deadlock
    //    (a concurrent erase blocks on the tenant lock BEFORE it holds any membership lock, so there is
    //    no membership-vs-tenant lock cycle), and sorted order prevents multi-tenant lock-order cycles.
    for (const tid of ownedTenantIds) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM tenants WHERE id = ${tid} FOR UPDATE`);
    }
    // 4) THEN lock every owner membership of those tenants (serialize vs owner promotion/demotion/
    //    deletion). Safe as one statement: the tenant locks already serialize any two contending txns.
    if (ownedTenantIds.length > 0) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM memberships WHERE "tenantId" IN (${Prisma.join(ownedTenantIds)}) AND role = 'owner' FOR UPDATE`);
    }
    // 5) Atomic sole-owner check (FRESH read under the locks). Block if any owned tenant has no other owner.
    const blockers = await computeSoleOwnerBlockers(tx, targetUserId, ownedTenantIds);
    if (blockers.length > 0) {
      throw new UserErasureError("sole_owner_blocked", blockers); // rolls back the whole tx
    }

    // 6) Counts for the receipt (before the cascade removes the rows), then revoke sessions.
    const sessionCount = await tx.userSession.count({ where: { userId: targetUserId } });
    const membershipCount = memberships.length;
    await tx.userSession.updateMany({ where: { userId: targetUserId, revokedAt: null }, data: { revokedAt: new Date() } });

    // 7/8/9) Hard-delete the User. DB cascades memberships + sessions; SET NULL anonymizes historical
    // actor/author refs; platformRole disappears with the row.
    await tx.user.delete({ where: { id: targetUserId } });

    // 10) Privacy-safe receipt, in the SAME transaction (exists iff the erasure committed).
    const operationId = randomUUID();
    await tx.userDeletionReceipt.create({
      data: {
        operationId,
        deletedUserId: targetUserId,
        initiatedBy: authority === "platform_admin" ? UserDeletionInitiator.platform_admin : UserDeletionInitiator.self,
        requestedByUserId: actorUserId,
        membershipCount,
        sessionCount,
        completedAt: new Date(),
      },
    });

    return { converged: false, operationId, membershipCount, sessionCount };
  });
}

/**
 * Platform-admin entry — authority checked FRESH via the V1.45A `user:delete` capability (admin-only;
 * staff denied), NEVER derived from any tenant role. Self-deletion via this path is disallowed (a
 * platform admin erasing THEIR OWN identity must use the self-service path). Same sole-owner rules apply.
 */
export async function eraseUserIdentityAsPlatformAdmin(actorUserId: string, targetUserId: string): Promise<EraseUserResult> {
  await requirePlatformCapability(actorUserId, "user:delete");
  if (actorUserId === targetUserId) throw new UserErasureError("self_delete_not_allowed_via_platform");
  return eraseUserIdentity({ targetUserId, actorUserId, authority: "platform_admin" });
}

export function getUserDeletionReceipt(operationId: string, client: PrismaClient = systemDb) {
  return client.userDeletionReceipt.findUnique({ where: { operationId } });
}
