/**
 * V1.57.4 — post-migration verification of stripe_checkout_attempts. Structure checks are READ-ONLY
 * (pg_catalog / information_schema). The runtime tenant-isolation check runs entirely inside a
 * transaction that is ALWAYS rolled back (a sentinel throw), so it leaves NO synthetic row behind.
 * Prints only structural facts — never a credential, tenant name, or billing datum.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { systemDb } from "../src/index";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok ? "" : `  — ${detail}`}`);
  ok ? pass++ : fail++;
}
const q = <T = Record<string, unknown>>(sql: TemplateStringsArray, ...v: unknown[]) => systemDb.$queryRaw<T[]>(sql, ...v);

async function run() {
  console.log(`\nTarget: production (${(process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]*@/, "://***@").split("?")[0]})\n`);

  // 1) table exists
  const reg = (await q`SELECT to_regclass('public.stripe_checkout_attempts')::text AS t`)[0]?.t;
  check("1) table stripe_checkout_attempts exists", reg === "stripe_checkout_attempts", String(reg));

  // 2) expected columns + types
  const cols = await q<{ column_name: string; data_type: string }>`
    SELECT column_name, data_type FROM information_schema.columns WHERE table_name='stripe_checkout_attempts'`;
  const colmap = new Map(cols.map((c) => [c.column_name, c.data_type]));
  const expected: Record<string, string> = {
    id: "text", tenantId: "text", status: "text", requestedPlan: "text", requestedInterval: "text",
    stripePriceId: "text", stripeCheckoutSessionId: "text", stripeCheckoutUrl: "text",
    stripeCheckoutUrlExpiresAt: "timestamp without time zone", idempotencyKey: "text", createdByUserId: "text",
    createdAt: "timestamp without time zone", updatedAt: "timestamp without time zone", expiresAt: "timestamp without time zone",
    completedAt: "timestamp without time zone", failedAt: "timestamp without time zone", failureCode: "text",
  };
  const missing = Object.entries(expected).filter(([c, t]) => colmap.get(c) !== t).map(([c]) => c);
  check("2) all expected columns present with correct types", missing.length === 0, `mismatched: ${missing.join(", ")}`);

  // 3) foreign key → tenants
  const fk = (await q<{ ref: string }>`
    SELECT confrelid::regclass::text AS ref FROM pg_constraint
    WHERE conrelid='stripe_checkout_attempts'::regclass AND contype='f'`).map((r) => r.ref);
  check("3) foreign key references tenants", fk.includes("tenants"), fk.join(", "));

  // 4/5/6) indexes — unique(sessionId), unique(idempotencyKey), PARTIAL unique(one live per tenant)
  const idx = await q<{ indexname: string; indexdef: string }>`
    SELECT indexname, indexdef FROM pg_indexes WHERE tablename='stripe_checkout_attempts'`;
  const byName = new Map(idx.map((i) => [i.indexname, i.indexdef]));
  check("4) unique index on stripeCheckoutSessionId",
    /UNIQUE/i.test(byName.get("stripe_checkout_attempts_stripeCheckoutSessionId_key") ?? ""));
  check("5) unique index on idempotencyKey",
    /UNIQUE/i.test(byName.get("stripe_checkout_attempts_idempotencyKey_key") ?? ""));
  const partial = byName.get("stripe_checkout_attempts_one_live_per_tenant") ?? "";
  check("6) PARTIAL unique index one_live_per_tenant with predicate status IN (CREATING,OPEN)",
    /UNIQUE/i.test(partial) && /\("?tenantId"?\)/.test(partial) && /WHERE .*status.*=\s*ANY|WHERE .*'CREATING'/i.test(partial) && /'OPEN'/.test(partial),
    partial);

  // 7/8) RLS enabled + forced
  const rls = (await q<{ e: boolean; f: boolean }>`
    SELECT relrowsecurity AS e, relforcerowsecurity AS f FROM pg_class WHERE relname='stripe_checkout_attempts'`)[0];
  check("7) ROW LEVEL SECURITY enabled", rls?.e === true);
  check("8) FORCE ROW LEVEL SECURITY enabled", rls?.f === true);

  // 9) tenant policy exists (USING + WITH CHECK on tenant context)
  const pol = await q<{ policyname: string; qual: string | null; with_check: string | null }>`
    SELECT policyname, qual, with_check FROM pg_policies WHERE tablename='stripe_checkout_attempts'`;
  const iso = pol.find((p) => p.policyname === "tenant_isolation");
  check("9) tenant_isolation policy exists (USING + WITH CHECK reference current_app_tenant_id)",
    !!iso && /current_app_tenant_id/.test(iso.qual ?? "") && /current_app_tenant_id/.test(iso.with_check ?? ""));

  // 10) runtime role grants
  const grants = (await q<{ privilege_type: string }>`
    SELECT privilege_type FROM information_schema.role_table_grants
    WHERE table_name='stripe_checkout_attempts' AND grantee='tamanor_app'`).map((g) => g.privilege_type);
  check("10) tamanor_app has SELECT/INSERT/UPDATE/DELETE",
    ["SELECT", "INSERT", "UPDATE", "DELETE"].every((p) => grants.includes(p)), grants.join(", "));

  // 12) system/webhook path can read the table (owner client, no tenant context) — read-only, no write
  const total = (await q<{ c: number }>`SELECT count(*)::int AS c FROM stripe_checkout_attempts`)[0]?.c;
  check("12) system path can query the table (owner client)", typeof total === "number", `rows=${total}`);

  // 11) runtime tenant isolation via the restricted tamanor_app role — ALL rolled back (no residue).
  const appUrl = process.env.APP_DATABASE_URL;
  const aTenant = (await q<{ id: string }>`SELECT id FROM tenants LIMIT 1`)[0]?.id;
  if (!appUrl || !aTenant) {
    check("11) runtime isolation (tamanor_app role)", false, !appUrl ? "APP_DATABASE_URL not set" : "no tenant to anchor FK");
  } else {
    const appDb = new PrismaClient({ datasourceUrl: appUrl });
    const SENTINEL = Symbol("rollback");
    const other = randomUUID();
    const tmpId = `verify_${randomUUID()}`;
    const tmpKey = `verify_${randomUUID()}`;
    let ownVisible = -1, crossVisible = -1, crossUpdated = -1;
    try {
      await appDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${aTenant}, true)`;
        await tx.$executeRaw`
          INSERT INTO stripe_checkout_attempts
            (id,"tenantId",status,"requestedPlan","requestedInterval","stripePriceId","idempotencyKey","expiresAt","updatedAt")
          VALUES (${tmpId},${aTenant},'CREATING','starter','monthly','price_verify',${tmpKey}, now()+interval '3 minutes', now())`;
        ownVisible = (await tx.$queryRaw<{ c: number }[]>`SELECT count(*)::int AS c FROM stripe_checkout_attempts WHERE id=${tmpId}`)[0].c;
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${other}, true)`; // impersonate a DIFFERENT tenant
        crossVisible = (await tx.$queryRaw<{ c: number }[]>`SELECT count(*)::int AS c FROM stripe_checkout_attempts WHERE id=${tmpId}`)[0].c;
        crossUpdated = await tx.$executeRaw`UPDATE stripe_checkout_attempts SET status='ABANDONED' WHERE id=${tmpId}`;
        throw SENTINEL; // ALWAYS roll back — the temp row never commits
      });
    } catch (e) {
      if (e !== SENTINEL) { check("11) runtime isolation (tamanor_app role)", false, String((e as Error)?.message ?? e).slice(0, 120)); }
    } finally {
      await appDb.$disconnect();
    }
    if (ownVisible !== -1) {
      check("11) runtime isolation: own-context visible, cross-tenant INVISIBLE + IMMUTABLE (rolled back)",
        ownVisible === 1 && crossVisible === 0 && crossUpdated === 0, `own=${ownVisible} cross=${crossVisible} updated=${crossUpdated}`);
    }
    // Confirm nothing leaked past the rollback.
    const leaked = (await q<{ c: number }>`SELECT count(*)::int AS c FROM stripe_checkout_attempts WHERE id=${tmpId}`)[0]?.c;
    check("11b) no synthetic row left behind (rollback clean)", leaked === 0, `found=${leaked}`);
  }

  await systemDb.$disconnect();
  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — checkout-attempts production verification: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
