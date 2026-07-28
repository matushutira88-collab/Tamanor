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
export type PlatformCapability =
  | "leads:read" | "leads:write" | "tenant:delete" | "user:delete" | "leads:erase"
  // Platform Admin & Privacy Analytics V1 — admin-area + analytics capabilities. `admin_users.manage`
  // (add/remove/change platform administrators) is OWNER-ONLY; `analytics.export` is a SEPARATE gate from
  // `analytics.view`; audit actor identity is redacted for `analyst` in the read service.
  | "admin.access" | "analytics.view" | "analytics.export" | "admin_users.view" | "admin_users.manage" | "audit.view" | "system_health.view";

/**
 * Capability policy. `owner` ⊇ `admin` ⊇ `staff` for existing lead/tenant/user caps; the new admin-area caps
 * layer on top. Only `owner` may manage platform administrators. Adding an enum value defaults to deny.
 */
export function platformRoleSatisfies(role: PlatformRole | null | undefined, cap: PlatformCapability): boolean {
  switch (role) {
    case PlatformRole.owner: return true;                       // full platform access incl. admin_users.manage
    case PlatformRole.admin: return cap !== "admin_users.manage"; // everything EXCEPT owner-only admin management
    case PlatformRole.analyst: return cap === "admin.access" || cap === "analytics.view" || cap === "audit.view"; // read-only analytics + (redacted) audit
    case PlatformRole.support: return cap === "admin.access" || cap === "system_health.view"; // limited system-health only
    case PlatformRole.staff: return cap === "leads:read" || cap === "leads:write"; // legacy leads only — NO admin area
    default: return false;                                      // none / null / unknown → denied
  }
}

/**
 * Dashboard platform-admin ENTRY visibility — owner-only by policy. The tenant-dashboard entry card renders
 * ONLY for a platform `owner`. Because `resolvePlatformRole` already collapses a revoked/deactivated owner (and
 * every non-owner role) to a NON-owner value, feeding its result here yields `false` for a revoked owner, a
 * platform `admin`, and any tenant role. This is INDEPENDENT of the /admin route guard (which enforces
 * per-capability `admin.access` server-side): hiding the card never grants, and showing it never gates, actual
 * admin access. Never derived from an email.
 */
export function canViewPlatformAdminEntry(role: PlatformRole | null | undefined): boolean {
  return role === PlatformRole.owner;
}

/**
 * Canonical mapping from a persisted/raw value to a PlatformRole. Representation-ROBUST: string-coerces, trims,
 * and lowercases before matching the known enum labels, and returns `none` for anything unknown, non-string
 * (e.g. an accidental object), null, or empty. This guarantees a value read from the DB enum column — or any
 * upstream representation drift (casing/whitespace) — resolves to the correct role, and never leaks a foreign
 * representation into the authorization comparison.
 */
const PLATFORM_ROLE_BY_LABEL: Record<string, PlatformRole> = {
  none: PlatformRole.none, staff: PlatformRole.staff, admin: PlatformRole.admin,
  owner: PlatformRole.owner, analyst: PlatformRole.analyst, support: PlatformRole.support,
};
export function normalizePlatformRole(value: unknown): PlatformRole {
  if (typeof value !== "string") return PlatformRole.none;
  return PLATFORM_ROLE_BY_LABEL[value.trim().toLowerCase()] ?? PlatformRole.none;
}

/** Bounded, PII-free resolution detail — for authorization AND safe diagnostics. Never carries email/session. */
export interface PlatformRoleResolution {
  /** Effective role AFTER the revoked-access collapse (this is what authorization uses). */
  role: PlatformRole;
  /** Assigned role BEFORE the revoked collapse (normalized) — so a revoked owner is still observable as owner. */
  assignedRole: PlatformRole;
  /** The exact stored representation (::text) — for diagnostics only; a role label, never PII. */
  rawRole: string | null;
  accessRevoked: boolean;
  found: boolean;
  errored: boolean;
}

/**
 * Fresh, trusted resolution of the platform role from persisted state, with bounded diagnostics. Fail-closed:
 * a missing user, revoked access, or a DB error all resolve `role` to `none`. Normalizes the stored value so
 * representation drift can never hide a legitimate role.
 */
export async function resolvePlatformRoleDetailed(userId: string | null | undefined): Promise<PlatformRoleResolution> {
  if (!userId) return { role: PlatformRole.none, assignedRole: PlatformRole.none, rawRole: null, accessRevoked: false, found: false, errored: false };
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true, platformAccessRevokedAt: true } });
    if (!u) return { role: PlatformRole.none, assignedRole: PlatformRole.none, rawRole: null, accessRevoked: false, found: false, errored: false };
    const rawRole = u.platformRole == null ? null : String(u.platformRole);
    const assignedRole = normalizePlatformRole(u.platformRole);
    const accessRevoked = u.platformAccessRevokedAt != null;
    return { role: accessRevoked ? PlatformRole.none : assignedRole, assignedRole, rawRole, accessRevoked, found: true, errored: false };
  } catch (e) {
    // Fail CLOSED (deny) on a DB error, but keep it DIAGNOSTICALLY visible — it must not be silently
    // indistinguishable from a legitimate `none`. Safe payload only: error name/code, never the
    // message (may carry connection details) and never any PII.
    console.error(JSON.stringify({ evt: "platform.role_resolve_error", error: (e as Error)?.name ?? "unknown", code: (e as { code?: string })?.code ?? null }));
    return { role: PlatformRole.none, assignedRole: PlatformRole.none, rawRole: null, accessRevoked: false, found: false, errored: true };
  }
}

/** Fresh, trusted resolution of the platform role from persisted state. Fail-closed. */
export async function resolvePlatformRole(userId: string | null | undefined): Promise<PlatformRole> {
  return (await resolvePlatformRoleDetailed(userId)).role;
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
