/**
 * S1 — SecurityScoreSnapshot persistence + RLS isolation (local DB).
 * Verifies: tenant-scoped writes/reads, cross-tenant isolation, fail-closed with
 * no context, and that `score` persists as NULL for insufficient_data (never a
 * fabricated 0). Run: pnpm security-score-snapshot:test
 */
import { systemDb, withTenant } from "../src/index";

let pass = 0,
  fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};
const sfx = `sss_${process.pid}`;
const tA = `tenA_${sfx}`;
const tB = `tenB_${sfx}`;

async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

async function main() {
  // Setup: two tenants (systemDb bypasses RLS for fixtures).
  for (const id of [tA, tB]) {
    await systemDb.tenant.upsert({ where: { id }, update: {}, create: { id, name: id, slug: id, plan: "growth" } });
  }

  // Write under tenant A via RLS context: one insufficient (score null) + one measured.
  await withTenant(tA, (db) =>
    db.securityScoreSnapshot.create({ data: { tenantId: tA, scope: "tenant", score: null, status: "insufficient_data", subscores: { note: "insufficient" } } }),
  );
  await withTenant(tA, (db) =>
    db.securityScoreSnapshot.create({ data: { tenantId: tA, scope: "tenant", score: 75, status: "measured", subscores: { level: "fair" } } }),
  );

  // 1) Tenant A sees exactly its 2 snapshots.
  const aRows = await withTenant(tA, (db) => db.securityScoreSnapshot.findMany({ where: {} }));
  check("A sees its 2 snapshots under RLS", aRows.length === 2);

  // 2) Nullable score persisted as NULL (insufficient_data), never 0.
  const nullRow = aRows.find((r) => r.status === "insufficient_data");
  check("insufficient_data snapshot stored score = NULL (not 0)", nullRow != null && nullRow.score === null);
  const measuredRow = aRows.find((r) => r.status === "measured");
  check("measured snapshot stored score = 75", measuredRow != null && measuredRow.score === 75);

  // 3) Tenant B sees none of A's snapshots (RLS isolation).
  const bRows = await withTenant(tB, (db) => db.securityScoreSnapshot.findMany({ where: {} }));
  check("B sees 0 of A's snapshots (tenant isolation)", bRows.length === 0);

  // 4) B cannot write a snapshot tagged as tenant A (WITH CHECK).
  const blocked = await rejects(() =>
    withTenant(tB, (db) => db.securityScoreSnapshot.create({ data: { tenantId: tA, scope: "tenant", score: 10, status: "measured", subscores: {} } })),
  );
  check("B cannot INSERT a row for tenant A (WITH CHECK)", blocked);

  // Cleanup (systemDb).
  await systemDb.securityScoreSnapshot.deleteMany({ where: { tenantId: { in: [tA, tB] } } });
  await systemDb.tenant.deleteMany({ where: { id: { in: [tA, tB] } } });

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — security score snapshot RLS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
