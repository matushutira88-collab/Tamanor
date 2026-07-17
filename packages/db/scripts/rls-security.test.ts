/**
 * V1.58.5 — EXECUTABLE RLS & database-security integration tests against a REAL Postgres using the
 * REAL restricted `tamanor_app` role (NOBYPASSRLS) with REAL grants + policies from the migrations.
 * Proves the fail-closed invariant: no tenant context ⇒ no tenant data; tenant A ⇏ tenant B; the app
 * role has no access to sensitive global tables; and the pg catalog matches the security contract.
 * SAFETY: refuses unless DATABASE_URL is local. Never prints a password/URL/token/payload.
 * Run: scripts/run-rls-security.sh
 */
import { PrismaClient } from "@prisma/client";
import { withTenantDb } from "../src/tenant-db";

const OWNER_URL = process.env.DATABASE_URL ?? "";
const APP_URL = process.env.APP_DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:\/]/.test(OWNER_URL)) {
  console.error("✗ REFUSING TO RUN: rls-security.test.ts requires a LOCAL Postgres (localhost). Never against production.");
  process.exit(2);
}
if (!APP_URL) { console.error("✗ APP_DATABASE_URL (tamanor_app role) is required."); process.exit(2); }

const owner = new PrismaClient({ datasourceUrl: OWNER_URL }); // bypassrls (superuser) — seeds + audit
const app = new PrismaClient({ datasourceUrl: APP_URL });     // tamanor_app — RLS enforced

let pass = 0, fail = 0;
function assert(cond: boolean, label: string, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
}
/** Run an app query with a transaction-local tenant context (mirrors withTenantDb). */
async function asTenant<T>(tenantId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
  return app.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx as unknown as PrismaClient);
  });
}
/** Expect an app operation to fail (RLS reject / permission denied). Returns the (safe) error kind. */
async function denied(fn: () => Promise<unknown>): Promise<"denied" | "ok"> {
  try { await fn(); return "ok"; } catch { return "denied"; }
}

const ids: string[] = [];

async function run() {
  console.log(`\nDatabase: LOCAL | app role: tamanor_app (NOBYPASSRLS)\n`);
  try {
    // ---- seed via OWNER (bypasses RLS) ----
    const A = (await owner.tenant.create({ data: { name: "TenA", slug: `a-${Math.random()}` }, select: { id: true } })).id;
    const B = (await owner.tenant.create({ data: { name: "TenB", slug: `b-${Math.random()}` }, select: { id: true } })).id;
    ids.push(A, B);
    const uA = (await owner.user.create({ data: { email: `ua-${Math.random()}@t.io` }, select: { id: true } })).id;
    const uB = (await owner.user.create({ data: { email: `ub-${Math.random()}@t.io` }, select: { id: true } })).id;
    await owner.membership.create({ data: { userId: uA, tenantId: A } });
    await owner.membership.create({ data: { userId: uB, tenantId: B } });
    const brandA = (await owner.brand.create({ data: { tenantId: A, name: "BrandA" }, select: { id: true } })).id;
    const brandB = (await owner.brand.create({ data: { tenantId: B, name: "BrandB" }, select: { id: true } })).id;
    await owner.userSession.create({ data: { tokenHash: `h-${Math.random()}`, userId: uA, activeTenantId: A, expiresAt: new Date(Date.now() + 864e5) } });
    await owner.webhookEvent.create({ data: { platform: "facebook_page" as never, tenantId: A } as never });
    await owner.lead.create({ data: { name: "Prospect", email: `lead-${Math.random()}@x.io` } });
    await owner.stripeWebhookEvent.create({ data: { stripeEventId: `evt_${Math.random()}`, eventType: "x", result: "ignored" } });

    // ---- A) NULL context: app sees NOTHING and cannot write ----
    assert((await app.tenant.count()) === 0, "A1) tamanor_app w/o context reads 0 tenants");
    assert((await app.user.count()) === 0, "A2) w/o context reads 0 users");
    assert((await app.membership.count()) === 0, "A3) w/o context reads 0 memberships");
    assert((await app.userSession.count()) === 0, "A4) w/o context reads 0 user_sessions");
    assert((await app.brand.count()) === 0, "A4b) w/o context reads 0 brands (strict tenant table)");
    assert(await denied(() => app.membership.create({ data: { userId: uA, tenantId: A } })) === "denied", "A5) INSERT w/o context is rejected (WITH CHECK null)");
    assert((await app.brand.updateMany({ where: { id: brandA }, data: { name: "x" } })).count === 0, "A6) UPDATE w/o context affects 0 rows");
    assert((await app.brand.deleteMany({ where: { id: brandA } })).count === 0, "A7) DELETE w/o context affects 0 rows");

    // ---- B) Cross-tenant isolation (context A). Each mutation that may THROW gets its OWN tx so an
    //         expected rejection can't poison a later assertion (Postgres aborts a tx on any error). ----
    await asTenant(A, async (tx) => {
      assert((await tx.brand.count()) === 1, "B14) count under context A = only A's rows");
      assert((await tx.brand.findMany()).every((b) => b.id === brandA), "B8) context A reads only A's brand, not B's");
      assert((await tx.membership.findMany()).every((m) => m.tenantId === A), "B13) relation/table reads never surface tenant B rows");
    });
    assert(await asTenant(A, (tx) => denied(() => tx.brand.create({ data: { tenantId: B, name: "evil" } }))) === "denied",
      "B9) cannot INSERT a row with tenantId=B under context A (WITH CHECK)");
    assert(await asTenant(A, async (tx) => (await tx.brand.updateMany({ where: { id: brandB }, data: { name: "hax" } })).count) === 0,
      "B10) cannot UPDATE tenant B's row under context A (0 rows)");
    assert(await asTenant(A, async (tx) => (await tx.brand.deleteMany({ where: { id: brandB } })).count) === 0,
      "B11) cannot DELETE tenant B's row under context A (0 rows)");
    assert(await asTenant(A, (tx) => denied(() => tx.brand.upsert({ where: { id: brandB }, create: { tenantId: B, name: "u" }, update: { name: "u" } }))) === "denied",
      "B12) UPSERT cannot bypass WITH CHECK into tenant B");
    // verify B's brand is untouched (owner view)
    assert((await owner.brand.findUnique({ where: { id: brandB } }))?.name === "BrandB", "B10b) tenant B's brand truly untouched by tenant A");

    // ---- C/F) context does not leak across transactions ----
    assert((await app.brand.count()) === 0, "F34) after context-A txn, a no-context app read sees 0 (SET LOCAL reset)");
    await asTenant(B, async (tx) => { assert((await tx.brand.count()) === 1 && (await tx.brand.findMany())[0]?.id === brandB, "F35) next txn with context B sees only B (no A leak)"); });
    assert(await denied(() => withTenantDb("", async () => 1)) === "denied", "F37) withTenantDb rejects an empty/invalid tenant id before any DB op");

    // ---- D) sensitive global tables: app role has NO access ----
    assert(await denied(() => app.$queryRawUnsafe("SELECT 1 FROM webhook_events LIMIT 1")) === "denied", "D21) tamanor_app permission denied on webhook_events");
    assert(await denied(() => app.$queryRawUnsafe("SELECT 1 FROM leads LIMIT 1")) === "denied", "D22) tamanor_app permission denied on leads");
    assert(await denied(() => app.$queryRawUnsafe("SELECT 1 FROM stripe_webhook_events LIMIT 1")) === "denied", "D22b) tamanor_app permission denied on stripe_webhook_events");
    assert(await denied(() => app.$queryRawUnsafe("SELECT payload FROM webhook_events LIMIT 1")) === "denied", "D25) raw webhook payload is unreachable by the app role");
    // systemDb (owner) flow still works
    assert((await owner.webhookEvent.count()) >= 1 && (await owner.lead.count()) >= 1, "D23/24) systemDb (owner) webhook + leads flow still functional");

    // ---- E) role attributes + grants (catalog) ----
    const role = (await owner.$queryRawUnsafe<Array<{ rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean }>>(
      "SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname='tamanor_app'"))[0];
    assert(role.rolbypassrls === false, "E26) tamanor_app NOBYPASSRLS");
    assert(role.rolsuper === false, "E27) tamanor_app not superuser");
    assert(role.rolcreaterole === false, "E28) tamanor_app NOCREATEROLE");
    assert(role.rolcreatedb === false, "E29) tamanor_app NOCREATEDB");
    const schemaCreate = (await owner.$queryRawUnsafe<Array<{ c: boolean }>>("SELECT has_schema_privilege('tamanor_app','public','CREATE') AS c"))[0];
    assert(schemaCreate.c === false, "E30) tamanor_app has NO CREATE on schema public");

    // ---- Phase D) catalog audit ----
    // D1/D2 — every tenantId table that is GRANTED to tamanor_app must have RLS ENABLED + FORCED.
    // A tenantId table with NO grant to the app role is systemDb-only (RLS moot). webhook_events is the
    // documented case: it carries a (post-resolution) tenantId but is revoked from the app role.
    const grantedToApp = new Set((await owner.$queryRawUnsafe<Array<{ t: string }>>(`
      SELECT DISTINCT table_name AS t FROM information_schema.role_table_grants WHERE grantee='tamanor_app' AND table_schema='public'`)).map((r) => r.t));
    const tenantTables = (await owner.$queryRawUnsafe<Array<{ t: string }>>(`
      SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r'
        AND EXISTS (SELECT 1 FROM information_schema.columns col WHERE col.table_name=c.relname AND col.column_name='tenantId')`)).map((r) => r.t);
    const rlsMap = new Map((await owner.$queryRawUnsafe<Array<{ t: string; e: boolean; f: boolean }>>(`
      SELECT relname AS t, relrowsecurity AS e, relforcerowsecurity AS f FROM pg_class WHERE relkind='r'`)).map((r) => [r.t, r]));
    const missingRls = tenantTables.filter((t) => grantedToApp.has(t) && !(rlsMap.get(t)?.e && rlsMap.get(t)?.f));
    assert(missingRls.length === 0, "D1/D2) every app-granted tenantId table has RLS ENABLED + FORCED", missingRls.join(", "));
    // D2b — a tenantId table WITHOUT RLS must not be granted to the app role (systemDb-only).
    const ungrantedTenantNoRls = tenantTables.filter((t) => !(rlsMap.get(t)?.e) && grantedToApp.has(t));
    assert(ungrantedTenantNoRls.length === 0, "D2b) no un-RLS'd tenantId table is reachable by the app role", ungrantedTenantNoRls.join(", "));

    // D5 — no residual "IS NULL" permissive policy on the four bootstrap tables.
    const nullPolicies = (await owner.$queryRawUnsafe<Array<{ t: string }>>(`
      SELECT tablename AS t FROM pg_policies WHERE schemaname='public' AND (qual LIKE '%IS NULL%' OR with_check LIKE '%IS NULL%')`)).map((r) => r.t);
    assert(nullPolicies.length === 0, "D5) no RLS policy retains an 'IS NULL' bootstrap-permissive branch", nullPolicies.join(", "));

    // D3 — no table GRANTED to tamanor_app is left WITHOUT RLS (except an explicit safe allowlist).
    const ALLOWLIST = new Set<string>([
      // reference/lookup tables with no tenant data that the app role may read; documented safe:
      // (none currently — sensitive globals are revoked)
    ]);
    const grantedNoRls = (await owner.$queryRawUnsafe<Array<{ t: string }>>(`
      SELECT DISTINCT g.table_name AS t
      FROM information_schema.role_table_grants g
      JOIN pg_class c ON c.relname=g.table_name
      WHERE g.grantee='tamanor_app' AND g.table_schema='public'
        AND c.relkind='r' AND c.relrowsecurity=false`)).map((r) => r.t).filter((t) => !ALLOWLIST.has(t));
    assert(grantedNoRls.length === 0, "D3) no table granted to tamanor_app lacks RLS (outside allowlist)", grantedNoRls.join(", "));

    // D4 — sensitive tables are NOT granted to tamanor_app at all.
    const sensitiveGranted = (await owner.$queryRawUnsafe<Array<{ t: string }>>(`
      SELECT DISTINCT table_name AS t FROM information_schema.role_table_grants
      WHERE grantee='tamanor_app' AND table_name IN ('webhook_events','leads','stripe_webhook_events')`)).map((r) => r.t);
    assert(sensitiveGranted.length === 0, "D4) webhook_events/leads/stripe_webhook_events NOT granted to tamanor_app", sensitiveGranted.join(", "));

    // D9 — current_app_tenant_id() is NOT SECURITY DEFINER (must not bypass RLS) and fails closed on null.
    const helper = (await owner.$queryRawUnsafe<Array<{ secdef: boolean }>>(`
      SELECT prosecdef AS secdef FROM pg_proc WHERE proname='current_app_tenant_id'`))[0];
    assert(helper?.secdef === false, "D9a) current_app_tenant_id() is not SECURITY DEFINER");
    const nullCtx = (await owner.$queryRawUnsafe<Array<{ v: string | null }>>("SELECT current_app_tenant_id() AS v"))[0];
    assert(nullCtx.v === null, "D9b) current_app_tenant_id() returns NULL (fail-closed) with no context set");

    // D7 — every SECURITY DEFINER function has an explicit safe search_path (no injection surface).
    const secdefFns = (await owner.$queryRawUnsafe<Array<{ name: string; cfg: string[] | null }>>(`
      SELECT proname AS name, proconfig AS cfg FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prosecdef=true`));
    const unsafeSecdef = secdefFns.filter((f) => !(f.cfg ?? []).some((c) => c.startsWith("search_path=")));
    assert(unsafeSecdef.length === 0, "D7) every SECURITY DEFINER function pins a safe search_path", unsafeSecdef.map((f) => f.name).join(", "));

    console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — RLS & DB security (V1.58.5): ${pass} passed, ${fail} failed`);
  } finally {
    for (const id of ids) await owner.tenant.delete({ where: { id } }).catch(() => {});
    await owner.lead.deleteMany({ where: { name: "Prospect" } }).catch(() => {});
    await owner.stripeWebhookEvent.deleteMany({ where: { eventType: "x" } }).catch(() => {});
    await app.$disconnect(); await owner.$disconnect();
  }
  process.exit(fail === 0 ? 0 : 1);
}
run().catch((e) => { console.error(String(e).slice(0, 200)); process.exit(1); });
