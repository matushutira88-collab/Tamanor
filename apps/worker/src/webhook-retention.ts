import { getWebhookRetentionConfig } from "@guardora/config";
import { minimizeWebhookPayloads, purgeExpiredWebhookEvents } from "@guardora/db";

/**
 * V1.45C3 — worker webhook-retention step. Computes the cutoffs from the (bounded, fail-safe) config,
 * then drains BOTH operations in bounded batches (`FOR UPDATE SKIP LOCKED`, so multiple worker
 * instances claim disjoint rows). Work per tick is capped at MAX_ROUNDS × batch so a huge backlog can
 * never make one tick unbounded — it drains over successive ticks. Returns COUNTS only (no PII).
 */
const DAY_MS = 86_400_000;
const MAX_ROUNDS = 20;

export interface WebhookRetentionResult {
  minimized: number;
  deleted: number;
}

export async function runWebhookRetentionTick(now: Date = new Date()): Promise<WebhookRetentionResult> {
  const cfg = getWebhookRetentionConfig();
  const maxPayloadAgeCutoff = new Date(now.getTime() - cfg.maxPayloadAgeDays * DAY_MS);
  const rowTtlCutoff = new Date(now.getTime() - cfg.rowTtlDays * DAY_MS);

  let minimized = 0;
  for (let r = 0; r < MAX_ROUNDS; r++) {
    const n = await minimizeWebhookPayloads({ maxPayloadAgeCutoff, batch: cfg.purgeBatch });
    minimized += n;
    if (n < cfg.purgeBatch) break; // eligible set drained
  }

  let deleted = 0;
  for (let r = 0; r < MAX_ROUNDS; r++) {
    const n = await purgeExpiredWebhookEvents({ rowTtlCutoff, batch: cfg.purgeBatch, maxPayloadAgeCutoff });
    deleted += n;
    if (n < cfg.purgeBatch) break;
  }

  return { minimized, deleted };
}
