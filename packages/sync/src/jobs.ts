/**
 * V1.58.8 — Vercel-native job runtime. Replaces the persistent worker's scheduler with short,
 * idempotent, budgeted jobs invoked by Vercel Cron. NO while(true), NO long-running process.
 *
 *   Vercel Cron → meta-dispatch (selectMetaSyncBatch, PLAN only) → meta-sync (runMetaSyncJob, EXECUTE
 *   one account within a runtime budget, checkpoint the cursor, release) → next Cron resumes.
 *
 * All V1.58.7 safety guarantees are preserved: each batch is one runReadOnlySync call, which does the
 * atomic generation-fenced lease acquire → sync → cursor checkpoint (writeAccountIfLeaseHeld) → release.
 * A budget stop happens ONLY BETWEEN batches (never mid-batch), so a Vercel Function timeout can never
 * abort a partial write; the last completed batch's cursor is durable and the next Cron continues from
 * it. Losing the lease mid-batch still yields `interrupted` (never a false success).
 */
import { systemDb, findMetaSyncCandidates, ConnectorStatus } from "@guardora/db";
import { emitOpsEvent } from "@guardora/core";
import { runReadOnlySync, type SyncVerdict } from "./index";

/** Bounded dispatcher fan-out per Cron tick. */
export const DEFAULT_DISPATCH_LIMIT = 10;
/** Per-account runtime budget for ONE meta-sync invocation (must be safely < the Function maxDuration). */
export const DEFAULT_JOB_BUDGET_MS = 45_000;
/** Hard cap on batches per invocation (belt-and-suspenders against a runaway resume loop). */
export const DEFAULT_JOB_MAX_BATCHES = 20;

export interface SyncBatchTarget {
  accountId: string;
  tenantId: string;
  platform: string;
}

/**
 * DISPATCHER selection (PLAN only — never syncs). Finds eligible Meta accounts, honours the retry
 * backoff (`nextRetryAt`), EXCLUDES accounts that currently hold a LIVE lease (another job in flight),
 * and returns a bounded batch. Cross-tenant SYSTEM discovery; the trusted tenantId flows to the job.
 */
export async function selectMetaSyncBatch(opts: {
  limit?: number;
  dataMode: "real" | "demo";
  now?: Date;
}): Promise<SyncBatchTarget[]> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? DEFAULT_DISPATCH_LIMIT;
  const statuses = opts.dataMode === "real"
    ? [ConnectorStatus.active]
    : [ConnectorStatus.active, ConnectorStatus.mock_connected];

  const all = await findMetaSyncCandidates(statuses as unknown as string[]);
  const eligible = all.filter((a) => a.nextRetryAt == null || a.nextRetryAt <= now);

  // Respect the lease: skip any account with a non-expired lease (a job is already running for it).
  const liveLeases = await systemDb.syncLease.findMany({ where: { expiresAt: { gt: now } }, select: { connectedAccountId: true } });
  const busy = new Set(liveLeases.map((l) => l.connectedAccountId));

  return eligible
    .filter((a) => !busy.has(a.id))
    .slice(0, limit)
    .map((a) => ({ accountId: a.id, tenantId: a.tenantId, platform: a.platform }));
}

export interface MetaSyncJobResult {
  ok: boolean;
  /** Final verdict of the LAST batch (or a rollup). */
  verdict: SyncVerdict | "no_work";
  /** How many read-only batches ran this invocation. */
  batches: number;
  created: number;
  updated: number;
  deduped: number;
  errors: number;
  /** True when the loop stopped because the runtime budget was hit (more work remains → next Cron). */
  budgetExhausted: boolean;
  /** True when there is no more work for this account (resume converged). */
  completed: boolean;
  durationMs: number;
}

/**
 * SYNC JOB (EXECUTE one account) — budgeted, checkpointing, resumable. Runs read-only batches until:
 *   • no more progress (resume converged → `completed`), OR
 *   • the runtime budget is exhausted (checkpoint saved → next Cron resumes → `budgetExhausted`), OR
 *   • a batch was skipped_locked / interrupted / failed (surfaced verbatim), OR
 *   • maxBatches is reached.
 * Each batch persists the cursor and releases the lease BEFORE returning, so stopping between batches
 * is always safe. Heartbeat is disabled (short batch ≪ TTL); generation fencing still protects writes.
 */
export async function runMetaSyncJob(input: {
  accountId: string;
  tenantId: string;
  trigger?: "manual" | "automatic";
  runId?: string;
  budgetMs?: number;
  maxBatches?: number;
  now?: () => number;
}): Promise<MetaSyncJobResult> {
  const now = input.now ?? (() => Date.now());
  const budgetMs = input.budgetMs ?? DEFAULT_JOB_BUDGET_MS;
  const maxBatches = input.maxBatches ?? DEFAULT_JOB_MAX_BATCHES;
  const trigger = input.trigger ?? "automatic";
  const startedAt = now();
  const deadline = startedAt + budgetMs;

  let batches = 0, created = 0, updated = 0, deduped = 0, errors = 0;
  let verdict: SyncVerdict | "no_work" = "no_work";
  let budgetExhausted = false;
  let completed = false;

  emitOpsEvent("cron.job.started", { operation: "meta_sync", trigger });

  while (batches < maxBatches) {
    // Budget is checked ONLY between batches → a batch is never aborted mid-write.
    if (now() >= deadline) { budgetExhausted = true; emitOpsEvent("cron.deadline_checkpoint", { operation: "meta_sync", result: "budget" }); break; }

    const r = await runReadOnlySync({ accountId: input.accountId, tenantId: input.tenantId }, trigger, { disableHeartbeat: true });
    batches++;
    created += r.created; updated += r.updated; deduped += r.deduped; errors += r.errors;
    verdict = r.verdict ?? "failed";

    // Terminal per-batch outcomes stop the loop immediately (do not resume).
    if (r.verdict === "skipped_locked" || r.verdict === "interrupted" || r.verdict === "failed") break;

    // Converged when a batch brings NO NEW items (updates/dedup of already-seen content only). If a
    // cursor advanced with more pages, we still stop here and the NEXT Cron resumes from the persisted
    // cursor — no data is lost, work is just spread across ticks (bounded, idempotent).
    if (r.created === 0) { completed = true; break; }
    // Otherwise loop and resume from the just-persisted cursor within the remaining budget.
  }

  const durationMs = now() - startedAt;
  emitOpsEvent("cron.job.completed", { operation: "meta_sync", result: verdict === "no_work" ? "no_work" : verdict });
  return {
    ok: verdict !== "failed" && verdict !== "interrupted",
    verdict, batches, created, updated, deduped, errors, budgetExhausted, completed, durationMs,
  };
}
