import "server-only";
import { cookies } from "next/headers";
import type { ResolvedSession } from "@guardora/db";
import {
  SESSION_COOKIE,
  readSessionFromJar,
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

/** Create a session for a user (bootstrap/login) and set the cookie. Mutation-safe entry point. */
export async function startSession(userId: string, activeTenantId?: string): Promise<ResolvedSession> {
  return startSessionInJar(await jar(), userId, activeTenantId);
}

/** Resolve the current session from the cookie, or null. STRICTLY READ-ONLY (render-safe). */
export async function readSession(): Promise<ResolvedSession | null> {
  return readSessionFromJar(await jar());
}

/** Server-side logout: revoke the DB session AND clear both cookies. Mutation-safe entry point. */
export async function endSession(): Promise<void> {
  return endSessionInJar(await jar());
}

/** Switch the active tenant (membership re-checked server-side) and rotate the token. Mutation-safe entry point. */
export async function switchActiveTenant(tenantId: string): Promise<ResolvedSession> {
  return switchActiveTenantInJar(await jar(), tenantId);
}
