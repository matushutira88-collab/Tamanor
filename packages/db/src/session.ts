/**
 * V1.37.1 Secure session core (DB-backed, opaque token) — V1.58.9 lifetime hardening.
 *
 * The single source of truth for identity + active tenant. The web layer
 * (apps/web/src/server/session.ts) wraps these with cookie I/O; nothing else
 * resolves identity. All checks are FAIL-CLOSED:
 *   - the client only ever holds a cryptographically random token,
 *   - only the SHA-256 hash of the token is stored (a raw token is never persisted),
 *   - lookup is by hash; revoked / expired / user-gone / membership-gone → rejected,
 *   - the active tenant is explicit and re-validated against a live membership on every read.
 *
 * V1.58.9 adds SERVER-ENFORCED lifetime limits on top of the opaque token:
 *   - IDLE timeout: a session with no activity for `idleMs` is rejected (`session_expired_idle`).
 *     Activity slides `lastSeenAt` (throttled), so an active session stays alive — but never past…
 *   - ABSOLUTE ceiling: `absoluteExpiresAt` is the hard maximum a session can live regardless of
 *     activity (`session_expired_absolute`). Rotation preserves it (no infinite extension).
 *   - REMEMBER-ME: a persistent login gets the longer absolute ceiling (`rememberMs`).
 * Backward compatible: pre-migration sessions have `absoluteExpiresAt = NULL` and keep their original
 * `expiresAt` lifetime; only the idle check applies to them (active users are unaffected).
 */
import { randomBytes, createHash } from "node:crypto";
import { metrics } from "@guardora/core";
import { prisma } from "./index";

/** Legacy absolute session lifetime constant (kept for backward-compat imports; NEW sessions use the
 *  configured absolute/remember ceiling below). */
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

/** Legacy throttle constant (kept for backward-compat imports). The live throttle is `touchMs`. */
export const LAST_SEEN_THROTTLE_MS = 1000 * 60 * 10; // 10 minutes

/** Server-enforced session lifetime policy (ms). Mirrors @guardora/config getSessionConfig defaults. */
export interface SessionTimeouts {
  idleMs: number;
  absoluteMs: number;
  rememberMs: number;
  touchMs: number;
}

/** Resolve the lifetime policy from env DIRECTLY (db has no dep on @guardora/config). Positive-only;
 *  a garbage/non-positive value falls back to the safe default (the config validator surfaces it). */
export function sessionTimeoutsFromEnv(src: NodeJS.ProcessEnv = process.env): SessionTimeouts {
  const pos = (key: string, def: number) => {
    const n = Number(src[key]);
    return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : def;
  };
  return {
    idleMs: pos("SESSION_IDLE_TIMEOUT_MINUTES", 30) * 60_000,
    absoluteMs: pos("SESSION_ABSOLUTE_TIMEOUT_HOURS", 24) * 3_600_000,
    rememberMs: pos("SESSION_REMEMBER_ME_DAYS", 30) * 86_400_000,
    touchMs: pos("SESSION_ACTIVITY_TOUCH_INTERVAL_SECONDS", 300) * 1_000,
  };
}

export type SessionRejectReason =
  | "unauthenticated"
  | "session_expired"
  // V1.58.9 — server-enforced lifetime rejections (distinct from the token's own `expiresAt`).
  | "session_expired_idle"
  | "session_expired_absolute"
  | "session_revoked"
  | "membership_missing"
  | "user_missing"
  | "tenant_missing"
  | "tenant_deleting"
  | "password_changed";

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  userName: string;
  userEmail: string;
  emailVerified: boolean;
  tenantId: string;
  tenantName: string;
  role: string;
  expiresAt: Date;
  /** V1.58.9 — hard ceiling regardless of activity (null for pre-migration sessions). */
  absoluteExpiresAt: Date | null;
  /** V1.58.9 — persistent ("remember me") login. */
  rememberMe: boolean;
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
 * Deterministically resolve the active tenant for a user (unchanged from V1.45C1): honor an explicit
 * membership-backed request, else the earliest active membership; a `deleting` tenant is never selectable.
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
 * Create a session. Verifies the user + membership in the resolved active tenant. Sets the ABSOLUTE
 * ceiling (`absoluteExpiresAt`) from the policy — the longer `rememberMs` when `rememberMe` is set — and
 * the token `expiresAt` to that ceiling (idle is enforced separately on top). Returns the RAW token.
 *
 * `ttlMs` overrides the token `expiresAt` (test convenience). `absoluteExpiresAt` override lets rotation
 * PRESERVE the original ceiling so a rotated session cannot outlive the absolute maximum.
 */
export async function createUserSession(input: {
  userId: string;
  activeTenantId?: string;
  ttlMs?: number;
  rememberMe?: boolean;
  timeouts?: SessionTimeouts;
  absoluteExpiresAt?: Date;
  now?: Date;
}): Promise<{ token: string; sessionId: string; session: ResolvedSession }> {
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } });
  if (!user) throw new Error("createUserSession: user not found");
  const tenantId = await resolveActiveTenant(input.userId, input.activeTenantId);
  if (!tenantId) throw new Error("createUserSession: no valid tenant membership");

  const t = input.timeouts ?? sessionTimeoutsFromEnv();
  const now = input.now ?? new Date();
  const rememberMe = input.rememberMe ?? false;
  const ceilingMs = rememberMe ? t.rememberMs : t.absoluteMs;
  const absoluteExpiresAt = input.absoluteExpiresAt ?? new Date(now.getTime() + ceilingMs);
  const expiresAt = input.ttlMs != null ? new Date(now.getTime() + input.ttlMs) : absoluteExpiresAt;

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const created = await prisma.userSession.create({
    data: { tokenHash, userId: input.userId, activeTenantId: tenantId, expiresAt, absoluteExpiresAt, rememberMe, lastSeenAt: now },
  });
  const session = await hydrate(created.id, input.userId, tenantId, expiresAt, absoluteExpiresAt, rememberMe, created.createdAt);
  if (!session.ok) throw new Error(`createUserSession: could not hydrate (${session.reason})`);
  return { token, sessionId: created.id, session: session.session! };
}

/** Load full session context (user + active-tenant membership + role). */
async function hydrate(
  sessionId: string, userId: string, tenantId: string, expiresAt: Date,
  absoluteExpiresAt: Date | null, rememberMe: boolean, sessionCreatedAt?: Date,
): Promise<ReadSessionResult> {
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    include: { user: true, tenant: true },
  });
  if (!membership) return { ok: false, reason: "membership_missing" };
  if (membership.tenant.deletionState !== "active") return { ok: false, reason: "tenant_deleting" };
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
      absoluteExpiresAt,
      rememberMe,
    },
  };
}

/**
 * Validate a raw token and return the bound session context, or a normalized rejection reason.
 * Enforcement order: revoked → token expired → ABSOLUTE ceiling → IDLE timeout → membership/etc.
 * On success, `lastSeenAt` slides (throttled) — activity keeps the session alive up to the ceiling.
 */
export async function readUserSession(
  token: string | null | undefined,
  now: Date = new Date(),
  timeouts?: SessionTimeouts,
): Promise<ReadSessionResult> {
  if (!token) return { ok: false, reason: "unauthenticated" };
  const t = timeouts ?? sessionTimeoutsFromEnv();
  const _q0 = Date.now();
  const row = await prisma.userSession.findUnique({ where: { tokenHash: hashSessionToken(token) } });
  metrics.observe("db_query_duration", Date.now() - _q0, { operation: "session_read" });
  if (!row) return { ok: false, reason: "unauthenticated" };
  if (row.revokedAt) return { ok: false, reason: "session_revoked" };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "session_expired" };
  // V1.58.9 — absolute ceiling (null for pre-migration sessions ⇒ skipped, they keep `expiresAt`).
  if (row.absoluteExpiresAt && row.absoluteExpiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "session_expired_absolute" };
  }
  // V1.58.9 — idle timeout: no activity within `idleMs` ⇒ rejected. `lastSeenAt` is the activity marker.
  if (row.lastSeenAt && now.getTime() - row.lastSeenAt.getTime() > t.idleMs) {
    return { ok: false, reason: "session_expired_idle" };
  }
  const result = await hydrate(row.id, row.userId, row.activeTenantId, row.expiresAt, row.absoluteExpiresAt ?? null, row.rememberMe ?? false, row.createdAt);
  if (!result.ok) return result; // membership_missing / password_changed / etc.
  // THROTTLED lastSeenAt slide: only persist when stale by > touchMs. This slides the idle window on
  // activity without a write per request. It never affects the token `expiresAt` or the absolute ceiling.
  if (!row.lastSeenAt || now.getTime() - row.lastSeenAt.getTime() > t.touchMs) {
    await prisma.userSession.update({ where: { id: row.id }, data: { lastSeenAt: now } });
  }
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
 * Rotate to a fresh session (new token), optionally changing the active tenant. The old session is
 * revoked so two identities never coexist (session-fixation safe). V1.58.9: rotation PRESERVES the
 * original absolute ceiling + rememberMe, so a rotated session can never outlive the absolute maximum.
 */
export async function rotateUserSession(token: string, opts: { activeTenantId?: string } = {}): Promise<{ token: string; sessionId: string; session: ResolvedSession }> {
  const current = await readUserSession(token);
  if (!current.ok || !current.session) throw new Error(`rotateUserSession: current session invalid (${current.reason})`);
  const prior = await prisma.userSession.findUnique({ where: { id: current.session.sessionId }, select: { rememberMe: true, absoluteExpiresAt: true } });
  const nextTenant = opts.activeTenantId ?? current.session.tenantId;
  if (!(await assertMembership(current.session.userId, nextTenant))) throw new Error("rotateUserSession: no membership in target tenant");
  const created = await createUserSession({
    userId: current.session.userId,
    activeTenantId: nextTenant,
    rememberMe: prior?.rememberMe ?? false,
    absoluteExpiresAt: prior?.absoluteExpiresAt ?? undefined, // preserve the ceiling — never extend it
  });
  await prisma.userSession.update({ where: { id: created.sessionId }, data: { rotatedFromId: current.session.sessionId } });
  await revokeUserSessionById(current.session.sessionId);
  return created;
}
