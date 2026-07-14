/**
 * V1.45A — GLOBAL platform-administration authorization. This is the ONE authoritative place that
 * decides platform (cross-tenant) access, and the ONLY sanctioned way to read/mutate the global
 * `leads` table. It is completely independent of tenant Role/Membership.
 *
 * Invariants:
 *  - The platform role is read FRESH from persisted `User.platformRole` on every check — never
 *    cached in a session — so removing a role takes effect immediately (no stale privilege).
 *  - Fail-closed: missing/unknown user, absent role, or a DB error resolves to NO platform access.
 *  - A role can never be supplied by a caller: the lead service takes a `userId` and resolves the
 *    role itself, so a forged/hardcoded role is impossible.
 *  - Lead PII is never returned to, logged by, or thrown from this module for an unauthorized caller.
 */
import { Prisma, PlatformRole } from "@prisma/client";
import { prisma, systemDb } from "./index";

export { PlatformRole };

export type PlatformCapability = "leads:read" | "leads:write";

/** Capability policy. `admin` ⊇ `staff`. Anything not explicitly granted is denied. */
export function platformRoleSatisfies(role: PlatformRole | null | undefined, cap: PlatformCapability): boolean {
  switch (role) {
    case PlatformRole.admin: return true;                       // full platform access
    case PlatformRole.staff: return cap === "leads:read" || cap === "leads:write";
    default: return false;                                      // none / null / unknown → denied
  }
}

/** Fresh, trusted resolution of the platform role from persisted state. Fail-closed. */
export async function resolvePlatformRole(userId: string | null | undefined): Promise<PlatformRole> {
  if (!userId) return PlatformRole.none;
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true } });
    return u?.platformRole ?? PlatformRole.none; // user gone / no row → no access
  } catch (e) {
    // Fail CLOSED (deny) on a DB error, but keep it DIAGNOSTICALLY visible — it must not be silently
    // indistinguishable from a legitimate `none`. Safe payload only: error name/code, never the
    // message (may carry connection details) and never any PII.
    console.error(JSON.stringify({ evt: "platform.role_resolve_error", error: (e as Error)?.name ?? "unknown", code: (e as { code?: string })?.code ?? null }));
    return PlatformRole.none;
  }
}

/** Thrown when a caller lacks the required platform capability. Carries NO lead data. */
export class PlatformForbiddenError extends Error {
  readonly code = "platform_forbidden";
  constructor(public readonly capability: PlatformCapability) { super("platform_forbidden"); this.name = "PlatformForbiddenError"; }
}
export function isPlatformForbidden(e: unknown): e is PlatformForbiddenError {
  return e instanceof PlatformForbiddenError || (e as { code?: string })?.code === "platform_forbidden";
}

/** Resolve + enforce a capability for a user id. Returns the resolved role on success; throws otherwise. */
export async function requirePlatformCapability(userId: string | null | undefined, cap: PlatformCapability): Promise<PlatformRole> {
  const role = await resolvePlatformRole(userId);
  if (!platformRoleSatisfies(role, cap)) throw new PlatformForbiddenError(cap);
  return role;
}

// --------------------------- platform-authorized LEADS service ---------------------------
// These are the ONLY exported lead READ/MUTATE functions. Each resolves the platform role from the
// given userId and enforces it BEFORE touching the global (systemDb) table — no unguarded path.

export async function platformListLeads(userId: string, args: Prisma.LeadFindManyArgs) {
  await requirePlatformCapability(userId, "leads:read");
  return systemDb.lead.findMany(args);
}
export async function platformGroupLeadsByStatus(userId: string) {
  await requirePlatformCapability(userId, "leads:read");
  return systemDb.lead.groupBy({ by: ["status"], _count: true });
}
export async function platformGetLeadById(userId: string, id: string) {
  await requirePlatformCapability(userId, "leads:read");
  return systemDb.lead.findUnique({ where: { id } });
}
export async function platformUpdateLead(userId: string, id: string, data: Prisma.LeadUpdateInput) {
  await requirePlatformCapability(userId, "leads:write");
  return systemDb.lead.update({ where: { id }, data });
}

// --------------------------- operational bootstrap (NOT runtime-exposed) ---------------------------
export type SetPlatformRoleResult =
  | { ok: true; userId: string; previous: PlatformRole; current: PlatformRole }
  | { ok: false; reason: "user_not_found" };

/**
 * Assign or remove a platform role by exact email. Idempotent. Used ONLY by the explicit,
 * separately-invoked bootstrap script — never reachable from tenant UI or any HTTP route. Returns
 * previous/current role; never returns tokens or PII beyond the operator-supplied email.
 */
export async function setPlatformRoleByEmail(email: string, role: PlatformRole): Promise<SetPlatformRoleResult> {
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true, platformRole: true } });
  if (!u) return { ok: false, reason: "user_not_found" };
  if (u.platformRole === role) return { ok: true, userId: u.id, previous: u.platformRole, current: role }; // idempotent
  await prisma.user.update({ where: { id: u.id }, data: { platformRole: role } });
  return { ok: true, userId: u.id, previous: u.platformRole, current: role };
}
