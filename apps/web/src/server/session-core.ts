import {
  createUserSession, readUserSession, revokeUserSession, rotateUserSession,
  SESSION_TTL_MS, type ResolvedSession,
} from "@guardora/db";

/**
 * V1.37.1/V1.37.3D — cookie-jar logic for the DB-backed session, decoupled from
 * `next/headers` so it is unit-testable and its read/mutate boundaries are explicit.
 *
 * The cookie carries ONLY the opaque random token; identity/tenant/role are always
 * resolved server-side from a validated `UserSession` row. Fail-closed.
 *
 * READ vs MUTATE is a hard boundary:
 *   - `readSessionFromJar` is STRICTLY READ-ONLY (safe during render).
 *   - every `set`/`delete` lives in a mutation-only helper that must be reached
 *     only from a Server Action or Route Handler.
 */
export const SESSION_COOKIE = "tamanor_session";
/** Legacy cookie — NEVER trusted, NEVER read for auth; cleared only on mutation. */
export const LEGACY_COOKIE = "guardora_session";

/** Minimal cookie-jar contract (a subset of Next's ReadonlyRequestCookies / mutable jar). */
export interface CookieJar {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options?: Record<string, unknown>): void;
  delete(name: string): void;
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/**
 * Drop the insecure legacy cookie if present. MUTATES the jar — only reachable from
 * mutation-safe entry points (login/logout/tenant-switch Server Actions). The legacy
 * cookie never authenticates anyone; this is hygiene, not a fallback.
 */
export function clearLegacyInJar(jar: CookieJar): void {
  if (jar.get(LEGACY_COOKIE)) jar.delete(LEGACY_COOKIE);
}

/**
 * Resolve the current session, or null. STRICTLY READ-ONLY: never set/delete. Only
 * the opaque `tamanor_session` token is read; the legacy `guardora_session` cookie is
 * IGNORED. A stale/invalid token fails closed (→ null) with NO cookie mutation.
 */
export async function readSessionFromJar(jar: CookieJar): Promise<ResolvedSession | null> {
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const result = await readUserSession(token);
  if (!result.ok || !result.session) return null; // fail-closed, no mutation
  return result.session;
}

/** Create a session (bootstrap/login) and set the cookie; clears the legacy cookie. */
export async function startSessionInJar(jar: CookieJar, userId: string, activeTenantId?: string): Promise<ResolvedSession> {
  const { token, session } = await createUserSession({ userId, activeTenantId });
  jar.set(SESSION_COOKIE, token, cookieOptions());
  clearLegacyInJar(jar);
  return session;
}

/** Revoke the DB session AND clear both cookies. */
export async function endSessionInJar(jar: CookieJar): Promise<void> {
  const token = jar.get(SESSION_COOKIE)?.value;
  await revokeUserSession(token);
  jar.delete(SESSION_COOKIE);
  clearLegacyInJar(jar);
}

/** Switch the active tenant (membership re-checked server-side), rotate the token, clear legacy. */
export async function switchActiveTenantInJar(jar: CookieJar, tenantId: string): Promise<ResolvedSession> {
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) throw new Error("switchActiveTenant: no session");
  const { token: next, session } = await rotateUserSession(token, { activeTenantId: tenantId });
  jar.set(SESSION_COOKIE, next, cookieOptions());
  clearLegacyInJar(jar);
  return session;
}
