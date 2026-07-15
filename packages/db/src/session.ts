/**
 * V1.37.1 Secure session core (DB-backed, opaque token).
 *
 * The single source of truth for identity + active tenant. The web layer
 * (apps/web/src/server/session.ts) wraps these with cookie I/O; nothing else
 * resolves identity. All checks are FAIL-CLOSED:
 *   - the client only ever holds a cryptographically random token,
 *   - only the SHA-256 hash of the token is stored (a raw token is never persisted),
 *   - lookup is by hash; revoked / expired / user-gone / membership-gone → rejected,
 *   - the active tenant is explicit and re-validated against a live membership on every read.
 *
 * These functions take a raw token string (no cookies), so integration tests can
 * exercise the exact production authorization path with real tenants/users.
 */
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "./index";

/** Absolute session lifetime. No sliding extension — expiry is fixed at creation. */
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export type SessionRejectReason =
  | "unauthenticated"
  | "session_expired"
  | "session_revoked"
  | "membership_missing"
  | "user_missing"
  | "tenant_missing"
  // V1.45C1 — the active tenant is being deleted. Every session for it fails closed IMMEDIATELY
  // (this is the single choke point: render reads and mutation paths all funnel through hydrate).
  | "tenant_deleting"
  // V1.50C — defense-in-depth: a session created before the user's last password change is stale
  // (a password reset revokes all sessions explicitly; this backstop catches any that slipped through).
  | "password_changed";

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  userName: string;
  userEmail: string;
  // V1.50C — whether the user's email is verified. Email/password users start false;
  // OAuth (provider-verified) users start true. Gates verification-required product access.
  emailVerified: boolean;
  tenantId: string;
  tenantName: string;
  role: string;
  expiresAt: Date;
}

export interface ReadSessionResult {
  ok: boolean;
  session?: ResolvedSession;
  reason?: SessionRejectReason;
}

/** Deterministic, one-way hash of the raw token. The raw token never touches the DB. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A membership must exist between the user and the tenant for the tenant to be active. */
export async function assertMembership(userId: string, tenantId: string): Promise<boolean> {
  const m = await prisma.membership.findUnique({ where: { userId_tenantId: { userId, tenantId } }, select: { id: true } });
  return !!m;
}

/**
 * Deterministically resolve the active tenant for a user: honor an explicit,
 * membership-backed request; otherwise pick the earliest membership (createdAt,
 * then id) — never an unspecified DB order. Returns null if the user has none.
 *
 * V1.45C1 — a `deleting` tenant is NEVER selectable: an explicit request for one is rejected, and
 * the earliest-membership fallback skips deleting tenants. This blocks starting a session in, or
 * switching/logging into, a tenant that is being deleted.
 */
export async function resolveActiveTenant(userId: string, requestedTenantId?: string): Promise<string | null> {
  if (requestedTenantId) {
    if (!(await assertMembership(userId, requestedTenantId))) return null;
    const t = await prisma.tenant.findUnique({ where: { id: requestedTenantId }, select: { deletionState: true } });
    if (!t || t.deletionState !== "active") return null;
    return requestedTenantId;
  }
  const m = await prisma.membership.findFirst({
    where: { userId, tenant: { deletionState: "active" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { tenantId: true },
  });
  return m?.tenantId ?? null;
}

/**
 * Create a session. Verifies the user exists and holds a membership in the
 * (resolved) active tenant. Returns the RAW token (to set as the cookie) plus
 * the session id — the caller must never persist the raw token elsewhere.
 * Throws when the user has no valid tenant membership (fail-closed).
 */
export async function createUserSession(input: { userId: string; activeTenantId?: string; ttlMs?: number }): Promise<{ token: string; sessionId: string; session: ResolvedSession }> {
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } });
  if (!user) throw new Error("createUserSession: user not found");
  const tenantId = await resolveActiveTenant(input.userId, input.activeTenantId);
  if (!tenantId) throw new Error("createUserSession: no valid tenant membership");

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const now = Date.now();
  const expiresAt = new Date(now + (input.ttlMs ?? SESSION_TTL_MS));
  const created = await prisma.userSession.create({ data: { tokenHash, userId: input.userId, activeTenantId: tenantId, expiresAt } });
  const session = await hydrate(created.id, input.userId, tenantId, expiresAt, created.createdAt);
  if (!session.ok) throw new Error(`createUserSession: could not hydrate (${session.reason})`);
  return { token, sessionId: created.id, session: session.session! };
}

/** Load full session context (user + active-tenant membership + role). */
async function hydrate(sessionId: string, userId: string, tenantId: string, expiresAt: Date, sessionCreatedAt?: Date): Promise<ReadSessionResult> {
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    include: { user: true, tenant: true },
  });
  if (!membership) return { ok: false, reason: "membership_missing" };
  // V1.45C1 — fail closed the instant the active tenant is being deleted. Read FRESH on every
  // hydrate (never cached), so a deletion invalidates every in-flight session immediately, and no
  // stale cookie can restore access. The tenant row survives (as `deleting`) until the final cascade.
  if (membership.tenant.deletionState !== "active") return { ok: false, reason: "tenant_deleting" };
  // V1.50C — password-change backstop: a session minted before the last password change is stale.
  const changedAt = membership.user.passwordChangedAt;
  if (sessionCreatedAt && changedAt && changedAt.getTime() > sessionCreatedAt.getTime()) {
    return { ok: false, reason: "password_changed" };
  }
  return {
    ok: true,
    session: {
      sessionId,
      userId: membership.user.id,
      userName: membership.user.name ?? membership.user.email,
      userEmail: membership.user.email,
      emailVerified: membership.user.emailVerifiedAt !== null,
      tenantId: membership.tenant.id,
      tenantName: membership.tenant.name,
      role: membership.role as string,
      expiresAt,
    },
  };
}

/**
 * Validate a raw token and return the bound session context, or a normalized
 * rejection reason. On success, `lastSeenAt` is bumped (no expiry extension).
 */
export async function readUserSession(token: string | null | undefined, now: Date = new Date()): Promise<ReadSessionResult> {
  if (!token) return { ok: false, reason: "unauthenticated" };
  const row = await prisma.userSession.findUnique({ where: { tokenHash: hashSessionToken(token) } });
  if (!row) return { ok: false, reason: "unauthenticated" };
  if (row.revokedAt) return { ok: false, reason: "session_revoked" };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "session_expired" };
  const result = await hydrate(row.id, row.userId, row.activeTenantId, row.expiresAt, row.createdAt);
  if (!result.ok) return result; // membership_missing / password_changed / etc.
  await prisma.userSession.update({ where: { id: row.id }, data: { lastSeenAt: now } });
  return result;
}

/** Revoke a session by its raw token (idempotent). Server-side invalidation. */
export async function revokeUserSession(token: string | null | undefined): Promise<void> {
  if (!token) return;
  await prisma.userSession.updateMany({ where: { tokenHash: hashSessionToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeUserSessionById(sessionId: string): Promise<void> {
  await prisma.userSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/**
 * Rotate to a fresh session (new token), optionally changing the active tenant.
 * The old session is revoked so two identities never coexist. The new tenant is
 * membership-checked. Returns the new raw token.
 */
export async function rotateUserSession(token: string, opts: { activeTenantId?: string } = {}): Promise<{ token: string; sessionId: string; session: ResolvedSession }> {
  const current = await readUserSession(token);
  if (!current.ok || !current.session) throw new Error(`rotateUserSession: current session invalid (${current.reason})`);
  const nextTenant = opts.activeTenantId ?? current.session.tenantId;
  if (!(await assertMembership(current.session.userId, nextTenant))) throw new Error("rotateUserSession: no membership in target tenant");
  const created = await createUserSession({ userId: current.session.userId, activeTenantId: nextTenant });
  await prisma.userSession.update({ where: { id: created.sessionId }, data: { rotatedFromId: current.session.sessionId } });
  await revokeUserSessionById(current.session.sessionId);
  return created;
}
