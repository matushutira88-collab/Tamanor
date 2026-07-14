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
import { randomUUID } from "node:crypto";
import { Prisma, PlatformRole, LeadErasureMode } from "@prisma/client";
import { prisma, systemDb } from "./index";

export { PlatformRole };

// V1.45C1 — `tenant:delete` is a PLATFORM capability distinct from tenant ownership: it lets a
// Platform Admin initiate a tenant deletion via a trusted server capability. It is granted ONLY to
// platform `admin` (NOT `staff`) — platform staff must never be able to destroy a tenant.
// V1.45C2 — `user:delete` lets a Platform Admin erase ANOTHER user's global identity. Also admin-only;
// staff denied; tenant roles grant NO global identity-delete authority.
// V1.45C3 — `leads:erase` is the DESTRUCTIVE lead-erasure capability, distinct from ordinary `leads:write`
// editing. Admin-only: platform staff keep read/write but must NOT be able to irreversibly erase leads.
export type PlatformCapability = "leads:read" | "leads:write" | "tenant:delete" | "user:delete" | "leads:erase";

/** Capability policy. `admin` ⊇ `staff`, EXCEPT tenant:delete and user:delete are admin-only. */
export function platformRoleSatisfies(role: PlatformRole | null | undefined, cap: PlatformCapability): boolean {
  switch (role) {
    case PlatformRole.admin: return true;                       // full platform access (incl. tenant:delete, user:delete, leads:erase)
    case PlatformRole.staff: return cap === "leads:read" || cap === "leads:write"; // NOT tenant:delete / user:delete / leads:erase
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
/**
 * V1.45C3 — uses `updateMany` (not `update`) so a stale edit on an ALREADY-ERASED lead affects ZERO
 * rows and returns cleanly, instead of throwing a raw P2025 — and it can never restore erased PII (an
 * UPDATE cannot recreate a deleted row). Returns the affected count (0 = the lead no longer exists).
 */
export async function platformUpdateLead(userId: string, id: string, data: Prisma.LeadUpdateInput) {
  await requirePlatformCapability(userId, "leads:write");
  return systemDb.lead.updateMany({ where: { id }, data: data as Prisma.LeadUpdateManyMutationInput });
}

// --------------------------- V1.45C3 platform-authorized LEAD ERASURE (leads:erase, admin-only) ---------------------------

export type LeadErasureTarget =
  | { mode: "lead_id"; leadId: string }
  | { mode: "normalized_email"; email: string };

export interface LeadErasureResult {
  operationId: string;
  mode: LeadErasureMode;
  matchedCount: number;
}

/** Exact email normalization for matching: trim + lowercase. NO domain/fuzzy/contains matching. */
export function normalizeLeadEmail(email: string): string {
  return String(email ?? "").trim().toLowerCase();
}

/**
 * Canonical global lead erasure. Platform-Admin-only (`leads:erase`, resolved FRESH from the DB; staff
 * and all tenant roles denied). Resolves + locks the EXACT target rows (an exact id, or an exact
 * normalized-email equality — never a domain or fuzzy match), HARD-DELETES them (removing all lead PII
 * and content with the row), and writes a PII-free receipt — all in one transaction. Idempotent: a
 * repeat erase matches zero rows and returns a truthful `matchedCount: 0` (never fabricates a prior
 * success; the operationId is server-generated, never client-selectable).
 */
export async function eraseLeads(actorUserId: string, target: LeadErasureTarget): Promise<LeadErasureResult> {
  await requirePlatformCapability(actorUserId, "leads:erase");
  const operationId = randomUUID();
  const mode: LeadErasureMode = target.mode === "lead_id" ? LeadErasureMode.lead_id : LeadErasureMode.normalized_email;

  return systemDb.$transaction(async (tx) => {
    // Lock the exact matching rows FOR UPDATE (serializes vs a concurrent erase / edit).
    let rows: Array<{ id: string }>;
    if (target.mode === "lead_id") {
      rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "leads" WHERE id = ${target.leadId} FOR UPDATE`);
    } else {
      const norm = normalizeLeadEmail(target.email);
      // Exact equality on the normalized (lowercased) email — no LIKE, no domain, no fuzzy.
      rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "leads" WHERE lower(email) = ${norm} FOR UPDATE`);
    }
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await tx.lead.deleteMany({ where: { id: { in: ids } } }); // hard-delete: all PII/content gone with the row
    }
    await tx.leadErasureReceipt.create({
      data: { operationId, requestedByUserId: actorUserId, mode, matchedCount: ids.length, completedAt: new Date() },
    });
    return { operationId, mode, matchedCount: ids.length };
  });
}

export function getLeadErasureReceipt(operationId: string, client = systemDb) {
  return client.leadErasureReceipt.findUnique({ where: { operationId } });
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
