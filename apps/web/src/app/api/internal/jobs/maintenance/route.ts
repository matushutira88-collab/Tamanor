/**
 * V1.58.8 — MAINTENANCE endpoint (Vercel Cron). Runs the whole maintenance tick ONCE — token expiry
 * monitor, onboarding cleanup, auth-token cleanup, webhook retention, trial sweep, Stripe purge, Meta
 * connector health, tenant-deletion resume, proposals — each bounded + idempotent + per-job isolated
 * (one failing job never aborts the others). Replaces the persistent worker's maintenance loop with a
 * short serverless invocation. Auth: internal Bearer (CRON_SECRET) only — else 401.
 */
import { assertCronAuth, cronUnauthorized } from "@/lib/cron-auth";
import { runMaintenanceTick } from "@guardora/sync";
import { emitOpsEvent } from "@guardora/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const auth = assertCronAuth(req);
  if (!auth.ok) return cronUnauthorized(auth.reason);

  emitOpsEvent("cron.job.started", { operation: "maintenance" });
  const summary = await runMaintenanceTick();
  emitOpsEvent("cron.job.completed", { operation: "maintenance" });
  return Response.json({ ok: true, summary });
}
