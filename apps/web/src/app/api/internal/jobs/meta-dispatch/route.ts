/**
 * V1.58.8 — DISPATCHER endpoint (Vercel Cron). PLANS only — it never syncs Meta. It selects a bounded
 * batch of eligible accounts (respecting retry backoff + live leases + health/status) and fans out one
 * independent meta-sync invocation per account via `after()` (fire-and-forget, survives the response),
 * so each sync job gets its own runtime budget. Idempotent: an account skipped/failed this tick is
 * re-selected next tick. Auth: internal Bearer (CRON_SECRET) only — else 401.
 */
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { assertCronAuth, cronUnauthorized } from "@/lib/cron-auth";
import { selectMetaSyncBatch, DEFAULT_DISPATCH_LIMIT } from "@guardora/sync";
import { getDataMode } from "@guardora/config";
import { emitOpsEvent } from "@guardora/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = assertCronAuth(req);
  if (!auth.ok) return cronUnauthorized(auth.reason);

  emitOpsEvent("cron.dispatch.started", { operation: "meta_dispatch" });
  const batch = await selectMetaSyncBatch({ limit: DEFAULT_DISPATCH_LIMIT, dataMode: getDataMode() });

  const base = (process.env.APP_BASE_URL || process.env.APP_URL || "").replace(/\/+$/, "");
  const secret = (process.env.CRON_SECRET ?? "").trim();
  // Fan out one independent sync-job invocation per account. `after()` lets the request be sent after
  // the dispatch response without blocking it; if a trigger fails, the NEXT Cron re-dispatches (the
  // sync job is idempotent and lease-guarded, so a double-trigger is safe — one wins, one is skipped).
  for (const job of batch) {
    const runId = randomUUID();
    after(async () => {
      try {
        await fetch(`${base}/api/internal/jobs/meta-sync`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
          body: JSON.stringify({ accountId: job.accountId, tenantId: job.tenantId, trigger: "automatic", runId }),
        });
      } catch {
        /* transient — the next Cron re-dispatches this account */
      }
    });
  }

  emitOpsEvent("cron.dispatch.completed", { operation: "meta_dispatch", count: batch.length });
  return Response.json({ ok: true, dispatched: batch.length });
}
