import "server-only";
import {
  withTenant,
  getWatchedAccountsView,
  accountProtectionScore,
  getTenantBilling,
  getTenantEntitlements,
  tokenStorageStatus,
  type WatchedAccountView,
} from "@guardora/db";
import { buildTokenEncryptionFact, type TokenStorageStatus } from "./security-score-facts";
import {
  computeSecurityScore,
  SECURITY_SCORE_THRESHOLDS as TH,
  SECURITY_AUDIT_EVENTS,
  SecurityScoreScope,
  type SecurityScoreInput,
  type SecurityScoreResult,
} from "@guardora/core";
import { writeAudit } from "./audit";
import type { AppSession } from "./auth";

/**
 * S1 — server-side Security Score loader. Gathers ONLY real, tenant-scoped facts
 * (all reads go through `withTenant` under RLS, or the already-tenant-scoped
 * repo helpers), builds the deterministic {@link SecurityScoreInput}, and runs
 * the pure engine. No AI, no network, no fabricated data — where a signal does
 * not exist yet the input flags it so the engine marks it unavailable.
 */
export async function loadSecurityScore(tenantId: string, now: Date = new Date()): Promise<SecurityScoreResult> {
  const input = await loadSecurityScoreInput(tenantId, now);
  return computeSecurityScore(input);
}

/**
 * Compute the score and persist a tenant-scoped, auditable snapshot. The write
 * and its AuditLog entry share one RLS-scoped transaction. `score` is null when
 * the result is insufficient_data — never a fabricated 0. Returns the result.
 */
export async function persistSecurityScoreSnapshot(session: AppSession, now: Date = new Date()): Promise<SecurityScoreResult> {
  const input = await loadSecurityScoreInput(session.tenantId, now);
  const result = computeSecurityScore(input);
  await withTenant(session.tenantId, async (db) => {
    await db.securityScoreSnapshot.create({
      data: {
        tenantId: session.tenantId,
        scope: SecurityScoreScope.Tenant,
        score: result.score, // nullable — insufficient_data persists as null
        status: result.status,
        subscores: result as unknown as object, // full breakdown (dimensions, level, coverage)
        inputs: input as unknown as object, // aggregated counts only — PII-minimal, no raw content
      },
    });
    await writeAudit({
      session,
      db,
      event: SECURITY_AUDIT_EVENTS.scoreSnapshot,
      targetType: "security_score_snapshot",
      metadata: { score: result.score, status: result.status, dimensionsMeasured: result.coverage.dimensionsMeasured, version: result.version },
    });
  });
  return result;
}

export async function loadSecurityScoreInput(tenantId: string, now: Date = new Date()): Promise<SecurityScoreInput> {
  const staleBefore = new Date(now.getTime() - TH.staleSessionDays * 86_400_000);
  const passwordCutoff = new Date(now.getTime() - TH.passwordMaxAgeDays * 86_400_000);
  const incidentStale = new Date(now.getTime() - TH.incidentStaleHours * 3_600_000);
  const approvalStale = new Date(now.getTime() - TH.approvalStaleHours * 3_600_000);
  const highRiskStale = new Date(now.getTime() - TH.highRiskAgedHours * 3_600_000);
  const auditSince = new Date(now.getTime() - TH.auditRecentDays * 86_400_000);
  const syncWindow = new Date(now.getTime() - 2 * 86_400_000);

  // Connector + coverage: reuse the tested watched-accounts view (its own withTenant).
  const watched: WatchedAccountView[] = await getWatchedAccountsView(tenantId, syncWindow);

  const [agg, billing, ent] = await Promise.all([
    withTenant(tenantId, async (db) => {
      const [members, sessions, staleSessions, openIncidents, agedOpenIncidents, pendingApprovals, agedPendingApprovals, highRiskItems, agedUnresolvedHighRisk, auditEntries] = await Promise.all([
        db.membership.findMany({ where: { tenantId }, select: { role: true, user: { select: { emailVerifiedAt: true, passwordHash: true, passwordChangedAt: true } } } }),
        db.userSession.count({ where: { activeTenantId: tenantId, revokedAt: null, expiresAt: { gt: now } } }),
        db.userSession.count({ where: { activeTenantId: tenantId, revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { lt: staleBefore } } }),
        db.incident.count({ where: { tenantId, status: "open" } }),
        db.incident.count({ where: { tenantId, status: "open", createdAt: { lt: incidentStale } } }),
        db.actionQueueItem.count({ where: { tenantId, queueState: "approval_required" } }),
        db.actionQueueItem.count({ where: { tenantId, queueState: "approval_required", createdAt: { lt: approvalStale } } }),
        db.reputationItem.count({ where: { tenantId, riskLevel: { in: ["high", "critical"] as never }, status: { notIn: ["resolved", "actioned"] as never } } }),
        db.reputationItem.count({ where: { tenantId, riskLevel: { in: ["high", "critical"] as never }, status: { notIn: ["resolved", "actioned"] as never }, createdAt: { lt: highRiskStale } } }),
        db.auditLog.count({ where: { tenantId, createdAt: { gte: auditSince } } }),
      ]);
      return { members, sessions, staleSessions, openIncidents, agedOpenIncidents, pendingApprovals, agedPendingApprovals, highRiskItems, agedUnresolvedHighRisk, auditEntries };
    }),
    getTenantBilling(tenantId),
    getTenantEntitlements(tenantId),
  ]);

  // --- Access ---
  const totalMembers = agg.members.length;
  const verifiedMembers = agg.members.filter((m) => m.user.emailVerifiedAt != null).length;
  const ownersAdmins = agg.members.filter((m) => m.role === "owner" || m.role === "admin").length;
  const passwordUserRows = agg.members.filter((m) => m.user.passwordHash != null);
  const passwordUsers = passwordUserRows.length;
  const passwordsOverAge = passwordUserRows.filter((m) => m.user.passwordChangedAt == null || m.user.passwordChangedAt < passwordCutoff).length;

  // --- Connector (from watched accounts) ---
  const totalAccounts = watched.length; // getWatchedAccountsView already excludes disconnected
  const activeAccounts = watched.filter((a) => a.status === "active").length;
  const healthyConnections = watched.filter((a) => a.health === "healthy" && a.connectionStatus === "connected").length;
  const tokenOk = watched.filter((a) => a.tokenHealth === "ok").length;
  const tokenProblem = watched.filter((a) => ["expired", "invalid", "revoked"].includes(a.tokenHealth)).length;
  const tokenExpiringSoon = watched.filter((a) => a.tokenHealth === "expiring_soon").length;
  const monitoringOn = watched.filter((a) => a.monitoringEnabled).length;

  // --- Coverage (aggregate reputation ProtectionScore over monitored accounts) ---
  const monitored = watched.filter((a) => a.monitoringEnabled);
  const protectionScore = monitored.length === 0 ? null : Math.round(monitored.reduce((s, a) => s + accountProtectionScore(a, now).score, 0) / monitored.length);

  // --- Response ---
  const hasActivity = totalAccounts > 0 || agg.highRiskItems > 0 || agg.openIncidents > 0 || agg.pendingApprovals > 0;

  // --- Compliance: explicit token-encryption fact from the central token-crypto
  // seam + explicit deployment signals (never NODE_ENV). tokenStorageStatus()
  // throws on an invalid TOKEN_ENCRYPTION_MODE → treat as unknown (no guess). ---
  let tokenStatus: TokenStorageStatus | null = null;
  try {
    tokenStatus = tokenStorageStatus();
  } catch {
    tokenStatus = null;
  }
  const tokenEncryption = buildTokenEncryptionFact(tokenStatus, process.env);

  return {
    access: {
      totalMembers,
      verifiedMembers,
      ownersAdmins,
      passwordUsers,
      passwordsOverAge,
      activeSessions: agg.sessions,
      staleSessions: agg.staleSessions,
      mfaSupported: false, // no MFA feature yet → engine marks unavailable
      breachDataAvailable: false, // HIBP not persisted → engine marks unavailable
    },
    connector: {
      totalAccounts,
      activeAccounts,
      healthyConnections,
      tokenOk,
      tokenProblem,
      tokenExpiringSoon,
      monitoringOn,
      permissionBaselineAvailable: false, // no historical baseline yet → unavailable
    },
    coverage: { monitoredAccounts: monitored.length, protectionScore },
    response: {
      hasActivity,
      openIncidents: agg.openIncidents,
      agedOpenIncidents: agg.agedOpenIncidents,
      pendingApprovals: agg.pendingApprovals,
      agedPendingApprovals: agg.agedPendingApprovals,
      highRiskItems: agg.highRiskItems,
      agedUnresolvedHighRisk: agg.agedUnresolvedHighRisk,
    },
    compliance: {
      accessState: billing?.accessState ?? "full_access",
      auditEntries: agg.auditEntries,
      dataRetentionConfigured: ent.dataRetentionDays !== 0, // null (unlimited) or a positive cap both count as configured
      tokenEncryption,
    },
  };
}
