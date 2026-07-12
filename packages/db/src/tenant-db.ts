/**
 * V1.37.2 — centralized tenant DB context (Row-Level Security).
 *
 * `withTenantDb` is the ONLY sanctioned way to run tenant-scoped queries: it opens
 * a transaction and, as its first statement, sets a TRANSACTION-LOCAL tenant
 * context (`app.tenant_id`). RLS policies then isolate every row by tenant — even
 * if application code forgets `where:{tenantId}`. The context is auto-reset at
 * commit/rollback, so it can never leak across pooled connections. The tenantId
 * MUST come from a validated server session (or a trusted server-made worker/system
 * job), never from client input.
 *
 * NOTE: RLS only takes effect when the app connects as a NON-superuser,
 * NON-bypassrls role (e.g. `tamanor_app`). The current owner/superuser role
 * bypasses RLS — see V1.37.2 report.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./index";

export type TenantTx = Prisma.TransactionClient;

/**
 * Run a callback with the tenant context set (transaction-local). All queries on
 * the provided `tx` client are isolated to `tenantId` by RLS.
 */
export async function withTenantDb<T>(
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
  client: PrismaClient = prisma,
): Promise<T> {
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error("withTenantDb: a validated tenantId is required");
  }
  return client.$transaction(async (tx) => {
    // `true` = local to this transaction. Parameterized — never string-interpolated.
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}
