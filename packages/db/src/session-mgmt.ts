/**
 * V1.58.9 phase 2 — user-facing session management (Active sessions / revoke / logout-all) and the
 * server side of "change password". Every function is scoped to a single `userId` so a user can only
 * ever see or revoke THEIR OWN sessions (no cross-user access). Returned rows carry only SAFE fields —
 * NEVER the token hash, raw IP, or a fingerprint. No token/password is ever logged.
 */
import { prisma } from "./index";

export interface ActiveSessionView {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  rememberMe: boolean;
  userAgentSummary: string | null;
  /** True for the session making the request (marked "This device"). */
  current: boolean;
}

/** List a user's LIVE (non-revoked, non-expired) sessions, newest activity first. Safe fields only. */
export async function listUserSessions(userId: string, currentSessionId: string | null, now: Date = new Date()): Promise<ActiveSessionView[]> {
  const rows = await prisma.userSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    select: { id: true, createdAt: true, lastSeenAt: true, rememberMe: true, userAgentSummary: true },
    orderBy: [{ lastSeenAt: "desc" }],
  });
  return rows.map((r) => ({ ...r, current: r.id === currentSessionId }));
}

/** Revoke ONE session — only if it belongs to `userId` (ownership-scoped). Returns whether a row changed. */
export async function revokeOwnedSession(userId: string, sessionId: string): Promise<boolean> {
  const res = await prisma.userSession.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return res.count > 0;
}

/** Revoke all of a user's sessions EXCEPT `keepSessionId` ("log out other devices"). Returns count. */
export async function revokeOtherSessions(userId: string, keepSessionId: string): Promise<number> {
  const res = await prisma.userSession.updateMany({ where: { userId, revokedAt: null, id: { not: keepSessionId } }, data: { revokedAt: new Date() } });
  return res.count;
}

/** Revoke ALL of a user's sessions including the current one ("log out everywhere"). Returns count. */
export async function revokeAllSessions(userId: string): Promise<number> {
  const res = await prisma.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return res.count;
}

/** Fetch the user's current password hash (for current-password verification in the change flow). */
export async function getUserPasswordHash(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  return u?.passwordHash ?? null;
}

/**
 * Set a new password hash and revoke sessions, atomically. `keepSessionId` (the caller's freshly-rotated
 * session) is preserved so a password change does not log the user out of the device they used to change
 * it; every OTHER session is revoked. Sets `passwordChangedAt` (the hydrate backstop invalidates any
 * session created before it too). NEVER receives or stores a plaintext password.
 */
export async function changeUserPassword(userId: string, newPasswordHash: string, keepSessionId: string | null): Promise<void> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash: newPasswordHash, passwordChangedAt: now } });
    await tx.userSession.updateMany({
      where: { userId, revokedAt: null, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
      data: { revokedAt: now },
    });
  });
}
