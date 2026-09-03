import "server-only";
import { after } from "next/server";
import {
  getDashboardAccountsOverview, getActiveSyncLeaseAccountIds, getTenantEntitlements,
  enableAccountMonitoringWithinLimit, setAccountMonitoring, readUserSession, withTenant,
} from "@guardora/db";
import { EntitlementError, classifyWorkspaceRouting, deriveFirstSyncState, emitOpsEvent, can, Permission } from "@guardora/core";
import { getProductionSafetyConfig } from "@guardora/config";
import { runReadOnlySync, disconnectAccount } from "@guardora/sync";
import { ActorKind } from "@prisma/client";
import type {
  AccountDetailSource, AccountSourceRow, AccountsDeps, AccountsSource,
} from "./mobile-accounts";

/**
 * M6 — the ONE wiring of native Accounts to real server data.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CANONICAL REUSE. Every rule this module needs already exists, so none of them is
 * re-derived here:
 *
 *   list projection  → `getDashboardAccountsOverview` (ONE batched dataset:
 *                       accounts + capacity + today-comments + today-risk)
 *   connection state → `resolveConnectionState`, inside that overview
 *   auto-sync state  → `resolveAutoSyncState`, inside that overview
 *   first-sync state → `deriveFirstSyncState` + `getActiveSyncLeaseAccountIds`
 *   monitoring ON    → `enableAccountMonitoringWithinLimit` (ATOMIC vs. the plan)
 *   monitoring OFF   → `setAccountMonitoring`
 *   manual sync      → `runReadOnlySync` (READ-ONLY; lease-deduplicated)
 *   disconnect       → `disconnectAccount` (cluster + revoke + audit semantics)
 *
 * PROVIDER-WRITE BOUNDARY. The only provider operation reachable from here is the
 * canonical READ-ONLY sync. This module imports no moderation surface: no
 * `attemptFacebookHide`, no hide/delete/reply, no live-action transport.
 *
 * TOKEN BOUNDARY. No query in this file selects `accessToken`, `longLivedToken` or
 * `refreshToken`, and no token can therefore be projected into a DTO.
 * ────────────────────────────────────────────────────────────────────────────
 */

const sessionDeps = {
  readUserSession,
  classifyWorkspace: (kind: unknown) => classifyWorkspaceRouting(kind),
  emitOpsEvent,
};

/** Bounded sync history. The web detail page shows the same window. */
const SYNC_RUN_LIMIT = 10;

/**
 * The presentation columns the canonical overview does NOT carry, fetched for the
 * whole tenant in ONE query and joined in memory. This is deliberately not a
 * per-row read: the list must stay at a fixed number of queries regardless of how
 * many accounts a tenant has.
 *
 * Token columns are absent by construction.
 */
const EXTRA_SELECT = {
  id: true,
  lastError: true,
  requiresReconnectReason: true,
  grantedPermissions: true,
  syncAttempts: true,
} as const;

/** Build the list source: canonical overview + first-sync inputs + extra columns. */
async function loadAccountsSource(tenantId: string): Promise<AccountsSource> {
  const [overview, leaseIds, extras] = await Promise.all([
    getDashboardAccountsOverview(tenantId),
    getActiveSyncLeaseAccountIds(tenantId),
    withTenant(tenantId, (db) =>
      db.connectedAccount.findMany({
        where: { tenantId, status: { not: "disconnected" } },
        select: EXTRA_SELECT,
      }),
    ),
  ]);

  const leases = new Set(leaseIds);
  const extraById = new Map(extras.map((e) => [e.id, e]));

  const rows: AccountSourceRow[] = overview.rows.map((r) => {
    const extra = extraById.get(r.id);
    return {
      id: r.id,
      platform: r.platform,
      name: r.name,
      username: r.username,
      monitoringEnabled: r.monitoringEnabled,
      monitoringCanBeEnabled: r.monitoringCanBeEnabled,
      connectionState: r.connectionState,
      autoSyncState: r.autoSyncState,
      reconnectRequired: r.reconnectRequired,
      commentsToday: r.commentsToday,
      riskToday: r.riskToday,
      lastSuccessAt: r.lastSuccessAt,
      lastAttemptAt: r.lastAttemptAt,
      accountKind: r.accountKind,
      // The canonical first-sync derivation — never inferred from a timestamp alone.
      firstSyncState: deriveFirstSyncState({
        lastSuccessfulSyncAt: r.lastSuccessAt,
        syncAttempts: extra?.syncAttempts ?? 0,
        hasActiveLease: leases.has(r.id),
      }),
      lastError: extra?.lastError ?? null,
      requiresReconnectReason: extra?.requiresReconnectReason ?? null,
      grantedPermissions: extra?.grantedPermissions ?? [],
    };
  });

  // `capacity.used` IS the monitored count: `getDashboardAccountsOverview` computes it
  // with `countMonitoredAccounts`, and `enableAccountMonitoringWithinLimit` enforces the
  // plan's `maxConnectedAccounts` against that same number. Deriving a second count here
  // would risk disagreeing with the limit that is actually enforced.
  return { rows: overview.rows.length ? rows : [], capacity: overview.capacity, monitored: overview.capacity.used };
}

export function realAccountsDeps(): AccountsDeps {
  return {
    ...sessionDeps,

    // The canonical connector permission — not a mobile RBAC copy.
    canManageConnectors: (role) => can(role as Parameters<typeof can>[0], Permission.ConnectorManage),

    listAccounts: ({ tenantId }) => loadAccountsSource(tenantId),

    // Re-reading ONE row goes through the same canonical dataset as the list, so a
    // post-mutation row can never disagree with what the list would have shown.
    getAccountRow: async ({ tenantId, accountId }) => {
      const source = await loadAccountsSource(tenantId);
      return source.rows.find((r) => r.id === accountId) ?? null;
    },

    getCapacity: async ({ tenantId }) => {
      const ent = await getTenantEntitlements(tenantId);
      const limit = ent.maxConnectedAccounts ?? -1;
      const used = await withTenant(tenantId, (db) =>
        db.connectedAccount.count({ where: { tenantId, monitoringEnabled: true, status: { not: "disconnected" } } }),
      );
      const remaining = limit < 0 ? -1 : Math.max(0, limit - used);
      return { used, limit, remaining, monitored: used };
    },

    getAccount: async ({ tenantId, accountId }) => {
      // Tenant-qualified: a foreign id simply reads back as null under RLS, which the
      // handler turns into the same `not_found` a missing id produces.
      const account = await withTenant(tenantId, (db) =>
        db.connectedAccount.findFirst({
          where: { id: accountId, tenantId },
          // Token columns are deliberately NOT selected — they can never be projected.
          select: {
            id: true, platform: true, externalName: true, status: true, mode: true, health: true,
            connectionStatus: true, tokenHealth: true, tokenExpiresAt: true, lastError: true,
            requiresReconnectReason: true, grantedPermissions: true, monitoringEnabled: true,
            lastSuccessfulSyncAt: true, lastSyncedAt: true, lastSuccessfulGraphCheckAt: true,
            killSwitch: true, syncAttempts: true,
            brand: { select: { name: true } },
            syncRuns: {
              orderBy: { startedAt: "desc" }, take: SYNC_RUN_LIMIT,
              select: {
                id: true, status: true, startedAt: true, finishedAt: true,
                fetched: true, created: true, error: true, mock: true,
              },
            },
          },
        }),
      );
      if (!account) return null;

      // The list projection is the source of truth for the shared fields, so detail and
      // list can never disagree about connection state, monitoring or metrics.
      const source = await loadAccountsSource(tenantId);
      const row = source.rows.find((r) => r.id === accountId);
      if (!row) return null;

      const safety = getProductionSafetyConfig();
      const detail: AccountDetailSource = {
        ...row,
        tokenHealth: account.tokenHealth,
        tokenExpiresAt: account.tokenExpiresAt,
        lastSuccessfulGraphCheckAt: account.lastSuccessfulGraphCheckAt,
        killSwitch: account.killSwitch,
        globalKillSwitch: safety.globalKillSwitch,
        brandName: account.brand?.name ?? null,
        syncRuns: account.syncRuns.map((r) => ({
          id: r.id,
          status: r.status as unknown as string,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          fetched: r.fetched,
          created: r.created,
          // Carried only so the projector knows a failure HAPPENED; the text itself is
          // classified into a bounded reason and never forwarded.
          error: r.error,
          mock: r.mock,
        })),
      };
      return detail;
    },

    enableMonitoring: async ({ tenantId, accountId }) => {
      try {
        // ATOMIC against the plan limit: an advisory lock + count + write in ONE
        // transaction. Capacity is never re-checked here, so a forged client flag
        // cannot over-allocate. Repeating an enable is idempotent inside it.
        await enableAccountMonitoringWithinLimit(tenantId, accountId);
        return { ok: true };
      } catch (e) {
        if (e instanceof EntitlementError) return { ok: false, reason: "account_limit_reached" };
        throw e;
      }
    },

    disableMonitoring: ({ tenantId, accountId }) => setAccountMonitoring(tenantId, accountId, false),

    hasActiveSyncLease: async ({ tenantId, accountId }) =>
      (await getActiveSyncLeaseAccountIds(tenantId)).includes(accountId),

    /**
     * Schedule the canonical READ-ONLY sync AFTER the response, exactly as the web
     * `runSyncAction` does. The phone never waits on the provider round trip, and the
     * account-level sync lease inside `runReadOnlySync` is what actually guarantees a
     * double tap cannot start two provider cycles.
     */
    startReadOnlySync: ({ tenantId, accountId }) => {
      after(async () => { await runReadOnlySync({ accountId, tenantId }, "manual").catch(() => {}); });
    },

    disconnectAccount: async ({ tenantId, accountId }) => {
      const result = await disconnectAccount(tenantId, accountId);
      return {
        found: result.account !== null,
        clusterCount: result.cluster.count,
        clusterPlatforms: result.cluster.platforms,
        providerRevoke: result.providerRevocation,
        manualCleanupRecommended: result.manualCleanupRecommended,
      };
    },

    writeAudit: async ({ tenantId, userId, event, targetId, metadata }) => {
      await withTenant(tenantId, (db) =>
        db.auditLog.create({
          data: {
            tenantId, actorKind: ActorKind.human, actorUserId: userId,
            event, targetType: "connected_account", targetId,
            // Bounded, token-free metadata only.
            metadata: metadata as never,
          },
        }),
      );
    },
  };
}
