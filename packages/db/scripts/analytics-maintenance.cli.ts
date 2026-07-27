/**
 * Platform Privacy Analytics V1 — retention + aggregation maintenance CLI. Runs deterministic daily
 * aggregation for a recent window, then bounded raw-event retention. Idempotent + concurrency-safe (safe to
 * re-run). Intended for LOCAL/manual execution and as the entry point a PRODUCTION scheduler invokes (this
 * sprint does NOT change any scheduler configuration). Analytics failures never affect customer requests.
 *
 *   pnpm analytics:maintenance [--days 2]
 */
import { runAnalyticsAggregation, runAnalyticsRetention, systemDb } from "../src/index";

function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; }

async function main() {
  const days = Math.min(Math.max(1, Number(arg("days") ?? 2)), 90);
  const now = new Date();
  const from = new Date(now.getTime() - days * 86400000);
  const agg = await runAnalyticsAggregation({ from, to: now, now });
  const ret = await runAnalyticsRetention({ now });
  console.log(JSON.stringify({ ok: true, aggregation: agg, retention: ret }));
  await systemDb.$disconnect();
}
main().catch(async (e) => { console.error("analytics maintenance failed:", (e as Error).message); await systemDb.$disconnect(); process.exit(1); });
