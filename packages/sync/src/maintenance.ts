/**
 * V1.58.8 — maintenance jobs as SHORT, idempotent, Cron-invoked functions (no persistent worker).
 * `runMaintenanceTick()` runs every maintenance job ONCE, bounded, with per-job isolation (one failing
 * job never aborts the others). Each underlying operation is already batch-bounded + crash-resumable +
 * multi-invocation safe, so running them from a Vercel Cron is equivalent to the old worker tick.
 *
 * Relocated/ported from the retired worker (token monitor + proposals use the shared tenant-job wrapper;
 * onboarding cleanup / webhook retention / meta health / auth-token cleanup / trial sweep / stripe purge
 * / tenant-deletion resume call the same repository primitives). No token/PII is ever logged.
 */
import {
  ConnectorHealth, ConnectorStatus, ActorKind, DecisionStatus, ModerationAction, ReputationStatus,
  findAccountsForTokenCheck, findItemsForProposal, findActiveMetaAccounts,
  deleteExpiredOnboardingSessions, minimizeWebhookPayloads, purgeExpiredWebhookEvents,
  cleanupExpiredAuthTokens, sweepTrialExpirations, sweepTrialEndingNotifications, purgeStripeWebhookEvents,
} from "@guardora/db";
import { loadEnv, getWebhookRetentionConfig } from "@guardora/config";
import { classifyTokenLifecycle, emitOpsEvent, metrics } from "@guardora/core";
import { runTenantJob, newCorrelationId, type TenantWorkerJob, type TenantTx } from "./tenant-job";
import { syncMetaAccountState } from "./meta-connector";
import { resumePendingTenantDeletions } from "./tenant-deletion";

const DAY_MS = 86_400_000;
const MAX_ROUNDS = 20;

// ---------------------------------------------------------------------------------------------------
// Token expiry monitor (ported) — flag connections whose OAuth token is expiring/expired (MODE B).
// ---------------------------------------------------------------------------------------------------
export async function runTokenExpiryMonitor(): Promise<{ recommended: number; expired: number }> {
  const now = Date.now();
  const warnMs = loadEnv().TOKEN_EXPIRY_WARN_DAYS * DAY_MS;
  const accounts = await findAccountsForTokenCheck();
  let recommended = 0, expired = 0;

  for (const a of accounts) {
    metrics.inc("token_checks_total", { platform: a.platform });
    const lifecycle = classifyTokenLifecycle(a.tokenExpiresAt, now, { warnMs });
    const isExpired = lifecycle === "expired";
    const isExpiringSoon = lifecycle === "expires_soon";
    if (!isExpired && !isExpiringSoon) continue;

    const job: TenantWorkerJob = {
      jobType: "token_check", tenantId: a.tenantId, connectedAccountId: a.id, brandId: a.brandId,
      tokenExpiresAt: a.tokenExpiresAt, correlationId: newCorrelationId("token"),
    };
    const res = await runTenantJob(job, async ({ db }) => {
      if (isExpired) {
        const upd = await db.connectedAccount.updateMany({
          where: { id: a.id, status: { not: ConnectorStatus.disconnected } },
          data: { status: ConnectorStatus.expired, health: ConnectorHealth.degraded, lastError: "Reconnect required", lastErrorAt: new Date() },
        });
        if (upd.count === 0) return "none" as const;
        await auditAccount(db, a, "token.expired");
        return "expired" as const;
      }
      const upd = await db.connectedAccount.updateMany({
        where: { id: a.id, status: { not: ConnectorStatus.disconnected } },
        data: { health: ConnectorHealth.degraded, lastError: "Reconnect recommended", lastErrorAt: new Date() },
      });
      if (upd.count === 0) return "none" as const;
      await auditAccount(db, a, "token.reconnect_recommended");
      return "recommended" as const;
    });

    if (res.ok && res.value === "expired") {
      expired++; metrics.inc("token_expired_total", { platform: a.platform });
      emitOpsEvent("provider.token_expired", { platform: a.platform, operation: "token_monitor", correlationId: job.correlationId });
    } else if (res.ok && res.value === "recommended") {
      recommended++; metrics.inc("token_expiring_total", { platform: a.platform });
      emitOpsEvent("provider.token_expires_soon", { platform: a.platform, operation: "token_monitor", correlationId: job.correlationId });
    }
  }
  metrics.setGauge("accounts_reconnect_required", expired);
  return { recommended, expired };
}

async function auditAccount(db: TenantTx, a: { id: string; tenantId: string; brandId: string; platform: string }, event: string): Promise<void> {
  await db.auditLog.create({
    data: { tenantId: a.tenantId, brandId: a.brandId, event, actorKind: ActorKind.system, targetType: "connected_account", targetId: a.id, metadata: { platform: a.platform } },
  });
}

// ---------------------------------------------------------------------------------------------------
// Proposals (ported) — PROPOSE (never execute) a hide for high/critical items still in triage.
// ---------------------------------------------------------------------------------------------------
export const AUTO_EXECUTION_ENABLED = false;
export async function proposeForHighRiskItems(limit = 20): Promise<number> {
  const candidates = await findItemsForProposal(limit);
  let created = 0;
  for (const c of candidates) {
    const job: TenantWorkerJob = { jobType: "propose", tenantId: c.tenantId, brandId: c.brandId, reputationItemId: c.id, correlationId: newCorrelationId("propose") };
    const res = await runTenantJob(job, async ({ db }) => {
      const item = await db.reputationItem.findFirst({ where: { id: c.id } });
      if (!item) return false;
      const stillEligible = (item.status === ReputationStatus.new || item.status === ReputationStatus.classified) && !item.requiresApproval;
      if (!stillEligible) return false;
      const already = await db.moderationDecision.findFirst({ where: { reputationItemId: item.id, status: { in: [DecisionStatus.proposed, DecisionStatus.approved] } }, select: { id: true } });
      if (already) return false;
      await db.moderationDecision.create({
        data: {
          tenantId: item.tenantId, brandId: item.brandId, reputationItemId: item.id, action: ModerationAction.hide,
          status: DecisionStatus.proposed, proposedByKind: ActorKind.ai, confidence: item.riskConfidence,
          riskSnapshot: { level: item.riskLevel, confidence: item.riskConfidence, categories: item.riskCategories, sentiment: item.sentiment },
          reason: "Auto-proposed for high-risk item (awaiting human approval, not executed).",
        },
      });
      await db.reputationItem.update({ where: { id: item.id }, data: { status: ReputationStatus.needs_approval, requiresApproval: true } });
      await db.auditLog.create({ data: { tenantId: item.tenantId, brandId: item.brandId, event: "proposal.created", actorKind: ActorKind.system, targetType: "reputation_item", targetId: item.id, metadata: { action: "hide", proposedBy: "ai", auto: true } } });
      return true;
    });
    if (res.ok && res.value) created++;
  }
  return created;
}

// ---------------------------------------------------------------------------------------------------
// Thin wrappers around the batch-bounded repository primitives.
// ---------------------------------------------------------------------------------------------------
export async function cleanupExpiredOnboarding(now: Date = new Date()): Promise<number> {
  return (await deleteExpiredOnboardingSessions(now)).count;
}

export async function runWebhookRetentionTick(now: Date = new Date()): Promise<{ minimized: number; deleted: number }> {
  const cfg = getWebhookRetentionConfig();
  const maxPayloadAgeCutoff = new Date(now.getTime() - cfg.maxPayloadAgeDays * DAY_MS);
  const rowTtlCutoff = new Date(now.getTime() - cfg.rowTtlDays * DAY_MS);
  let minimized = 0;
  for (let r = 0; r < MAX_ROUNDS; r++) { const n = await minimizeWebhookPayloads({ maxPayloadAgeCutoff, batch: cfg.purgeBatch }); minimized += n; if (n < cfg.purgeBatch) break; }
  let deleted = 0;
  for (let r = 0; r < MAX_ROUNDS; r++) { const n = await purgeExpiredWebhookEvents({ rowTtlCutoff, batch: cfg.purgeBatch, maxPayloadAgeCutoff }); deleted += n; if (n < cfg.purgeBatch) break; }
  return { minimized, deleted };
}

export async function runMetaConnectorHealth(): Promise<{ enabled: boolean; checked: number; changed: number }> {
  if ((process.env.META_CONNECTOR_HEALTH ?? "").trim() !== "true") return { enabled: false, checked: 0, changed: 0 };
  const accounts = await findActiveMetaAccounts();
  let changed = 0;
  for (const a of accounts) {
    try { const res = await syncMetaAccountState(a.tenantId, a.id); if (res.changed) changed++; } catch { /* isolated; no PII */ }
  }
  return { enabled: true, checked: accounts.length, changed };
}

// ---------------------------------------------------------------------------------------------------
// The whole maintenance tick — every job once, bounded, per-job isolated. Returns a safe summary.
// ---------------------------------------------------------------------------------------------------
export interface MaintenanceSummary {
  tokenExpiry: { recommended: number; expired: number } | { failed: true };
  onboardingCleanup: number | { failed: true };
  authTokenCleanup: { verificationRemoved: number; resetRemoved: number } | { failed: true };
  webhookRetention: { minimized: number; deleted: number } | { failed: true };
  trialSweep: number | { failed: true };
  trialEndingNotify: number | { failed: true };
  stripePurge: number | { failed: true };
  metaHealth: { enabled: boolean; checked: number; changed: number } | { failed: true };
  tenantDeletionResume: { pending: number; resumed: number; failed: number } | { failed: true };
  proposals: number | { failed: true };
}

async function guard<T>(op: string, fn: () => Promise<T>): Promise<T | { failed: true }> {
  try { return await fn(); }
  catch (err) { emitOpsEvent("worker.maintenance_failed", { operation: op, reason: err instanceof Error ? err.name : "unknown" }); return { failed: true }; }
}

export async function runMaintenanceTick(now: Date = new Date()): Promise<MaintenanceSummary> {
  return {
    tokenExpiry: await guard("token_monitor", () => runTokenExpiryMonitor()),
    onboardingCleanup: await guard("onboarding_cleanup", () => cleanupExpiredOnboarding(now)),
    authTokenCleanup: await guard("auth_token_cleanup", () => cleanupExpiredAuthTokens({ now })),
    webhookRetention: await guard("webhook_retention", () => runWebhookRetentionTick(now)),
    trialSweep: await guard("trial_sweep", () => sweepTrialExpirations(now)),
    trialEndingNotify: await guard("trial_ending_notify", () => sweepTrialEndingNotifications(now)),
    stripePurge: await guard("stripe_purge", () => purgeStripeWebhookEvents(new Date(now.getTime() - 90 * DAY_MS))),
    metaHealth: await guard("meta_health", () => runMetaConnectorHealth()),
    tenantDeletionResume: await guard("tenant_deletion_resume", () => resumePendingTenantDeletions().then((r) => ({ pending: r.pending, resumed: r.resumed, failed: r.failed }))),
    proposals: await guard("proposals", () => proposeForHighRiskItems()),
  };
}
