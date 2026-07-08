import {
  prisma,
  ConnectorHealth,
  ConnectorStatus,
  ActorKind,
} from "@guardora/db";
import { log } from "./logger";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Proactively flag connections whose OAuth token is expiring or expired, so the
 * dashboard can prompt a reconnect BEFORE a sync fails.
 *
 * Only transitions accounts that are currently healthy/unknown (so it does not
 * re-audit the same account every tick). Tokens are never read or logged here.
 */
export async function runTokenExpiryMonitor(): Promise<{
  recommended: number;
  expired: number;
}> {
  const now = Date.now();
  const accounts = await prisma.connectedAccount.findMany({
    where: {
      tokenExpiresAt: { not: null },
      health: { in: [ConnectorHealth.healthy, ConnectorHealth.unknown] },
    },
    select: {
      id: true,
      tenantId: true,
      brandId: true,
      platform: true,
      tokenExpiresAt: true,
    },
  });

  let recommended = 0;
  let expired = 0;

  for (const a of accounts) {
    const expiry = a.tokenExpiresAt!.getTime();
    const isExpired = expiry <= now;
    const isExpiringSoon = !isExpired && expiry - now <= SEVEN_DAYS_MS;
    if (!isExpired && !isExpiringSoon) continue;

    if (isExpired) {
      await prisma.connectedAccount.update({
        where: { id: a.id },
        data: {
          status: ConnectorStatus.expired,
          health: ConnectorHealth.degraded,
          lastError: "Reconnect required",
          lastErrorAt: new Date(),
        },
      });
      await audit(a, "token.expired");
      expired++;
    } else {
      await prisma.connectedAccount.update({
        where: { id: a.id },
        data: {
          health: ConnectorHealth.degraded,
          lastError: "Reconnect recommended",
          lastErrorAt: new Date(),
        },
      });
      await audit(a, "token.reconnect_recommended");
      recommended++;
    }
  }

  if (recommended > 0 || expired > 0) {
    log.info("worker.token_monitor", { recommended, expired });
  }
  return { recommended, expired };
}

async function audit(
  a: { id: string; tenantId: string; brandId: string; platform: unknown },
  event: string,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      tenantId: a.tenantId,
      brandId: a.brandId,
      event,
      actorKind: ActorKind.system,
      targetType: "connected_account",
      targetId: a.id,
      // No token material — only the platform + the event.
      metadata: { platform: a.platform as string },
    },
  });
}
