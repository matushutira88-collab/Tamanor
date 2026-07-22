/**
 * V1.59 phase 2 — REAL, tenant-scoped, batched dashboard + watched-account metrics. Every number comes
 * from the database (never fabricated); a value the DB cannot supply is simply absent (the UI shows
 * "Nedostupné cez aktuálne oprávnenia" rather than a fake 0). Queries are batched (Promise.all / groupBy)
 * so there is no N+1 across accounts. All reads go through withTenant (RLS) — no cross-tenant leakage.
 */
import {
  computeProtectionScore, type ProtectionScore,
  resolveConnectionState, resolveAutoSyncState, type ConnectionState, type AutoSyncState, type ConnectionStateInput,
} from "@guardora/core";
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
// V1.67.1 — `brandWhere` is the real-mode brand scope (empty `{}` in demo/normal mode → no-op; in
// GUARDORA_DATA_MODE=real it restricts to real brands, `{ brandId: { in: realBrandIds } }`). Applying it here
// keeps the headline KPIs consistent with the brand-scoped risk-trend chart (no cross-brand counting).
export async function getDashboardKpis(tenantId: string, since: Date, brandWhere: Record<string, unknown> = {}): Promise<DashboardKpis> {
  return withTenant(tenantId, async (db) => {
    const [analyzedComments, riskComments, autoHidden, pending, accountsWithProblem] = await Promise.all([
      db.reputationItem.count({ where: { tenantId, ...brandWhere, createdAt: { gte: since } } }),
      db.reputationItem.count({ where: { tenantId, ...brandWhere, createdAt: { gte: since }, riskLevel: { in: ["high", "critical"] as never } } }),
      db.actionQueueItem.count({ where: { tenantId, ...brandWhere, queueState: "executed", updatedAt: { gte: since } } }),
      db.actionQueueItem.count({ where: { tenantId, ...brandWhere, queueState: "approval_required" } }),
      db.connectedAccount.count({ where: {
        tenantId, ...brandWhere, monitoringEnabled: true, status: { not: "disconnected" },
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

/**
 * V1.60 — previous-window counterparts of the three event-based headline KPIs, bounded to
 * [prevSince, since). Kept SEPARATE from getDashboardKpis (which is an unbounded "since now" count)
 * so the dashboard can show an honest period-over-period delta. `pending`/`accountsWithProblem` are
 * live-state metrics with no meaningful historical baseline, so they are intentionally not included.
 */
export interface DashboardKpiDeltas {
  analyzedComments: number;
  riskComments: number;
  autoHidden: number;
}

export async function getDashboardKpiDeltas(tenantId: string, prevSince: Date, since: Date, brandWhere: Record<string, unknown> = {}): Promise<DashboardKpiDeltas> {
  return withTenant(tenantId, async (db) => {
    const prevWindow = { gte: prevSince, lt: since };
    const [analyzedComments, riskComments, autoHidden] = await Promise.all([
      db.reputationItem.count({ where: { tenantId, ...brandWhere, createdAt: prevWindow } }),
      db.reputationItem.count({ where: { tenantId, ...brandWhere, createdAt: prevWindow, riskLevel: { in: ["high", "critical"] as never } } }),
      db.actionQueueItem.count({ where: { tenantId, ...brandWhere, queueState: "executed", updatedAt: prevWindow } }),
    ]);
    return { analyzedComments, riskComments, autoHidden };
  });
}

/** Risk comments grouped by category within [since, now]. Real taxonomy only (no invented mapping). */
export async function getRiskByCategory(tenantId: string, since: Date, brandWhere: Record<string, unknown> = {}): Promise<Array<{ category: string; count: number }>> {
  return withTenant(tenantId, async (db) => {
    const rows = await db.reputationItem.findMany({
      where: { tenantId, ...brandWhere, createdAt: { gte: since }, riskLevel: { in: ["high", "critical"] as never } },
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
  /** V1.75 — canonical, server-authoritative connection + auto-sync state (shared resolver). */
  connectionState: ConnectionState;
  autoSyncState: AutoSyncState;
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

/**
 * V1.75 — the main-dashboard `problem` is now a pure PROJECTION of the ONE canonical
 * connection state (no independent field-combination formula). monitoring_off still wins so a
 * deliberately-unmonitored account is labelled as such rather than as a connection error.
 */
function classifyProblem(state: ConnectionState, monitoringEnabled: boolean): AccountProblem {
  if (!monitoringEnabled) return "monitoring_off";
  switch (state) {
    case "REAUTH_REQUIRED": return "permissions_expired";
    case "DISCONNECTED": return "needs_reconnect";
    case "SYNC_FAILED":
    case "DEGRADED": return "sync_failed";
    default: return "none"; // CONNECTED_HEALTHY | WAITING_FIRST_SYNC
  }
}

/**
 * Per-account cards for the Watched Accounts module. Each Facebook Page and each Instagram account is
 * its own card (never merged). Batched: one accounts read + one tenant-defaults read + two groupBy
 * aggregations (comments + risk) for ALL accounts — no per-account N+1.
 */
export async function getWatchedAccountsView(tenantId: string, since: Date, brandWhere: Record<string, unknown> = {}): Promise<WatchedAccountView[]> {
  return withTenant(tenantId, async (db) => {
    const [accounts, tenant, commentGroups, riskGroups] = await Promise.all([
      db.connectedAccount.findMany({
        where: { tenantId, ...brandWhere, status: { not: "disconnected" } },
        select: {
          id: true, platform: true, externalName: true, externalId: true, status: true, health: true, mode: true,
          connectionStatus: true, tokenHealth: true, tokenExpiresAt: true, lastError: true, lastSyncedAt: true,
          monitoringEnabled: true, lastSuccessfulSyncAt: true, parentAccountId: true,
          protectionOverridden: true, autoHideEnabled: true, autoHideMode: true, autoHideRiskThreshold: true,
          autoHideCategories: true, requireManualApproval: true,
        },
      }),
      db.tenant.findUnique({ where: { id: tenantId }, select: {
        defaultAutoHideEnabled: true, defaultAutoHideMode: true, defaultAutoHideRiskThreshold: true,
        defaultAutoHideCategories: true, defaultRequireManualApproval: true,
      } }),
      db.contentItem.groupBy({ by: ["connectedAccountId"], where: { tenantId, ...brandWhere, ingestedAt: { gte: since } }, _count: { connectedAccountId: true } }),
      db.contentItem.groupBy({ by: ["connectedAccountId"], where: { tenantId, ...brandWhere, ingestedAt: { gte: since }, reputationItem: { riskLevel: { in: ["high", "critical"] as never } } }, _count: { connectedAccountId: true } }),
    ]);
    const defaults = tenant ?? { defaultAutoHideEnabled: false, defaultAutoHideMode: "recommend", defaultAutoHideRiskThreshold: "high", defaultAutoHideCategories: [], defaultRequireManualApproval: false };
    const comments = new Map(commentGroups.map((g) => [g.connectedAccountId, g._count.connectedAccountId]));
    const risk = new Map(riskGroups.map((g) => [g.connectedAccountId, g._count.connectedAccountId]));

    return accounts.map((a) => {
      const stateInput: ConnectionStateInput = {
        status: a.status as unknown as string, mode: a.mode as unknown as string, health: a.health as unknown as string,
        connectionStatus: a.connectionStatus, tokenHealth: a.tokenHealth, tokenExpiresAt: a.tokenExpiresAt,
        lastError: a.lastError, lastSuccessfulSyncAt: a.lastSuccessfulSyncAt, lastSyncedAt: a.lastSyncedAt,
        monitoringEnabled: a.monitoringEnabled,
      };
      const connectionState = resolveConnectionState(stateInput);
      return {
        id: a.id, platform: a.platform as unknown as string, externalName: a.externalName, externalId: a.externalId,
        status: a.status as unknown as string, health: a.health as unknown as string,
        connectionStatus: a.connectionStatus, tokenHealth: a.tokenHealth, monitoringEnabled: a.monitoringEnabled,
        lastSuccessfulSyncAt: a.lastSuccessfulSyncAt,
        connectionState, autoSyncState: resolveAutoSyncState(stateInput),
        parentAccountId: a.parentAccountId,
        protection: resolveAccountProtection(a, defaults),
        commentsInWindow: comments.get(a.id) ?? 0,
        riskCommentsInWindow: risk.get(a.id) ?? 0,
        problem: classifyProblem(connectionState, a.monitoringEnabled),
      };
    });
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
  /** V1.75 — canonical, server-authoritative connection + auto-sync state (the ONE resolver). */
  connectionState: ConnectionState;
  autoSyncState: AutoSyncState;
  reconnectRequired: boolean;
  commentsToday: number;
  riskToday: number;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  hasSyncError: boolean;
  parentAccountId: string | null;
  /** V1.59 hotfix — truthful account kind (from mode/status/permissions), for honest UX naming. */
  accountKind: "real" | "read_only" | "test";
  /** Truthful sync state, SEPARATE from connection: not_active (test) / waiting first run / ok / failed. */
  syncState: "ok" | "waiting_first_sync" | "failed" | "not_active";
}

/** Single source of truth for the account KIND (uses only existing fields — no new DB state). */
function accountKindOf(a: { status: string; mode: string; grantedPermissions: string[] }): "real" | "read_only" | "test" {
  if (a.status === "mock_connected" || a.mode === "placeholder") return "test";
  // A real account that was not granted the engagement permission can read/sync but not act (auto-hide).
  if (a.mode === "read_only" && !a.grantedPermissions.includes("pages_manage_engagement")) return "read_only";
  return "real";
}
function syncStateOf(kind: "real" | "read_only" | "test", cs: ConnectionStatusView, lastSuccessAt: Date | null): "ok" | "waiting_first_sync" | "failed" | "not_active" {
  if (kind === "test") return "not_active";           // demo/test connection → automatic sync is not active
  if (cs === "sync_error") return "failed";           // a REAL attempt failed
  if (!lastSuccessAt) return "waiting_first_sync";    // connected, never synced yet — NOT an error
  return "ok";
}

export interface DashboardAccountsOverview {
  rows: DashboardAccountRow[];
  capacity: { used: number; limit: number; remaining: number };
}

/**
 * V1.59 hotfix — truthful CONNECTION status (separate from monitoring and from sync progress). A never-
 * synced account is NOT an error (its "Last sync" column already shows "Never synchronized" — that is a
 * waiting state, not a failure). Only a REAL failed sync ATTEMPT (health="error" AND a sync was actually
 * attempted) maps to sync_error; a transient `degraded` health is not surfaced as an error.
 */
function connectionStatusView(state: ConnectionState, a: { status: string; tokenHealth: string }): ConnectionStatusView {
  switch (state) {
    case "DISCONNECTED": return "disconnected";
    case "REAUTH_REQUIRED":
      // Preserve the existing copy split: an expired/invalid token reads "permissions expired";
      // a connection-level needs_reconnect reads "reconnect required". Both drive the Reconnect CTA.
      return a.status === "expired" || ["expired", "invalid", "revoked"].includes(a.tokenHealth) ? "permissions_expired" : "reconnect_required";
    case "SYNC_FAILED": return "sync_error";
    // DEGRADED (transient) stays "connected" in this LEGACY projection — the truthful non-green
    // rendering is driven by the canonical `connectionState` field the UI reads for the badge.
    default: return "connected"; // CONNECTED_HEALTHY | WAITING_FIRST_SYNC | DEGRADED
  }
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
          id: true, platform: true, externalName: true, externalId: true, status: true, health: true, mode: true, grantedPermissions: true,
          connectionStatus: true, tokenHealth: true, tokenExpiresAt: true, lastError: true, monitoringEnabled: true, lastSuccessfulSyncAt: true, lastSyncedAt: true, parentAccountId: true,
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
      const stateInput: ConnectionStateInput = {
        status: a.status as unknown as string, mode: a.mode as unknown as string, health: a.health as unknown as string,
        connectionStatus: a.connectionStatus, tokenHealth: a.tokenHealth, tokenExpiresAt: a.tokenExpiresAt,
        lastError: a.lastError, lastSuccessfulSyncAt: a.lastSuccessfulSyncAt, lastSyncedAt: a.lastSyncedAt,
        monitoringEnabled: a.monitoringEnabled,
      };
      const connectionState = resolveConnectionState(stateInput, now);
      // Legacy view is a pure projection of the canonical state (keeps every existing consumer stable).
      const cs = connectionStatusView(connectionState, { status: stateInput.status, tokenHealth: a.tokenHealth });
      const kind = accountKindOf({ status: a.status as unknown as string, mode: a.mode as unknown as string, grantedPermissions: a.grantedPermissions });
      return {
        id: a.id, platform: a.platform as unknown as string, name: a.externalName, username: a.platform as unknown as string === "instagram_business" ? a.externalName : null,
        avatarUrl: null, followersCount: null, monitoringEnabled: a.monitoringEnabled,
        monitoringCanBeEnabled: a.monitoringEnabled || remaining > 0,
        connectionStatus: cs,
        connectionState, autoSyncState: resolveAutoSyncState(stateInput, now),
        reconnectRequired: cs === "reconnect_required" || cs === "permissions_expired",
        commentsToday: comments.get(a.id) ?? 0, riskToday: risk.get(a.id) ?? 0,
        lastSuccessAt: a.lastSuccessfulSyncAt, lastAttemptAt: a.lastSyncedAt, hasSyncError: cs === "sync_error",
        parentAccountId: a.parentAccountId,
        accountKind: kind, syncState: syncStateOf(kind, cs, a.lastSuccessfulSyncAt),
      };
    });
    return { rows, capacity: { used, limit, remaining: limit < 0 ? -1 : remaining } };
  });
}
