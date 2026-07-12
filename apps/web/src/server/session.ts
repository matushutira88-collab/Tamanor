import "server-only";
import { cookies } from "next/headers";
import {
  createUserSession, readUserSession, revokeUserSession, rotateUserSession,
  SESSION_TTL_MS, type ResolvedSession,
} from "@guardora/db";

/**
 * V1.37.1 — web session layer: cookie I/O around the DB-backed session core.
 * The cookie carries ONLY the opaque random token; identity/tenant/role are
 * always resolved server-side from a validated `UserSession` row. Fail-closed.
 */
export const SESSION_COOKIE = "tamanor_session";
/** Legacy cookie — never trusted; cleared on read/bootstrap. */
const LEGACY_COOKIE = "guardora_session";

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/** Drop the insecure legacy cookie if present. No fallback authentication from it. */
async function clearLegacy(): Promise<void> {
  const jar = await cookies();
  if (jar.get(LEGACY_COOKIE)) jar.delete(LEGACY_COOKIE);
}

/** Create a session for a user (bootstrap/login) and set the cookie. */
export async function startSession(userId: string, activeTenantId?: string): Promise<ResolvedSession> {
  const { token, session } = await createUserSession({ userId, activeTenantId });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOptions());
  await clearLegacy();
  return session;
}

/** Resolve the current session from the cookie, or null. Invalid cookie is cleared. */
export async function readSession(): Promise<ResolvedSession | null> {
  await clearLegacy();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const result = await readUserSession(token);
  if (!result.ok || !result.session) {
    // Fail-closed: a revoked/expired/orphaned token must not linger as a cookie.
    jar.delete(SESSION_COOKIE);
    return null;
  }
  return result.session;
}

/** Server-side logout: revoke the DB session AND clear the cookie. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  await revokeUserSession(token);
  jar.delete(SESSION_COOKIE);
  await clearLegacy();
}

/** Switch the active tenant (membership re-checked server-side) and rotate the token. */
export async function switchActiveTenant(tenantId: string): Promise<ResolvedSession> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) throw new Error("switchActiveTenant: no session");
  const { token: next, session } = await rotateUserSession(token, { activeTenantId: tenantId });
  jar.set(SESSION_COOKIE, next, cookieOptions());
  return session;
}
