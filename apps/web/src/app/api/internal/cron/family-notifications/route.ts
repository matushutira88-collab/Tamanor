/**
 * FAMILY NOTIFICATIONS PHASE 3C — production scheduler endpoint (Vercel Cron, every 5 minutes).
 *
 * Server-only. Auth: internal Bearer (CRON_SECRET) via assertCronAuth — fail-closed (deny all if the secret is
 * unset), constant-time comparison, never logs or echoes the token, generic 401. No browser session / cookie /
 * query-string secret. It calls ONLY the shared scheduler runner with NO caller-controlled input (the caller can
 * neither raise the bounds nor choose a tenant/source), and returns AGGREGATE counts only (no ids). Never cached.
 */
import { assertCronAuth, cronUnauthorized } from "@/lib/cron-auth";
import { runFamilyNotificationScheduler } from "@guardora/db";
import { emitOpsEvent } from "@guardora/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = assertCronAuth(req);
  if (!auth.ok) return cronUnauthorized(auth.reason);

  emitOpsEvent("cron.job.started", { operation: "family_notifications_scheduler" });
  // NO caller input is threaded in — the runner uses its own bounded defaults; a caller cannot raise bounds,
  // choose a tenant/source, or influence which sources are scanned.
  const r = await runFamilyNotificationScheduler({});
  emitOpsEvent("cron.job.completed", { operation: "family_notifications_scheduler" });

  return Response.json(
    { ok: true, ...r }, // aggregate counts + acquired + stoppedReason ONLY — no ids/tenants/recipients
    { headers: { "Cache-Control": "no-store" } },
  );
}
