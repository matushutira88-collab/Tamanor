import {
  ConnectorHealth,
  ConnectorStatus,
  ActorKind,
  findAccountsForTokenCheck,
} from "@guardora/db";
import { log } from "./logger";
import { newCorrelationId, runTenantJob, type TenantWorkerJob, type TenantTx } from "./job";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * V1.37.3B — proactively flag connections whose OAuth token is expiring/expired so
 * the dashboard can prompt a reconnect BEFORE a sync fails.
 *
 * System discovery finds the accounts (trusted tenantId); the expiry decision is a
 * pure timestamp comparison (no provider HTTP); the status/audit WRITE runs under
 * the account's tenant context via RLS. Tokens are never read or logged.
 */
export async function runTokenExpiryMonitor(): Promise<{ recommended: number; expired: number }> {
  const now = Date.now();
  const accounts = await findAccountsForTokenCheck();

  let recommended = 0;
  let expired = 0;

  for (const a of accounts) {
    const expiry = a.tokenExpiresAt?.getTime();
    if (expiry == null) continue;
    const isExpired = expiry <= now;
    const isExpiringSoon = !isExpired && expiry - now <= SEVEN_DAYS_MS;
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
          where: { id: a.id },
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
      const upd = await db.connectedAccount.updateMany({
        where: { id: a.id },
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

    if (res.ok && res.value === "expired") expired++;
    else if (res.ok && res.value === "recommended") recommended++;
    else if (!res.ok) log.error("worker.token_monitor.item_failed", { reason: res.reason, correlationId: res.correlationId });
  }

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
