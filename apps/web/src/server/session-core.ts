import {
  createUserSession, readUserSession, revokeUserSession, rotateUserSession,
  type ResolvedSession, type SessionRejectReason,
} from "@guardora/db";
import { getSessionConfig } from "@guardora/config";
import { emitOpsEvent } from "@guardora/core";

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

/**
 * V1.58.9 — the cookie Max-Age tracks the session's ABSOLUTE ceiling: the longer remember-me ceiling
 * for a persistent login, the shorter absolute ceiling otherwise. The server still enforces the idle
 * timeout independently — the cookie lifetime is only the outer bound the browser will retain it.
 */
export function cookieOptions(rememberMe = false) {
  const cfg = getSessionConfig();
  const ceilingMs = rememberMe ? cfg.rememberMs : cfg.absoluteMs;
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(ceilingMs / 1000),
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

/**
 * V1.58.9 — like {@link readSessionFromJar} but surfaces the REJECT REASON (READ-ONLY, no mutation).
 * Used to show a truthful "logged out due to inactivity / session expired" message on redirect to
 * /login. `null` reason means no token was present (never authenticated).
 */
export async function readSessionResultFromJar(jar: CookieJar): Promise<{ session: ResolvedSession | null; reason: SessionRejectReason | null }> {
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return { session: null, reason: null };
  const result = await readUserSession(token);
  if (!result.ok || !result.session) {
    const reason = result.reason ?? "unauthenticated";
    // Audit ONLY the security-relevant lifetime rejections (not an ordinary "no token" render).
    if (reason === "session_expired_idle") emitOpsEvent("auth.session_expired_idle", { reason });
    else if (reason === "session_expired_absolute") emitOpsEvent("auth.session_expired_absolute", { reason });
    return { session: null, reason };
  }
  return { session: result.session, reason: null };
}

/** Create a session (bootstrap/login) and set the cookie; clears the legacy cookie. */
export async function startSessionInJar(jar: CookieJar, userId: string, activeTenantId?: string, rememberMe = false, userAgentSummary?: string): Promise<ResolvedSession> {
  const { token, session } = await createUserSession({ userId, activeTenantId, rememberMe, userAgentSummary });
  jar.set(SESSION_COOKIE, token, cookieOptions(rememberMe));
  clearLegacyInJar(jar);
  return session;
}

/** Revoke the DB session AND clear both cookies. */
export async function endSessionInJar(jar: CookieJar): Promise<void> {
  const token = jar.get(SESSION_COOKIE)?.value;
  await revokeUserSession(token);
  jar.delete(SESSION_COOKIE);
  clearLegacyInJar(jar);
  emitOpsEvent("auth.logout", {});
}

/** Switch the active tenant (membership re-checked server-side), rotate the token, clear legacy. */
export async function switchActiveTenantInJar(jar: CookieJar, tenantId: string): Promise<ResolvedSession> {
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) throw new Error("switchActiveTenant: no session");
  const { token: next, session } = await rotateUserSession(token, { activeTenantId: tenantId });
  jar.set(SESSION_COOKIE, next, cookieOptions(session.rememberMe));
  clearLegacyInJar(jar);
  emitOpsEvent("auth.session_rotated", { operation: "tenant_switch" });
  return session;
}
