/**
 * Platform Admin & Privacy Analytics V1 — platform-admin identity lifecycle, audit, and privileged-session
 * helpers. Builds on the authoritative V1.45A authorization (`platform-repo.ts`): the platform role lives on
 * `User.platformRole` (read fresh, fail-closed) and is NEVER derived from a hardcoded email. Administrator
 * management is OWNER-ONLY, the last active owner is protected, self-mutation is blocked, and every action is
 * audited into the append-only `platform_admin_audit_events` (bounded, content-free metadata only).
 */
import { PlatformRole, Prisma } from "@prisma/client";
import { prisma, systemDb } from "./index";
import { resolvePlatformRole, requirePlatformCapability, PlatformForbiddenError } from "./platform-repo";

export { PlatformForbiddenError };

// ── Audit ─────────────────────────────────────────────────────────────────────
export const PLATFORM_AUDIT_ACTIONS = [
  "admin.area_accessed", "admin.access_denied", "analytics.viewed", "analytics.exported",
  "admin_user.added", "admin_user.role_changed", "admin_user.deactivated", "admin_user.reactivated",
  "bootstrap.owner_assigned", "retention.executed", "aggregation.executed", "analytics.collection_setting_changed",
  "privileged.reauth_required", "privileged.action_rejected", "system_health.viewed", "audit.viewed",
] as const;
export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];

export interface PlatformAuditExtra {
  targetUserId?: string | null;
  platformRole?: string | null;
  resultCode?: string;
  reportType?: string | null;
  dateRangeStart?: Date | null;
  dateRangeEnd?: Date | null;
  summary?: string | null;
}
/** Append a bounded, content-free platform-admin audit event. Never stores IP/hashes/timeline/content. */
export async function platformAudit(actorUserId: string | null, action: PlatformAuditAction, extra: PlatformAuditExtra = {}): Promise<void> {
  await systemDb.platformAdminAuditEvent.create({ data: {
    actorUserId: actorUserId ?? null, action, targetUserId: extra.targetUserId ?? null, platformRole: extra.platformRole ?? null,
    resultCode: extra.resultCode ?? "ok", reportType: extra.reportType ?? null,
    dateRangeStart: extra.dateRangeStart ?? null, dateRangeEnd: extra.dateRangeEnd ?? null,
    summary: extra.summary ? String(extra.summary).slice(0, 200) : null,
  } }).catch(() => {});
}

// ── Privileged-session freshness (recent-authentication requirement) ──────────
// V1 uses SESSION FRESHNESS as the recent-auth signal (the session's createdAt is the last authentication).
// True step-up re-auth (re-entering a password / passkey) is documented as a production hardening step.
export const PRIVILEGED_FRESHNESS_MS = 30 * 60 * 1000; // 30 minutes
export class PlatformAdminError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "PlatformAdminError"; }
}
/** Throw `stale_privileged_auth` if the session/auth is older than the freshness window. */
export function requireRecentAuth(authenticatedAt: Date | null | undefined, now: Date = new Date()): void {
  if (!authenticatedAt || now.getTime() - authenticatedAt.getTime() > PRIVILEGED_FRESHNESS_MS) {
    throw new PlatformAdminError("stale_privileged_auth");
  }
}

/** Coarse privileged-area access marker (never a raw IP / session token / timeline). Best-effort. */
export async function markPlatformAccess(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { platformLastAccessAt: new Date() } }).catch(() => {});
}

// ── Administrator registry (User.platformRole is the registry; no duplicate table) ──
export const ASSIGNABLE_PLATFORM_ROLES: readonly PlatformRole[] = [PlatformRole.owner, PlatformRole.admin, PlatformRole.analyst, PlatformRole.support];
const isAssignableRole = (r: string): r is PlatformRole => (ASSIGNABLE_PLATFORM_ROLES as readonly string[]).includes(r);

/** Count active PLATFORM_OWNERs (role owner AND not deactivated) — the last-owner-protection basis. */
export async function countActivePlatformOwners(): Promise<number> {
  return prisma.user.count({ where: { platformRole: PlatformRole.owner, platformAccessRevokedAt: null } });
}

/**
 * Inside a transaction, LOCK every active-owner row `FOR UPDATE` and return how many active owners would
 * remain if `exceptId` were removed. Locking serializes concurrent owner-management operations so the
 * last-owner check can never race (two simultaneous demotions/deactivations can never both pass and leave
 * zero owners). Follows the repo's row-lock pattern (cf. lead erasure).
 */
async function remainingActiveOwnersLocked(tx: Prisma.TransactionClient, exceptId: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "users" WHERE "platformRole"::text = 'owner' AND "platformAccessRevokedAt" IS NULL FOR UPDATE`);
  return rows.filter((r) => r.id !== exceptId).length;
}

export interface PlatformAdminRow {
  userId: string; name: string | null; email: string; platformRole: string; active: boolean;
  createdAt: string; platformRoleUpdatedAt: string | null; platformLastAccessAt: string | null;
}
/** List platform administrators (any non-`none` role, incl. deactivated). Requires admin_users.view. */
export async function listPlatformAdministrators(actorUserId: string): Promise<PlatformAdminRow[]> {
  await requirePlatformCapability(actorUserId, "admin_users.view");
  const rows = await prisma.user.findMany({
    where: { platformRole: { not: PlatformRole.none } },
    select: { id: true, name: true, email: true, platformRole: true, platformAccessRevokedAt: true, createdAt: true, platformRoleUpdatedAt: true, platformLastAccessAt: true },
    orderBy: [{ platformRole: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((u) => ({
    userId: u.id, name: u.name, email: u.email, platformRole: u.platformRole, active: !u.platformAccessRevokedAt,
    createdAt: u.createdAt.toISOString(), platformRoleUpdatedAt: u.platformRoleUpdatedAt?.toISOString() ?? null,
    platformLastAccessAt: u.platformLastAccessAt?.toISOString() ?? null,
  }));
}

interface ManageOpts { authenticatedAt: Date | null; }
/** Resolve the actor's role fresh and enforce OWNER (admin_users.manage) + recent auth. */
async function assertOwnerManage(actorUserId: string, opts: ManageOpts): Promise<void> {
  requireRecentAuth(opts.authenticatedAt);
  await requirePlatformCapability(actorUserId, "admin_users.manage"); // owner-only
}

/**
 * Add an EXISTING authenticated user as a platform administrator (by exact email). OWNER-only. The user must
 * already exist in the normal identity system — this never creates a user or handles a password. Anti-
 * enumeration: a missing user returns a bounded `user_not_found` without revealing account existence details.
 */
export async function addPlatformAdministrator(actorUserId: string, email: string, role: string, opts: ManageOpts): Promise<{ ok: true; userId: string }> {
  await assertOwnerManage(actorUserId, opts);
  if (!isAssignableRole(role)) throw new PlatformAdminError("unsupported_role");
  const normalized = String(email ?? "").trim().toLowerCase();
  const u = await prisma.user.findFirst({ where: { email: { equals: normalized, mode: "insensitive" } }, select: { id: true, platformRole: true } });
  if (!u) { await platformAudit(actorUserId, "admin_user.added", { resultCode: "user_not_found" }); throw new PlatformAdminError("user_not_found"); }
  if (u.id === actorUserId) throw new PlatformAdminError("cannot_self_manage"); // no self-elevation
  await prisma.user.update({ where: { id: u.id }, data: { platformRole: role as PlatformRole, platformAccessRevokedAt: null, platformRoleUpdatedAt: new Date() } });
  await platformAudit(actorUserId, "admin_user.added", { targetUserId: u.id, platformRole: role });
  return { ok: true, userId: u.id };
}

/**
 * Change a platform administrator's role. OWNER-only. Cannot change your OWN role (separation of duties) and
 * cannot demote the LAST active owner. Optimistic concurrency via `expectedUpdatedAt` (ISO of the row's
 * platformRoleUpdatedAt, or null).
 */
export async function changePlatformRole(actorUserId: string, targetUserId: string, newRole: string, opts: ManageOpts & { expectedUpdatedAt?: string | null }): Promise<{ ok: true }> {
  await assertOwnerManage(actorUserId, opts);
  if (!isAssignableRole(newRole)) throw new PlatformAdminError("unsupported_role");
  if (targetUserId === actorUserId) throw new PlatformAdminError("cannot_self_manage");
  // Last-owner protection + optimistic concurrency are enforced atomically inside a transaction (owner rows
  // locked FOR UPDATE) so a concurrent demotion/deactivation can never leave zero owners.
  await systemDb.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: targetUserId }, select: { platformRole: true, platformAccessRevokedAt: true, platformRoleUpdatedAt: true } });
    if (!target || target.platformRole === PlatformRole.none) throw new PlatformAdminError("user_not_found");
    const cur = target.platformRoleUpdatedAt?.toISOString() ?? null;
    if (opts.expectedUpdatedAt !== undefined && opts.expectedUpdatedAt !== cur) throw new PlatformAdminError("version_conflict");
    if (target.platformRole === PlatformRole.owner && newRole !== PlatformRole.owner && !target.platformAccessRevokedAt) {
      if ((await remainingActiveOwnersLocked(tx, targetUserId)) === 0) throw new PlatformAdminError("last_owner_protected");
    }
    const res = await tx.user.updateMany({ where: { id: targetUserId, ...(opts.expectedUpdatedAt !== undefined ? { platformRoleUpdatedAt: target.platformRoleUpdatedAt } : {}) }, data: { platformRole: newRole as PlatformRole, platformRoleUpdatedAt: new Date() } });
    if (res.count === 0) throw new PlatformAdminError("version_conflict");
  });
  await platformAudit(actorUserId, "admin_user.role_changed", { targetUserId, platformRole: newRole });
  return { ok: true };
}

/** Deactivate platform access (preserves the role for reactivation). OWNER-only; last active owner protected. */
export async function deactivatePlatformAccess(actorUserId: string, targetUserId: string, opts: ManageOpts): Promise<{ ok: true }> {
  await assertOwnerManage(actorUserId, opts);
  if (targetUserId === actorUserId) throw new PlatformAdminError("cannot_self_manage");
  let role = "";
  await systemDb.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: targetUserId }, select: { platformRole: true, platformAccessRevokedAt: true } });
    if (!target || target.platformRole === PlatformRole.none) throw new PlatformAdminError("user_not_found");
    if (target.platformAccessRevokedAt) { role = "__idempotent__"; return; } // already deactivated
    if (target.platformRole === PlatformRole.owner && (await remainingActiveOwnersLocked(tx, targetUserId)) === 0) throw new PlatformAdminError("last_owner_protected");
    await tx.user.update({ where: { id: targetUserId }, data: { platformAccessRevokedAt: new Date() } });
    role = target.platformRole;
  });
  if (role === "__idempotent__") return { ok: true };
  await platformAudit(actorUserId, "admin_user.deactivated", { targetUserId, platformRole: role });
  return { ok: true };
}

/** Reactivate platform access (restores the preserved role). OWNER-only. */
export async function reactivatePlatformAccess(actorUserId: string, targetUserId: string, opts: ManageOpts): Promise<{ ok: true }> {
  await assertOwnerManage(actorUserId, opts);
  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { platformRole: true, platformAccessRevokedAt: true } });
  if (!target || target.platformRole === PlatformRole.none) throw new PlatformAdminError("user_not_found");
  if (!target.platformAccessRevokedAt) return { ok: true }; // idempotent
  await prisma.user.update({ where: { id: targetUserId }, data: { platformAccessRevokedAt: null, platformRoleUpdatedAt: new Date() } });
  await platformAudit(actorUserId, "admin_user.reactivated", { targetUserId, platformRole: target.platformRole });
  return { ok: true };
}

// ── Bootstrap of the initial PLATFORM_OWNER (explicit; never per-request) ──────
export type BootstrapResult =
  | { ok: true; userId: string; changed: boolean }
  | { ok: false; reason: "no_env" | "no_user" | "ambiguous_users" };

/**
 * Idempotently make the CONFIGURED email the initial PLATFORM_OWNER. Reads the email ONLY from
 * `TAMANOR_BOOTSTRAP_PLATFORM_OWNER_EMAIL` (never hardcoded in application logic), normalizes it, and
 * requires EXACTLY ONE matching user (an EXISTING account in the normal identity system — never creates a
 * user or handles a password). Fails safely if the env is unset, no user matches, or MULTIPLE users match
 * (the safety stop against silent elevation). Idempotent (a repeat run is a no-op) and audited. Intended to
 * be invoked by an explicit operator command / controlled startup — NOT on every request.
 */
export async function bootstrapPlatformOwnerFromEnv(now: Date = new Date()): Promise<BootstrapResult> {
  const raw = process.env.TAMANOR_BOOTSTRAP_PLATFORM_OWNER_EMAIL;
  if (!raw || !raw.trim()) return { ok: false, reason: "no_env" };
  const email = raw.trim().toLowerCase();
  const matches = await prisma.user.findMany({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, platformRole: true, platformAccessRevokedAt: true } });
  if (matches.length === 0) return { ok: false, reason: "no_user" };
  if (matches.length > 1) return { ok: false, reason: "ambiguous_users" }; // conflicting accounts → fail safely
  const target = matches[0]!;
  const alreadyOwner = target.platformRole === PlatformRole.owner && !target.platformAccessRevokedAt;
  if (alreadyOwner) return { ok: true, userId: target.id, changed: false }; // idempotent
  await prisma.user.update({ where: { id: target.id }, data: { platformRole: PlatformRole.owner, platformAccessRevokedAt: null, platformRoleUpdatedAt: now } });
  await platformAudit(null, "bootstrap.owner_assigned", { targetUserId: target.id, platformRole: PlatformRole.owner, summary: "bootstrap" });
  return { ok: true, userId: target.id, changed: true };
}

// ── Platform audit read (actor identity redacted for analyst) ─────────────────
export async function listPlatformAudit(actorUserId: string, input: { action?: string; actorUserId?: string; result?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) {
  const role = await requirePlatformCapability(actorUserId, "audit.view");
  const redactActor = role === PlatformRole.analyst; // analyst: no actor identity
  const where: Record<string, unknown> = {};
  if (input.action && (PLATFORM_AUDIT_ACTIONS as readonly string[]).includes(input.action)) where.action = input.action;
  if (input.actorUserId && !redactActor) where.actorUserId = input.actorUserId;
  if (input.result) where.resultCode = String(input.result).slice(0, 40);
  const range: Record<string, Date> = {};
  if (input.from && !Number.isNaN(Date.parse(input.from))) range.gte = new Date(input.from);
  if (input.to && !Number.isNaN(Date.parse(input.to))) range.lte = new Date(input.to);
  if (Object.keys(range).length) where.createdAt = range;
  const pageSize = Math.min(Math.max(1, Math.floor(input.pageSize || 50)), 200);
  const page = Math.max(1, Math.floor(input.page || 1));
  const [total, rows] = await Promise.all([
    systemDb.platformAdminAuditEvent.count({ where }),
    systemDb.platformAdminAuditEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  await platformAudit(actorUserId, "audit.viewed", { resultCode: "ok" });
  return { total, page, pageSize, hasMore: page * pageSize < total, redactedActor: redactActor, items: rows.map((r) => ({
    id: r.id, action: r.action, actorUserId: redactActor ? null : r.actorUserId, targetUserId: redactActor ? null : r.targetUserId,
    platformRole: r.platformRole, resultCode: r.resultCode, reportType: r.reportType, summary: r.summary, createdAt: r.createdAt.toISOString(),
  })) };
}
