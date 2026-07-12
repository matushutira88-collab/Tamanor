/**
 * V1.37.2 RLS integration tests — REAL Postgres, REAL queries, TWO tenants.
 *
 * Seed runs as the owner (systemDb). The assertions run as the NON-superuser,
 * NON-bypassrls `tamanor_app` role through the production `withTenantDb` wrapper,
 * so they prove Row-Level Security actually isolates tenants at the database — a
 * query that FORGETS `where:{tenantId}` still returns only the active tenant.
 *
 * Run via: pnpm rls-isolation:test
 */
import { PrismaClient } from "@prisma/client";
import { systemDb, withTenantDb } from "@guardora/db";
import { Permission, Role, can } from "@guardora/core";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false; } catch { return true; }
}

/** Build the tamanor_app (RLS-enforced) connection string from DATABASE_URL. */
function appUrl(): string {
  const raw = process.env.DATABASE_URL ?? "";
  return raw.replace(/\/\/[^:@/]+:[^@]*@/, "//tamanor_app:tamanor_app@");
}

async function run() {
  const app = new PrismaClient({ datasourceUrl: appUrl() });

  // Confirm the app client actually connects and is NOT superuser/bypassrls.
  let roleInfo: Array<{ role: string; rolsuper: boolean; rolbypassrls: boolean }> = [];
  try {
    roleInfo = await app.$queryRawUnsafe(`SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
  } catch (e) {
    console.log("  ✗ could not connect as tamanor_app — check pg_hba/password:", e instanceof Error ? e.message : String(e));
    console.log("\nFAIL (1) — RLS isolation (tamanor_app unreachable)");
    await app.$disconnect(); await systemDb.$disconnect(); process.exit(1);
  }

  // ---- Seed two tenants + data as the OWNER (bypasses RLS) ----
  const sfx = `${Date.now().toString(36)}`;
  const tenantA = await systemDb.tenant.create({ data: { name: "RLS A", slug: `rls-a-${sfx}` } });
  const tenantB = await systemDb.tenant.create({ data: { name: "RLS B", slug: `rls-b-${sfx}` } });
  const userV = await systemDb.user.create({ data: { email: `v-${sfx}@t.test`, name: "Viewer" } });
  await systemDb.membership.create({ data: { userId: userV.id, tenantId: tenantA.id, role: "viewer" } });
  const brandA = await systemDb.brand.create({ data: { tenantId: tenantA.id, name: "Brand A" } });
  const brandB = await systemDb.brand.create({ data: { tenantId: tenantB.id, name: "Brand B" } });
  const acctA = await systemDb.connectedAccount.create({ data: { tenantId: tenantA.id, brandId: brandA.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `A_${sfx}`, pageId: `A_${sfx}` } });
  const acctB = await systemDb.connectedAccount.create({ data: { tenantId: tenantB.id, brandId: brandB.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `B_${sfx}`, pageId: `B_${sfx}` } });
  const ciA = await systemDb.contentItem.create({ data: { tenantId: tenantA.id, brandId: brandA.id, connectedAccountId: acctA.id, platform: "facebook_page", kind: "comment", externalId: `ca_${sfx}`, text: "A", publishedAt: new Date() } });
  const ciB = await systemDb.contentItem.create({ data: { tenantId: tenantB.id, brandId: brandB.id, connectedAccountId: acctB.id, platform: "facebook_page", kind: "comment", externalId: `cb_${sfx}`, text: "B", publishedAt: new Date() } });
  await systemDb.reputationItem.create({ data: { tenantId: tenantA.id, brandId: brandA.id, platform: "facebook_page", contentItemId: ciA.id, riskLevel: "none", riskCategories: [], sentiment: "neutral" } });
  await systemDb.reputationItem.create({ data: { tenantId: tenantB.id, brandId: brandB.id, platform: "facebook_page", contentItemId: ciB.id, riskLevel: "high", riskCategories: ["scam"], sentiment: "neutral" } });

  const AB_IDS = [ciA.id, ciB.id];
  try {
    // ---------- Runtime DB role (25-27) ----------
    check("25) runtime role is not superuser", roleInfo[0]?.rolsuper === false && roleInfo[0]?.role === "tamanor_app");
    check("26) runtime role has no BYPASSRLS", roleInfo[0]?.rolbypassrls === false);
    const forced: Array<{ f: boolean }> = await app.$queryRawUnsafe(`SELECT relforcerowsecurity AS f FROM pg_class WHERE relname='content_items'`);
    check("27) FORCE RLS active on tenant table", forced[0]?.f === true);

    // ---------- Context behavior (no context) (1-6) ----------
    check("1) no context: SELECT returns no tenant rows", (await app.contentItem.findMany({ where: { id: { in: AB_IDS } } })).length === 0);
    check("2) no context: INSERT rejected", await rejects(() => app.contentItem.create({ data: { tenantId: tenantA.id, brandId: brandA.id, connectedAccountId: acctA.id, platform: "facebook_page", kind: "comment", externalId: `x_${sfx}`, text: "x", publishedAt: new Date() } })));
    check("3) no context: UPDATE affects 0 rows", (await app.contentItem.updateMany({ where: { id: ciA.id }, data: { text: "hacked" } })).count === 0);
    check("4) no context: DELETE affects 0 rows", (await app.contentItem.deleteMany({ where: { id: ciA.id } })).count === 0);
    check("5) empty tenant context rejected (fail-closed)", await rejects(() => withTenantDb("", (db) => db.contentItem.findMany(), app)));
    check("6) non-existent tenant context sees nothing", await withTenantDb("tenant_does_not_exist", (db) => db.contentItem.findMany({ where: { id: { in: AB_IDS } } }), app).then((r) => r.length === 0));

    // ---------- Tenant A isolation (7-12). Note: each WITH CHECK-violating write
    //            must run in its OWN transaction (an error aborts the whole tx). ----------
    await withTenantDb(tenantA.id, async (db) => {
      const all = await db.contentItem.findMany({ where: { id: { in: AB_IDS } } });
      check("7) A sees its own row", all.some((r) => r.id === ciA.id));
      check("8) A does NOT see B's row", !all.some((r) => r.id === ciB.id) && all.length === 1);
      // updateMany/deleteMany on invisible rows return count 0 (no error, no abort).
      check("11) A cannot UPDATE B's row", (await db.contentItem.updateMany({ where: { id: ciB.id }, data: { text: "z" } })).count === 0);
      check("12) A cannot DELETE B's row", (await db.contentItem.deleteMany({ where: { id: ciB.id } })).count === 0);
    }, app);
    check("9) A cannot INSERT a row for tenant B (WITH CHECK)", await rejects(() => withTenantDb(tenantA.id, (db) => db.contentItem.create({ data: { tenantId: tenantB.id, brandId: brandB.id, connectedAccountId: acctB.id, platform: "facebook_page", kind: "comment", externalId: `y_${sfx}`, text: "y", publishedAt: new Date() } }), app)));
    check("10) A cannot move its row to tenant B (WITH CHECK)", await rejects(() => withTenantDb(tenantA.id, (db) => db.contentItem.update({ where: { id: ciA.id }, data: { tenantId: tenantB.id } }), app)));

    // ---------- Indirect/child tables isolated (13-15) ----------
    await withTenantDb(tenantA.id, async (db) => {
      check("13) A sees only its reputation items (child)", (await db.reputationItem.findMany()).every((r) => r.tenantId === tenantA.id) && (await db.reputationItem.count()) === 1);
      check("15) A cannot read B's connected account across the relation", (await db.connectedAccount.findMany()).every((a) => a.tenantId === tenantA.id));
    }, app);
    check("14) A cannot INSERT a child under tenant B", await rejects(() => withTenantDb(tenantA.id, (db) => db.reputationItem.create({ data: { tenantId: tenantB.id, brandId: brandB.id, platform: "facebook_page", contentItemId: ciB.id, riskLevel: "none", riskCategories: [], sentiment: "neutral" } }), app)));

    // ---------- Connection-pool leakage (16-19) ----------
    const seenInCtx = await withTenantDb(tenantA.id, (db) => db.contentItem.count({ where: { id: { in: AB_IDS } } }), app);
    check("16) in A context: sees A", seenInCtx === 1);
    check("17) context does NOT leak to a later context-less query", (await app.contentItem.findMany({ where: { id: { in: AB_IDS } } })).length === 0);
    check("18) B context sees B, not A", await withTenantDb(tenantB.id, async (db) => { const r = await db.contentItem.findMany({ where: { id: { in: AB_IDS } } }); return r.length === 1 && r[0].id === ciB.id; }, app));
    const [ra, rb] = await Promise.all([
      withTenantDb(tenantA.id, (db) => db.contentItem.findMany({ where: { id: { in: AB_IDS } } }), app),
      withTenantDb(tenantB.id, (db) => db.contentItem.findMany({ where: { id: { in: AB_IDS } } }), app),
    ]);
    check("19) parallel A/B do not mix rows", ra.length === 1 && ra[0].id === ciA.id && rb.length === 1 && rb[0].id === ciB.id);

    // ---------- Application integration + THE wrong-query proof (20-24) ----------
    check("20) withTenantDb(A) returns only A", (await withTenantDb(tenantA.id, (db) => db.contentItem.findMany(), app)).every((r) => r.tenantId === tenantA.id));
    check("21) withTenantDb(B) returns only B", (await withTenantDb(tenantB.id, (db) => db.contentItem.findMany(), app)).every((r) => r.tenantId === tenantB.id));
    // (Q) The critical proof: a query that FORGETS where:{tenantId} is still isolated by RLS.
    const forgetful = await withTenantDb(tenantA.id, (db) => db.contentItem.findMany(), app); // NO tenantId filter
    check("22) forgotten where:{tenantId} still isolated by RLS", forgetful.length === 1 && forgetful[0].id === ciA.id && !forgetful.some((r) => r.id === ciB.id));
    check("23) foreign id returns null under RLS", (await withTenantDb(tenantA.id, (db) => db.contentItem.findFirst({ where: { id: ciB.id } }), app)) === null);
    check("24) RLS does not replace permission checks (viewer denied privileged op)", can(("viewer") as Role, Permission.ConnectorManage) === false && can(("owner") as Role, Permission.ConnectorManage) === true);
  } finally {
    await app.$disconnect();
    // cleanup as owner
    await systemDb.reputationItem.deleteMany({ where: { brandId: { in: [brandA.id, brandB.id] } } });
    await systemDb.contentItem.deleteMany({ where: { brandId: { in: [brandA.id, brandB.id] } } });
    await systemDb.connectedAccount.deleteMany({ where: { brandId: { in: [brandA.id, brandB.id] } } });
    await systemDb.brand.deleteMany({ where: { id: { in: [brandA.id, brandB.id] } } });
    await systemDb.membership.deleteMany({ where: { userId: userV.id } });
    await systemDb.user.deleteMany({ where: { id: userV.id } });
    await systemDb.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — RLS tenant isolation (V1.37.2)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
