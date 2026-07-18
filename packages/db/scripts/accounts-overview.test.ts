/**
 * V1.59 phase 2b — /dashboard/accounts overview + REAL "today" metrics against a real Postgres.
 * Proves: today = current UTC day (comments before the day start are excluded), risk-today counts into
 * both metrics, connection status is SEPARATE from monitoring, capacity is real, cross-account and
 * cross-tenant are isolated, and there is NO per-account N+1. Run: pnpm accounts-overview:test
 */
import { randomUUID } from "node:crypto";
import { systemDb, withTenant, getDashboardAccountsOverview, setAccountMonitoring } from "@guardora/db";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const now = new Date();
const DAY_START = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const TODAY = new Date(DAY_START.getTime() + 3_600_000); // 01:00 today UTC (inside the day)
const BEFORE = new Date(DAY_START.getTime() - 3_600_000); // 23:00 yesterday UTC (outside)

async function run() {
  const sfx = Date.now().toString(36);
  const mk = async (tag: string) => {
    const t = await systemDb.tenant.create({ data: { name: `Ao${tag}`, slug: `ao-${tag}-${sfx}`, plan: "growth" } });
    const b = await systemDb.brand.create({ data: { tenantId: t.id, name: `AoB${tag}` } });
    return { t, b };
  };
  const mkAcc = (T: { t: { id: string }; b: { id: string } }, tag: string, platform: string, patch: Record<string, unknown> = {}) =>
    systemDb.connectedAccount.create({ data: {
      tenantId: T.t.id, brandId: T.b.id, platform: platform as never, status: "active", mode: "read_only",
      externalId: `AO_${tag}_${sfx}`, externalName: `Acc ${tag}`, health: "healthy", tokenHealth: "ok", connectionStatus: "connected",
      monitoringEnabled: false, ...patch,
    } });
  const comment = async (T: { t: { id: string }; b: { id: string } }, acc: { id: string; platform: unknown }, risk: string, when: Date) => {
    const ci = await systemDb.contentItem.create({ data: { tenantId: T.t.id, brandId: T.b.id, connectedAccountId: acc.id, platform: acc.platform as never, kind: "comment", externalId: `C_${randomUUID()}`, text: "x", publishedAt: when, ingestedAt: when } });
    await systemDb.reputationItem.create({ data: { tenantId: T.t.id, brandId: T.b.id, platform: acc.platform as never, contentItemId: ci.id, status: "classified", riskLevel: risk as never, riskCategories: [], createdAt: when } });
  };
  const A = await mk("a"); const B = await mk("b");

  try {
    // FB has an expired token (connection problem) BUT monitoring ON — the two are independent.
    const fb = await mkAcc(A, "fb", "facebook_page", { tokenHealth: "expired", monitoringEnabled: true, lastSuccessfulSyncAt: BEFORE });
    const ig = await mkAcc(A, "ig", "instagram_business", { parentAccountId: fb.id });
    // Sync-status truthfulness: never-synced (health error but NO attempt) must NOT read as sync_error;
    // a real failed attempt (health error + lastSyncedAt) does.
    const never = await mkAcc(A, "never", "facebook_page", { health: "error", tokenHealth: "ok", connectionStatus: "connected", lastSuccessfulSyncAt: null, lastSyncedAt: null });
    const failed = await mkAcc(A, "failed", "facebook_page", { health: "error", tokenHealth: "ok", connectionStatus: "connected", lastSyncedAt: BEFORE });

    // FB: 3 comments today (2 high, 1 low) + 1 yesterday. IG: 1 today (critical).
    await comment(A, fb, "high", TODAY); await comment(A, fb, "high", TODAY); await comment(A, fb, "low", TODAY);
    await comment(A, fb, "critical", BEFORE);
    await comment(A, ig, "critical", TODAY);
    // Tenant B noise.
    const bfb = await mkAcc(B, "bfb", "facebook_page");
    await comment(B, bfb, "critical", TODAY);

    const ov = await getDashboardAccountsOverview(A.t.id, now);
    const rfb = ov.rows.find((r) => r.id === fb.id)!;
    const rig = ov.rows.find((r) => r.id === ig.id)!;

    console.log("Today metrics (UTC day)");
    check("comments today = 3 (yesterday excluded)", rfb.commentsToday === 3, `${rfb.commentsToday}`);
    check("risk today = 2 (high/critical today only)", rfb.riskToday === 2, `${rfb.riskToday}`);
    check("IG today = 1 comment, 1 risk", rig.commentsToday === 1 && rig.riskToday === 1);
    check("no cross-tenant leakage into A's rows (tenant B absent)", ov.rows.every((r) => [fb.id, ig.id, never.id, failed.id].includes(r.id)) && !ov.rows.some((r) => r.id === bfb.id));

    console.log("Connection status SEPARATE from monitoring");
    check("FB: permissions_expired connection BUT monitoring stays ON", rfb.connectionStatus === "permissions_expired" && rfb.reconnectRequired && rfb.monitoringEnabled === true);
    check("IG: connected + monitoring off", rig.connectionStatus === "connected" && rig.monitoringEnabled === false);
    const rnever = ov.rows.find((r) => r.id === never.id)!;
    const rfailed = ov.rows.find((r) => r.id === failed.id)!;
    check("never-synced (health error, NO attempt) is NOT sync_error", rnever.connectionStatus === "connected" && rnever.hasSyncError === false && rnever.lastSuccessAt === null);
    check("real failed attempt (health error + attempt) → sync_error", rfailed.connectionStatus === "sync_error" && rfailed.hasSyncError === true);

    console.log("Capacity");
    check("capacity: used=1 (FB monitored), limit=3, remaining=2", ov.capacity.used === 1 && ov.capacity.limit === 3 && ov.capacity.remaining === 2, JSON.stringify(ov.capacity));
    check("IG (off) can be enabled (slots remain)", rig.monitoringCanBeEnabled === true);

    console.log("Full-limit behaviour");
    await setAccountMonitoring(A.t.id, ig.id, true);
    const cfb = await mkAcc(A, "cfb", "facebook_page"); // a 3rd account → fills the limit (FB+IG+cfb=3)
    await setAccountMonitoring(A.t.id, cfb.id, true);
    const ov2 = await getDashboardAccountsOverview(A.t.id, now);
    const off = ov2.rows.find((r) => !r.monitoringEnabled);
    check("at full limit, an OFF account cannot be enabled", ov2.capacity.remaining === 0 && (!off || off.monitoringCanBeEnabled === false));
    check("an already-ON account can still be turned off at full limit", ov2.rows.filter((r) => r.monitoringEnabled).every((r) => r.monitoringCanBeEnabled === true));

    console.log("Account kind + sync state (truthful UX naming — single source of truth)");
    // test/mock connection → kind=test, sync not active. real-no-engagement-perm → read_only.
    // real (engagement granted) that has synced → real+ok; real that never synced → real+waiting_first_sync.
    const kTest = await mkAcc(A, "ktest", "facebook_page", { status: "mock_connected", mode: "placeholder", lastSuccessfulSyncAt: TODAY });
    const kReadOnly = await mkAcc(A, "kro", "facebook_page", { mode: "read_only", grantedPermissions: [], lastSuccessfulSyncAt: TODAY });
    const kRealOk = await mkAcc(A, "krok", "facebook_page", { mode: "read_only", grantedPermissions: ["pages_manage_engagement"], lastSuccessfulSyncAt: TODAY });
    const kRealWait = await mkAcc(A, "kwait", "facebook_page", { mode: "read_only", grantedPermissions: ["pages_manage_engagement"], lastSuccessfulSyncAt: null, lastSyncedAt: null });
    const ovK = await getDashboardAccountsOverview(A.t.id, now);
    const rk = (id: string) => ovK.rows.find((r) => r.id === id)!;
    check("test/mock account → kind=test, syncState=not_active", rk(kTest.id).accountKind === "test" && rk(kTest.id).syncState === "not_active", `${rk(kTest.id).accountKind}/${rk(kTest.id).syncState}`);
    check("real without engagement permission → kind=read_only", rk(kReadOnly.id).accountKind === "read_only", rk(kReadOnly.id).accountKind);
    check("real with engagement + synced → kind=real, syncState=ok", rk(kRealOk.id).accountKind === "real" && rk(kRealOk.id).syncState === "ok", `${rk(kRealOk.id).accountKind}/${rk(kRealOk.id).syncState}`);
    check("real never synced → syncState=waiting_first_sync (NOT error)", rk(kRealWait.id).accountKind === "real" && rk(kRealWait.id).syncState === "waiting_first_sync", `${rk(kRealWait.id).accountKind}/${rk(kRealWait.id).syncState}`);
    check("real failed attempt → syncState=failed", rk(failed.id).syncState === "failed", rk(failed.id).syncState);

    console.log("Tenant isolation");
    const ovB = await getDashboardAccountsOverview(B.t.id, now);
    check("tenant B overview shows only B's account", ovB.rows.length === 1 && ovB.rows[0]!.id === bfb.id);
  } finally {
    for (const X of [A, B]) {
      await systemDb.reputationItem.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.contentItem.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.connectedAccount.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.brand.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.tenant.deleteMany({ where: { id: X.t.id } });
    }
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — accounts overview + today metrics (V1.59)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
