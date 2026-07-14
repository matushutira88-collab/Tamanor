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
import { Role } from "@prisma/client";
import { withTenantDb, type TenantTx } from "./tenant-db";
import { systemDb } from "./index";

// --------------------------- Tenant repositories ---------------------------

export function listConnectedAccounts(tenantId: string) {
  return withTenantDb(tenantId, (db) => db.connectedAccount.findMany({ orderBy: { createdAt: "desc" } }));
}

export function getConnectedAccount(tenantId: string, id: string) {
  return withTenantDb(tenantId, (db) => db.connectedAccount.findFirst({ where: { id } }));
}

/**
 * Low-level single-row disconnect (tenant-scoped). Returns null for a foreign/absent id
 * (→ not_found, no enumeration).
 *
 * NOTE: This is the DB-layer primitive used by RLS runtime tests. It is NOT the product
 * disconnect path — the canonical, credential-clearing, CLUSTER-aware disconnect lives in
 * `@guardora/sync` `disconnectAccount` (clears the full Meta Page/Instagram token cluster,
 * invalidates leases, and classifies provider revocation). To avoid leaving a credential
 * behind even when this primitive is used directly, it clears the token fields too (a
 * status-only flip would have left a live token on the row — a foot-gun).
 */
export function disconnectConnectedAccount(tenantId: string, id: string): Promise<{ id: string; brandId: string; platform: string } | null> {
  return withTenantDb(tenantId, async (db) => {
    const acc = await db.connectedAccount.findFirst({ where: { id }, select: { id: true, brandId: true, platform: true } });
    if (!acc) return null;
    await db.connectedAccount.update({
      where: { id: acc.id },
      data: {
        status: "disconnected" as ConnectorStatus,
        connectionStatus: "disconnected",
        tokenHealth: "invalid",
        requiresReconnectReason: "disconnected",
        accessToken: null,
        longLivedToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
      },
    });
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
    // V1.45C1 — never surface accounts of a tenant that is being deleted (no new sync/data).
    where: { status: "active", tenant: { deletionState: "active" } },
    select: { id: true, tenantId: true, brandId: true, platform: true },
  });
}

/** Discovery row carrying only the trusted identifiers a tenant job needs. No tokens. */
export interface MetaSyncCandidate {
  id: string;
  tenantId: string;
  brandId: string;
  platform: string;
  externalId: string;
  externalName: string | null;
  pageId: string | null;
  health: string;
  status: string;
  nextRetryAt: Date | null;
}

/** Meta accounts eligible for a read-only sync tick. Cross-tenant discovery only. */
export function findMetaSyncCandidates(statuses: string[]): Promise<MetaSyncCandidate[]> {
  return systemDb.connectedAccount.findMany({
    where: {
      platform: { in: ["facebook_page", "instagram_business"] as never },
      status: { in: statuses as never },
      // V1.45C1 — exclude a deleting tenant so worker auto-sync never picks up its accounts.
      tenant: { deletionState: "active" },
    },
    select: {
      id: true, tenantId: true, brandId: true, platform: true,
      externalId: true, externalName: true, pageId: true, health: true, status: true, nextRetryAt: true,
    },
  }) as Promise<MetaSyncCandidate[]>;
}

/** Count of mock/demo Meta accounts (for real-mode "skipped demo" reporting). */
export function countMockMetaAccounts(): Promise<number> {
  return systemDb.connectedAccount.count({
    where: { platform: { in: ["facebook_page", "instagram_business"] as never }, status: "mock_connected" as never },
  });
}

/** Active Facebook Page accounts for the token watchdog. Cross-tenant discovery; trusted tenantId. */
export function findActiveFacebookAccounts(): Promise<Array<{ id: string; tenantId: string }>> {
  return systemDb.connectedAccount.findMany({
    where: { platform: "facebook_page" as never, status: "active" as never, tenant: { deletionState: "active" } },
    select: { id: true, tenantId: true },
  });
}

/** V1.38 — active Meta accounts (Facebook Page + Instagram) for the connector health monitor. */
export function findActiveMetaAccounts(): Promise<Array<{ id: string; tenantId: string }>> {
  return systemDb.connectedAccount.findMany({
    where: { platform: { in: ["facebook_page", "instagram_business"] as never }, status: "active" as never, tenant: { deletionState: "active" } },
    select: { id: true, tenantId: true },
  });
}

/** Accounts whose OAuth token has an expiry and are currently healthy/unknown. No token material returned. */
export function findAccountsForTokenCheck(): Promise<Array<{ id: string; tenantId: string; brandId: string; platform: string; tokenExpiresAt: Date | null }>> {
  return systemDb.connectedAccount.findMany({
    where: { tokenExpiresAt: { not: null }, health: { in: ["healthy", "unknown"] as never }, tenant: { deletionState: "active" } },
    select: { id: true, tenantId: true, brandId: true, platform: true, tokenExpiresAt: true },
  });
}

/** High/critical items still in triage with no open proposal. Carries trusted tenantId. */
export function findItemsForProposal(limit: number): Promise<Array<{ id: string; tenantId: string; brandId: string }>> {
  return systemDb.reputationItem.findMany({
    where: {
      riskLevel: { in: ["high", "critical"] as never },
      status: { in: ["new", "classified"] as never },
      decisions: { none: { status: { in: ["proposed", "approved"] as never } } },
      // V1.45C1 — never propose new work for a deleting tenant.
      tenant: { deletionState: "active" },
    },
    take: limit,
    select: { id: true, tenantId: true, brandId: true },
  });
}

/** Active accounts matching webhook page IDs. Cross-tenant discovery; trusted tenantId. */
export function findAccountsByExternalIds(externalIds: string[]): Promise<Array<{ id: string; tenantId: string; brandId: string }>> {
  return systemDb.connectedAccount.findMany({
    where: { externalId: { in: externalIds }, platform: "facebook_page" as never, status: "active" as never, tenant: { deletionState: "active" } },
    select: { id: true, tenantId: true, brandId: true },
  });
}

/**
 * V1.38 — resolve active Meta accounts (Facebook Page OR Instagram Business) by their
 * external ids. A webhook entry id may be a Page id (page object) or an IG account id
 * (instagram object) — both are handled by the ONE unified connector. Trusted tenantId.
 */
export function findMetaAccountsByExternalIds(externalIds: string[]): Promise<Array<{ id: string; tenantId: string; brandId: string; platform: string }>> {
  return systemDb.connectedAccount.findMany({
    // V1.45C1 — a webhook whose page/IG id maps to a DELETING tenant's account no longer matches, so
    // the event is marked ignored (never processed) and can never recreate content/accounts.
    where: { externalId: { in: externalIds }, platform: { in: ["facebook_page", "instagram_business"] as never }, status: "active" as never, tenant: { deletionState: "active" } },
    select: { id: true, tenantId: true, brandId: true, platform: true },
  });
}

// ----------------------- V1.45C1 tenant-deletion system helpers -----------------------
// Trusted CLEANUP path: unlike the discovery queries above, these DO reach a `deleting` tenant — they
// are the only queries permitted to, and are used solely by the deletion orchestrator + webhook link.

/** Enumerate ALL connected accounts of a tenant (any status) for orchestrated disconnect cleanup. */
export function findTenantConnectedAccountsForCleanup(tenantId: string): Promise<Array<{ id: string; platform: string; parentAccountId: string | null }>> {
  return systemDb.connectedAccount.findMany({
    where: { tenantId },
    select: { id: true, platform: true, parentAccountId: true },
  });
}

/** Delete ALL sync leases for a tenant (belt-and-suspenders; disconnect already drops per-cluster leases). */
export function deleteTenantSyncLeases(tenantId: string): Promise<{ count: number }> {
  return systemDb.syncLease.deleteMany({ where: { tenantId } });
}

/**
 * V1.45C1 — tenants STRANDED in `deleting` (a crash/timeout after the request transition, which
 * revokes the initiator's session, would otherwise leave the operation with no user able to retry —
 * a deleting tenant is unreachable). `olderThan` skips a fresh deletion still running inline. Carries
 * the trusted server-generated operationId so the system resume runner needs no session. No PII.
 */
export function findTenantsPendingDeletion(olderThan: Date, limit = 50): Promise<Array<{ id: string; deletionOperationId: string | null }>> {
  return systemDb.tenant.findMany({
    where: { deletionState: "deleting", deletionRequestedAt: { lt: olderThan } },
    select: { id: true, deletionOperationId: true },
    orderBy: { deletionRequestedAt: "asc" },
    take: limit,
  });
}

/**
 * V1.45C1 — durably link a matched raw webhook event to its trusted tenant + account (resolved from
 * the matched active account, NEVER from the payload). Best-effort: a link failure never blocks
 * webhook processing. Enables the explicit tenant-deletion purge.
 */
export async function linkWebhookEventToTenant(id: string, tenantId: string, connectedAccountId: string): Promise<void> {
  try {
    await systemDb.webhookEvent.update({ where: { id }, data: { tenantId, connectedAccountId } });
  } catch {
    // non-fatal — the event is still processed; only the durable purge link is best-effort.
  }
}

/**
 * SYSTEM cleanup — delete expired Meta onboarding sessions across ALL tenants.
 * This is genuinely global TTL garbage collection (the rows hold short-lived
 * tokens). It MUST run on the owner client: `meta_onboarding_sessions` has strict
 * FORCE RLS, so `appDb` with no tenant context would match zero rows. This is the
 * sanctioned system-only exception (never a tenant-data mutation).
 */
export function deleteExpiredOnboardingSessions(now: Date): Promise<{ count: number }> {
  return systemDb.metaOnboardingSession.deleteMany({ where: { expiresAt: { lt: now } } });
}

/**
 * `webhook_events` is a GLOBAL table (no tenant column / no RLS) — provider
 * webhooks arrive before any tenant is resolved. These system helpers read and mark
 * events; tenant work that follows is resolved via findAccountsByExternalIds + RLS.
 */
export function listUnprocessedFacebookWebhooks(take: number): Promise<Array<{ id: string; payload: unknown }>> {
  return systemDb.webhookEvent.findMany({
    where: { processed: false, platform: "facebook_page" as never },
    orderBy: { receivedAt: "asc" },
    take,
    select: { id: true, payload: true },
  }) as Promise<Array<{ id: string; payload: unknown }>>;
}

/** Latest inbound webhook for a platform (GLOBAL diagnostic; no tenant column). */
export function getLatestWebhookForPlatform(platform: string): Promise<{ receivedAt: Date; eventType: string | null; signatureValid: boolean } | null> {
  return systemDb.webhookEvent.findFirst({
    where: { platform: platform as never },
    orderBy: { receivedAt: "desc" },
    select: { receivedAt: true, eventType: true, signatureValid: true },
  }) as Promise<{ receivedAt: Date; eventType: string | null; signatureValid: boolean } | null>;
}

/**
 * V1.38.1 — unprocessed Meta webhooks (Facebook Page OR Instagram) that carry a VALID
 * signature. Unsigned/forged events (`signatureValid=false`) are stored for audit but are
 * NEVER processed. Ordered oldest-first for fair draining.
 */
export function listUnprocessedMetaWebhooks(take: number): Promise<Array<{ id: string; payload: unknown; platform: string }>> {
  return systemDb.webhookEvent.findMany({
    where: { processed: false, signatureValid: true, platform: { in: ["facebook_page", "instagram_business"] as never } },
    orderBy: { receivedAt: "asc" },
    take,
    select: { id: true, payload: true, platform: true },
  }) as Promise<Array<{ id: string; payload: unknown; platform: string }>>;
}

export function markWebhookProcessed(id: string, matched: boolean, error?: string): Promise<unknown> {
  return systemDb.webhookEvent.update({
    where: { id },
    data: { processed: true, matched, ...(error !== undefined ? { error } : {}) },
  });
}

/**
 * Record an inbound provider webhook event (global ingestion table, pre-tenant).
 *
 * V1.38.1 — replay/dedup safe: a redelivered event has the same `dedupeKey`
 * (X-Hub-Signature-256 over the raw body), so the unique index rejects the duplicate.
 * On that conflict we return the ORIGINAL row's id with `duplicate:true` — the caller
 * still ACKs 200 without creating a second event or reprocessing.
 */
export async function recordWebhookEvent(
  data: Prisma.WebhookEventCreateInput,
): Promise<{ id: string; duplicate: boolean }> {
  try {
    const row = await systemDb.webhookEvent.create({ data, select: { id: true } });
    return { id: row.id, duplicate: false };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "P2002" && data.dedupeKey) {
      const existing = await systemDb.webhookEvent.findUnique({
        where: { dedupeKey: data.dedupeKey as string },
        select: { id: true },
      });
      if (existing) return { id: existing.id, duplicate: true };
    }
    throw err;
  }
}

// --------------------- Session bootstrap (system, pre-auth) ---------------------
// Used ONLY by the login screen's dev sign-in picker (before any session exists).
// Real auth replaces this; it never runs inside a tenant request.

export function listDevLoginUsers() {
  return systemDb.user.findMany({
    include: { memberships: { include: { tenant: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * V1.42B — TEST-ONLY: idempotently ensure a VIEWER-role member exists in `tenantId`, returning
 * its user id. Callers MUST gate this behind the fail-closed E2E seam; it exists only so the
 * browser suite can prove a viewer cannot mutate the inbox. System-scope (pre-session bootstrap),
 * mirroring `listDevLoginUsers`. Creates no privileged access — a viewer is the least-privileged role.
 */
export async function ensureE2EViewerUser(tenantId: string): Promise<{ id: string }> {
  const email = "e2e-viewer@tamanor.test";
  const user = await systemDb.user.upsert({ where: { email }, create: { email, name: "E2E Viewer" }, update: {} });
  await systemDb.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId } },
    create: { userId: user.id, tenantId, role: Role.viewer },
    update: { role: Role.viewer },
  });
  return { id: user.id };
}

// ------------------------- Global `Lead` table (no tenant) -------------------------
// `leads` is a GLOBAL marketing-capture table with NO tenantId column and NO RLS (platform scope).
// V1.45A: creation is PUBLIC (the /book-demo & /contact forms). Every READ/MUTATE of leads is now
// platform-authorized and lives ONLY in `platform-repo.ts` (`platformListLeads`, `platformGetLeadById`,
// `platformUpdateLead`, `platformGroupLeadsByStatus`). The unguarded read/mutate helpers were REMOVED
// so no tenant request code can reach global prospect PII.

export function createLead(data: Prisma.LeadCreateInput): Promise<{ id: string }> {
  return systemDb.lead.create({ data, select: { id: true } });
}
