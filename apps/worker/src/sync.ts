import { prisma, ConnectorStatus, Platform } from "@guardora/db";
import { runReadOnlySync } from "@guardora/sync";
import { log } from "./logger";

/**
 * Run read-only sync for every eligible connected Meta account (Facebook Page +
 * IG Business). Read-only: creates ReputationItems, never executes actions.
 * Deduplication means repeated ticks converge (no duplicate items). Manual and
 * automatic sync call the SAME runReadOnlySync — only the trigger differs.
 */
export async function syncConnectedMetaAccounts(
  trigger: "manual" | "automatic" = "automatic",
): Promise<{ created: number; accounts: number; skippedBackoff: number }> {
  const now = new Date();

  // All connected Meta accounts (to distinguish eligible vs backed-off).
  const all = await prisma.connectedAccount.findMany({
    where: {
      platform: { in: [Platform.facebook_page, Platform.instagram_business] },
      status: { in: [ConnectorStatus.active, ConnectorStatus.mock_connected] },
    },
    select: {
      id: true, platform: true, externalId: true, externalName: true, pageId: true,
      health: true, status: true, nextRetryAt: true,
    },
  });

  const eligible = all.filter((a) => a.nextRetryAt == null || a.nextRetryAt <= now);
  const backedOff = all.filter((a) => a.nextRetryAt != null && a.nextRetryAt > now);

  log.info("worker.autosync.eligible", {
    trigger,
    connected: all.length,
    eligible: eligible.length,
    skippedBackoff: backedOff.length,
  });
  for (const a of backedOff) {
    log.info("worker.autosync.skip.backoff", {
      accountId: a.id, pageName: a.externalName, pageId: a.pageId ?? a.externalId,
      nextRetryAt: a.nextRetryAt?.toISOString(),
    });
  }

  let created = 0;
  for (const account of eligible) {
    log.info("worker.autosync.account.start", {
      accountId: account.id, platform: account.platform,
      pageName: account.externalName, pageId: account.pageId ?? account.externalId,
      health: account.health, trigger,
    });
    const r = await runReadOnlySync(account.id, trigger);
    created += r.created;
    log.info("worker.autosync.account.done", {
      accountId: account.id,
      pageName: account.externalName, pageId: account.pageId ?? account.externalId,
      mock: r.mock, fetched: r.fetched, created: r.created, deduped: r.deduped,
      errors: r.errors, trigger,
    });
  }
  return { created, accounts: eligible.length, skippedBackoff: backedOff.length };
}
