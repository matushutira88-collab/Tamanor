/**
 * V1.37.3 — tenant repositories (RLS runtime) + explicit system-level access.
 *
 * Tenant repositories run every query through `withTenantDb` on the non-superuser
 * `appDb` client, so Postgres RLS enforces isolation even if a `where:{tenantId}`
 * is forgotten. These are the real functions server actions/pages call AND the
 * runtime tests exercise. System functions (worker discovery) are explicitly
 * cross-tenant, narrow, and grep-auditable — never used from tenant request code.
 */
import type { Prisma, ConnectorStatus } from "@prisma/client";
import { withTenantDb, type TenantTx } from "./tenant-db";
import { systemDb } from "./index";

// --------------------------- Tenant repositories ---------------------------

export function listConnectedAccounts(tenantId: string) {
  return withTenantDb(tenantId, (db) => db.connectedAccount.findMany({ orderBy: { createdAt: "desc" } }));
}

export function getConnectedAccount(tenantId: string, id: string) {
  return withTenantDb(tenantId, (db) => db.connectedAccount.findFirst({ where: { id } }));
}

/** Disconnect an account. Returns null for a foreign/absent id (→ not_found, no enumeration). */
export function disconnectConnectedAccount(tenantId: string, id: string): Promise<{ id: string; brandId: string; platform: string } | null> {
  return withTenantDb(tenantId, async (db) => {
    const acc = await db.connectedAccount.findFirst({ where: { id }, select: { id: true, brandId: true, platform: true } });
    if (!acc) return null;
    await db.connectedAccount.update({ where: { id: acc.id }, data: { status: "disconnected" as ConnectorStatus } });
    return acc;
  });
}

export function getActionQueueItem(tenantId: string, id: string) {
  return withTenantDb(tenantId, (db) => db.actionQueueItem.findFirst({ where: { id } }));
}

export function listReputationItems(tenantId: string, where: Prisma.ReputationItemWhereInput = {}, take = 500) {
  return withTenantDb(tenantId, (db) => db.reputationItem.findMany({ where, take, orderBy: { createdAt: "desc" } }));
}

export function listTenantAudit(tenantId: string, take = 100) {
  return withTenantDb(tenantId, (db) => db.auditLog.findMany({ take, orderBy: { createdAt: "desc" } }));
}

/** Run arbitrary tenant work under RLS (per-account worker job / multi-op action). */
export function withTenant<T>(tenantId: string, fn: (db: TenantTx) => Promise<T>): Promise<T> {
  return withTenantDb(tenantId, fn);
}

// ----------------------- System-level (cross-tenant) -----------------------
// EXPLICITLY cross-tenant. Only for worker discovery / scheduled jobs. Never call
// from a tenant request path. Returns trusted tenantId for downstream withTenantDb.

export function findSyncCandidates(): Promise<Array<{ id: string; tenantId: string; brandId: string; platform: string }>> {
  return systemDb.connectedAccount.findMany({
    where: { status: "active" },
    select: { id: true, tenantId: true, brandId: true, platform: true },
  });
}
