/**
 * V1.45C1 — tenant-deletion ORCHESTRATOR. Lives in @guardora/sync because it REUSES the canonical
 * V1.45B `disconnectAccount` (cluster-aware, credential-clearing, lease-invalidating, provider-truthful).
 * It sequences the phases that involve provider work AROUND the DB-only primitives in @guardora/db.
 *
 * Provider HTTP happens ONLY inside `disconnectAccount` (which does it OUTSIDE any DB transaction) —
 * never inside a transaction here. Every step is idempotent and retry-safe; on a recoverable failure the
 * tenant stays `deleting` (ordinary activity stays blocked) and the receipt records a NORMALIZED failure
 * class (never a raw exception). A retry resumes with the SAME operationId — never a second deletion.
 */
import {
  requestTenantDeletion,
  completeTenantDeletion,
  markTenantDeletionFailed,
  purgeTenantWebhookEvents,
  revokeSessionsForTenant,
  findTenantConnectedAccountsForCleanup,
  findTenantsPendingDeletion,
  deleteTenantSyncLeases,
  type RequestTenantDeletionInput,
  type RequestTenantDeletionResult,
} from "@guardora/db";
import { disconnectAccount } from "./disconnect";
import type { RevokeTransport } from "./provider-revoke";

/** Normalized, allowlisted failure classifications — the ONLY values ever written to a receipt. */
export type TenantDeletionFailureClass =
  | "provider_cleanup_failed"
  | "lease_cleanup_failed"
  | "session_revoke_failed"
  | "webhook_purge_failed"
  | "cascade_failed"
  | "unknown_failure";

/** SAFE aggregate provider summary — counts/booleans/opaque ids only. NEVER tokens, bodies, or PII. */
export interface ProviderCleanupSummary {
  accounts: number;
  clustersInvalidated: number;
  notFound: number;
  byStatus: Record<string, number>;
  byRevocation: Record<string, number>;
  /** true if any Meta authorization may persist at the provider until expiry (revoke unsupported/failed). */
  manualCleanupRecommended: boolean;
}

export interface ExecuteTenantDeletionInput {
  tenantId: string;
  operationId: string;
  /** Test-only revoke transport seam (production Meta revoke is unsupported → no network). */
  transport?: RevokeTransport;
}

function inc(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

/**
 * Steps 2–4 of the lifecycle (the tenant is already marked `deleting`):
 *  2. disconnect every connected account (V1.45B cluster semantics) + drop all sync leases,
 *  3. revoke sessions (idempotent) + explicitly purge tenant-linked webhook rows,
 *  4. ATOMIC final cascade delete + receipt finalize.
 * Idempotent: safe to re-run after a partial failure.
 */
export async function executeTenantDeletion(input: ExecuteTenantDeletionInput) {
  const { tenantId, operationId, transport } = input;

  // --- Step 2a: provider disconnect for every account (cluster-aware, idempotent). ---
  const summary: ProviderCleanupSummary = {
    accounts: 0, clustersInvalidated: 0, notFound: 0, byStatus: {}, byRevocation: {}, manualCleanupRecommended: false,
  };
  try {
    const accounts = await findTenantConnectedAccountsForCleanup(tenantId);
    summary.accounts = accounts.length;
    const cleared = new Set<string>(); // account ids already invalidated via a prior cluster clear
    for (const acct of accounts) {
      if (cleared.has(acct.id)) continue; // avoid double-counting a Page/IG cluster member
      const res = await disconnectAccount(tenantId, acct.id, { transport });
      if (!res.account) { summary.notFound += 1; cleared.add(acct.id); continue; }
      summary.clustersInvalidated += 1;
      inc(summary.byStatus, res.status);
      inc(summary.byRevocation, res.providerRevocation);
      if (res.manualCleanupRecommended) summary.manualCleanupRecommended = true;
      for (const id of res.cluster.accountIds) cleared.add(id);
      cleared.add(acct.id);
    }
  } catch {
    await markTenantDeletionFailed(operationId, "provider_cleanup_failed" satisfies TenantDeletionFailureClass);
    throw new TenantDeletionOrchestrationError("provider_cleanup_failed");
  }

  // --- Step 2b: drop any remaining sync leases for the tenant. ---
  try {
    await deleteTenantSyncLeases(tenantId);
  } catch {
    await markTenantDeletionFailed(operationId, "lease_cleanup_failed" satisfies TenantDeletionFailureClass);
    throw new TenantDeletionOrchestrationError("lease_cleanup_failed");
  }

  // --- Step 3a: session revocation (idempotent; also done at request time). ---
  try {
    await revokeSessionsForTenant(tenantId);
  } catch {
    await markTenantDeletionFailed(operationId, "session_revoke_failed" satisfies TenantDeletionFailureClass);
    throw new TenantDeletionOrchestrationError("session_revoke_failed");
  }

  // --- Step 3b: explicit webhook purge (by durable tenantId link, not payload parsing). ---
  let webhookEventsPurged = 0;
  try {
    webhookEventsPurged = await purgeTenantWebhookEvents(tenantId);
  } catch {
    await markTenantDeletionFailed(operationId, "webhook_purge_failed" satisfies TenantDeletionFailureClass);
    throw new TenantDeletionOrchestrationError("webhook_purge_failed");
  }

  // --- Step 4: ATOMIC final cascade delete + receipt finalize. ---
  try {
    return await completeTenantDeletion({
      tenantId,
      operationId,
      providerAccountCount: summary.accounts,
      providerResultSummary: summary,
      webhookEventsPurged,
    });
  } catch (e) {
    await markTenantDeletionFailed(operationId, "cascade_failed" satisfies TenantDeletionFailureClass);
    throw e;
  }
}

export interface DeleteTenantResult {
  operationId: string;
  alreadyDeleting: boolean;
  receipt: Awaited<ReturnType<typeof completeTenantDeletion>>;
}

/**
 * High-level entry: ATOMIC request transition (mark deleting + receipt + session revoke) followed by
 * the orchestrated cleanup + final delete. There is no queue by design (V1.45C1) — cleanup runs
 * inline. Idempotent end-to-end: a repeat call converges on the same operation and finalizes safely.
 */
export async function deleteTenant(input: RequestTenantDeletionInput & { transport?: RevokeTransport }): Promise<DeleteTenantResult> {
  const { transport, ...requestInput } = input;
  const requested: RequestTenantDeletionResult = await requestTenantDeletion(requestInput);
  const receipt = await executeTenantDeletion({ tenantId: requested.deletedTenantId, operationId: requested.operationId, transport });
  return { operationId: requested.operationId, alreadyDeleting: requested.alreadyDeleting, receipt };
}

export interface ResumePendingDeletionsResult {
  pending: number;
  resumed: number;
  failed: number;
}

/**
 * V1.45C1 — PRODUCTION resume path for stranded deletions (the required non-test recovery mechanism).
 *
 * A crash or web-request timeout AFTER the request transition (which revokes the initiator's session)
 * leaves a tenant `deleting` with no user able to retry — a deleting tenant is unreachable (session
 * hydration + resolveActiveTenant both exclude it) and there is no operator UI. This SYSTEM runner —
 * invoked by the worker maintenance tick — finds each stranded operation and resumes it with the
 * tenant's OWN trusted, server-generated operationId, using system/explicit context (NO session).
 *
 * Idempotent and convergent: it never creates a second independent deletion, and a concurrent inline
 * run + resume converge on one completed receipt. `staleMs` skips a fresh deletion still running inline.
 * NOT a general queue — a narrow, single-purpose resume of the existing operation.
 */
export async function resumePendingTenantDeletions(opts?: { staleMs?: number; nowMs?: number; transport?: RevokeTransport }): Promise<ResumePendingDeletionsResult> {
  const staleMs = opts?.staleMs ?? 60_000;
  const now = opts?.nowMs ?? Date.now();
  const olderThan = new Date(now - staleMs);
  const pending = await findTenantsPendingDeletion(olderThan);
  let resumed = 0;
  let failed = 0;
  for (const t of pending) {
    // A `deleting` tenant ALWAYS carries an operationId (set atomically in the same transaction);
    // a null here is a corrupt invariant → skip (do not fabricate an operation id).
    if (!t.deletionOperationId) { failed += 1; continue; }
    try {
      await executeTenantDeletion({ tenantId: t.id, operationId: t.deletionOperationId, transport: opts?.transport });
      resumed += 1;
    } catch {
      // Stays `deleting`; the failure class is already recorded on the receipt and a later tick retries.
      failed += 1;
    }
  }
  return { pending: pending.length, resumed, failed };
}

/** Thrown for a recoverable orchestration failure. Carries a normalized class only — never PII/raw errors. */
export class TenantDeletionOrchestrationError extends Error {
  readonly code: TenantDeletionFailureClass;
  constructor(code: TenantDeletionFailureClass) {
    super(`tenant_deletion_orchestration_failed:${code}`);
    this.name = "TenantDeletionOrchestrationError";
    this.code = code;
  }
}
