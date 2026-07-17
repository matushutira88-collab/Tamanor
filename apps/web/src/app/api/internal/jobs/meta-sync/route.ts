/**
 * V1.58.8 — SYNC JOB endpoint (Vercel-native). Executes ONE account's read-only sync within a runtime
 * budget: acquire lease → sync bounded batches → checkpoint cursor → release, repeating until budget or
 * convergence. Idempotent + resumable; a Function timeout can never abort a partial write (budget is
 * checked only between batches). Auth: internal Bearer (CRON_SECRET) only — else 401.
 */
import { assertCronAuth, cronUnauthorized } from "@/lib/cron-auth";
import { runMetaSyncJob, DEFAULT_JOB_BUDGET_MS, DEFAULT_JOB_MAX_BATCHES } from "@guardora/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = assertCronAuth(req);
  if (!auth.ok) return cronUnauthorized(auth.reason);

  const body = (await req.json().catch(() => null)) as
    | { accountId?: string; tenantId?: string; trigger?: "manual" | "automatic"; runId?: string }
    | null;
  if (!body?.accountId || !body?.tenantId) {
    return Response.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }

  const result = await runMetaSyncJob({
    accountId: body.accountId,
    tenantId: body.tenantId,
    trigger: body.trigger === "manual" ? "manual" : "automatic",
    runId: body.runId,
    budgetMs: DEFAULT_JOB_BUDGET_MS,
    maxBatches: DEFAULT_JOB_MAX_BATCHES,
  });
  return Response.json(result);
}
