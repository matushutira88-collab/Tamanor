import "server-only";
import {
  readUserSession, withTenant, getTenantBilling, getTenantEntitlements, unreadNotificationCount,
  getDashboardKpis, getDashboardKpiDeltas, getRiskByCategory, getWatchedAccountsView,
  accountProtectionScore, type WatchedAccountView,
} from "@guardora/db";
import { classifyWorkspaceRouting, emitOpsEvent, RiskLevel } from "@guardora/core";
import { computeDeniedNavHrefs } from "@/server/nav-access";
import { getRealModeFilter } from "@/server/data-mode";
import {
  MOBILE_ACTIVITY_TYPES, ACTIVITY_LIMIT,
  type BootstrapDeps, type DashboardDeps, type MobileCheckState, type RawDashboardData,
} from "./mobile-shell";

/**
 * M3 — the ONE wiring of the mobile shell/dashboard service to real server data.
 *
 * Every source here is the SAME function the web dashboard uses. Nothing is
 * re-implemented for mobile: the KPIs, deltas, watched-account view, protection
 * score, risk taxonomy, billing, entitlements and nav gate all come from the
 * existing server modules, so the two surfaces cannot disagree.
 */

const sessionDeps = {
  readUserSession,
  classifyWorkspace: (kind: unknown) => classifyWorkspaceRouting(kind),
  emitOpsEvent,
};

export function realBootstrapDeps(): BootstrapDeps {
  return {
    ...sessionDeps,
    getTenantBilling,
    getTenantEntitlements,
    unreadNotificationCount,
    deniedNavHrefs: computeDeniedNavHrefs,

    /**
     * The three shell counters, in ONE tenant transaction — exactly the batch the
     * web dashboard layout runs, so the mobile badge and the web sidebar badge can
     * never disagree.
     */
    getShellCounters: async (tenantId) => {
      const now = new Date();
      const [period, pendingReview, accountsUsed] = await withTenant(tenantId, (db) =>
        Promise.all([
          db.usagePeriod.findFirst({
            where: { tenantId, periodStart: { lte: now }, periodEnd: { gt: now } },
            select: { basicUnitsUsed: true },
          }),
          db.actionQueueItem.count({ where: { tenantId, queueState: "approval_required" } }),
          db.connectedAccount.count({ where: { tenantId, status: { in: ["active", "mock_connected"] } } }),
        ]),
      );
      return { processedItemsUsed: period?.basicUnitsUsed ?? 0, pendingReview, accountsUsed };
    },
  };
}

/**
 * Aggregate per-account protection into ONE headline + weakest-link checklist.
 *
 * This is a direct port of `aggregateProtection` in the web dashboard page: the
 * score is the mean of the per-account scores from `accountProtectionScore` (itself
 * backed by the tested core `computeProtectionScore`), and a component reads "ok"
 * only when it holds for EVERY monitored account, "partial" for some, "off" for
 * none. Only the check KEY crosses the wire — the app supplies the label.
 */
export function aggregateProtection(
  watched: WatchedAccountView[],
): { score: number; checks: { key: string; state: MobileCheckState }[] } | null {
  const monitored = watched.filter((a) => a.monitoringEnabled);
  if (monitored.length === 0) return null;

  const scored = monitored.map((a) => accountProtectionScore(a));
  const score = Math.round(scored.reduce((sum, p) => sum + p.score, 0) / scored.length);

  const checks = scored[0]!.components.map((component) => {
    const okCount = scored.filter((p) => p.components.find((k) => k.key === component.key)?.ok).length;
    const state: MobileCheckState = okCount === scored.length ? "ok" : okCount > 0 ? "partial" : "off";
    return { key: component.key, state };
  });

  return { score, checks };
}

export function realDashboardDeps(): DashboardDeps {
  return {
    ...sessionDeps,

    loadDashboard: async ({ tenantId, since, prevSince }): Promise<RawDashboardData> => {
      // Same data-mode scoping the web dashboard applies, so a real-mode tenant
      // never sees demo brands leak into mobile.
      const realMode = await getRealModeFilter(tenantId);
      const brandWhere = realMode.brandWhere;

      const [kpi, deltas, categories, watched, trendRows, activity] = await Promise.all([
        getDashboardKpis(tenantId, since, brandWhere),
        getDashboardKpiDeltas(tenantId, prevSince, since, brandWhere),
        getRiskByCategory(tenantId, since, brandWhere),
        getWatchedAccountsView(tenantId, since, brandWhere),
        withTenant(tenantId, (db) =>
          db.reputationItem.findMany({
            where: {
              tenantId, ...brandWhere,
              riskLevel: { in: [RiskLevel.High, RiskLevel.Critical] },
              createdAt: { gte: since },
            },
            select: { createdAt: true },
          }),
        ),
        withTenant(tenantId, (db) =>
          db.auditLog.findMany({
            // Bounded at the QUERY: only the approved activity events are ever read,
            // so no unrelated audit row or its metadata can reach a mobile client.
            where: { tenantId, event: { in: [...MOBILE_ACTIVITY_TYPES] } },
            orderBy: { createdAt: "desc" },
            take: ACTIVITY_LIMIT,
            select: { id: true, event: true, createdAt: true },
          }),
        ),
      ]);

      return {
        kpi,
        deltas,
        categories,
        watched,
        trendDates: trendRows.map((r) => r.createdAt),
        activity,
        protection: aggregateProtection(watched),
        realTestMode: realMode.isRealMode,
      };
    },
  };
}
