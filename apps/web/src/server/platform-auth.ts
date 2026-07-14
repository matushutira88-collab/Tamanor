import "server-only";
import { notFound } from "next/navigation";
import { getSession } from "@/server/auth";
import { resolvePlatformRole, platformRoleSatisfies, type PlatformCapability, type PlatformRole } from "@guardora/db";

/**
 * V1.45A — server-only guard for a GLOBAL platform (cross-tenant) capability. Fails CLOSED and
 * NON-REVEALING: an unauthenticated user, an ordinary tenant user (any tenant Role, incl. Owner/
 * Admin), or any insufficient platform role all receive a uniform `notFound()` (404) — the caller
 * cannot distinguish "not authorized" from "resource does not exist", and NO protected data query
 * runs before this returns. The platform role is resolved FRESH from persisted state on every call
 * (never from the session), so a removed role denies access immediately.
 */
export async function requirePlatformCapabilityOrNotFound(cap: PlatformCapability): Promise<{ userId: string; platformRole: PlatformRole }> {
  const session = await getSession();
  if (!session) {
    logPlatformSecurityEvent("platform.access_denied", { actorUserId: null, capability: cap, reason: "unauthenticated" });
    notFound(); // never returns
  }
  const platformRole = await resolvePlatformRole(session.userId);
  if (!platformRoleSatisfies(platformRole, cap)) {
    logPlatformSecurityEvent("platform.access_denied", { actorUserId: session.userId, capability: cap, reason: "insufficient_platform_role" });
    notFound(); // never returns
  }
  return { userId: session.userId, platformRole };
}

/**
 * Safe platform-security structured log. NEVER include lead email/message/notes, session tokens, or
 * any secret — identifiers + safe metadata only. Logging must never throw.
 */
export function logPlatformSecurityEvent(evt: string, fields: Record<string, string | number | null | undefined>): void {
  try {
    console.info(JSON.stringify({ evt, at: new Date().toISOString(), ...fields }));
  } catch {
    /* logging must never break the request */
  }
}
