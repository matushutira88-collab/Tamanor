import { loadEnv } from "@guardora/config";
import { assertRlsRuntime, validateRuntimeDbConfig, cleanupExpiredAuthTokens, sweepTrialExpirations, purgeStripeWebhookEvents } from "@guardora/db";
import { emitOpsEvent, metrics, initOpsSink } from "@guardora/core";
import { log } from "./logger";

// V1.48P — initialize the vendor-neutral observability sink at worker startup (structured stdout).
initOpsSink("worker", process.env.NODE_ENV ?? "development");
import { processPendingWebhookEvents, resumePendingTenantDeletions } from "@guardora/sync";
import { runWebhookRetentionTick } from "./webhook-retention";
import { proposeForHighRiskItems } from "./proposals";
import { syncConnectedMetaAccounts } from "./sync";
import { runTokenExpiryMonitor } from "./token-monitor";
import { cleanupExpiredOnboarding } from "./cleanup";
import { runMetaConnectorHealth } from "./meta-health";

/**
 * Guardora worker entrypoint.
 *
 * V1.37.3B: the maintenance tick runs SYSTEM discovery jobs (token monitor,
 * onboarding cleanup, webhooks, proposals) that each hand a trusted tenantId to
 * tenant-scoped execution under RLS. There is a SINGLE authoritative ingest path
 * (runReadOnlySync via autoSyncTick / webhooks) — the old non-persisting pipeline
 * skeleton has been removed.
 */
async function tick(): Promise<void> {
  log.info("tick.start", {});

  // Token expiry monitor: flag expiring/expired connections for reconnect.
  try {
    await runTokenExpiryMonitor();
  } catch (err) {
    log.error("token_monitor.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    emitOpsEvent("worker.maintenance_failed", { operation: "token_monitor", reason: err instanceof Error ? err.name : "unknown" });
  }

  // Data-safety cleanup: drop expired onboarding sessions (they hold tokens).
  try {
    await cleanupExpiredOnboarding();
  } catch (err) {
    log.error("cleanup.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    emitOpsEvent("worker.maintenance_failed", { operation: "onboarding_cleanup", reason: err instanceof Error ? err.name : "unknown" });
  }

  // V1.45C3 — webhook retention: minimize raw payloads no longer needed + purge globally-expired rows,
  // in bounded batches (multi-instance safe via SKIP LOCKED). A failure here must NOT crash provider
  // sync work. Summary counts + normalized failure class only — never a payload, id, tenant, or raw error.
  try {
    const start = Date.now();
    const r = await runWebhookRetentionTick();
    if (r.minimized > 0 || r.deleted > 0) {
      log.info("webhook.retention", { minimized: r.minimized, deleted: r.deleted, durationMs: Date.now() - start });
    }
  } catch (err) {
    log.error("webhook.retention.failed", { error: err instanceof Error ? err.name : "unknown" });
    emitOpsEvent("webhook.retention_failed", { operation: "webhook_retention", reason: err instanceof Error ? err.name : "unknown" });
  }

  // V1.50C — auth token cleanup: delete expired/consumed verification + reset tokens in bounded,
  // index-backed batches (id-scoped deletes are multi-worker safe). A failure here must NOT crash
  // sync. Summary counts only — never a token, hash, user, or raw error.
  try {
    const c = await cleanupExpiredAuthTokens();
    if (c.verificationRemoved > 0 || c.resetRemoved > 0) {
      log.info("auth.token_cleanup", { verificationRemoved: c.verificationRemoved, resetRemoved: c.resetRemoved });
    }
  } catch (err) {
    log.error("auth.token_cleanup.failed", { error: err instanceof Error ? err.name : "unknown" });
    emitOpsEvent("auth.token_cleanup_failed", { operation: "auth_token_cleanup", reason: err instanceof Error ? err.name : "unknown" });
  }

  // V1.50D — billing maintenance: move trial-expired tenants (no active subscription) to restricted
  // access (never delete/disconnect), and purge old Stripe webhook audit rows. Bounded + idempotent;
  // a failure must NOT crash sync. No payment PII in logs.
  try {
    const now = new Date();
    const restricted = await sweepTrialExpirations(now);
    const purged = await purgeStripeWebhookEvents(new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000));
    if (restricted > 0) { log.info("billing.trial_swept", { restricted }); emitOpsEvent("billing.access_restricted", { reason: "trial_expired" }); }
    if (purged > 0) log.info("billing.webhook_purged", { purged });
  } catch (err) {
    log.error("billing.maintenance.failed", { error: err instanceof Error ? err.name : "unknown" });
    emitOpsEvent("billing.webhook_failed", { operation: "billing_maintenance", reason: err instanceof Error ? err.name : "unknown" });
  }

  // V1.38 — unified Meta connector health (gated by META_CONNECTOR_HEALTH; off = no-op).
  try {
    const mh = await runMetaConnectorHealth();
    if (mh.enabled) log.info("meta_health.done", { checked: mh.checked, changed: mh.changed });
  } catch (err) {
    log.error("meta_health.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    emitOpsEvent("worker.maintenance_failed", { operation: "meta_health", reason: err instanceof Error ? err.name : "unknown" });
  }

  // V1.45C1 — resume any tenant deletion stranded in `deleting` (crash/timeout after the request
  // transition revoked the initiator's session). System context, idempotent, no session required.
  // This is the REQUIRED production recovery path so a deletion can never be permanently stuck.
  try {
    const res = await resumePendingTenantDeletions();
    metrics.setGauge("pending_tenant_deletions", res.pending);
    if (res.pending > 0) log.info("tenant_deletion.resume", { pending: res.pending, resumed: res.resumed, failed: res.failed });
    if (res.failed > 0) emitOpsEvent("tenant.deletion_failed", { operation: "tenant_deletion_resume", reason: "resume_incomplete" });
  } catch (err) {
    log.error("tenant_deletion.resume.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    emitOpsEvent("worker.maintenance_failed", { operation: "tenant_deletion_resume", reason: err instanceof Error ? err.name : "unknown" });
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
    emitOpsEvent("worker.maintenance_failed", { operation: "webhook_followup_sync", reason: err instanceof Error ? err.name : "unknown" });
  }

  // Propose (never execute) actions for high-risk items. Auto-execution is off.
  try {
    const proposed = await proposeForHighRiskItems();
    log.info("tick.done", { proposalsCreated: proposed });
  } catch (err) {
    log.error("proposals.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    emitOpsEvent("worker.maintenance_failed", { operation: "proposals", reason: err instanceof Error ? err.name : "unknown" });
  }

  // V1.51 — liveness heartbeat: emit a positive "worker is alive" signal + a monotonic gauge at the
  // end of every maintenance tick, so an operator can alert on STALENESS (missing heartbeat) rather
  // than only on the absence of logs. Carries no PII/ids — just the tick cadence.
  metrics.setGauge("worker_last_tick_epoch_ms", Date.now());
  emitOpsEvent("worker.heartbeat", { operation: "maintenance_tick" });
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

  // V1.37.3B — RLS runtime preflight, ONCE at boot (never per job). Fail-closed:
  // the worker refuses to start if the runtime role is a superuser / has BYPASSRLS,
  // the RLS helper/policies are missing, or (in production) APP_DATABASE_URL is
  // missing or equal to the owner URL. Never logs any credential.
  const cfg = validateRuntimeDbConfig();
  if (!cfg.ok) {
    log.error("worker.preflight.config_invalid", { reason: cfg.reason });
    throw new Error("database_runtime_misconfigured");
  }
  try {
    await assertRlsRuntime();
    log.info("worker.preflight.ok", { rls: "healthy" });
  } catch {
    log.error("worker.preflight.rls_unhealthy", { reason: "database_runtime_misconfigured" });
    emitOpsEvent("rls.health_failed", { operation: "worker_preflight" });
    throw new Error("database_runtime_misconfigured");
  }

  const state = { running: true };
  const shutdown = (signal: string) => {
    log.info("worker.shutdown", { signal });
    state.running = false;
    // V1.51 — bounded drain: the loops only check `state.running` BETWEEN ticks, so a tick blocked
    // on a slow provider call could delay exit indefinitely. Guarantee the process exits within a
    // deadline (default 25s) so an orchestrator's SIGTERM→SIGKILL window is respected cleanly.
    const graceMs = Number(process.env.WORKER_SHUTDOWN_GRACE_MS ?? 25_000);
    const t = setTimeout(() => {
      log.error("worker.shutdown.forced", { reason: "drain_deadline_exceeded" });
      process.exit(0);
    }, Math.max(1_000, graceMs));
    // Don't let this timer keep the loop alive once the loops have exited cleanly.
    if (typeof t.unref === "function") t.unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // V1.51 — defense-in-depth crash safety: surface an otherwise-silent unhandled rejection /
  // uncaught exception as a bounded ops event (normalized name only) and exit non-zero so the
  // supervisor restarts a persistent worker. Per-job try/catch still isolates ordinary failures.
  process.on("unhandledRejection", (reason) => {
    log.error("worker.unhandled_rejection", { error: reason instanceof Error ? reason.name : "unknown" });
    emitOpsEvent("worker.fatal", { reason: reason instanceof Error ? reason.name : "unhandled_rejection" });
    process.exit(1);
  });
  process.on("uncaughtException", (err) => {
    log.error("worker.uncaught_exception", { error: err instanceof Error ? err.name : "unknown" });
    emitOpsEvent("worker.fatal", { reason: err instanceof Error ? err.name : "uncaught_exception" });
    process.exit(1);
  });

  // Maintenance loop: token monitor, cleanup, webhooks, proposals.
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
  // Bounded ops event (normalized error name only — never a stack/message with infra detail).
  emitOpsEvent("worker.fatal", { reason: err instanceof Error ? err.name : "unknown" });
  process.exitCode = 1;
});
