/**
 * DATABASE-BACKED verification of the persisted customer-classification projection.
 *
 * The pure suites prove the projection LOGIC; this one proves the SQL: that the migration's column
 * definition is what the application assumes, that the gate-aware predicates actually exclude
 * unprojected/stale rows in Postgres (not just in an in-memory evaluator), that keyset pagination stays
 * correct under those predicates, that tenant scoping holds, and that GIN category filtering works.
 *
 * Requires the local Postgres from docker-compose.local.yml:
 *   docker compose -f docker-compose.local.yml up -d
 *
 * Run: pnpm customer-projection-db:test
 */
import { PrismaClient } from "@prisma/client";
import {
  customerRiskyWhere, customerRequiresReviewWhere, CUSTOMER_PROJECTION_VERSION,
} from "@guardora/ai";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const prisma = new PrismaClient();
const T_A = "cpdb_tenant_a";
const T_B = "cpdb_tenant_b";
const PREFIX = "cpdb_";

type Fixture = {
  id: string; tenant: string;
  state: string | null; version: number | null; cats: string[]; level: string | null;
};

/** The fixture matrix: every state × version combination the predicates must separate. */
const FIXTURES: Fixture[] = [
  // A — legacy: raw profanity/critical, projection never written.
  { id: `${PREFIX}legacy_null`, tenant: T_A, state: null, version: null, cats: [], level: null },
  // B — the same row after backfill.
  { id: `${PREFIX}legacy_backfilled`, tenant: T_A, state: "review_required", version: CUSTOMER_PROJECTION_VERSION, cats: [], level: "medium" },
  // C/D — current confirmed.
  { id: `${PREFIX}confirmed_prof`, tenant: T_A, state: "confirmed", version: CUSTOMER_PROJECTION_VERSION, cats: ["profanity"], level: "critical" },
  { id: `${PREFIX}confirmed_scam`, tenant: T_A, state: "confirmed", version: CUSTOMER_PROJECTION_VERSION, cats: ["scam"], level: "high" },
  // E/F — clean and non-accusatory.
  { id: `${PREFIX}clean`, tenant: T_A, state: "no_issue", version: CUSTOMER_PROJECTION_VERSION, cats: [], level: "none" },
  // Confirmed spam IS harmful content (spam ∈ RISKY_CATEGORIES), so it legitimately matches risky.
  { id: `${PREFIX}confirmed_spam`, tenant: T_A, state: "confirmed", version: CUSTOMER_PROJECTION_VERSION, cats: ["spam"], level: "medium" },
  // A confirmed NON-accusatory, non-risky category: visible, but never in the risky facet.
  { id: `${PREFIX}descriptive`, tenant: T_A, state: "confirmed", version: CUSTOMER_PROJECTION_VERSION, cats: ["normal_criticism"], level: "low" },
  // H — stale version: confirmed-looking but produced by an older algorithm.
  { id: `${PREFIX}stale_version`, tenant: T_A, state: "confirmed", version: CUSTOMER_PROJECTION_VERSION - 1, cats: ["profanity"], level: "critical" },
  // Version present, state missing — still unprojected.
  { id: `${PREFIX}null_state`, tenant: T_A, state: null, version: CUSTOMER_PROJECTION_VERSION, cats: [], level: null },
  // Other tenant — must never leak into tenant A's results.
  { id: `${PREFIX}other_tenant`, tenant: T_B, state: "confirmed", version: CUSTOMER_PROJECTION_VERSION, cats: ["profanity"], level: "critical" },
];

async function seed(): Promise<void> {
  await cleanup();
  for (const t of [T_A, T_B]) {
    await prisma.$executeRawUnsafe(`INSERT INTO tenants (id,name,slug,"createdAt","updatedAt") VALUES ($1,$1,$1,now(),now()) ON CONFLICT (id) DO NOTHING`, t);
    await prisma.$executeRawUnsafe(`INSERT INTO brands (id,"tenantId",name,"createdAt","updatedAt") VALUES ($1,$2,$1,now(),now()) ON CONFLICT (id) DO NOTHING`, `${t}_brand`, t);
    await prisma.$executeRawUnsafe(
      `INSERT INTO connected_accounts (id,"tenantId","brandId",platform,"externalId","externalName",status,"createdAt","updatedAt")
       VALUES ($1,$2,$3,'facebook_page',$1,$1,(SELECT unnest(enum_range(NULL::"ConnectorStatus")) LIMIT 1),now(),now()) ON CONFLICT (id) DO NOTHING`,
      `${t}_acct`, t, `${t}_brand`,
    );
  }
  let i = 0;
  for (const f of FIXTURES) {
    i++;
    await prisma.$executeRawUnsafe(
      `INSERT INTO content_items (id,"tenantId","brandId","connectedAccountId",platform,kind,"externalId",text,"publishedAt","ingestedAt")
       VALUES ($1,$2,$3,$4,'facebook_page','comment',$1,'x',now(),now())`,
      `${f.id}_ci`, f.tenant, `${f.tenant}_brand`, `${f.tenant}_acct`,
    );
    // Raw verdict is deliberately ACCUSATORY for every fixture, so only the persisted projection can
    // separate them — exactly the condition the old raw predicate failed.
    await prisma.$executeRawUnsafe(
      `INSERT INTO reputation_items
         (id,"tenantId","brandId",platform,"contentItemId",status,priority,"riskLevel","riskConfidence","riskCategories",sentiment,
          "customerClassificationState","customerClassificationProjectionVersion","customerRiskCategories","customerRiskLevel","createdAt","updatedAt")
       VALUES ($1,$2,$3,'facebook_page',$4,'classified','normal','critical',0.88,ARRAY['profanity'],'negative',
          $5,$6,$7::text[],$8::"RiskLevel", now() - ($9 || ' minutes')::interval, now())`,
      f.id, f.tenant, `${f.tenant}_brand`, `${f.id}_ci`,
      f.state, f.version, f.cats, f.level, String(i),
    );
  }
}

async function cleanup(): Promise<void> {
  await prisma.$executeRawUnsafe(`DELETE FROM reputation_items WHERE id LIKE '${PREFIX}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM content_items WHERE id LIKE '${PREFIX}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM connected_accounts WHERE id LIKE '${PREFIX}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM brands WHERE id LIKE '${PREFIX}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id LIKE '${PREFIX}%'`);
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

async function main(): Promise<void> {
  console.log("\n0) migration/schema parity — the column is what the application assumes");
  {
    const col = await prisma.$queryRawUnsafe<{ is_nullable: string; column_default: string | null; data_type: string }[]>(
      `SELECT is_nullable, column_default, data_type FROM information_schema.columns
       WHERE table_name='reputation_items' AND column_name='customerRiskCategories'`,
    );
    const c = col[0];
    check("0a) customerRiskCategories exists as an array column", c?.data_type === "ARRAY", JSON.stringify(c));
    check("0b) it is NOT NULL", c?.is_nullable === "NO", c?.is_nullable);
    check("0c) it defaults to an empty array", (c?.column_default ?? "").includes("{}"), c?.column_default ?? "null");

    const others = await prisma.$queryRawUnsafe<{ column_name: string; is_nullable: string }[]>(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name='reputation_items' AND column_name IN
       ('customerClassificationState','customerRiskLevel','customerClassificationProjectionVersion','customerRequiresReanalysis')`,
    );
    check("0d) state, level, version and reanalysis remain nullable",
      others.length === 4 && others.every((o) => o.is_nullable === "YES"), JSON.stringify(others));

    const gin = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE tablename='reputation_items' AND indexname LIKE '%customerRiskCategories%'`,
    );
    check("0e) a GIN index exists on the array", (gin[0]?.indexdef ?? "").includes("gin"), gin[0]?.indexdef ?? "missing");
  }

  await seed();
  const tenantA = { tenantId: T_A };

  console.log("\n1) the confirmed-risky predicate excludes every unprojected/stale row (real SQL)");
  {
    const risky = await prisma.reputationItem.findMany({
      where: { AND: [tenantA, customerRiskyWhere(CUSTOMER_PROJECTION_VERSION) as never] },
      select: { id: true },
    });
    check("1a) matches exactly the confirmed risky rows",
      ids(risky).join(",") === [`${PREFIX}confirmed_prof`, `${PREFIX}confirmed_scam`, `${PREFIX}confirmed_spam`].sort().join(","), ids(risky).join(","));
    check("1b) the NULL-projection legacy row is excluded", !ids(risky).includes(`${PREFIX}legacy_null`));
    check("1c) the backfilled review_required row is excluded", !ids(risky).includes(`${PREFIX}legacy_backfilled`));
    check("1d) the stale-version row is excluded", !ids(risky).includes(`${PREFIX}stale_version`));
    check("1e) the null-state row is excluded", !ids(risky).includes(`${PREFIX}null_state`));
    check("1f) the clean row is excluded", !ids(risky).includes(`${PREFIX}clean`));
    check("1g) a confirmed NON-risky category (normal_criticism) is excluded from RISKY", !ids(risky).includes(`${PREFIX}descriptive`));
    check("1g2) a confirmed RISKY category (spam) IS included", ids(risky).includes(`${PREFIX}confirmed_spam`));
    check("1h) tenant isolation: the other tenant's confirmed row never appears", !ids(risky).includes(`${PREFIX}other_tenant`));
  }

  console.log("\n2) the requires-review predicate includes them, and nothing is lost");
  {
    const review = await prisma.reputationItem.findMany({
      where: { AND: [tenantA, customerRequiresReviewWhere(CUSTOMER_PROJECTION_VERSION) as never] },
      select: { id: true },
    });
    const expect = [`${PREFIX}legacy_null`, `${PREFIX}legacy_backfilled`, `${PREFIX}stale_version`, `${PREFIX}null_state`].sort();
    check("2a) matches exactly the unprojected/stale/review rows", ids(review).join(",") === expect.join(","), ids(review).join(","));
    check("2b) confirmed rows never appear here",
      !ids(review).includes(`${PREFIX}confirmed_prof`) && !ids(review).includes(`${PREFIX}confirmed_scam`));
    check("2c) the clean row is NOT counted as requiring review", !ids(review).includes(`${PREFIX}clean`));

    const risky = await prisma.reputationItem.findMany({
      where: { AND: [tenantA, customerRiskyWhere(CUSTOMER_PROJECTION_VERSION) as never] }, select: { id: true },
    });
    const overlap = ids(risky).filter((i) => ids(review).includes(i));
    check("2d) the two facets are non-overlapping in SQL", overlap.length === 0, overlap.join(","));
  }

  console.log("\n3) keyset pagination stays correct under the predicates");
  {
    const page = async (where: object, cursorAfter?: { createdAt: Date; id: string }) =>
      prisma.reputationItem.findMany({
        where: {
          AND: [tenantA, where as never, ...(cursorAfter ? [{
            OR: [
              { createdAt: { lt: cursorAfter.createdAt } },
              { createdAt: cursorAfter.createdAt, id: { lt: cursorAfter.id } },
            ],
          } as never] : [])],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, createdAt: true },
      });

    for (const [label, where, expected] of [
      ["risky", customerRiskyWhere(CUSTOMER_PROJECTION_VERSION), 3],
      ["requires-review", customerRequiresReviewWhere(CUSTOMER_PROJECTION_VERSION), 4],
    ] as const) {
      const seen: string[] = [];
      let cursor: { createdAt: Date; id: string } | undefined;
      for (let i = 0; i < 10; i++) {
        const rows = await page(where, cursor);
        const row = rows[0];
        if (!row) break;
        seen.push(row.id);
        cursor = { createdAt: row.createdAt, id: row.id };
      }
      check(`3a) ${label}: page-size-1 cursor walk returns every row exactly once`,
        seen.length === expected && new Set(seen).size === expected, `${seen.length} rows`);
      const all = await prisma.reputationItem.findMany({
        where: { AND: [tenantA, where as never] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true },
      });
      check(`3b) ${label}: the walk order matches a single unpaginated query`,
        seen.join(",") === all.map((r) => r.id).join(","), seen.join(","));
    }
  }

  console.log("\n4) GIN category filtering over the persisted confirmed categories");
  {
    const prof = await prisma.reputationItem.findMany({
      where: { tenantId: T_A, customerRiskCategories: { hasSome: ["profanity"] } }, select: { id: true },
    });
    check("4a) confirmed profanity is found by category containment", ids(prof).includes(`${PREFIX}confirmed_prof`));
    check("4b) the legacy row (raw profanity, empty projection) is NOT found", !ids(prof).includes(`${PREFIX}legacy_null`));
    check("4c) the stale-version row still carries its array but is excluded by the risky predicate",
      ids(prof).includes(`${PREFIX}stale_version`));
    const empty = await prisma.reputationItem.findMany({
      where: { tenantId: T_A, customerRiskCategories: { isEmpty: true } }, select: { id: true },
    });
    check("4d) empty-array rows are queryable (no NULLs to special-case)", ids(empty).length >= 3, ids(empty).join(","));
    const nulls = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM reputation_items WHERE "customerRiskCategories" IS NULL`,
    );
    check("4e) no customerRiskCategories value is NULL anywhere in the table", Number(nulls[0]?.n ?? -1) === 0);
  }

  await cleanup();
  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — customer projection (database-backed): ${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(`database-backed run failed: ${(e as Error).message.slice(0, 300)}`);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
