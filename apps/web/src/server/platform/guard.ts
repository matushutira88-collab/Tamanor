import "server-only";
import { getSession } from "@/server/auth";
import { systemDb, resolvePlatformRole, platformRoleSatisfies, markPlatformAccess, platformAudit, PlatformRole, type PlatformCapability } from "@guardora/db";

/**
 * Platform-admin route guard. Re-checks platform authorization SERVER-SIDE on every request (the role is
 * resolved FRESH from persisted state — never from the session), records a bounded access/denial audit, and
 * returns a null on denial so the page renders a SAFE, non-enumerating denial (it never reveals who is a
 * platform admin). Reuses the existing secure session — no admin bypass, no email-based authorization.
 */
export interface PlatformSession {
  userId: string; userName: string; userEmail: string; role: PlatformRole; authenticatedAt: Date | null;
}

export async function requirePlatformAccess(cap: PlatformCapability = "admin.access"): Promise<PlatformSession | null> {
  const session = await getSession();
  if (!session || !session.emailVerified) return null;
  const role = await resolvePlatformRole(session.userId);
  if (!platformRoleSatisfies(role, cap)) {
    await platformAudit(session.userId, "admin.access_denied", { resultCode: cap, platformRole: role }).catch(() => {});
    return null;
  }
  const us = await systemDb.userSession.findUnique({ where: { id: session.sessionId }, select: { createdAt: true } }).catch(() => null);
  await markPlatformAccess(session.userId).catch(() => {});
  await platformAudit(session.userId, "admin.area_accessed", { platformRole: role }).catch(() => {});
  return { userId: session.userId, userName: session.userName, userEmail: session.userEmail, role, authenticatedAt: us?.createdAt ?? null };
}

export interface PlatformCaps {
  role: PlatformRole; analyticsView: boolean; analyticsExport: boolean; adminUsersView: boolean;
  adminUsersManage: boolean; auditView: boolean; systemHealth: boolean;
}
export function platformCapsFor(role: PlatformRole): PlatformCaps {
  return {
    role,
    analyticsView: platformRoleSatisfies(role, "analytics.view"),
    analyticsExport: platformRoleSatisfies(role, "analytics.export"),
    adminUsersView: platformRoleSatisfies(role, "admin_users.view"),
    adminUsersManage: platformRoleSatisfies(role, "admin_users.manage"),
    auditView: platformRoleSatisfies(role, "audit.view"),
    systemHealth: platformRoleSatisfies(role, "system_health.view"),
  };
}
