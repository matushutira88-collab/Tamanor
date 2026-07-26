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
  // Active trial window → `full_access`, so the growth-plan per-brand connect limits apply (V1.68 read-time
  // gate would otherwise resolve this no-subscription/no-trial tenant to `restricted` → zero limits).
  const t = await systemDb.tenant.create({ data: { name: "Mf", slug: `mf-${sfx}`, plan: "growth", trialEndsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) } }); // growth: 3 brands × (1 FB + 1 IG) per brand
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

    console.log("Connect ≠ monitor: connect is not bundle/monitored-limited (per-brand structural cap applies)");
    // V1.64 — a brand holds at most 1 active FB + 1 active IG; connecting MORE pages uses MORE brands
    // (growth allows 3). Connect never touches the tenant-total MONITORED limit (enforced only when
    // monitoring is activated), so connecting a full page+IG on each additional brand must not throw.
    const b2 = await systemDb.brand.create({ data: { tenantId: t.id, name: "MfB2" } });
    const b3 = await systemDb.brand.create({ data: { tenantId: t.id, name: "MfB3" } });
    const linkTo = (brandId: string, page: never, connectIg: boolean) => linkMetaAssets({
      tenantId: t.id, brandId, page, connectIg, scopes: [], grantedPermissions: [],
      encryptedToken: encryptToken("fake-token"), tokenType: null, tokenExpiresAt: null,
    });
    let connectThrew = false;
    try { await linkTo(b2.id, mkPage("b", sfx, true), true); await linkTo(b3.id, mkPage("c", sfx, true), true); } catch { connectThrew = true; }
    const connectedCount = await withTenant(t.id, (db) => db.connectedAccount.count({ where: { tenantId: t.id } }));
    check("connecting page+IG across brands is not bundle/monitored-limited", !connectThrew && connectedCount >= 6, `threw=${connectThrew} count=${connectedCount}`);
    check("all newly-connected accounts are unmonitored", (await withTenant(t.id, (db) => countMonitoredAccounts(db, t.id))) === 0);
    // The STRUCTURAL per-brand cap IS enforced at connect: a 2nd DIFFERENT active FB on the SAME brand rejects.
    let perBrandEnforced = false;
    try { await linkTo(b.id, mkPage("dup", sfx, false), false); } catch (e) { perBrandEnforced = /brand_platform_limit_reached/.test(String(e)); }
    check("per-brand cap enforced (2nd FB on same brand → brand_platform_limit_reached)", perBrandEnforced);

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
