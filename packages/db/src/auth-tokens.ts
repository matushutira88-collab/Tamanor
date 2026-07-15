import { randomBytes, createHash } from "node:crypto";
import { systemDb } from "./index";

/**
 * V1.50C — one-time email verification & password reset tokens.
 *
 * Design mirrors the session token: a 256-bit opaque RAW token is delivered to the user
 * (by email); only its SHA-256 hash is stored. The raw token NEVER touches the DB, logs,
 * or telemetry. Consumption is a single atomic guarded UPDATE (count === 1 wins), so it is
 * one-time and race-safe under concurrent clicks. Distinct from session tokens/tables.
 */

export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
export const RESET_TTL_MS = 60 * 60 * 1000; // 1h

/** SHA-256 hex of the raw token. Deterministic, one-way. Never store the raw token. */
export function hashAuthToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}
function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

export type ConsumeReason = "invalid" | "expired" | "consumed";
export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: ConsumeReason };

// ---- Email verification ----------------------------------------------------

/**
 * Issue a fresh verification token, invalidating any earlier active tokens for the user
 * (resend replaces, never accumulates). Returns the RAW token + expiry for the email link.
 */
export async function createEmailVerificationToken(userId: string): Promise<{ rawToken: string; expiresAt: Date }> {
  const now = new Date();
  await systemDb.emailVerificationToken.updateMany({
    where: { userId, consumedAt: null },
    data: { consumedAt: now },
  });
  const rawToken = generateRawToken();
  const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_MS);
  await systemDb.emailVerificationToken.create({ data: { tokenHash: hashAuthToken(rawToken), userId, expiresAt } });
  return { rawToken, expiresAt };
}

/**
 * Consume a verification token and mark the user verified. Idempotent + race-safe: the
 * atomic guarded update means exactly one concurrent request wins; setting emailVerifiedAt
 * is a no-op if already verified. Returns a truthful reason on failure.
 */
export async function consumeEmailVerificationToken(rawToken: string): Promise<ConsumeResult> {
  const tokenHash = hashAuthToken(rawToken);
  const now = new Date();
  const guarded = await systemDb.emailVerificationToken.updateMany({
    where: { tokenHash, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (guarded.count !== 1) return { ok: false, reason: await classify(systemDb.emailVerificationToken, tokenHash, now) };
  const row = await systemDb.emailVerificationToken.findUnique({ where: { tokenHash }, select: { userId: true } });
  if (!row) return { ok: false, reason: "invalid" };
  // Idempotent: only sets when currently null.
  await systemDb.user.updateMany({ where: { id: row.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } });
  return { ok: true, userId: row.userId };
}

// ---- Password reset --------------------------------------------------------

export async function createPasswordResetToken(userId: string): Promise<{ rawToken: string; expiresAt: Date }> {
  const now = new Date();
  await systemDb.passwordResetToken.updateMany({
    where: { userId, consumedAt: null },
    data: { consumedAt: now },
  });
  const rawToken = generateRawToken();
  const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
  await systemDb.passwordResetToken.create({ data: { tokenHash: hashAuthToken(rawToken), userId, expiresAt } });
  return { rawToken, expiresAt };
}

/**
 * Atomically reset a password: consume the token, set the new Argon2id hash +
 * passwordChangedAt, and revoke EVERY existing session for the user — all in one
 * transaction (any failure rolls back, leaving the old password + token valid). No new
 * session is created. Race-safe under concurrent resets (guarded consume; one winner).
 */
export async function resetPasswordWithToken(rawToken: string, newPasswordHash: string): Promise<ConsumeResult> {
  const tokenHash = hashAuthToken(rawToken);
  const now = new Date();
  try {
    return await systemDb.$transaction(async (tx) => {
      const guarded = await tx.passwordResetToken.updateMany({
        where: { tokenHash, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (guarded.count !== 1) {
        // Throw to roll back; the reason is classified from a fresh read outside the tx.
        throw new ResetGuardError();
      }
      const row = await tx.passwordResetToken.findUnique({ where: { tokenHash }, select: { userId: true } });
      if (!row) throw new ResetGuardError();
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash: newPasswordHash, passwordChangedAt: now } });
      await tx.userSession.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } });
      return { ok: true as const, userId: row.userId };
    });
  } catch (e) {
    if (e instanceof ResetGuardError) return { ok: false, reason: await classify(systemDb.passwordResetToken, tokenHash, new Date()) };
    throw e;
  }
}

class ResetGuardError extends Error {}

// ---- shared helpers --------------------------------------------------------

type TokenDelegate = {
  findUnique(args: { where: { tokenHash: string }; select: { consumedAt: true; expiresAt: true } }): Promise<{ consumedAt: Date | null; expiresAt: Date } | null>;
};

/** Truthful failure classification for a token that did not consume. */
async function classify(delegate: TokenDelegate, tokenHash: string, now: Date): Promise<ConsumeReason> {
  const row = await delegate.findUnique({ where: { tokenHash }, select: { consumedAt: true, expiresAt: true } });
  if (!row) return "invalid";
  if (row.consumedAt) return "consumed";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "invalid";
}

// ---- maintenance cleanup ---------------------------------------------------

/**
 * Delete expired OR consumed auth tokens in bounded, index-backed batches. Idempotent and
 * safe for concurrent workers (id-scoped deletes). Never an unbounded deleteMany over the
 * whole table. Returns the count removed (summary logging only — no token material).
 */
export async function cleanupExpiredAuthTokens(opts: { batchSize?: number; maxBatches?: number; now?: Date } = {}): Promise<{ verificationRemoved: number; resetRemoved: number }> {
  const batchSize = Math.min(Math.max(opts.batchSize ?? 500, 1), 5000);
  const maxBatches = Math.min(Math.max(opts.maxBatches ?? 20, 1), 1000);
  const now = opts.now ?? new Date();
  const stale = { OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }] };

  let verificationRemoved = 0;
  let resetRemoved = 0;
  for (let i = 0; i < maxBatches; i++) {
    const ids = await systemDb.emailVerificationToken.findMany({ where: stale, select: { id: true }, take: batchSize });
    if (ids.length === 0) break;
    const del = await systemDb.emailVerificationToken.deleteMany({ where: { id: { in: ids.map((r) => r.id) } } });
    verificationRemoved += del.count;
    if (ids.length < batchSize) break;
  }
  for (let i = 0; i < maxBatches; i++) {
    const ids = await systemDb.passwordResetToken.findMany({ where: stale, select: { id: true }, take: batchSize });
    if (ids.length === 0) break;
    const del = await systemDb.passwordResetToken.deleteMany({ where: { id: { in: ids.map((r) => r.id) } } });
    resetRemoved += del.count;
    if (ids.length < batchSize) break;
  }
  return { verificationRemoved, resetRemoved };
}
