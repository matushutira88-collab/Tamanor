/**
 * V1.37.3B — trusted tenant worker job contract + per-tenant execution wrapper.
 *
 * The security model:
 *   system discovery (owner) → trusted TenantWorkerJob → runTenantJob →
 *   withTenantDb(job.tenantId) [RLS-enforcing appDb].
 *
 * A job's `tenantId` MUST originate from a system discovery query or an internal
 * server job — NEVER from an unverified provider/webhook payload. Every tenant
 * read/write inside the wrapper runs under the job's tenant context, so RLS
 * isolates it even if a `where:{tenantId}` is forgotten. HTTP/provider calls must
 * happen OUTSIDE the `withTenantDb` callbacks (short read tx → HTTP → short write tx).
 */
import { randomUUID } from "node:crypto";
import { withTenant, type TenantTx } from "@guardora/db";

export type { TenantTx };

/** Discriminated union of trusted worker jobs. Extend as new job types appear. */
export type TenantWorkerJob =
  | { jobType: "sync"; tenantId: string; connectedAccountId: string; brandId: string; trigger: "manual" | "automatic"; correlationId: string }
  | { jobType: "token_check"; tenantId: string; connectedAccountId: string; brandId: string; tokenExpiresAt: Date | null; correlationId: string }
  | { jobType: "propose"; tenantId: string; brandId: string; reputationItemId: string; correlationId: string }
  | { jobType: "webhook_sync"; tenantId: string; connectedAccountId: string; brandId: string; correlationId: string };

/** Normalized, non-revealing worker error reasons (never contains secrets). */
export type WorkerErrorReason =
  | "worker_job_invalid"
  | "tenant_context_missing"
  | "tenant_not_found"
  | "account_not_found"
  | "tenant_access_denied"
  | "database_runtime_misconfigured"
  | "provider_unavailable"
  | "provider_permission_missing"
  | "provider_rate_limited"
  | "sync_failed";

export class WorkerError extends Error {
  constructor(public readonly reason: WorkerErrorReason, message?: string) {
    super(message ?? reason);
    this.name = "WorkerError";
  }
}

/** Map an arbitrary thrown value to a safe reason. Postgres RLS denials → access_denied. */
export function normalizeWorkerError(err: unknown): WorkerErrorReason {
  if (err instanceof WorkerError) return err.reason;
  const code = (err as { code?: string })?.code;
  const meta = (err as { meta?: { code?: string } })?.meta;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  // 42501 = Postgres RLS/permission denied (WITH CHECK / USING violation). Prisma may
  // expose it on .code, .meta.code, or only in the message — check all three.
  if (code === "42501" || meta?.code === "42501" || /42501|row-level security/i.test(msg)) {
    return "tenant_access_denied";
  }
  return "sync_failed";
}

/** Generate a correlation id for a job (safe to log — carries no tenant data). */
export function newCorrelationId(prefix = "job"): string {
  return `${prefix}_${randomUUID()}`;
}

/** Validate that a job carries a usable tenant context. Throws WorkerError otherwise. */
export function assertValidJob(job: TenantWorkerJob): void {
  if (!job || typeof job !== "object" || typeof job.jobType !== "string") {
    throw new WorkerError("worker_job_invalid");
  }
  if (typeof job.tenantId !== "string" || job.tenantId.length === 0) {
    throw new WorkerError("tenant_context_missing");
  }
}

export interface TenantJobResult<T> {
  ok: boolean;
  reason?: WorkerErrorReason;
  value?: T;
  correlationId: string;
}

/**
 * Run tenant-scoped work for a validated job. Verifies the job, confirms the tenant
 * exists (under RLS — a foreign/absent tenant is rejected), then hands a tenant tx to
 * `fn`. Errors are normalized to a safe reason and never rethrown to the caller.
 *
 * `fn` receives a SHORT tenant tx — do NOT perform provider HTTP inside it. For a
 * read→fetch→write flow, call runTenantJob (or withTenant) multiple times around the
 * HTTP call instead of holding one long transaction.
 */
export async function runTenantJob<T>(
  job: TenantWorkerJob,
  fn: (ctx: { tenantId: string; db: TenantTx; job: TenantWorkerJob }) => Promise<T>,
): Promise<TenantJobResult<T>> {
  try {
    assertValidJob(job);
  } catch (e) {
    return { ok: false, reason: normalizeWorkerError(e), correlationId: job?.correlationId ?? "unknown" };
  }
  try {
    const value = await withTenant(job.tenantId, async (db) => {
      // Existence check under the tenant's own context (RLS: only the active tenant is visible).
      const tenant = await db.tenant.findUnique({ where: { id: job.tenantId }, select: { id: true } });
      if (!tenant) throw new WorkerError("tenant_not_found");
      return fn({ tenantId: job.tenantId, db, job });
    });
    return { ok: true, value, correlationId: job.correlationId };
  } catch (e) {
    return { ok: false, reason: normalizeWorkerError(e), correlationId: job.correlationId };
  }
}
