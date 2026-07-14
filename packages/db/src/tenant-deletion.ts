/**
 * V1.45C1 — tenant-deletion lifecycle PRIMITIVES (DB-only; NO provider HTTP here — the orchestrator
 * in @guardora/sync sequences provider cleanup around these). Everything is idempotent, convergent,
 * fail-closed, and strictly tenant-scoped: a foreign tenant can never be affected.
 *
 * Ordering of the whole lifecycle (the orchestrator owns steps 2–4):
 *   1. requestTenantDeletion   — ATOMIC active→deleting + server-generated operationId + receipt +
 *                                session revocation. After this commits, no ordinary activity proceeds.
 *   2. provider + lease cleanup (orchestrator, reuses V1.45B disconnectAccount)
 *   3. purgeTenantWebhookEvents — explicit removal of tenant-linked raw webhook rows
 *   4. completeTenantDeletion   — ATOMIC final tenant cascade delete + receipt finalize (one tx)
 *
 * Steps 1 and 4 are each a single transaction, so there is NO crash boundary WITHIN them. Steps 2–3
 * are idempotent and retry-safe; a crash there leaves the tenant `deleting` (ordinary activity stays
 * blocked) and a retry resumes with the SAME operationId — never a second independent deletion.
 *
 * PRIVACY: the receipt and all returns carry aggregate, non-PII facts only (opaque ids, counts,
 * normalized classifications) — never tenant name, email, tokens, payloads, or raw exception text.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma, PrismaClient, TenantDeletionState, TenantDeletionStatus } from "@prisma/client";
import { prisma, systemDb } from "./index";
import { requirePlatformCapability } from "./platform-repo";

export type TenantDeletionAuthority = "tenant_owner" | "platform_admin";

export type TenantDeletionErrorCode =
  | "tenant_not_found"
  | "confirmation_mismatch"
  | "not_deleting"
  | "operation_mismatch";

/** Carries a normalized code only — never tenant name/PII. */
export class TenantDeletionError extends Error {
  readonly code: TenantDeletionErrorCode;
  constructor(code: TenantDeletionErrorCode) {
    super(`tenant_deletion_error:${code}`);
    this.name = "TenantDeletionError";
    this.code = code;
  }
}
export function isTenantDeletionError(e: unknown): e is TenantDeletionError {
  return e instanceof TenantDeletionError;
}

/** Constant-time confirmation compare (avoids leaking the tenant name via timing). */
function confirmationMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(String(provided ?? ""), "utf8");
  const b = Buffer.from(String(expected ?? ""), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface RequestTenantDeletionInput {
  /** Trusted tenant id (from a validated session or a protected platform action). Never client-supplied state. */
  tenantId: string;
  /** Actor user id — an OPAQUE handle stored on the receipt (not PII); nullable for system callers. */
  actorUserId: string | null;
  authority: TenantDeletionAuthority;
  /** Strong confirmation: must EXACTLY equal the tenant's name. */
  confirmationName: string;
}

export interface RequestTenantDeletionResult {
  operationId: string;
  /** true when the tenant was already `deleting` (or a concurrent request won): the caller converges. */
  alreadyDeleting: boolean;
  deletedTenantId: string;
}

/**
 * ATOMIC deletion request. Verifies confirmation, flips active→deleting via a conditional UPDATE
 * (the concurrency gate), generates a server-side operationId, creates the receipt, and revokes all
 * sessions for the tenant — ALL in one transaction. Convergent: two concurrent requests, or a repeat
 * request on an already-deleting tenant, both return the SAME operationId.
 */
export async function requestTenantDeletion(input: RequestTenantDeletionInput): Promise<RequestTenantDeletionResult> {
  const { tenantId, actorUserId, authority, confirmationName } = input;
  if (!tenantId || typeof tenantId !== "string") throw new TenantDeletionError("tenant_not_found");

  return systemDb.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, deletionState: true, deletionOperationId: true },
    });
    if (!tenant) throw new TenantDeletionError("tenant_not_found");

    // Confirmation is required in every case — an already-deleting tenant still demands proof.
    if (!confirmationMatches(confirmationName, tenant.name)) {
      throw new TenantDeletionError("confirmation_mismatch");
    }

    // Already deleting → converge on the existing operation (idempotent).
    if (tenant.deletionState === TenantDeletionState.deleting && tenant.deletionOperationId) {
      await ensureReceipt(tx, tenant.deletionOperationId, tenant.id, actorUserId, authority);
      await revokeSessionsForTenantTx(tx, tenant.id);
      return { operationId: tenant.deletionOperationId, alreadyDeleting: true, deletedTenantId: tenant.id };
    }

    const operationId = randomUUID();
    // Conditional flip — the ATOMIC gate. Only ONE transaction can move active→deleting; a concurrent
    // request's UPDATE matches 0 rows (it sees `deleting` after the winner commits) and converges.
    const flipped = await tx.tenant.updateMany({
      where: { id: tenant.id, deletionState: TenantDeletionState.active },
      data: { deletionState: TenantDeletionState.deleting, deletionRequestedAt: new Date(), deletionOperationId: operationId },
    });

    if (flipped.count === 0) {
      // Lost the race — re-read and converge on the winner's operation.
      const now = await tx.tenant.findUnique({ where: { id: tenant.id }, select: { deletionOperationId: true } });
      if (now?.deletionOperationId) {
        await ensureReceipt(tx, now.deletionOperationId, tenant.id, actorUserId, authority);
        await revokeSessionsForTenantTx(tx, tenant.id);
        return { operationId: now.deletionOperationId, alreadyDeleting: true, deletedTenantId: tenant.id };
      }
      // Should be unreachable (deleting always carries an operationId). Fail closed.
      throw new TenantDeletionError("not_deleting");
    }

    await ensureReceipt(tx, operationId, tenant.id, actorUserId, authority);
    await revokeSessionsForTenantTx(tx, tenant.id);
    return { operationId, alreadyDeleting: false, deletedTenantId: tenant.id };
  });
}

/** Platform-admin entry — authority is checked FRESH via V1.45A platform capability, never derived from tenant ownership. */
export async function requestTenantDeletionAsPlatformAdmin(
  actorUserId: string,
  tenantId: string,
  confirmationName: string,
): Promise<RequestTenantDeletionResult> {
  await requirePlatformCapability(actorUserId, "tenant:delete");
  return requestTenantDeletion({ tenantId, actorUserId, authority: "platform_admin", confirmationName });
}

/** Upsert the requested-state receipt for an operation. Idempotent (unique operationId). */
async function ensureReceipt(
  tx: Prisma.TransactionClient,
  operationId: string,
  tenantId: string,
  actorUserId: string | null,
  authority: TenantDeletionAuthority,
): Promise<void> {
  await tx.tenantDeletionReceipt.upsert({
    where: { operationId },
    create: {
      operationId,
      deletedTenantId: tenantId,
      requestedByUserId: actorUserId,
      initiatedAuthority: authority,
      status: TenantDeletionStatus.requested,
    },
    update: {}, // never downgrade / rewrite an existing receipt on convergence
  });
}

/** Revoke every non-revoked session whose ACTIVE tenant is the target. Idempotent. */
async function revokeSessionsForTenantTx(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
  const res = await tx.userSession.updateMany({
    where: { activeTenantId: tenantId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

/** Standalone bulk session revoke (idempotent) — safe to re-run during retries. */
export async function revokeSessionsForTenant(tenantId: string, client: PrismaClient = systemDb): Promise<number> {
  const res = await client.userSession.updateMany({
    where: { activeTenantId: tenantId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

/**
 * Explicitly purge raw webhook rows durably linked to the tenant (by the stored `tenantId`, NEVER by
 * parsing untrusted payloads). Idempotent and bounded. Legacy unlinked rows are NOT touched (they
 * remain subject to the future global retention purge — V1.45C3). `webhook_events` is a GLOBAL table
 * (no RLS), so this runs on the system client.
 */
export async function purgeTenantWebhookEvents(tenantId: string, client: PrismaClient = systemDb): Promise<number> {
  const res = await client.webhookEvent.deleteMany({ where: { tenantId } });
  return res.count;
}

export interface CompleteTenantDeletionInput {
  tenantId: string;
  operationId: string;
  providerAccountCount: number;
  /** Safe aggregate (counts by classification) — never tokens/bodies. Serialized as JSON. */
  providerResultSummary: unknown;
  webhookEventsPurged: number;
}

/**
 * FINAL step — ATOMIC. In ONE transaction: re-verify the tenant is still `deleting` with the EXPECTED
 * operationId, cascade-delete the tenant row (the verified FK graph removes ALL tenant-scoped data),
 * and finalize the receipt as `completed`. Because both live on the system DB, delete + finalize are
 * a single atomic unit — there is no crash boundary between them.
 *
 * Idempotent / crash-recovery: a retry after the tenant row is already gone finalizes (or returns the
 * already-`completed`) receipt for THIS operation. A stale operationId can never delete another
 * (restored/new) tenant lifecycle — the operationId check refuses it.
 */
export async function completeTenantDeletion(input: CompleteTenantDeletionInput) {
  const { tenantId, operationId, providerAccountCount, providerResultSummary, webhookEventsPurged } = input;
  return systemDb.$transaction(async (tx) => {
    const receipt = await tx.tenantDeletionReceipt.findUnique({ where: { operationId } });
    if (!receipt) throw new TenantDeletionError("operation_mismatch"); // unknown operation → refuse
    if (receipt.deletedTenantId !== tenantId) throw new TenantDeletionError("operation_mismatch");

    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, deletionState: true, deletionOperationId: true },
    });

    let tenantRowDeleted = receipt.tenantRowDeleted;
    if (tenant) {
      // Tenant still present — it MUST be deleting with the matching operation, else refuse.
      if (tenant.deletionState !== TenantDeletionState.deleting) throw new TenantDeletionError("not_deleting");
      if (tenant.deletionOperationId !== operationId) throw new TenantDeletionError("operation_mismatch");
      await tx.tenant.delete({ where: { id: tenantId } }); // DB cascade removes all tenant-scoped data
      tenantRowDeleted = true;
    } else {
      // Tenant already gone (retry after a prior committed delete) → finalize idempotently.
      tenantRowDeleted = true;
    }

    return tx.tenantDeletionReceipt.update({
      where: { operationId },
      data: {
        status: TenantDeletionStatus.completed,
        completedAt: receipt.completedAt ?? new Date(),
        tenantRowDeleted,
        providerAccountCount,
        providerResultSummary: (providerResultSummary ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        webhookEventsPurged,
        failureClass: null,
      },
    });
  });
}

/**
 * Record a recoverable failure on the receipt WITHOUT changing the tenant's `deleting` state (ordinary
 * activity stays blocked; a retry resumes with the same operationId). `failureClass` MUST be a
 * normalized allowlisted classification — never a raw exception message.
 */
export async function markTenantDeletionFailed(operationId: string, failureClass: string, client: PrismaClient = systemDb) {
  return client.tenantDeletionReceipt.updateMany({
    where: { operationId, status: { not: TenantDeletionStatus.completed } },
    data: { status: TenantDeletionStatus.failed, failureClass },
  });
}

export function getTenantDeletionReceipt(operationId: string, client: PrismaClient = systemDb) {
  return client.tenantDeletionReceipt.findUnique({ where: { operationId } });
}

export function getTenantDeletionReceiptByTenant(tenantId: string, client: PrismaClient = systemDb) {
  return client.tenantDeletionReceipt.findFirst({ where: { deletedTenantId: tenantId }, orderBy: { requestedAt: "desc" } });
}
