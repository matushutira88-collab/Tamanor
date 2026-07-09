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
      proposalsCreated: proposed,
    });
  } catch (err) {
    log.error("proposals.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Automatic read-only sync. Gated by AUTO_SYNC_ENABLED and paced by
 * AUTO_SYNC_INTERVAL_SECONDS. Reads only — never executes a platform action.
 * Eligible-account selection + backoff live in syncConnectedMetaAccounts.
 */
async function autoSyncTick(): Promise<void> {
  try {
    const { created, accounts, skippedBackoff } = await syncConnectedMetaAccounts("automatic");
    log.info("autosync.done", { eligibleAccounts: accounts, createdItems: created, skippedBackoff });
  } catch (err) {
    log.error("autosync.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const autoSyncMs = env.AUTO_SYNC_INTERVAL_SECONDS * 1000;
  log.info("worker.boot", {
    env: env.NODE_ENV,
    intervalMs: env.WORKER_SYNC_INTERVAL_MS,
    autoSyncEnabled: env.AUTO_SYNC_ENABLED,
    autoSyncIntervalSeconds: env.AUTO_SYNC_INTERVAL_SECONDS,
    aiProvider: env.AI_PROVIDER,
  });

  const state = { running: true };
  const shutdown = (signal: string) => {
    log.info("worker.shutdown", { signal });
    state.running = false;
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Maintenance loop: pipeline, token monitor, cleanup, webhooks, proposals.
  const maintenance = (async () => {
    await tick();
    while (state.running) {
      await sleep(env.WORKER_SYNC_INTERVAL_MS);
      if (!state.running) break;
      await tick();
    }
  })();

  // Automatic read-only sync loop (independent cadence), only when enabled.
  const autosync = (async () => {
    if (!env.AUTO_SYNC_ENABLED) {
      log.info("autosync.DISABLED", {
        reason: "AUTO_SYNC_ENABLED is not true in this worker's env",
        hint: "set AUTO_SYNC_ENABLED=true in .env and restart the worker; manual 'Run read-only sync' still works",
      });
      return;
    }
    log.info("autosync.ENABLED", { intervalSeconds: env.AUTO_SYNC_INTERVAL_SECONDS });
    await autoSyncTick();
    while (state.running) {
      await sleep(autoSyncMs);
      if (!state.running) break;
      await autoSyncTick();
    }
  })();

  await Promise.all([maintenance, autosync]);
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
