/**
 * RC Stabilization — regression for the notifications/invites bootstrap-permissive `IS NULL` RLS fix
 * (migration 20260819090000). Connects as the REAL restricted `tamanor_app` role (NOBYPASSRLS) and proves,
 * for BOTH `notifications` and `invites`:
 *   • valid same-tenant read/write works (context set),
 *   • cross-tenant read is denied (context = tenant A → 0 of tenant B),
 *   • NULL-context (no session) is fail-closed → 0 rows (the removed permissive branch),
 *   • the privileged owner/system path still sees everything (RLS bypass).
 * Run: pnpm rls-null-branch-fix:test
 */
import { PrismaClient } from "@prisma/client";

const OWNER_URL = process.env.DATABASE_URL ?? "";
const APP_URL = process.env.APP_DATABASE_URL ?? "";
let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

if (!APP_URL || APP_URL === OWNER_URL) { console.error("✗ APP_DATABASE_URL (tamanor_app role) required and must differ from DATABASE_URL."); process.exit(2); }

const owner = new PrismaClient({ datasourceUrl: OWNER_URL }); // bypassrls — seeds + system path
const app = new PrismaClient({ datasourceUrl: APP_URL });     // tamanor_app — RLS enforced

/** Run an app query inside a transaction-local tenant context (mirrors withTenantDb). */
async function asTenant<T>(tenantId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
  return app.$transaction(async (tx) => { await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`; return fn(tx as unknown as PrismaClient); });
}
/** Run an app query with NO tenant context set (the fail-closed / null-context path). */
async function noContext<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
  return app.$transaction(async (tx) => fn(tx as unknown as PrismaClient));
}

const sfx = `rlsnb_${process.pid}`;
const tids: string[] = [];
let k = 0;
async function seedTenant() {
  const id = `t${k++}_${sfx}`; tids.push(id);
  await owner.tenant.create({ data: { id, name: id, slug: id, plan: "free" } });
  const notif = await owner.notification.create({ data: { tenantId: id, type: "sync_failed", severity: "warning", titleKey: "k", messageKey: "m", dedupeKey: `d_${id}` } });
  const inv = await owner.invite.create({ data: { tenantId: id, emailNormalized: `x@${id}.local`, tokenHash: `th_${id}`, expiresAt: new Date(Date.now() + 864e5) } });
  return { id, notifId: notif.id, inviteId: inv.id };
}

async function main() {
  const A = await seedTenant();
  const B = await seedTenant();

  console.log("\nnotifications");
  check("★ valid same-tenant read works (context A → sees A's notification)", (await asTenant(A.id, (tx) => tx.notification.count({ where: { tenantId: A.id } }))) === 1);
  check("★ cross-tenant read DENIED (context A → 0 of tenant B)", (await asTenant(A.id, (tx) => tx.notification.count({ where: { tenantId: B.id } }))) === 0);
  check("★ cross-tenant read DENIED (context A → unfiltered count = only A's)", (await asTenant(A.id, (tx) => tx.notification.count())) === 1);
  check("★ NULL-context is FAIL-CLOSED (no session → 0 rows)", (await noContext((tx) => tx.notification.count())) === 0);
  const wrote = await asTenant(A.id, (tx) => tx.notification.create({ data: { tenantId: A.id, type: "sync_failed", severity: "info", titleKey: "k", messageKey: "m", dedupeKey: `d2_${A.id}` } }).then(() => true).catch(() => false));
  check("★ same-tenant WRITE works under context", wrote === true);
  check("★ owner/system path sees ALL (RLS bypass)", (await owner.notification.count({ where: { tenantId: { in: [A.id, B.id] } } })) >= 3);

  console.log("\ninvites");
  check("★ valid same-tenant read works (context A → sees A's invite)", (await asTenant(A.id, (tx) => tx.invite.count({ where: { tenantId: A.id } }))) === 1);
  check("★ cross-tenant read DENIED (context A → 0 of tenant B)", (await asTenant(A.id, (tx) => tx.invite.count({ where: { tenantId: B.id } }))) === 0);
  check("★ NULL-context is FAIL-CLOSED (no session → 0 rows)", (await noContext((tx) => tx.invite.count())) === 0);
  check("★ owner/system path sees ALL invites (RLS bypass)", (await owner.invite.count({ where: { tenantId: { in: [A.id, B.id] } } })) === 2);

  console.log("\npolicy structure");
  const nullPols = (await owner.$queryRawUnsafe<Array<{ t: string }>>(`SELECT tablename AS t FROM pg_policies WHERE schemaname='public' AND tablename IN ('notifications','invites') AND (qual LIKE '%IS NULL%' OR with_check LIKE '%IS NULL%')`));
  check("★ neither policy retains an IS NULL branch", nullPols.length === 0);
}

main()
  .then(async () => {
    for (const id of tids) { await owner.notification.deleteMany({ where: { tenantId: id } }).catch(() => {}); await owner.invite.deleteMany({ where: { tenantId: id } }).catch(() => {}); await owner.tenant.delete({ where: { id } }).catch(() => {}); }
    await owner.$disconnect(); await app.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — RLS null-branch fix (notifications/invites): ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => { console.error("FATAL:", e?.stack ?? e?.message ?? e); for (const id of tids) await owner.tenant.delete({ where: { id } }).catch(() => {}); await owner.$disconnect().catch(() => {}); await app.$disconnect().catch(() => {}); process.exit(1); });
