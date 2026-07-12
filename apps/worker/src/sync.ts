import { ConnectorStatus, findMetaSyncCandidates, countMockMetaAccounts } from "@guardora/db";
import { runReadOnlySync } from "@guardora/sync";
import { getDataMode } from "@guardora/config";
import { log } from "./logger";

/**
 * Run read-only sync for every eligible connected Meta account (Facebook Page +
 * IG Business). Read-only: creates ReputationItems, never executes actions.
 * Deduplication means repeated ticks converge (no duplicate items). Manual and
 * automatic sync call the SAME runReadOnlySync — only the trigger differs.
 *
 * V1.37.3B: account discovery is an explicit cross-tenant SYSTEM query; the trusted
 * tenantId from discovery is handed to runReadOnlySync, which does all tenant reads
 * and writes under RLS (withTenantDb / appDb).
 */
export async function syncConnectedMetaAccounts(
  trigger: "manual" | "automatic" = "automatic",
): Promise<{ created: number; accounts: number; skippedBackoff: number }> {
  const now = new Date();
  const dataMode = getDataMode();
  // In real mode, sync ONLY real (active) accounts — never mock/demo.
  const statuses = dataMode === "real"
    ? [ConnectorStatus.active]
    : [ConnectorStatus.active, ConnectorStatus.mock_connected];

  // Connected Meta accounts (to distinguish eligible vs backed-off) — SYSTEM discovery.
  const all = await findMetaSyncCandidates(statuses);
  const skippedDemo = dataMode === "real" ? await countMockMetaAccounts() : 0;

  const eligible = all.filter((a) => a.nextRetryAt == null || a.nextRetryAt <= now);
  const backedOff = all.filter((a) => a.nextRetryAt != null && a.nextRetryAt > now);

  log.info("worker.autosync.eligible", {
    trigger,
    dataMode,
    connected: all.length,
    eligible: eligible.length,
    skippedBackoff: backedOff.length,
    skippedDemo,
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
    // Trusted tenantId from system discovery drives the RLS-scoped execution.
    const r = await runReadOnlySync({ accountId: account.id, tenantId: account.tenantId }, trigger);
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
