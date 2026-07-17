/**
 * V1.58.8 — internal Cron/job endpoint authentication. FAIL-CLOSED: every internal job route rejects
 * any request that does not carry the exact `Authorization: Bearer ${CRON_SECRET}`. Vercel Cron sends
 * this header automatically when the `CRON_SECRET` env var is set; the dispatcher uses the SAME secret
 * for its internal fan-out call. If `CRON_SECRET` is unset the routes deny EVERYTHING (never open).
 *
 * Never logs the secret or the provided token. The comparison is length-checked + constant-time to
 * avoid leaking the secret via timing.
 */
import { emitOpsEvent } from "@guardora/core";

export interface CronAuthResult {
  ok: boolean;
  reason?: "unauthorized" | "cron_secret_unset";
}

export function assertCronAuth(req: Request, secret: string | undefined = process.env.CRON_SECRET): CronAuthResult {
  const s = (secret ?? "").trim();
  if (!s) return { ok: false, reason: "cron_secret_unset" }; // fail-closed: no secret configured ⇒ deny all
  const provided = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${s}`;
  if (provided.length !== expected.length) return { ok: false, reason: "unauthorized" };
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? { ok: true } : { ok: false, reason: "unauthorized" };
}

/** Standard 401 response for an internal job route (emits a safe ops event; never echoes the token). */
export function cronUnauthorized(reason?: CronAuthResult["reason"]): Response {
  emitOpsEvent("cron.unauthorized", { reason: reason === "cron_secret_unset" ? "secret_unset" : "unauthorized" });
  return new Response("Unauthorized", { status: 401 });
}
