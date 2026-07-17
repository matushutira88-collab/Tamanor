import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { metrics } from "@guardora/core";
import type { ResolvedSession } from "@guardora/db";
import type { SessionRejectReason } from "@guardora/db";
import {
  SESSION_COOKIE,
  readSessionFromJar,
  readSessionResultFromJar,
  startSessionInJar,
  endSessionInJar,
  switchActiveTenantInJar,
  type CookieJar,
} from "./session-core";

/**
 * V1.37.1 — web session layer: thin `next/headers` cookie I/O around the DB-backed
 * session core (see {@link ./session-core}). The cookie carries ONLY the opaque
 * random token; identity/tenant/role are always resolved server-side from a
 * validated `UserSession` row. Fail-closed.
 *
 * MUTATION BOUNDARY: only {@link startSession} / {@link endSession} /
 * {@link switchActiveTenant} set or delete cookies, and they must be called from a
 * Server Action or Route Handler. {@link readSession} is strictly read-only, so it
 * is safe from render-time code (pages, layouts, getSession/requireSession).
 */
export { SESSION_COOKIE };

/** The Next cookie jar satisfies the CookieJar contract (get/set/delete). */
async function jar(): Promise<CookieJar> {
  return (await cookies()) as unknown as CookieJar;
}

/** Create a session for a user (bootstrap/login) and set the cookie. Mutation-safe entry point.
 *  V1.58.9 — `rememberMe` selects the longer persistent absolute ceiling + cookie Max-Age. */
export async function startSession(userId: string, activeTenantId?: string, rememberMe = false, userAgentSummary?: string): Promise<ResolvedSession> {
  return startSessionInJar(await jar(), userId, activeTenantId, rememberMe, userAgentSummary);
}

/**
 * V1.51C — REQUEST-SCOPED session memoization. `requestSessionHolder` is wrapped in React `cache()`,
 * so it returns the SAME mutable holder for every call within a single request (and a fresh one per
 * request). The first `readSession()` in a request performs the ONE DB lookup and stores the promise;
 * every later call (getSession → requireSession → requireVerifiedSession, server components, actions)
 * reuses it — one lookup per request instead of N. The promise is assigned SYNCHRONOUSLY (before the
 * first `await`) so concurrent callers cannot both miss. Full validation (revocation, expiry,
 * membership, passwordChangedAt) still runs on the miss — the reused result is valid for the request.
 */
const requestSessionHolder = cache((): { promise: Promise<ResolvedSession | null> | null } => ({ promise: null }));

/** Resolve the current session from the cookie, or null. STRICTLY READ-ONLY (render-safe). */
export function readSession(): Promise<ResolvedSession | null> {
  const holder = requestSessionHolder();
  if (holder.promise) {
    metrics.inc("session_cache_hit");
    return holder.promise;
  }
  metrics.inc("session_cache_miss");
  holder.promise = (async () => readSessionFromJar(await jar()))();
  return holder.promise;
}

/**
 * V1.58.9 — the reason the current cookie failed to resolve (READ-ONLY). Used by /login to show a
 * truthful "logged out due to inactivity / session expired" message. Returns null when a valid session
 * exists or no token is present.
 */
export async function readSessionReason(): Promise<SessionRejectReason | null> {
  const { reason } = await readSessionResultFromJar(await jar());
  return reason;
}

/** Server-side logout: revoke the DB session AND clear both cookies. Mutation-safe entry point. */
export async function endSession(): Promise<void> {
  return endSessionInJar(await jar());
}

/** Switch the active tenant (membership re-checked server-side) and rotate the token. Mutation-safe entry point. */
export async function switchActiveTenant(tenantId: string): Promise<ResolvedSession> {
  return switchActiveTenantInJar(await jar(), tenantId);
}
