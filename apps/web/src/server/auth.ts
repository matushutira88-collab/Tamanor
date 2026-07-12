import "server-only";
import { redirect } from "next/navigation";
import { Role, type Permission, can } from "@guardora/core";
import { readSession } from "./session";

/**
 * AUTH SEAM.
 *
 * The single place the app resolves identity. As of V1.37.1 this is a SECURE,
 * DB-backed opaque session (see {@link readSession} / @guardora/db session core):
 * the cookie holds only a random token, identity + active tenant + role are
 * resolved server-side from a validated `UserSession` row, and every check is
 * fail-closed. Callers depend on {@link AppSession}, not on how it is produced.
 */
export { SESSION_COOKIE } from "./session";

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
  const s = await readSession();
  if (!s) return null;
  return {
    userId: s.userId,
    userName: s.userName,
    userEmail: s.userEmail,
    tenantId: s.tenantId,
    tenantName: s.tenantName,
    role: s.role as Role,
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
