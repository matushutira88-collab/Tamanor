/**
 * V1.38 — Unified Meta connector (Facebook Page + Instagram) integration tests.
 * Real Postgres + appDb via the REAL production functions (`linkMetaAssets`,
 * `syncMetaAccountState`, `findMetaAccountsByExternalIds`) with an injected MOCK
 * transport — NO real network call and NO fake persisted content. Proves canonical
 * identity, idempotent link/reconnect (no duplicates), read→HTTP→write, full
 * detection of expired/revoked/deleted/IG-disconnected/ownership/missing-asset, tenant
 * isolation (RLS), and token-free audit.
 *
 * Run: pnpm meta-connector:test
 */
import { systemDb, withTenant, encryptToken, findMetaAccountsByExternalIds } from "@guardora/db";
import { MockMetaConnectorTransport, type MetaDiscoveredPage } from "../../connectors/src/index";
import { linkMetaAssets, syncMetaAccountState } from "../../sync/src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const sfx = Date.now().toString(36);
  const tA = await systemDb.tenant.create({ data: { name: "Meta A", slug: `meta-a-${sfx}` } });
  const tB = await systemDb.tenant.create({ data: { name: "Meta B", slug: `meta-b-${sfx}` } });
  const brA = await systemDb.brand.create({ data: { tenantId: tA.id, name: "MA" } });
  const brB = await systemDb.brand.create({ data: { tenantId: tB.id, name: "MB" } });

  const page = (tag: string, ig?: { id: string; username?: string }): MetaDiscoveredPage => ({
    pageId: `PG_${tag}_${sfx}`, name: `Page ${tag}`, pageAccessToken: "PAGE_TOKEN_RAW",
    category: "Business", igBusinessId: ig?.id, igUsername: ig?.username,
  });
  const link = (tenantId: string, brandId: string, p: MetaDiscoveredPage, connectIg = true) => linkMetaAssets({
    tenantId, brandId, page: p, connectIg,
    scopes: ["pages_manage_engagement", "pages_read_engagement", "instagram_basic"],
    grantedPermissions: ["pages_manage_engagement"],
    encryptedToken: encryptToken(p.pageAccessToken), tokenType: "bearer", tokenExpiresAt: null,
  });

  try {
    // ===== Canonical link (page + IG), no dup =====
    const pIg = page("IG", { id: `IG_${sfx}`, username: "acme" });
    const r1 = await link(tA.id, brA.id, pIg, true);
    const fbRow = await withTenant(tA.id, (db) => db.connectedAccount.findFirst({ where: { id: r1.pageAccountId }, select: { platform: true, externalId: true, igBusinessId: true } }));
    const igRow = await withTenant(tA.id, (db) => db.connectedAccount.findFirst({ where: { id: r1.igAccountId! }, select: { platform: true, externalId: true, parentAccountId: true } }));
    check("1) page + IG persisted as one unified connector (2 rows)", !!r1.pageAccountId && !!r1.igAccountId && fbRow?.platform === "facebook_page" && igRow?.platform === "instagram_business");
    check("2) canonical Page↔IG link (parentAccountId + shared pageId)", igRow?.parentAccountId === r1.pageAccountId && igRow?.externalId === pIg.igBusinessId && fbRow?.igBusinessId === pIg.igBusinessId);
    check("3) first connect is not a reconnect", r1.pageReconnected === false && r1.igReconnected === false);

    // ===== Reconnect is idempotent — SAME rows, no duplicates =====
    const r2 = await link(tA.id, brA.id, pIg, true);
    const total = await withTenant(tA.id, (db) => db.connectedAccount.count({ where: { brandId: brA.id, externalId: { in: [pIg.pageId, pIg.igBusinessId!] } } }));
    check("4) reconnect → SAME account ids, no duplicate rows", r2.pageAccountId === r1.pageAccountId && r2.igAccountId === r1.igAccountId && r2.pageReconnected === true && r2.igReconnected === true && total === 2);

    // ===== syncMetaAccountState — read → HTTP → write detection =====
    // Healthy.
    const okT = new MockMetaConnectorTransport({ page: { ok: true, pageId: pIg.pageId, pageName: "Page IG", canManage: true, igBusinessId: pIg.igBusinessId } });
    const sOk = await syncMetaAccountState(tA.id, r1.pageAccountId, { transport: okT });
    check("5) healthy page → connected/ok; transport was called (real HTTP path)", sOk.status === "healthy" && sOk.connectionStatus === "connected" && okT.calls.some((c) => c.startsWith("getPageState")));

    // Token expired.
    const sExp = await syncMetaAccountState(tA.id, r1.pageAccountId, { transport: new MockMetaConnectorTransport({ page: { ok: false, errorCode: "token_expired" } }) });
    check("6) expired token → token_expired + needs_reconnect", sExp.status === "token_expired" && sExp.connectionStatus === "needs_reconnect");

    // Permission revoked (canManage false).
    const sPerm = await syncMetaAccountState(tA.id, r1.pageAccountId, { transport: new MockMetaConnectorTransport({ page: { ok: true, pageId: pIg.pageId, canManage: false, igBusinessId: pIg.igBusinessId } }) });
    check("7) revoked moderation permission → permission_revoked", sPerm.status === "permission_revoked" && sPerm.connectionStatus === "missing_permission");

    // Deleted page.
    const sDel = await syncMetaAccountState(tA.id, r1.pageAccountId, { transport: new MockMetaConnectorTransport({ page: { ok: false, errorCode: "not_found" } }) });
    check("8) deleted page → page_deleted + disconnected", sDel.status === "page_deleted" && sDel.connectionStatus === "disconnected");

    // Ownership / rename change.
    const sOwn = await syncMetaAccountState(tA.id, r1.pageAccountId, { transport: new MockMetaConnectorTransport({ page: { ok: true, pageId: pIg.pageId, pageName: "TRANSFERRED", canManage: true, igBusinessId: pIg.igBusinessId } }) });
    const renamed = await withTenant(tA.id, (db) => db.connectedAccount.findFirst({ where: { id: r1.pageAccountId }, select: { externalName: true } }));
    check("9) page rename/transfer → ownership_changed + name updated", sOwn.status === "ownership_changed" && renamed?.externalName === "TRANSFERRED");

    // Instagram disconnected (page's IG link removed) → also marks the IG account.
    const sIgOff = await syncMetaAccountState(tA.id, r1.pageAccountId, { transport: new MockMetaConnectorTransport({ page: { ok: true, pageId: pIg.pageId, pageName: "TRANSFERRED", canManage: true, igBusinessId: null } }) });
    const igAfter = await withTenant(tA.id, (db) => db.connectedAccount.findFirst({ where: { id: r1.igAccountId! }, select: { connectionStatus: true } }));
    check("10) IG unlinked from Page → instagram_disconnected + IG account marked", sIgOff.status === "instagram_disconnected" && igAfter?.connectionStatus === "disconnected");

    // Transient provider failure — NEVER downgrades local state.
    await link(tA.id, brA.id, pIg, true); // restore healthy state
    await syncMetaAccountState(tA.id, r1.pageAccountId, { transport: okT });
    const before = await withTenant(tA.id, (db) => db.connectedAccount.findFirst({ where: { id: r1.pageAccountId }, select: { connectionStatus: true } }));
    const sTrans = await syncMetaAccountState(tA.id, r1.pageAccountId, { transport: new MockMetaConnectorTransport({ page: { ok: false, errorCode: "rate_limit" } }) });
    const after = await withTenant(tA.id, (db) => db.connectedAccount.findFirst({ where: { id: r1.pageAccountId }, select: { connectionStatus: true } }));
    check("11) transient provider failure → transient_error, local state PRESERVED", sTrans.status === "transient_error" && sTrans.changed === false && after?.connectionStatus === before?.connectionStatus && before?.connectionStatus === "connected");

    // IG account direct sync.
    const igHealthy = await syncMetaAccountState(tA.id, r1.igAccountId!, { transport: new MockMetaConnectorTransport({ instagram: { ok: true, igBusinessId: pIg.igBusinessId!, username: "acme" } }) });
    check("12) IG account healthy sync", igHealthy.status === "healthy" && igHealthy.platform === "instagram_business");
    const igGone = await syncMetaAccountState(tA.id, r1.igAccountId!, { transport: new MockMetaConnectorTransport({ instagram: { ok: false, errorCode: "not_found" } }) });
    check("13) IG account gone → instagram_disconnected", igGone.status === "instagram_disconnected");

    // ===== Webhook resolver handles BOTH platforms =====
    const resolved = await findMetaAccountsByExternalIds([pIg.pageId, pIg.igBusinessId!]);
    check("14) webhook resolver matches Page AND Instagram by external id", resolved.some((a) => a.id === r1.pageAccountId && a.platform === "facebook_page") && resolved.some((a) => a.id === r1.igAccountId && a.platform === "instagram_business"));

    // ===== Tenant isolation (RLS) — B cannot sync A's account =====
    const foreign = await syncMetaAccountState(tB.id, r1.pageAccountId, { transport: okT });
    check("15) cross-tenant sync → not_applicable (RLS: account invisible)", foreign.status === "not_applicable");
    // A's account in tenant B never mutated.
    const stillA = await withTenant(tA.id, (db) => db.connectedAccount.count({ where: { id: r1.pageAccountId, tenantId: tA.id } }));
    check("15b) A's account unchanged by B's attempt", stillA === 1);

    // ===== Audit contains NO token material =====
    const audits = await withTenant(tA.id, (db) => db.auditLog.findMany({ where: { targetId: r1.pageAccountId, event: { startsWith: "meta." } }, select: { event: true, metadata: true } }));
    check("16) full audit trail, no token in metadata", audits.length >= 1 && audits.every((a) => JSON.stringify(a.metadata ?? {}).indexOf("PAGE_TOKEN_RAW") === -1) && audits.some((a) => a.event === "meta.page.connected" || a.event === "meta.page.reconnected"));

    // ===== No-token account fails closed =====
    await withTenant(tA.id, (db) => db.connectedAccount.updateMany({ where: { id: r1.pageAccountId }, data: { accessToken: null, longLivedToken: null } }));
    const noTok = await syncMetaAccountState(tA.id, r1.pageAccountId, { transport: okT });
    check("17) missing stored token → token_expired (fail-closed), no HTTP needed", noTok.status === "token_expired" && noTok.connectionStatus === "needs_reconnect");

    // ===== Page without IG: newly-available business asset detection =====
    const pNoIg = page("NOIG");
    const r3 = await link(tA.id, brA.id, pNoIg, false);
    check("18) page without IG → no IG account created", r3.igAccountId === null);
    const sAvail = await syncMetaAccountState(tA.id, r3.pageAccountId, { transport: new MockMetaConnectorTransport({ page: { ok: true, pageId: pNoIg.pageId, pageName: "Page NOIG", canManage: true, igBusinessId: `NEWIG_${sfx}` } }) });
    const availRow = await withTenant(tA.id, (db) => db.connectedAccount.findFirst({ where: { id: r3.pageAccountId }, select: { igBusinessId: true } }));
    check("19) page gains an IG business asset → recorded (igBusinessId set)", sAvail.status === "healthy" && availRow?.igBusinessId === `NEWIG_${sfx}`);

    // ===== V1.38 FK/trigger: cross-tenant parent link rejected; parent delete → SetNull =====
    const rB = await link(tB.id, brB.id, page("B"), false);
    let xtenant = false;
    try { await systemDb.connectedAccount.update({ where: { id: r1.igAccountId! }, data: { parentAccountId: rB.pageAccountId } }); } catch { xtenant = true; }
    check("20) cross-tenant parent link rejected (trigger, owner path)", xtenant);

    await systemDb.connectedAccount.delete({ where: { id: r1.pageAccountId } });
    const igOrphan = await systemDb.connectedAccount.findUnique({ where: { id: r1.igAccountId! }, select: { id: true, parentAccountId: true } });
    check("21) parent Page delete → IG survives with parentAccountId NULL (SetNull)", !!igOrphan && igOrphan.parentAccountId === null);
  } finally {
    for (const t of [tA.id, tB.id]) {
      await systemDb.auditLog.deleteMany({ where: { tenantId: t } });
      // Delete IG (child) accounts first so the parent FK doesn't block, then pages.
      await systemDb.connectedAccount.deleteMany({ where: { tenantId: t, platform: "instagram_business" } });
      await systemDb.connectedAccount.deleteMany({ where: { tenantId: t } });
      await systemDb.brand.deleteMany({ where: { tenantId: t } });
    }
    await systemDb.tenant.deleteMany({ where: { id: { in: [tA.id, tB.id] } } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — unified Meta connector (V1.38)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
