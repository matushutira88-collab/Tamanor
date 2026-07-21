/**
 * V1.70 (Release B / B2) — notification repository + RLS integration tests (REAL local Postgres, TWO
 * tenants). Seed as owner (systemDb); prove RLS isolation as the NON-bypassrls tamanor_app role. Covers:
 * dedupe, unread count, mark-read, mark-all-read, tenant-wide vs user-scoped visibility, sanitized
 * metadata (no tokens), and hard RLS isolation (a forgotten tenantId is still isolated).
 * Run: pnpm notification-repo:test  (needs DATABASE_URL=local owner + APP_DATABASE_URL=tamanor_app)
 */
import { PrismaClient } from "@prisma/client";
import {
  systemDb, withTenantDb,
  createNotification, unreadNotificationCount, listNotifications, markNotificationRead, markAllNotificationsRead,
} from "@guardora/db";

const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) {
  console.error(`REFUSING to run: DATABASE_URL is not local (${DB.replace(/:\/\/[^@]*@/, "://***@")})`);
  process.exit(1);
}

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
};
async function rejects(fn: () => Promise<unknown>): Promise<boolean> { try { await fn(); return false; } catch { return true; } }

function appUrl(): string {
  const a = process.env.APP_DATABASE_URL;
  if (a && a !== DB) return a;
  return DB.replace(/\/\/([^:@/]+):[^@]*@/, (_m, u: string) => { const d = u.indexOf("."); return `//tamanor_app${d >= 0 ? u.slice(d) : ""}:tamanor_app@`; });
}

async function run() {
  const app = new PrismaClient({ datasourceUrl: appUrl() });
  const sfx = Date.now().toString(36);
  const A = await systemDb.tenant.create({ data: { name: "NfA", slug: `nf-a-${sfx}` } });
  const B = await systemDb.tenant.create({ data: { name: "NfB", slug: `nf-b-${sfx}` } });
  const userA = await systemDb.user.create({ data: { email: `nfa-${sfx}@t.local` } });
  const userA2 = await systemDb.user.create({ data: { email: `nfa2-${sfx}@t.local` } });
  await systemDb.membership.create({ data: { userId: userA.id, tenantId: A.id, role: "owner" } });

  try {
    // 1) create + dedupe ---------------------------------------------------------------------------
    const r1 = await createNotification({ tenantId: A.id, type: "sync_failed", titleKey: "notif.sync_failed.title", messageKey: "notif.sync_failed.body", dedupeKey: "sync_failed:acct1:2026-07-20" });
    check("create → created:true", r1.created === true && !!r1.id);
    const r2 = await createNotification({ tenantId: A.id, type: "sync_failed", titleKey: "notif.sync_failed.title", messageKey: "notif.sync_failed.body", dedupeKey: "sync_failed:acct1:2026-07-20" });
    check("same dedupeKey → created:false (dedupe, no spam)", r2.created === false);
    const r3 = await createNotification({ tenantId: A.id, type: "sync_failed", titleKey: "notif.sync_failed.title", messageKey: "notif.sync_failed.body", dedupeKey: "sync_failed:acct1:2026-07-21" });
    check("different day bucket → created (recurs once/day)", r3.created === true);

    // 2) sanitized metadata (no tokens) ------------------------------------------------------------
    const rSan = await createNotification({ tenantId: A.id, userId: userA.id, type: "account_reconnect_required", titleKey: "notif.reconnect.title", messageKey: "notif.reconnect.body", dedupeKey: "reconnect:acct1", metadata: { accountName: "Page X", accessToken: "eyJsecret", refreshToken: "r", nested: { token: "x" }, count: 2 } });
    const sanRow = await systemDb.notification.findFirst({ where: { id: rSan.id! }, select: { metadata: true } });
    const metaStr = JSON.stringify(sanRow?.metadata);
    check("metadata sanitized: no token/secret keys, no nested objects", !/token|secret|eyJ|refresh/i.test(metaStr) && /Page X/.test(metaStr) && /"count":2/.test(metaStr), metaStr);

    // 3) unread count + visibility (tenant-wide vs user) -------------------------------------------
    // Seeded so far for A visible to userA: r1(tenant-wide), r3(tenant-wide), rSan(userA). = 3 unread.
    check("unread count for userA = 3 (2 tenant-wide + 1 addressed)", (await unreadNotificationCount(A.id, userA.id)) === 3);
    check("unread count for userA2 = 2 (only the tenant-wide ones)", (await unreadNotificationCount(A.id, userA2.id)) === 2);

    // 4) mark one read -----------------------------------------------------------------------------
    check("mark r1 read → 1 changed", (await markNotificationRead(A.id, r1.id!, userA.id)) === 1);
    check("mark r1 read again → 0 (already read)", (await markNotificationRead(A.id, r1.id!, userA.id)) === 0);
    check("unread count now 2 for userA", (await unreadNotificationCount(A.id, userA.id)) === 2);

    // 5) mark all read -----------------------------------------------------------------------------
    check("mark all read for userA → 2 changed", (await markAllNotificationsRead(A.id, userA.id)) === 2);
    check("unread count now 0 for userA", (await unreadNotificationCount(A.id, userA.id)) === 0);
    check("inbox still lists read notifications (paginated)", (await listNotifications(A.id, userA.id, { limit: 10 })).length === 3);

    // 6) HARD RLS isolation via tamanor_app --------------------------------------------------------
    await createNotification({ tenantId: B.id, type: "payment_failed", titleKey: "notif.payment_failed.title", messageKey: "notif.payment_failed.body", dedupeKey: "payment_failed:B" });
    const aVisible = await withTenantDb(A.id, (db) => db.notification.findMany(), app); // NO tenantId filter
    check("RLS: A-context sees only A's notifications (forgotten tenantId still isolated)", aVisible.length === 3 && aVisible.every((n) => n.tenantId === A.id));
    check("RLS: A-context cannot read B's notification by id", (await withTenantDb(A.id, (db) => db.notification.findFirst({ where: { tenantId: B.id } }), app)) === null);
    check("RLS: A cannot INSERT a notification for tenant B (WITH CHECK)", await rejects(() => withTenantDb(A.id, (db) => db.notification.create({ data: { tenantId: B.id, type: "sync_failed", titleKey: "x", messageKey: "x", dedupeKey: `evil:${sfx}` } }), app)));
    const forced: Array<{ f: boolean }> = await app.$queryRawUnsafe(`SELECT relforcerowsecurity AS f FROM pg_class WHERE relname='notifications'`);
    check("RLS: FORCE row security active on notifications", forced[0]?.f === true);
  } finally {
    await app.$disconnect();
    await systemDb.notification.deleteMany({ where: { tenantId: { in: [A.id, B.id] } } });
    await systemDb.membership.deleteMany({ where: { tenantId: A.id } });
    await systemDb.user.deleteMany({ where: { id: { in: [userA.id, userA2.id] } } });
    await systemDb.tenant.deleteMany({ where: { id: { in: [A.id, B.id] } } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — notification repo + RLS (V1.70 B2)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error(String(e).slice(0, 500)); await systemDb.$disconnect(); process.exit(1); });
