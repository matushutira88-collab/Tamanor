/**
 * BOUNDED, IDEMPOTENT BACKFILL of the persisted customer-classification projection.
 *
 * Migration 20260901090000 added the projection columns as NULL for every existing row. NULL fails
 * closed (review_required, no categories, capped level), so production is CORRECT but conservative:
 * every legacy row sits in the requires-review facet until it is projected. This tool projects them.
 *
 * SAFETY CONTRACT
 *  - DRY-RUN BY DEFAULT. `--apply` alone is not enough: BACKFILL_CONFIRMATION must equal the exact
 *    arming phrase, and BACKFILL_ENVIRONMENT must be `production`.
 *  - Writes ONLY the five projection columns. Never touches riskLevel/riskConfidence/riskCategories/
 *    aiDiagnostics (the immutable diagnostic source) and never touches AutoProtectDecision.
 *  - Bounded batches, deterministic `id ASC` cursor, resumable via BACKFILL_CURSOR, idempotent
 *    (rows already on the current projection version are skipped).
 *  - Tenant-safe: rows are processed within their own tenant context so RLS applies exactly as it does
 *    to application traffic.
 *  - Output is AGGREGATE COUNTS ONLY. No comment text, no PII, no ids, no tokens, no raw diagnostics,
 *    no DATABASE_URL — the resume cursor is the sole opaque identifier emitted, and only when armed.
 *
 * Usage:
 *   pnpm --filter @guardora/db exec tsx scripts/backfill-customer-projection.cli.ts            # dry-run
 *   BACKFILL_ENVIRONMENT=production BACKFILL_CONFIRMATION=APPLY_CUSTOMER_PROJECTION_BACKFILL \
 *     pnpm --filter @guardora/db exec tsx scripts/backfill-customer-projection.cli.ts --apply
 */
import { prisma } from "../src/index";
import { persistedProjectionFields, CUSTOMER_PROJECTION_VERSION } from "@guardora/ai";

export const APPLY_CONFIRMATION = "APPLY_CUSTOMER_PROJECTION_BACKFILL";
const DEFAULT_BATCH = 200;
const DEFAULT_MAX_BATCHES = 5;

export interface BackfillCounts {
  scanned: number;
  confirmed: number;
  reviewRequired: number;
  noIssue: number;
  legacyUnverified: number;
  skippedCurrentVersion: number;
  updated: number;
  failed: number;
  remaining: number;
  nextCursor: string | null;
}

const bounded = (raw: string | undefined, def: number, min: number, max: number): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
};

/** Arming check — mutation requires BOTH the flag and the exact environment + confirmation phrase. */
export function isArmed(argv: readonly string[], env: NodeJS.ProcessEnv): { armed: boolean; reason: string } {
  if (!argv.includes("--apply")) return { armed: false, reason: "dry_run_default" };
  if (env.BACKFILL_ENVIRONMENT !== "production") return { armed: false, reason: "environment_not_production" };
  if (env.BACKFILL_CONFIRMATION !== APPLY_CONFIRMATION) return { armed: false, reason: "confirmation_mismatch" };
  return { armed: true, reason: "armed" };
}

async function main(): Promise<void> {
  const env = process.env;
  const { armed, reason } = isArmed(process.argv.slice(2), env);
  const batchSize = bounded(env.BACKFILL_BATCH_SIZE, DEFAULT_BATCH, 1, 1000);
  const maxBatches = bounded(env.BACKFILL_MAX_BATCHES, DEFAULT_MAX_BATCHES, 1, 100);
  let cursor = (env.BACKFILL_CURSOR ?? "").trim() || null;

  console.log(`customer-projection backfill — mode=${armed ? "APPLY" : "DRY-RUN"} (${reason})`);
  console.log(`  projectionVersion=${CUSTOMER_PROJECTION_VERSION} batchSize=${batchSize} maxBatches=${maxBatches} resume=${cursor ? "yes" : "no"}`);

  const c: BackfillCounts = {
    scanned: 0, confirmed: 0, reviewRequired: 0, noIssue: 0, legacyUnverified: 0,
    skippedCurrentVersion: 0, updated: 0, failed: 0, remaining: 0, nextCursor: null,
  };

  for (let batch = 0; batch < maxBatches; batch++) {
    // Deterministic keyset scan on the (tenantId, projectionVersion, id) index. Rows already on the
    // current version are excluded by the predicate, which is what makes re-running a no-op.
    const rows = await prisma.reputationItem.findMany({
      where: {
        OR: [
          { customerClassificationProjectionVersion: null },
          { customerClassificationProjectionVersion: { lt: CUSTOMER_PROJECTION_VERSION } },
        ],
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: batchSize,
      select: {
        id: true, tenantId: true, riskLevel: true, riskConfidence: true, riskCategories: true,
        aiDiagnostics: true, customerClassificationProjectionVersion: true,
      },
    });
    if (rows.length === 0) break;

    // One bounded lookup of the Auto-Protect decisions for exactly this batch (no widening).
    const decisions = await prisma.autoProtectDecision.findMany({
      where: { itemId: { in: rows.map((r) => r.id) } },
      select: { itemId: true, decision: true, matchedCategory: true },
    });
    const byItem = new Map(decisions.map((d) => [d.itemId, d]));

    for (const row of rows) {
      c.scanned++;
      cursor = row.id;
      if (row.customerClassificationProjectionVersion === CUSTOMER_PROJECTION_VERSION) {
        c.skippedCurrentVersion++;
        continue;
      }
      try {
        const ap = byItem.get(row.id);
        // THE canonical helper — the backfill never re-derives the evidence gate itself.
        const fields = persistedProjectionFields({
          riskLevel: row.riskLevel as unknown as string,
          riskCategories: row.riskCategories,
          riskConfidence: row.riskConfidence,
          aiDiagnostics: row.aiDiagnostics,
          autoProtect: ap ? { decision: ap.decision, matchedCategory: ap.matchedCategory } : null,
        });
        if (fields.customerClassificationState === "confirmed") c.confirmed++;
        else if (fields.customerClassificationState === "review_required") c.reviewRequired++;
        else c.noIssue++;
        if (fields.customerRequiresReanalysis) c.legacyUnverified++;

        if (armed) {
          // ONLY the projection columns. Raw verdict and AutoProtectDecision are never written.
          await prisma.reputationItem.update({
            where: { id: row.id },
            data: {
              customerClassificationState: fields.customerClassificationState,
              customerRiskLevel: fields.customerRiskLevel as never,
              customerRiskCategories: fields.customerRiskCategories,
              customerClassificationProjectionVersion: fields.customerClassificationProjectionVersion,
              customerRequiresReanalysis: fields.customerRequiresReanalysis,
            },
          });
          c.updated++;
        }
      } catch {
        // Never print the error — it can carry row content. Counts only.
        c.failed++;
      }
    }
    if (rows.length < batchSize) break;
  }

  c.remaining = await prisma.reputationItem.count({
    where: {
      OR: [
        { customerClassificationProjectionVersion: null },
        { customerClassificationProjectionVersion: { lt: CUSTOMER_PROJECTION_VERSION } },
      ],
    },
  });
  c.nextCursor = armed ? cursor : null;

  console.log("\nresult (counts only — no ids, text, PII, diagnostics or connection details):");
  console.log(`  scanned                 : ${c.scanned}`);
  console.log(`  confirmed               : ${c.confirmed}`);
  console.log(`  review_required         : ${c.reviewRequired}`);
  console.log(`  no_issue                : ${c.noIssue}`);
  console.log(`  legacy/unverified       : ${c.legacyUnverified}`);
  console.log(`  skipped (current version): ${c.skippedCurrentVersion}`);
  console.log(`  updated                 : ${c.updated}${armed ? "" : " (dry-run — nothing written)"}`);
  console.log(`  failed                  : ${c.failed}`);
  console.log(`  remaining               : ${c.remaining}`);
  if (c.nextCursor) console.log(`  resume cursor           : ${c.nextCursor}`);

  await prisma.$disconnect();
  process.exit(c.failed > 0 ? 1 : 0);
}

main().catch(async () => {
  // No error body is printed — it may contain row content.
  console.error("backfill failed (details withheld by design)");
  await prisma.$disconnect();
  process.exit(1);
});
