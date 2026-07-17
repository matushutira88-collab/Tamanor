/**
 * V1.58.8 — WEBHOOK RETRY endpoint (Vercel Cron). Drains pending Meta webhook events into targeted
 * read-only syncs ONCE per invocation (bounded batch), as a short serverless job instead of a permanent
 * loop. Gated by META_WEBHOOK_SYNC (off ⇒ no-op). Auth: internal Bearer (CRON_SECRET) only — else 401.
 */
import { assertCronAuth, cronUnauthorized } from "@/lib/cron-auth";
import { processPendingWebhookEvents } from "@guardora/sync";
import { emitOpsEvent } from "@guardora/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = assertCronAuth(req);
  if (!auth.ok) return cronUnauthorized(auth.reason);

  emitOpsEvent("cron.job.started", { operation: "webhook_retry" });
  const result = await processPendingWebhookEvents();
  emitOpsEvent("cron.job.completed", { operation: "webhook_retry", result: result.enabled ? "ok" : "disabled" });
  return Response.json({ ok: true, ...result });
}
