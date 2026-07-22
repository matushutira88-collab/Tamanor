/**
 * V1.75 (P0) — integration tests for the "truthful account health" hotfix. Drives the REAL
 * runReadOnlySync / real repositories / real notification dedup against a local Postgres, plus
 * source-level assertions that the shared resolver + bulk server action are wired truthfully.
 *
 * Covers the P0 bullets:
 *  - an all-items-failed sync records `sync.failed`, NEVER `sync.completed`
 *  - a partial success records `sync.partial`, NEVER `sync.completed`
 *  - the cron/worker selection SKIPS monitoring-disabled accounts (findMetaSyncCandidates /
 *    findAccountsForTokenCheck)
 *  - the reconnect notification is deduplicated (never recreated for the same account)
 *  - disconnect is idempotent; cross-tenant reads/writes are denied by RLS (bulk safety)
 *  - the bulk server action is permission-checked, tenant-scoped, audited, idempotent, capped
 *  - manual sync is blocked on reauth; dashboard + accounts table use the ONE resolver
 *
 * Run: DATABASE_URL=<local> pnpm connection-truth:test   (never point this at production)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { systemDb, withTenant, findMetaSyncCandidates, findAccountsForTokenCheck, setAccountMonitoring, createNotification } from "@guardora/db";
// @guardora/sync is not a dependency of @guardora/db — import via relative path (same as sync-verdict.test.ts).
import { runReadOnlySync, disconnectAccount } from "../../sync/src/index";
import { notificationDedupeKey } from "@guardora/core";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const sfx = Date.now().toString(36);
  const mkTenant = async (tag: string) => {
    // internalAccess → full_access, so the read-only-sync billing gate never pauses these fixtures.
    const t = await systemDb.tenant.create({ data: { name: `Ct${tag}`, slug: `ct-${tag}-${sfx}`, internalAccess: true } });
    const b = await systemDb.brand.create({ data: { tenantId: t.id, name: `CtB${tag}` } });
    return { t, b };
  };
  const A = await mkTenant("a");
  const B = await mkTenant("b");
  // Each account gets its OWN brand — a brand holds at most one account per platform (partial-unique index).
  const mkAcc = async (T: { t: { id: string } }, tag: string, over: Record<string, unknown> = {}) => {
    const brand = await systemDb.brand.create({ data: { tenantId: T.t.id, name: `CtB_${tag}_${sfx}` } });
    return systemDb.connectedAccount.create({ data: {
      tenantId: T.t.id, brandId: brand.id, platform: "facebook_page", status: "mock_connected", mode: "placeholder",
      externalId: `CT_${tag}_${sfx}`, pageId: `CT_${tag}_${sfx}`, health: "healthy", monitoringEnabled: true, ...over,
    } as never });
  };

  const auditEvents = (accountId: string) =>
    withTenant(A.t.id, (db) => db.auditLog.findMany({ where: { targetId: accountId, event: { startsWith: "sync." } }, select: { event: true } }));

  try {
    // ---- A) Sync result truthfulness ----
    // A1) ALL items fail (throw for every item) → verdict failed → `sync.failed`, never `sync.completed`.
    const failAcc = await mkAcc(A, "fail");
    let calls = 0;
    const rFail = await runReadOnlySync({ accountId: failAcc.id, tenantId: A.t.id }, "manual", { beforeReputationCreate: () => { calls++; throw new Error("simulated item failure"); } });
    const failEvents = (await auditEvents(failAcc.id)).map((e) => e.event);
    check("A1) all-items-failed sync → verdict failed, ok=false", rFail.verdict === "failed" && rFail.ok === false, `${rFail.verdict}/${rFail.ok}`);
    check("A1) failed sync records sync.failed and NEVER sync.completed", failEvents.includes("sync.failed") && !failEvents.includes("sync.completed"), failEvents.join(","));
    check("A1) SyncRun recorded as failed (not completed)", (await withTenant(A.t.id, (db) => db.syncRun.count({ where: { connectedAccountId: failAcc.id, status: "failed" } }))) === 1
      && (await withTenant(A.t.id, (db) => db.syncRun.count({ where: { connectedAccountId: failAcc.id, status: "completed" } }))) === 0);

    // A2) Partial (first item fails, rest succeed) → `sync.partial`, never `sync.completed`.
    const partAcc = await mkAcc(A, "part");
    let n = 0;
    const rPart = await runReadOnlySync({ accountId: partAcc.id, tenantId: A.t.id }, "manual", { beforeReputationCreate: () => { if (n++ === 0) throw new Error("one bad item"); } });
    const partEvents = (await auditEvents(partAcc.id)).map((e) => e.event);
    check("A2) partial success → verdict partial_success", rPart.verdict === "partial_success", rPart.verdict);
    check("A2) partial sync records sync.partial and NEVER sync.completed", partEvents.includes("sync.partial") && !partEvents.includes("sync.completed"), partEvents.join(","));

    // A3) Clean success baseline → `sync.completed`.
    const okAcc = await mkAcc(A, "ok");
    const rOk = await runReadOnlySync({ accountId: okAcc.id, tenantId: A.t.id }, "manual");
    const okEvents = (await auditEvents(okAcc.id)).map((e) => e.event);
    check("A3) clean success → verdict success + sync.completed", rOk.verdict === "success" && okEvents.includes("sync.completed") && !okEvents.includes("sync.failed"));

    // ---- B) Cron/worker selection honours the per-account auto-sync (monitoring) toggle ----
    const monOn = await mkAcc(A, "monon", { status: "active", mode: "read_only", monitoringEnabled: true });
    const monOff = await mkAcc(A, "monoff", { status: "active", mode: "read_only", monitoringEnabled: false });
    const candidates = await findMetaSyncCandidates(["active"]);
    const candIds = new Set(candidates.map((c) => c.id));
    check("B1) cron candidates INCLUDE a monitoring-enabled active account", candIds.has(monOn.id));
    check("B1) cron candidates EXCLUDE a monitoring-DISABLED account (was the bug)", !candIds.has(monOff.id));

    const tokOn = await mkAcc(A, "tokon", { status: "active", mode: "read_only", monitoringEnabled: true, tokenExpiresAt: new Date(Date.now() + 86_400_000) });
    const tokOff = await mkAcc(A, "tokoff", { status: "active", mode: "read_only", monitoringEnabled: false, tokenExpiresAt: new Date(Date.now() + 86_400_000) });
    const tokenCheck = await findAccountsForTokenCheck();
    const tokIds = new Set(tokenCheck.map((c) => c.id));
    check("B2) token watchdog EXCLUDES a monitoring-disabled account (no reconnect spam)", tokIds.has(tokOn.id) && !tokIds.has(tokOff.id));

    // ---- C) Reconnect notification is deduplicated (never recreated for the same account) ----
    const notifAcc = await mkAcc(A, "notif");
    const dk = notificationDedupeKey("account_reconnect_required", notifAcc.id);
    const mkNotif = () => createNotification({
      tenantId: A.t.id, type: "account_reconnect_required",
      titleKey: "notif.account_reconnect_required.title", messageKey: "notif.account_reconnect_required.body",
      dedupeKey: dk, metadata: { accountId: notifAcc.id, brandId: A.b.id },
    });
    const first = await mkNotif();
    const second = await mkNotif();
    const notifCount = await withTenant(A.t.id, (db) => db.notification.count({ where: { dedupeKey: dk } }));
    check("C) reconnect notification is created ONCE and deduped (second is a no-op)", first.created === true && second.created === false && notifCount === 1, `${first.created}/${second.created}/${notifCount}`);

    // ---- D) Bulk safety primitives: idempotent disconnect + RLS tenant scoping ----
    const dcAcc = await mkAcc(A, "dc", { status: "active", mode: "read_only" });
    const d1 = await disconnectAccount(A.t.id, dcAcc.id);
    const d2 = await disconnectAccount(A.t.id, dcAcc.id); // idempotent — no throw, still disconnected
    const dcStatus = await withTenant(A.t.id, (db) => db.connectedAccount.findFirst({ where: { id: dcAcc.id }, select: { status: true } }));
    check("D1) disconnect is idempotent (second call does not throw; stays disconnected)", !!d1.account && !!d2.account && dcStatus?.status === "disconnected");

    // Cross-tenant: tenant B can neither SEE nor MUTATE tenant A's account (RLS). This is exactly what
    // makes the bulk snapshot safe — a foreign id never appears and setAccountMonitoring touches 0 rows.
    const crossAcc = await mkAcc(A, "cross", { status: "active", mode: "read_only", monitoringEnabled: true });
    const bSees = await withTenant(B.t.id, (db) => db.connectedAccount.findMany({ where: { id: { in: [crossAcc.id] } }, select: { id: true } }));
    const bMutated = await setAccountMonitoring(B.t.id, crossAcc.id, false); // wrong tenant → 0 rows
    const stillOn = await withTenant(A.t.id, (db) => db.connectedAccount.findFirst({ where: { id: crossAcc.id }, select: { monitoringEnabled: true } }));
    check("D2) cross-tenant denial: tenant B cannot see or disable tenant A's account", bSees.length === 0 && bMutated === 0 && stillOn?.monitoringEnabled === true);

    // ---- E) Source-level truthfulness/wiring assertions ----
    const bulk = readSrc("apps/web/src/app/dashboard/accounts/bulk-actions.ts");
    check("E1) bulk action is permission-checked (ConnectorManage), same-origin, tenant-scoped, audited, capped",
      bulk.includes("assertCan(session.role, Permission.ConnectorManage)") && bulk.includes("isSameOrigin") && bulk.includes("withTenant(") && bulk.includes("writeAudit(") && bulk.includes("BULK_MAX"));
    check("E1) bulk action reports success/already/failed and has both bulk operations",
      bulk.includes('"success"') && bulk.includes('"already"') && bulk.includes('"failed"') && bulk.includes("bulkDisconnectAccounts") && bulk.includes("bulkDisableMonitoring")
      && bulk.includes("connector.bulk_disconnected") && bulk.includes("connector.bulk_monitoring_disabled"));

    const actions = readSrc("apps/web/src/app/dashboard/accounts/actions.ts");
    check("E2) manual sync is blocked on reauth (resolveConnectionState + manualSyncBlocked + reconnect notice)",
      actions.includes("resolveConnectionState") && actions.includes("manualSyncBlocked") && actions.includes("Reconnect the account first"));

    const metrics = readSrc("packages/db/src/dashboard-metrics.ts");
    const table = readSrc("apps/web/src/components/dashboard/accounts-table.tsx");
    check("E3) dashboard metrics AND accounts table use the ONE resolver (resolveConnectionState / connectionState)",
      metrics.includes("resolveConnectionState") && metrics.includes("resolveAutoSyncState") && table.includes("row.connectionState") && table.includes("CONNECTION_STATE_PRESENTATION"));

    const syncSrc = readSrc("packages/sync/src/index.ts");
    check("E4) failed verdict emits sync.failed (never sync.completed) at the terminal write",
      syncSrc.includes("terminalEvent") && syncSrc.includes(': "sync.failed"') && syncSrc.includes('emitOpsEvent("sync.failed"'));

    const repos = readSrc("packages/db/src/repositories.ts");
    check("E5) cron selection queries filter monitoringEnabled: true",
      (repos.match(/monitoringEnabled: true/g) ?? []).length >= 2);

    console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — account health truthfulness + bulk safety (V1.75)`);
    await systemDb.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  } finally {
    // Best-effort cleanup of both tenants (cascades to brands/accounts/audit/notifications/sync rows).
    await systemDb.tenant.deleteMany({ where: { id: { in: [A.t.id, B.t.id] } } }).catch(() => {});
  }
}
run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
