"use server";

import { revalidatePath } from "next/cache";
import { Permission, assertCan } from "@guardora/core";
import { disconnectAccount } from "@guardora/sync";
import { withTenant, setAccountMonitoring } from "@guardora/db";
import { requireSession } from "@/server/auth";
import { writeAudit } from "@/server/audit";
import { isSameOrigin } from "@/server/csrf";

/**
 * V1.75 (P0) — SERVER-SIDE bulk account actions. Every action is:
 *   - tenant-scoped (all reads/writes go through withTenant / disconnectAccount / setAccountMonitoring,
 *     which run under RLS with the session's tenant — a foreign/cross-tenant id simply never matches),
 *   - permission-checked (ConnectorManage — Owner/Admin only),
 *   - same-origin checked (CSRF),
 *   - idempotent (an already-disconnected / already-unmonitored account reports "already", not "failed",
 *     and no duplicate work is done),
 *   - audited (one audit row per successful item + one summary row per batch),
 *   - partial-failure aware (a per-item outcome list; one item failing never aborts the rest).
 * Max batch is 200 (server-enforced) — the same cap as the inbox bulk bar.
 */

export type BulkOutcome = "success" | "already" | "failed";

export interface BulkActionResult {
  /** false ONLY for a gate rejection (empty selection / csrf). Per-item failures keep ok:true. */
  ok: boolean;
  /** Count of items that were actually changed by this action. */
  affected: number;
  results: Array<{ id: string; outcome: BulkOutcome }>;
  reason?: string;
}

const BULK_MAX = 200;

function normalizeIds(ids: string[]): string[] {
  return [...new Set((ids ?? []).filter((x) => typeof x === "string" && x.length > 0))].slice(0, BULK_MAX);
}

function summarize(results: Array<{ id: string; outcome: BulkOutcome }>) {
  return {
    affected: results.filter((r) => r.outcome === "success").length,
    already: results.filter((r) => r.outcome === "already").length,
    failed: results.filter((r) => r.outcome === "failed").length,
  };
}

/** Disconnect every selected account (idempotent). Already-disconnected/absent ids report "already". */
export async function bulkDisconnectAccounts(rawIds: string[]): Promise<BulkActionResult> {
  const session = await requireSession();
  assertCan(session.role, Permission.ConnectorManage);
  if (!(await isSameOrigin())) return { ok: false, affected: 0, results: [], reason: "csrf" };
  const ids = normalizeIds(rawIds);
  if (ids.length === 0) return { ok: false, affected: 0, results: [], reason: "empty_selection" };

  // Tenant-scoped snapshot: cross-tenant / absent ids never appear here → they resolve to "already".
  const existing = await withTenant(session.tenantId, (db) =>
    db.connectedAccount.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }),
  );
  const statusById = new Map(existing.map((a) => [a.id, a.status as unknown as string]));

  const results: Array<{ id: string; outcome: BulkOutcome }> = [];
  for (const id of ids) {
    const status = statusById.get(id);
    if (status === undefined || status === "disconnected") { results.push({ id, outcome: "already" }); continue; }
    try {
      const { account, revoke, status: dStatus, cluster, manualCleanupRecommended } = await disconnectAccount(session.tenantId, id);
      if (!account) { results.push({ id, outcome: "already" }); continue; }
      await writeAudit({
        session, event: "connector.disconnected", brandId: account.brandId,
        targetType: "connected_account", targetId: account.id,
        metadata: {
          platform: account.platform, localCredentialsRemoved: true, providerRevoke: revoke, status: dStatus,
          clusterCount: cluster.count, clusterPlatforms: cluster.platforms, manualCleanupRecommended,
          resultingStatus: "disconnected", bulk: true,
        },
      });
      results.push({ id, outcome: "success" });
    } catch {
      results.push({ id, outcome: "failed" });
    }
  }

  const s = summarize(results);
  await writeAudit({ session, event: "connector.bulk_disconnected", targetType: "connected_account", metadata: { requested: ids.length, ...s } }).catch(() => {});
  revalidatePath("/dashboard/accounts");
  return { ok: true, affected: s.affected, results };
}

/** Turn OFF monitoring (automatic sync) for every selected account (idempotent). */
export async function bulkDisableMonitoring(rawIds: string[]): Promise<BulkActionResult> {
  const session = await requireSession();
  assertCan(session.role, Permission.ConnectorManage);
  if (!(await isSameOrigin())) return { ok: false, affected: 0, results: [], reason: "csrf" };
  const ids = normalizeIds(rawIds);
  if (ids.length === 0) return { ok: false, affected: 0, results: [], reason: "empty_selection" };

  const existing = await withTenant(session.tenantId, (db) =>
    db.connectedAccount.findMany({ where: { id: { in: ids } }, select: { id: true, monitoringEnabled: true } }),
  );
  const monById = new Map(existing.map((a) => [a.id, a.monitoringEnabled]));

  const results: Array<{ id: string; outcome: BulkOutcome }> = [];
  for (const id of ids) {
    const mon = monById.get(id);
    if (mon === undefined || mon === false) { results.push({ id, outcome: "already" }); continue; }
    try {
      const count = await setAccountMonitoring(session.tenantId, id, false); // RLS-scoped updateMany
      if (count > 0) {
        await writeAudit({ session, event: "connector.monitoring_disabled", targetType: "connected_account", targetId: id, metadata: { bulk: true } });
        results.push({ id, outcome: "success" });
      } else {
        results.push({ id, outcome: "already" });
      }
    } catch {
      results.push({ id, outcome: "failed" });
    }
  }

  const s = summarize(results);
  await writeAudit({ session, event: "connector.bulk_monitoring_disabled", targetType: "connected_account", metadata: { requested: ids.length, ...s } }).catch(() => {});
  revalidatePath("/dashboard/accounts");
  return { ok: true, affected: s.affected, results };
}
