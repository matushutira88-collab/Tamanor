import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Role, type Permission, can } from "@guardora/core";
import { prisma } from "./db";

/**
 * AUTH SEAM.
 *
 * This is the single place the app resolves identity. Today it is a dev/mock
 * provider: a cookie holds a user id and the session is loaded from the DB. To
 * move to real auth (e.g. OAuth/OIDC, magic links), replace only the cookie
 * read in {@link getSession} and the sign-in action — every caller stays the
 * same because they depend on {@link AppSession}, not on how it was produced.
 */
export const SESSION_COOKIE = "guardora_session";

export interface AppSession {
  userId: string;
  userName: string;
  userEmail: string;
  tenantId: string;
  tenantName: string;
  role: Role;
}

/** Resolve the current session, or null if not signed in. */
export async function getSession(): Promise<AppSession | null> {
  const jar = await cookies();
  const userId = jar.get(SESSION_COOKIE)?.value;
  if (!userId) return null;

  const membership = await prisma.membership.findFirst({
    where: { userId },
    include: { user: true, tenant: true },
  });
  if (!membership) return null;

  return {
    userId: membership.user.id,
    userName: membership.user.name ?? membership.user.email,
    userEmail: membership.user.email,
    tenantId: membership.tenant.id,
    tenantName: membership.tenant.name,
    role: membership.role as Role,
  };
}

/** Require a session; redirect to /login if absent. */
export async function requireSession(): Promise<AppSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Require a session that holds a permission; redirect/throw otherwise. */
export async function requirePermission(
  permission: Permission,
): Promise<AppSession> {
  const session = await requireSession();
  if (!can(session.role, permission)) {
    throw new Error(`Forbidden: missing permission "${permission}"`);
  }
  return session;
}
