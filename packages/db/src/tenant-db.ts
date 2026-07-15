/**
 * V1.37.2/3 — centralized tenant DB context (Row-Level Security).
 *
 * `withTenantDb` is the ONLY sanctioned way to run tenant-scoped queries: it opens
 * a transaction and, as its first statement, sets a TRANSACTION-LOCAL tenant
 * context (`app.tenant_id`). RLS policies then isolate every row by tenant — even
 * if application code forgets `where:{tenantId}`. The context auto-resets at
 * commit/rollback, so it can never leak across pooled connections. The tenantId
 * MUST come from a validated server session (or a trusted server-made worker/system
 * job), never from client input.
 *
 * V1.37.3: it runs on `appDb` (the non-superuser tamanor_app runtime role) so RLS
 * is actually enforced. The owner/system client bypasses RLS and is used only for
 * the narrow `systemDb` cross-tenant contract.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { metrics } from "@guardora/core";
import { appDb } from "./index";

export type TenantTx = Prisma.TransactionClient;

/**
 * Run a callback with the tenant context set (transaction-local). All queries on
 * the provided `tx` client are isolated to `tenantId` by RLS. Defaults to the RLS
 * runtime client (`appDb`).
 */
export async function withTenantDb<T>(
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
  client: PrismaClient = appDb,
): Promise<T> {
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error("withTenantDb: a validated tenantId is required");
  }
  // V1.51C — observe the tenant-transaction duration (db_query_duration, operation label only —
  // low cardinality, no tenant id). Timed in finally so a rollback is still recorded.
  const _t0 = Date.now();
  try {
    return await client.$transaction(async (tx) => {
      // `true` = local to this transaction. Parameterized — never string-interpolated.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  } finally {
    metrics.observe("db_query_duration", Date.now() - _t0, { operation: "tenant_tx" });
  }
}

// ---------------------------------------------------------------------------
// S) Runtime RLS preflight — fail-closed. Never exposes credentials.
// ---------------------------------------------------------------------------
export type RlsRuntimeStatus =
  | "healthy"
  | "misconfigured"
  | "rls_bypassed"
  | "role_invalid"
  | "policy_missing"
  | "unavailable";

export interface RlsRuntimeReport {
  status: RlsRuntimeStatus;
  role: string | null;
  superuser: boolean | null;
  bypassrls: boolean | null;
  helperAvailable: boolean;
  criticalTableForced: boolean;
}

/**
 * Verify the RUNTIME client connects with a safe role and RLS is active. Returns a
 * structured report (no connection string / password / token). Meant for a startup
 * or health preflight — not per-request.
 */
export async function checkRlsRuntime(client: PrismaClient = appDb): Promise<RlsRuntimeReport> {
  const base: RlsRuntimeReport = { status: "unavailable", role: null, superuser: null, bypassrls: null, helperAvailable: false, criticalTableForced: false };
  try {
    const roleRows = await client.$queryRawUnsafe<Array<{ role: string; rolsuper: boolean; rolbypassrls: boolean }>>(
      `SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    const r = roleRows[0];
    base.role = r?.role ?? null;
    base.superuser = r?.rolsuper ?? null;
    base.bypassrls = r?.rolbypassrls ?? null;
    const helper = await client.$queryRawUnsafe<Array<{ ok: boolean }>>(
      `SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname='current_app_tenant_id') AS ok`,
    );
    base.helperAvailable = helper[0]?.ok === true;
    const forced = await client.$queryRawUnsafe<Array<{ f: boolean }>>(
      `SELECT relforcerowsecurity AS f FROM pg_class WHERE relname='content_items'`,
    );
    base.criticalTableForced = forced[0]?.f === true;

    if (r?.rolsuper || r?.rolbypassrls) return { ...base, status: "rls_bypassed" };
    if (!base.role) return { ...base, status: "role_invalid" };
    if (!base.helperAvailable) return { ...base, status: "misconfigured" };
    if (!base.criticalTableForced) return { ...base, status: "policy_missing" };
    return { ...base, status: "healthy" };
  } catch {
    return base; // "unavailable"
  }
}

/** Fail-closed assertion for tenant runtime paths. Throws a safe, non-revealing error. */
export async function assertRlsRuntime(client: PrismaClient = appDb): Promise<void> {
  const report = await checkRlsRuntime(client);
  if (report.status !== "healthy") {
    throw new Error(`database_runtime_misconfigured: RLS runtime not healthy (${report.status})`);
  }
}

/**
 * D) Production runtime DB config validation (pure, no DB). In production the
 * app MUST have a distinct APP_DATABASE_URL (the non-superuser role); a missing
 * value or one equal to DATABASE_URL is fail-closed. Dev/test is permitted.
 */
export function validateRuntimeDbConfig(env: NodeJS.ProcessEnv = process.env): { ok: boolean; reason?: string } {
  if (env.NODE_ENV !== "production") return { ok: true };
  if (!env.APP_DATABASE_URL) return { ok: false, reason: "app_database_url_missing" };
  if (env.APP_DATABASE_URL === env.DATABASE_URL) return { ok: false, reason: "app_database_url_equals_owner" };
  return { ok: true };
}
