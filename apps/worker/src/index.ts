import { loadEnv } from "@guardora/config";
import { log } from "./logger";
import { processPendingWebhookEvents } from "@guardora/sync";
import { loadActiveAccounts, runPipelineForAccount } from "./pipeline";
import { proposeForHighRiskItems } from "./proposals";
import { syncConnectedMetaAccounts } from "./sync";
import { runTokenExpiryMonitor } from "./token-monitor";
import { cleanupExpiredOnboarding } from "./cleanup";

/**
 * Guardora worker entrypoint.
 *
 * Runs the reputation pipeline on an interval for every active connected
 * account. This is a skeleton scheduler: no real platform API calls and no
 * moderation actions are executed yet.
 */
async function tick(): Promise<void> {
  const accounts = await loadActiveAccounts();

  log.info("tick.start", { accounts: accounts.length });
  for (const account of accounts) {
    try {
      await runPipelineForAccount(account);
    } catch (err) {
      log.error("pipeline.account.failed", {
        accountId: account.id,
        platform: account.platform,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Token expiry monitor: flag expiring/expired connections for reconnect.
  try {
    await runTokenExpiryMonitor();
  } catch (err) {
    log.error("token_monitor.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Data-safety cleanup: drop expired onboarding sessions (they hold tokens).
  try {
    await cleanupExpiredOnboarding();
  } catch (err) {
    log.error("cleanup.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Read-only sync for connected Meta accounts (creates ReputationItems only).
  let synced = 0;
  try {
    synced = await syncConnectedMetaAccounts();
  } catch (err) {
    log.error("sync.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Webhook follow-up: read-only targeted sync (gated by META_WEBHOOK_SYNC, off).
  try {
    const wh = await processPendingWebhookEvents();
    if (wh.enabled) {
      log.info("webhook.processed", { processed: wh.processed, synced: wh.synced });
    }
  } catch (err) {
    log.error("webhook.process.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Propose (never execute) actions for high-risk items. Auto-execution is off.
  try {
    const proposed = await proposeForHighRiskItems();
    log.info("tick.done", {
      accounts: accounts.length,
      syncedItems: synced,
      proposalsCreated: proposed,
    });
  } catch (err) {
    log.error("proposals.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  log.info("worker.boot", {
    env: env.NODE_ENV,
    intervalMs: env.WORKER_SYNC_INTERVAL_MS,
    aiProvider: env.AI_PROVIDER,
  });

  let running = true;
  const shutdown = (signal: string) => {
    log.info("worker.shutdown", { signal });
    running = false;
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Run once immediately, then loop on the configured interval.
  await tick();
  while (running) {
    await sleep(env.WORKER_SYNC_INTERVAL_MS);
    if (!running) break;
    await tick();
  }

  log.info("worker.stopped");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  log.error("worker.fatal", {
    error: err instanceof Error ? err.stack ?? err.message : String(err),
  });
  process.exitCode = 1;
});
