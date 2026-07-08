import { prisma, ConnectorStatus, Platform } from "@guardora/db";
import { runReadOnlySync } from "@guardora/sync";
import { log } from "./logger";

/**
 * Run read-only sync for every connected Meta account (Facebook Page + IG
 * Business). Read-only: creates ReputationItems, never executes actions.
 * Deduplication means repeated ticks converge (no duplicate items).
 */
export async function syncConnectedMetaAccounts(): Promise<number> {
  const accounts = await prisma.connectedAccount.findMany({
    where: {
      platform: {
        in: [Platform.facebook_page, Platform.instagram_business],
      },
      status: { in: [ConnectorStatus.active, ConnectorStatus.mock_connected] },
      // Respect backoff: skip accounts scheduled to retry later.
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    select: { id: true },
  });

  let created = 0;
  for (const account of accounts) {
    const r = await runReadOnlySync(account.id);
    created += r.created;
    log.info("worker.sync.account", {
      accountId: account.id,
      mock: r.mock,
      fetched: r.fetched,
      created: r.created,
      deduped: r.deduped,
      errors: r.errors,
    });
  }
  return created;
}
