/**
 * V1.37.4 — account-level sync lease (DB-backed, TTL). Guarantees at most ONE active
 * sync per ConnectedAccount so a manual + scheduled sync of the same account cannot
 * run concurrently. It is NOT a held DB transaction — it is a row with an expiry, so
 * a crashed holder never blocks the account forever (an expired lease is atomically
 * taken over). Tenant-scoped: RLS + an explicit ownership check prevent Tenant A from
 * ever leasing Tenant B's account.
 */
import { withTenantDb } from "./tenant-db";

/** Default lease lifetime. A sync must finish (or heartbeat) within this window. */
export const SYNC_LEASE_TTL_MS = 5 * 60 * 1000;

export interface LeaseHandle {
  id: string;
  connectedAccountId: string;
  holderId: string;
}

/** Postgres unique-violation detector (Prisma P2002 / SQLSTATE 23505). */
function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const meta = (e as { meta?: { code?: string } })?.meta?.code;
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return code === "P2002" || meta === "23505" || /23505|unique constraint|duplicate key/i.test(msg);
}

/**
 * Try to acquire the lease for an account. Returns a handle on success, or null when
 * an active lease is already held (caller should treat as `skipped_locked`) OR the
 * account does not belong to this tenant (denied). Atomic: expired-lease takeover is
 * a single conditional UPDATE; a fresh acquire relies on the unique(connectedAccountId).
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

  const expiresAt = new Date(now.getTime() + ttlMs);

  // 1) Atomically take over an EXPIRED lease (single UPDATE ... WHERE expiresAt < now).
  const took = await withTenantDb(tenantId, (db) => db.syncLease.updateMany({
    where: { connectedAccountId, expiresAt: { lt: now } },
    data: { holderId, acquiredAt: now, expiresAt, heartbeatAt: now },
  }));
  if (took.count === 1) {
    const row = await withTenantDb(tenantId, (db) => db.syncLease.findFirst({ where: { connectedAccountId, holderId }, select: { id: true } }));
    if (row) return { id: row.id, connectedAccountId, holderId };
  }

  // 2) No lease (or a live lease held by someone else): try to create a fresh one.
  try {
    const row = await withTenantDb(tenantId, (db) => db.syncLease.create({
      data: { tenantId, connectedAccountId, holderId, acquiredAt: now, expiresAt, heartbeatAt: now },
      select: { id: true },
    }));
    return { id: row.id, connectedAccountId, holderId };
  } catch (e) {
    if (isUniqueViolation(e)) return null; // an active (non-expired) lease is held
    throw e;
  }
}

/** Extend a held lease's expiry (long syncs). Only the holder may renew. */
export async function heartbeatSyncLease(
  tenantId: string,
  lease: LeaseHandle,
  ttlMs: number = SYNC_LEASE_TTL_MS,
  now: Date = new Date(),
): Promise<boolean> {
  const res = await withTenantDb(tenantId, (db) => db.syncLease.updateMany({
    where: { id: lease.id, holderId: lease.holderId },
    data: { heartbeatAt: now, expiresAt: new Date(now.getTime() + ttlMs) },
  }));
  return res.count === 1;
}

/** Release the lease. Only the holder's row is deleted (idempotent). */
export async function releaseSyncLease(tenantId: string, lease: LeaseHandle): Promise<void> {
  await withTenantDb(tenantId, (db) => db.syncLease.deleteMany({ where: { id: lease.id, holderId: lease.holderId } }));
}
