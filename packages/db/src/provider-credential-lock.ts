/**
 * ONE TRANSACTIONAL CUTOVER BOUNDARY (server-only, owner/systemDb).
 *
 * Every provider-credential mutation for a ConnectedAccount — connect, reconnect, rotation, backfill apply, and
 * (where relevant) revoke — MUST run through `withProviderCredentialAccountLock`. It opens a single DB transaction,
 * takes a transaction-scoped PostgreSQL advisory lock keyed by (tenant, account), revalidates the tenant/account
 * relationship INSIDE the transaction, and hands the caller the transaction client. Because every writer shares
 * the same collision-resistant key, a backfill can never interleave with a reconnect that replaces the credential
 * between the backfill's verification and its legacy-column clear.
 *
 * The lock uses the two-key `pg_advisory_xact_lock(int4, int4)` form via a PARAMETERIZED `$executeRaw` (never
 * `$executeRawUnsafe`). The transaction client is threaded into the tx-aware vault services so all reads/writes in
 * the critical section share ONE connection — never a silent fall-back to the global `systemDb`.
 */
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { systemDb } from "./index";

/** A Prisma client OR an interactive-transaction client — both expose the model delegates + `$executeRaw`. */
export type VaultExecutor = PrismaClient | Prisma.TransactionClient;

/** Raised when the (tenant, account) relationship does not hold inside the locked transaction. */
export class ProviderCredentialLockError extends Error {
  constructor(readonly reason: "account_not_in_tenant") {
    super(`provider_credential_lock_${reason}`);
    this.name = "ProviderCredentialLockError";
  }
}

/**
 * Two signed 32-bit advisory-lock keys derived from tenant + account identity. Collision-resistant (sha256) and
 * STABLE, so connect/reconnect/backfill/revoke on the same account always contend on the same lock. Never derived
 * from selected-project/session state or a mutable alias.
 */
export function advisoryLockKeys(tenantId: string, connectedAccountId: string): [number, number] {
  const h = createHash("sha256").update(`provider_credential:${tenantId}:${connectedAccountId}`).digest();
  return [h.readInt32BE(0), h.readInt32BE(4)];
}

export interface AccountLockArgs<T> {
  tenantId: string;
  connectedAccountId: string;
  /** Runs inside the locked transaction. ALL credential reads/writes here MUST use the provided `tx` client. */
  operation: (tx: Prisma.TransactionClient) => Promise<T>;
}

/**
 * Run `operation` inside a single transaction holding the (tenant, account) advisory lock, after revalidating that
 * the account genuinely belongs to the tenant. Rejects a cross-tenant/missing account (never mutates across
 * tenants). `opts.db` lets a caller supply a specific PrismaClient (owner); defaults to `systemDb`.
 */
export async function withProviderCredentialAccountLock<T>(args: AccountLockArgs<T>, opts?: { db?: PrismaClient; timeoutMs?: number }): Promise<T> {
  const client = opts?.db ?? systemDb;
  return client.$transaction(async (tx) => {
    const [k1, k2] = advisoryLockKeys(args.tenantId, args.connectedAccountId);
    // Parameterized advisory lock — the two int4 keys are bound params, never string-interpolated SQL.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${k1}::int4, ${k2}::int4)`;
    // Revalidate the tenant/account relationship INSIDE the transaction (owner client + explicit tenant filter).
    const acct = await tx.connectedAccount.findFirst({ where: { id: args.connectedAccountId, tenantId: args.tenantId }, select: { id: true } });
    if (!acct) throw new ProviderCredentialLockError("account_not_in_tenant");
    return args.operation(tx);
  }, opts?.timeoutMs ? { timeout: opts.timeoutMs } : undefined);
}
