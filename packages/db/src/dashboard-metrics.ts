/**
 * V1.59 phase 2 — REAL, tenant-scoped, batched dashboard + watched-account metrics. Every number comes
 * from the database (never fabricated); a value the DB cannot supply is simply absent (the UI shows
 * "Nedostupné cez aktuálne oprávnenia" rather than a fake 0). Queries are batched (Promise.all / groupBy)
 * so there is no N+1 across accounts. All reads go through withTenant (RLS) — no cross-tenant leakage.
 */
import { computeProtectionScore, type ProtectionScore } from "@guardora/core";
import { withTenant } from "./repositories";
import { resolveAccountProtection, type EffectiveProtection } from "./account-protection";

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
