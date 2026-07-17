/**
 * V1.59 phase 2b — Meta OAuth finalize on the NEW model (no legacy bundle) against a real Postgres.
 * Proves: linkMetaAssets connects a Page + IG as SEPARATE accounts, connected-but-NOT-monitored; connect
 * imposes NO bundle limit; a reconnect creates no duplicate and preserves monitoring; and monitoring
 * activation counts FB=1 and IG=1 (FB+IG = TWO) via the atomic enableAccountMonitoringWithinLimit.
 * Run: pnpm meta-finalize:test
 */
import { systemDb, withTenant, encryptToken, enableAccountMonitoringWithinLimit, countMonitoredAccounts } from "@guardora/db";
import { linkMetaAssets } from "../../sync/src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const mkPage = (tag: string, sfx: string, withIg: boolean) => ({
  pageId: `PG_${tag}_${sfx}`, name: `Page ${tag}`,
  igBusinessId: withIg ? `IG_${tag}_${sfx}` : null, igUsername: withIg ? `ig_${tag}` : null,
  pageAccessToken: "fake-token", category: "Business", tasks: [],
}) as never;

async function run() {
  const sfx = Date.now().toString(36);
  const t = await systemDb.tenant.create({ data: { name: "Mf", slug: `mf-${sfx}`, plan: "growth" } }); // limit 3 → FB+IG=2 fits
  const b = await systemDb.brand.create({ data: { tenantId: t.id, name: "MfB" } });
  const link = (page: never, connectIg: boolean) => linkMetaAssets({
    tenantId: t.id, brandId: b.id, page, connectIg, scopes: [], grantedPermissions: [],
    encryptedToken: encryptToken("fake-token"), tokenType: null, tokenExpiresAt: null,
  });

  try {
    console.log("Connect = separate FB + IG accounts, NOT monitored");
    const l1 = await link(mkPage("a", sfx, true), true);
    check("FB Page + IG created as SEPARATE accounts", !!l1.pageAccountId && !!l1.igAccountId && l1.pageAccountId !== l1.igAccountId);
    const fb = await systemDb.connectedAccount.findUnique({ where: { id: l1.pageAccountId }, select: { platform: true, monitoringEnabled: true } });
    const ig = await systemDb.connectedAccount.findUnique({ where: { id: l1.igAccountId! }, select: { platform: true, monitoringEnabled: true, parentAccountId: true } });
    check("both connected-but-NOT-monitored (connect ≠ monitor)", fb?.monitoringEnabled === false && ig?.monitoringEnabled === false);
    check("IG links to its parent FB Page but is a separate account", ig?.parentAccountId === l1.pageAccountId && ig?.platform === "instagram_business");

    console.log("Connect imposes NO bundle limit");
    // Connect several more pages — connect must never throw an entitlement/bundle limit.
    let connectThrew = false;
    try { for (const tag of ["b", "c", "d", "e"]) await link(mkPage(tag, sfx, false), false); } catch { connectThrew = true; }
    const connectedCount = await withTenant(t.id, (db) => db.connectedAccount.count({ where: { tenantId: t.id } }));
    check("connecting many pages never hits a bundle limit", !connectThrew && connectedCount >= 6);
    check("all newly-connected accounts are unmonitored", (await withTenant(t.id, (db) => countMonitoredAccounts(db, t.id))) === 0);

    console.log("Reconnect = no duplicate, monitoring preserved");
    // Enable monitoring on the FB + IG (FB=1, IG=1 → 2 monitored).
    await enableAccountMonitoringWithinLimit(t.id, l1.pageAccountId);
    await enableAccountMonitoringWithinLimit(t.id, l1.igAccountId!);
    check("FB=1 + IG=1 ⇒ 2 monitored accounts (no bundle)", (await withTenant(t.id, (db) => countMonitoredAccounts(db, t.id))) === 2);
    const l2 = await link(mkPage("a", sfx, true), true); // reconnect the SAME page
    check("reconnect returns the SAME account rows (no duplicate)", l2.pageAccountId === l1.pageAccountId && l2.igAccountId === l1.igAccountId);
    const totalFb = await withTenant(t.id, (db) => db.connectedAccount.count({ where: { tenantId: t.id, externalId: `PG_a_${sfx}` } }));
    check("no duplicate FB row after reconnect", totalFb === 1);
    check("reconnect PRESERVES monitoring state", (await withTenant(t.id, (db) => countMonitoredAccounts(db, t.id))) === 2);
  } finally {
    await systemDb.connectedAccount.deleteMany({ where: { tenantId: t.id } });
    await systemDb.auditLog.deleteMany({ where: { tenantId: t.id } });
    await systemDb.brand.deleteMany({ where: { tenantId: t.id } });
    await systemDb.tenant.deleteMany({ where: { id: t.id } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Meta finalize (no bundle, per-account monitoring) V1.59`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
