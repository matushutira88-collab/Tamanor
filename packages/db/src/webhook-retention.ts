/**
 * V1.45C3 — bounded, idempotent, multi-worker-safe webhook retention primitives (system-only).
 *
 * Two operations, each a SINGLE bounded statement over `systemDb` (the global, no-RLS `webhook_events`
 * table). Both select a bounded batch with `ORDER BY receivedAt, id ... LIMIT n FOR UPDATE SKIP LOCKED`
 * so two workers claim DISJOINT rows, a crash simply leaves work for the next tick, and re-running is a
 * no-op once the eligible set is drained. They return COUNTS only — never payloads, ids, or PII.
 *
 * Callers pass explicit cutoffs + batch (the worker computes them from getWebhookRetentionConfig); this
 * keeps the primitives pure and deterministically testable. NEVER an unbounded UPDATE/deleteMany.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { systemDb } from "./index";

/** Hard bound on any single batch (defence-in-depth against a misconfigured caller). */
const MAX_BATCH = 5000;
function boundBatch(n: number): number {
  return Math.max(1, Math.min(MAX_BATCH, Math.floor(Number.isFinite(n) ? n : 1)));
}

/**
 * MINIMIZE: null the raw `payload` for a bounded batch of rows that no longer need it — a processed row
 * (never re-read), a signature-invalid row (never enters the processor), or any row older than the hard
 * max-payload age (sheds PII even if still pending). Bounded/security metadata is untouched. Idempotent
 * (the `payload IS NOT NULL` guard means an already-minimized row is never re-selected). Returns the
 * number of rows minimized this batch.
 */
export async function minimizeWebhookPayloads(
  opts: { maxPayloadAgeCutoff: Date; batch: number },
  client: PrismaClient = systemDb,
): Promise<number> {
  const batch = boundBatch(opts.batch);
  return client.$executeRaw(Prisma.sql`
    UPDATE "webhook_events" SET "payload" = NULL
    WHERE id IN (
      SELECT id FROM "webhook_events"
      WHERE "payload" IS NOT NULL
        AND ("processed" = true OR "signatureValid" = false OR "receivedAt" < ${opts.maxPayloadAgeCutoff})
      ORDER BY "receivedAt" ASC, id ASC
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED
    )`);
}

/**
 * PURGE: delete a bounded batch of whole rows older than the row TTL — linked, unlinked-legacy,
 * unmatched, or signature-invalid alike (global expiry does not care about tenant linkage). This also
 * removes the `dedupeKey`, so replay/dedupe guarantees exist ONLY while a row remains within TTL.
 * Idempotent, crash-resumable, multi-worker safe. Returns the number of rows deleted this batch.
 *
 * The caller MUST ensure rowTtlCutoff is OLDER than maxPayloadAgeCutoff (row TTL > payload age); the
 * worker enforces `rowTtlDays > maxPayloadAgeDays` via config. This assert is a cheap final backstop.
 */
export async function purgeExpiredWebhookEvents(
  opts: { rowTtlCutoff: Date; batch: number; maxPayloadAgeCutoff?: Date },
  client: PrismaClient = systemDb,
): Promise<number> {
  if (opts.maxPayloadAgeCutoff && !(opts.rowTtlCutoff < opts.maxPayloadAgeCutoff)) {
    // rowTtlCutoff must be further in the past than the payload cutoff. Fail closed: delete nothing.
    return 0;
  }
  const batch = boundBatch(opts.batch);
  return client.$executeRaw(Prisma.sql`
    DELETE FROM "webhook_events"
    WHERE id IN (
      SELECT id FROM "webhook_events"
      WHERE "receivedAt" < ${opts.rowTtlCutoff}
      ORDER BY "receivedAt" ASC, id ASC
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED
    )`);
}
