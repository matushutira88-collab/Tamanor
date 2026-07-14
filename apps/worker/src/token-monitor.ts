import {
  ConnectorHealth,
  ConnectorStatus,
  ActorKind,
  findAccountsForTokenCheck,
} from "@guardora/db";
import { loadEnv } from "@guardora/config";
import { classifyTokenLifecycle, emitOpsEvent, metrics } from "@guardora/core";
import { log } from "./logger";
import { newCorrelationId, runTenantJob, type TenantWorkerJob, type TenantTx } from "./job";

/**
 * V1.37.3B / V1.46-47 — proactively flag connections whose OAuth token is expiring/expired so the
 * dashboard can prompt a reconnect BEFORE a sync fails. MODE B (monitor + reconnect; NO renewal —
 * Meta Page tokens cannot be independently refreshed and the User token is not retained).
 *
 * System discovery finds the accounts (trusted tenantId, excludes disconnected + deleting tenants);
 * the expiry decision is a PURE timestamp classification (no provider HTTP); the status/audit WRITE
 * runs under the account's tenant context via RLS with a disconnect-guarded CAS. Tokens are never read
 * or logged. Emits bounded ops events + low-cardinality metrics (platform label only).
 */
export async function runTokenExpiryMonitor(): Promise<{ recommended: number; expired: number }> {
  const now = Date.now();
  const warnMs = loadEnv().TOKEN_EXPIRY_WARN_DAYS * 24 * 60 * 60 * 1000;
  const accounts = await findAccountsForTokenCheck();

  let recommended = 0;
  let expired = 0;

  for (const a of accounts) {
    metrics.inc("token_checks_total", { platform: a.platform });
    // Pure, truthful classification — a null expiry is `unknown` (never silently healthy) and is left
    // to the reconnect/UI policy rather than fabricated here; only expired/expires_soon act.
    const lifecycle = classifyTokenLifecycle(a.tokenExpiresAt, now, { warnMs });
    const isExpired = lifecycle === "expired";
    const isExpiringSoon = lifecycle === "expires_soon";
    if (!isExpired && !isExpiringSoon) continue;

    const job: TenantWorkerJob = {
      jobType: "token_check",
      tenantId: a.tenantId,
      connectedAccountId: a.id,
      brandId: a.brandId,
      tokenExpiresAt: a.tokenExpiresAt,
      correlationId: newCorrelationId("token"),
    };

    const res = await runTenantJob(job, async ({ db }) => {
      // Re-scope the write to this account under RLS. updateMany avoids a not-found
      // throw if the row moved out of scope between discovery and execution.
      if (isExpired) {
        const upd = await db.connectedAccount.updateMany({
          // V1.45B — never flip a user-disconnected account back to expired/degraded.
          where: { id: a.id, status: { not: ConnectorStatus.disconnected } },
          data: {
            status: ConnectorStatus.expired,
            health: ConnectorHealth.degraded,
            lastError: "Reconnect required",
            lastErrorAt: new Date(),
          },
        });
        if (upd.count === 0) return "none" as const;
        await audit(db, a, "token.expired");
        return "expired" as const;
      }
      // (expires-soon branch below)
      const upd = await db.connectedAccount.updateMany({
        where: { id: a.id, status: { not: ConnectorStatus.disconnected } },
        data: {
          health: ConnectorHealth.degraded,
          lastError: "Reconnect recommended",
          lastErrorAt: new Date(),
        },
      });
      if (upd.count === 0) return "none" as const;
      await audit(db, a, "token.reconnect_recommended");
      return "recommended" as const;
    });

    if (res.ok && res.value === "expired") {
      expired++;
      metrics.inc("token_expired_total", { platform: a.platform });
      metrics.inc("reconnect_required_total", { platform: a.platform });
      // Bounded ops event: an expired token has stopped sync — reconnect is required (no PII/token).
      emitOpsEvent("provider.token_expired", { platform: a.platform, operation: "token_monitor", correlationId: job.correlationId });
    } else if (res.ok && res.value === "recommended") {
      recommended++;
      metrics.inc("token_expiring_total", { platform: a.platform });
      emitOpsEvent("provider.token_expires_soon", { platform: a.platform, operation: "token_monitor", correlationId: job.correlationId });
    } else if (!res.ok) {
      log.error("worker.token_monitor.item_failed", { reason: res.reason, correlationId: res.correlationId });
    }
  }

  metrics.setGauge("accounts_reconnect_required", expired);
  if (recommended > 0 || expired > 0) {
    log.info("worker.token_monitor", { recommended, expired });
  }
  return { recommended, expired };
}

async function audit(
  db: TenantTx,
  a: { id: string; tenantId: string; brandId: string; platform: string },
  event: string,
): Promise<void> {
  await db.auditLog.create({
    data: {
      tenantId: a.tenantId,
      brandId: a.brandId,
      event,
      actorKind: ActorKind.system,
      targetType: "connected_account",
      targetId: a.id,
      // No token material — only the platform + the event.
      metadata: { platform: a.platform },
    },
  });
}
