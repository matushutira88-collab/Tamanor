/**
 * V1.37.4 / V1.58.7 — account-level sync lease (DB-backed, TTL) with a monotonic FENCING token.
 *
 * Guarantees at most ONE active sync per ConnectedAccount so a manual + scheduled sync of the same
 * account cannot run concurrently. It is NOT a held DB transaction — it is a row with an expiry, so a
 * crashed holder never blocks the account forever (an expired lease is atomically taken over).
 *
 * V1.58.7 adds a fencing GENERATION: every acquire/takeover stamps the row with `nextval()` of a
 * monotonic DB sequence (never an app clock). The generation is checked ATOMICALLY on every heartbeat,
 * every release, and every critical account write (see writeAccountIfLeaseHeld in @guardora/sync). A
 * worker whose lease EXPIRED and was taken over by a newer worker therefore carries a LOWER generation
 * and is fenced out of every subsequent write — even if its old, slow request finally returns.
 *
 * Tenant-scoped: RLS + an explicit ownership check prevent Tenant A from ever leasing Tenant B's
 * account. It NEVER logs a token, credential, or holder secret.
 */
import { withTenantDb } from "./tenant-db";

/** Default lease lifetime. A sync must finish (or heartbeat) within this window. */
export const SYNC_LEASE_TTL_MS = 5 * 60 * 1000;

/**
 * V1.69 (Release B / B1) — the ids of a tenant's accounts with an ACTIVE (unexpired) sync lease, i.e.
 * a sync currently in flight. Tenant-scoped (RLS). Drives the "syncing" first-sync state in the UI.
 */
export async function getActiveSyncLeaseAccountIds(tenantId: string, now: Date = new Date()): Promise<string[]> {
  const rows = await withTenantDb(tenantId, (db) =>
    db.syncLease.findMany({ where: { tenantId, expiresAt: { gt: now } }, select: { connectedAccountId: true } }),
  );
  return rows.map((r) => r.connectedAccountId);
}

export interface LeaseHandle {
  id: string;
  connectedAccountId: string;
  holderId: string;
  /** V1.58.7 — monotonic fencing token from the DB sequence. Checked on every critical write. */
  generation: bigint;
  /** When this lease currently expires (advanced by each heartbeat). */
  expiresAt: Date;
}

/**
 * V1.58.7 — raised when a conditional (fencing-checked) DB write matched ZERO rows because this
 * worker no longer owns the lease at its generation: a newer worker took over. It is NEVER a success —
 * the caller must abort further work and mark the run `interrupted`, not `completed`.
 */
export class LeaseLostError extends Error {
  constructor(readonly connectedAccountId: string) {
    super("sync_lease_lost"); // no token/holder/tenant in the message
    this.name = "LeaseLostError";
  }
}

/**
 * Try to acquire the lease for an account. Returns a handle (with its fencing generation) on success,
 * or null when an active lease is already held by someone else (caller treats as `skipped_locked`) OR
 * the account does not belong to this tenant (denied).
 *
 * ATOMIC: a single `INSERT … ON CONFLICT (connectedAccountId) DO UPDATE … WHERE expiresAt < now`
 * statement both creates a fresh lease AND takes over an EXPIRED one, with NO TOCTOU between a check
 * and a write. `generation = nextval(seq)` on the write path issues a strictly-higher token than any
 * displaced holder. If the conflicting row is still LIVE (not expired) the DO UPDATE's WHERE is false,
 * nothing is written, RETURNING is empty → we report "already held" (null).
 *
 * Re-acquire semantics (deterministic): calling acquire again while the lease is LIVE — even from the
 * same holderId — returns null (already held; no new generation). After expiry, a takeover always mints
 * a strictly higher generation, including for the same holderId.
 */
export async function acquireSyncLease(
  tenantId: string,
  connectedAccountId: string,
  holderId: string,
  ttlMs: number = SYNC_LEASE_TTL_MS,
  now: Date = new Date(),
): Promise<LeaseHandle | null> {
  // Ownership guard (RLS): a foreign account reads back as null → denied.
  const owns = await withTenantDb(tenantId, (db) => db.connectedAccount.findFirst({ where: { id: connectedAccountId }, select: { id: true } }));
  if (!owns) return null;

  const id = globalThis.crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + ttlMs);

  // Single atomic upsert-or-takeover. Runs under withTenantDb → RLS applies (INSERT WITH CHECK and the
  // DO UPDATE USING both require tenantId = current_app_tenant_id(), already true for our own account).
  const rows = await withTenantDb(tenantId, (db) => db.$queryRaw<Array<{ id: string; generation: bigint; holderId: string; expiresAt: Date }>>`
    INSERT INTO "sync_leases"
      ("id", "tenantId", "connectedAccountId", "holderId", "acquiredAt", "expiresAt", "heartbeatAt", "generation", "createdAt", "updatedAt")
    VALUES
      (${id}, ${tenantId}, ${connectedAccountId}, ${holderId}, ${now}, ${expiresAt}, ${now}, nextval('sync_lease_generation_seq'), ${now}, ${now})
    ON CONFLICT ("connectedAccountId") DO UPDATE
      SET "holderId" = EXCLUDED."holderId",
          "acquiredAt" = EXCLUDED."acquiredAt",
          "expiresAt" = EXCLUDED."expiresAt",
          "heartbeatAt" = EXCLUDED."heartbeatAt",
          "generation" = nextval('sync_lease_generation_seq'),
          "updatedAt" = EXCLUDED."updatedAt"
      WHERE "sync_leases"."expiresAt" < ${now}
    RETURNING "id", "generation", "holderId", "expiresAt"`);

  const row = rows[0];
  if (!row) return null; // a live lease is held by someone else
  return { id: row.id, connectedAccountId, holderId: row.holderId, generation: row.generation, expiresAt: row.expiresAt };
}

/**
 * Extend a held lease's expiry (long syncs). ONLY the current holder AT ITS GENERATION may renew:
 * the WHERE clause pins id + holderId + generation, so once a newer worker has taken over (bumping the
 * generation) this update matches zero rows. Returns TRUE if renewed, FALSE if the lease was lost.
 */
export async function heartbeatSyncLease(
  tenantId: string,
  lease: LeaseHandle,
  ttlMs: number = SYNC_LEASE_TTL_MS,
  now: Date = new Date(),
): Promise<boolean> {
  const count = await withTenantDb(tenantId, (db) => db.$executeRaw`
    UPDATE "sync_leases"
    SET "heartbeatAt" = ${now}, "expiresAt" = ${new Date(now.getTime() + ttlMs)}, "updatedAt" = ${now}
    WHERE "id" = ${lease.id} AND "holderId" = ${lease.holderId} AND "generation" = ${lease.generation}`);
  return count === 1;
}

/**
 * Release the lease. ONLY the current holder AT ITS GENERATION deletes it (fencing-checked + idempotent).
 * A displaced old worker CANNOT release the new worker's lease. Returns `{ released }`: `false` means the
 * row was already taken over / gone — a STALE ownership state that the caller must NOT log as a clean
 * release.
 */
export async function releaseSyncLease(tenantId: string, lease: LeaseHandle): Promise<{ released: boolean }> {
  const count = await withTenantDb(tenantId, (db) => db.$executeRaw`
    DELETE FROM "sync_leases"
    WHERE "id" = ${lease.id} AND "holderId" = ${lease.holderId} AND "generation" = ${lease.generation}`);
  return { released: count === 1 };
}
