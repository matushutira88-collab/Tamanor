/**
 * V1.59 phase 2 — REAL, tenant-scoped, batched dashboard + watched-account metrics. Every number comes
 * from the database (never fabricated); a value the DB cannot supply is simply absent (the UI shows
 * "Nedostupné cez aktuálne oprávnenia" rather than a fake 0). Queries are batched (Promise.all / groupBy)
 * so there is no N+1 across accounts. All reads go through withTenant (RLS) — no cross-tenant leakage.
 */
import { computeProtectionScore, type ProtectionScore } from "@guardora/core";
import { withTenant } from "./repositories";
import { resolveAccountProtection, countMonitoredAccounts, type EffectiveProtection } from "./account-protection";
import { getTenantEntitlements } from "./billing-repo";

export interface DashboardKpis {
  analyzedComments: number;
  riskComments: number;
  autoHidden: number;
  pending: number;
  accountsWithProblem: number;
}

/** The five headline KPIs, all within [since, now]. ONE round-trip (Promise.all) — no N+1. */
export async function getDashboardKpis(tenantId: string, since: Date): Promise<DashboardKpis> {
  return withTenant(tenantId, async (db) => {
    const [analyzedComments, riskComments, autoHidden, pending, accountsWithProblem] = await Promise.all([
      db.reputationItem.count({ where: { tenantId, createdAt: { gte: since } } }),
      db.reputationItem.count({ where: { tenantId, createdAt: { gte: since }, riskLevel: { in: ["high", "critical"] as never } } }),
      db.actionQueueItem.count({ where: { tenantId, queueState: "executed", updatedAt: { gte: since } } }),
      db.actionQueueItem.count({ where: { tenantId, queueState: "approval_required" } }),
      db.connectedAccount.count({ where: {
        tenantId, monitoringEnabled: true, status: { not: "disconnected" },
        OR: [
          { health: { in: ["error", "degraded"] as never } },
          { connectionStatus: { in: ["needs_reconnect", "invalid_token", "missing_permission"] } },
          { tokenHealth: { in: ["expired", "invalid", "revoked"] } },
        ],
      } }),
    ]);
    return { analyzedComments, riskComments, autoHidden, pending, accountsWithProblem };
  });
}

/** Risk comments grouped by category within [since, now]. Real taxonomy only (no invented mapping). */
export async function getRiskByCategory(tenantId: string, since: Date): Promise<Array<{ category: string; count: number }>> {
  return withTenant(tenantId, async (db) => {
    const rows = await db.reputationItem.findMany({
      where: { tenantId, createdAt: { gte: since }, riskLevel: { in: ["high", "critical"] as never } },
      select: { riskCategories: true },
    });
    const tally = new Map<string, number>();
    for (const r of rows) for (const c of r.riskCategories ?? []) tally.set(c, (tally.get(c) ?? 0) + 1);
    return [...tally.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
  });
}

export type AccountProblem = "none" | "permissions_expired" | "sync_failed" | "needs_reconnect" | "monitoring_off";

export interface WatchedAccountView {
  id: string;
  platform: string;
  externalName: string | null;
  externalId: string;
  status: string;
  health: string;
  connectionStatus: string;
  tokenHealth: string;
  monitoringEnabled: boolean;
  lastSuccessfulSyncAt: Date | null;
  parentAccountId: string | null;
  /** Effective (resolved) protection — tenant default unless the account overrides it. */
  protection: EffectiveProtection;
  /** Real comment counts within the window (0 here IS a confirmed zero — the account was queried). */
  commentsInWindow: number;
  riskCommentsInWindow: number;
  problem: AccountProblem;
}

const FRAUD_CATEGORIES = new Set(["fraud", "scam", "phishing", "brand_impersonation"]);
const DANGEROUS_LINK_CATEGORIES = new Set(["phishing", "malicious_link", "dangerous_link", "link_spam", "scam"]);
const RECENT_SYNC_MS = 2 * 86_400_000;

/**
 * Derive the DETERMINISTIC protection-score inputs for one account from its real state + effective
 * protection, then compute the server-side score. Never fabricated — every input is a knowable fact.
 */
export function accountProtectionScore(view: WatchedAccountView, now: Date = new Date()): ProtectionScore {
  const cats = view.protection.autoHideCategories;
  const hasCat = (set: Set<string>) => cats.some((c) => set.has(c));
  return computeProtectionScore({
    metaPermissionsHealthy: view.tokenHealth === "ok" && view.connectionStatus === "connected",
    syncHealthy: view.health === "healthy" && !!view.lastSuccessfulSyncAt && now.getTime() - view.lastSuccessfulSyncAt.getTime() < RECENT_SYNC_MS,
    rulesActive: view.protection.autoHideCategories.length > 0 || view.protection.autoHideEnabled,
    dangerousLinksHandled: hasCat(DANGEROUS_LINK_CATEGORIES),
    fraudProtection: hasCat(FRAUD_CATEGORIES),
    reviewWorkflow: view.protection.requireManualApproval || view.protection.autoHideMode === "manual_approval",
    actionConfigured: view.protection.autoHideMode !== "recommend",
  });
}

function classifyProblem(a: { monitoringEnabled: boolean; health: string; connectionStatus: string; tokenHealth: string }): AccountProblem {
  if (!a.monitoringEnabled) return "monitoring_off";
  if (["expired", "invalid", "revoked"].includes(a.tokenHealth)) return "permissions_expired";
  if (["needs_reconnect", "invalid_token", "missing_permission"].includes(a.connectionStatus)) return "needs_reconnect";
  if (["error", "degraded"].includes(a.health)) return "sync_failed";
  return "none";
}

/**
 * Per-account cards for the Watched Accounts module. Each Facebook Page and each Instagram account is
 * its own card (never merged). Batched: one accounts read + one tenant-defaults read + two groupBy
 * aggregations (comments + risk) for ALL accounts — no per-account N+1.
 */
export async function getWatchedAccountsView(tenantId: string, since: Date): Promise<WatchedAccountView[]> {
  return withTenant(tenantId, async (db) => {
    const [accounts, tenant, commentGroups, riskGroups] = await Promise.all([
      db.connectedAccount.findMany({
        where: { tenantId, status: { not: "disconnected" } },
        select: {
          id: true, platform: true, externalName: true, externalId: true, status: true, health: true,
          connectionStatus: true, tokenHealth: true, monitoringEnabled: true, lastSuccessfulSyncAt: true, parentAccountId: true,
          protectionOverridden: true, autoHideEnabled: true, autoHideMode: true, autoHideRiskThreshold: true,
          autoHideCategories: true, requireManualApproval: true,
        },
      }),
      db.tenant.findUnique({ where: { id: tenantId }, select: {
        defaultAutoHideEnabled: true, defaultAutoHideMode: true, defaultAutoHideRiskThreshold: true,
        defaultAutoHideCategories: true, defaultRequireManualApproval: true,
      } }),
      db.contentItem.groupBy({ by: ["connectedAccountId"], where: { tenantId, ingestedAt: { gte: since } }, _count: { connectedAccountId: true } }),
      db.contentItem.groupBy({ by: ["connectedAccountId"], where: { tenantId, ingestedAt: { gte: since }, reputationItem: { riskLevel: { in: ["high", "critical"] as never } } }, _count: { connectedAccountId: true } }),
    ]);
    const defaults = tenant ?? { defaultAutoHideEnabled: false, defaultAutoHideMode: "recommend", defaultAutoHideRiskThreshold: "high", defaultAutoHideCategories: [], defaultRequireManualApproval: false };
    const comments = new Map(commentGroups.map((g) => [g.connectedAccountId, g._count.connectedAccountId]));
    const risk = new Map(riskGroups.map((g) => [g.connectedAccountId, g._count.connectedAccountId]));

    return accounts.map((a) => ({
      id: a.id, platform: a.platform as unknown as string, externalName: a.externalName, externalId: a.externalId,
      status: a.status as unknown as string, health: a.health as unknown as string,
      connectionStatus: a.connectionStatus, tokenHealth: a.tokenHealth, monitoringEnabled: a.monitoringEnabled,
      lastSuccessfulSyncAt: a.lastSuccessfulSyncAt, parentAccountId: a.parentAccountId,
      protection: resolveAccountProtection(a, defaults),
      commentsInWindow: comments.get(a.id) ?? 0,
      riskCommentsInWindow: risk.get(a.id) ?? 0,
      problem: classifyProblem({ monitoringEnabled: a.monitoringEnabled, health: a.health as unknown as string, connectionStatus: a.connectionStatus, tokenHealth: a.tokenHealth }),
    }));
  });
}

// ---------------------------------------------------------------------------------------------------
// V1.59 2b — the /dashboard/accounts product-table row model + capacity. Connection status and
// monitoring are SEPARATE. "Today" = from the start of the current UTC day (the system-wide convention
// used across the dashboard: setUTCHours(0,0,0,0)); there is no tenant-level timezone field.
// ---------------------------------------------------------------------------------------------------
export type ConnectionStatusView = "connected" | "reconnect_required" | "permissions_expired" | "disconnected" | "sync_error";

export interface DashboardAccountRow {
  id: string;
  platform: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;      // not stored by Meta connector → null (UI shows initials fallback)
  followersCount: number | null; // not stored → null (UI shows "Unavailable via current permissions")
  monitoringEnabled: boolean;
  /** Whether the monitoring switch may ENABLE this account (already-on can always be turned off). */
  monitoringCanBeEnabled: boolean;
  connectionStatus: ConnectionStatusView;
  reconnectRequired: boolean;
  commentsToday: number;
  riskToday: number;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  hasSyncError: boolean;
  parentAccountId: string | null;
}

export interface DashboardAccountsOverview {
  rows: DashboardAccountRow[];
  capacity: { used: number; limit: number; remaining: number };
}

function connectionStatusOf(a: { status: string; health: string; connectionStatus: string; tokenHealth: string }): ConnectionStatusView {
  if (a.status === "disconnected") return "disconnected";
  if (["expired", "invalid", "revoked"].includes(a.tokenHealth)) return "permissions_expired";
  if (["needs_reconnect", "invalid_token", "missing_permission"].includes(a.connectionStatus)) return "reconnect_required";
  if (["error", "degraded"].includes(a.health)) return "sync_error";
  return "connected";
}

/**
 * ONE batched dataset for the accounts table (used by BOTH desktop + mobile). No per-account query:
 * accounts (1) + tenant capacity (1) + today-comments groupBy (1) + today-risk groupBy (1). Tenant-scoped.
 */
export async function getDashboardAccountsOverview(tenantId: string, now: Date = new Date()): Promise<DashboardAccountsOverview> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const ent = await getTenantEntitlements(tenantId);
  const limit = ent.maxConnectedAccounts ?? -1;

  return withTenant(tenantId, async (db) => {
    const [accounts, used, commentGroups, riskGroups] = await Promise.all([
      db.connectedAccount.findMany({
        where: { tenantId, status: { not: "disconnected" } },
        select: {
          id: true, platform: true, externalName: true, externalId: true, status: true, health: true,
          connectionStatus: true, tokenHealth: true, monitoringEnabled: true, lastSuccessfulSyncAt: true, lastSyncedAt: true, parentAccountId: true,
        },
      }),
      countMonitoredAccounts(db, tenantId),
      db.contentItem.groupBy({ by: ["connectedAccountId"], where: { tenantId, ingestedAt: { gte: dayStart } }, _count: { connectedAccountId: true } }),
      db.contentItem.groupBy({ by: ["connectedAccountId"], where: { tenantId, ingestedAt: { gte: dayStart }, reputationItem: { riskLevel: { in: ["high", "critical"] as never } } }, _count: { connectedAccountId: true } }),
    ]);
    const comments = new Map(commentGroups.map((g) => [g.connectedAccountId, g._count.connectedAccountId]));
    const risk = new Map(riskGroups.map((g) => [g.connectedAccountId, g._count.connectedAccountId]));
    const remaining = limit < 0 ? Number.MAX_SAFE_INTEGER : Math.max(0, limit - used);

    const rows: DashboardAccountRow[] = accounts.map((a) => {
      const cs = connectionStatusOf({ status: a.status as unknown as string, health: a.health as unknown as string, connectionStatus: a.connectionStatus, tokenHealth: a.tokenHealth });
      return {
        id: a.id, platform: a.platform as unknown as string, name: a.externalName, username: a.platform as unknown as string === "instagram_business" ? a.externalName : null,
        avatarUrl: null, followersCount: null, monitoringEnabled: a.monitoringEnabled,
        monitoringCanBeEnabled: a.monitoringEnabled || remaining > 0,
        connectionStatus: cs, reconnectRequired: cs === "reconnect_required" || cs === "permissions_expired",
        commentsToday: comments.get(a.id) ?? 0, riskToday: risk.get(a.id) ?? 0,
        lastSuccessAt: a.lastSuccessfulSyncAt, lastAttemptAt: a.lastSyncedAt, hasSyncError: cs === "sync_error",
        parentAccountId: a.parentAccountId,
      };
    });
    return { rows, capacity: { used, limit, remaining: limit < 0 ? -1 : remaining } };
  });
}
