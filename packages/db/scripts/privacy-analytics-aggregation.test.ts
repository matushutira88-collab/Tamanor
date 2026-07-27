/**
 * Platform Privacy Analytics V1 — aggregation + retention DOMAIN tests (local DB). Proves deterministic,
 * idempotent daily aggregation (approximate unique visitors, sessions, bounce, engaged, conversions), bot
 * inclusion in the warehouse but read-time exclusion, low-count suppression, and bounded raw-event retention
 * that keeps aggregates. Run: pnpm privacy-analytics-aggregation:test
 */
import { systemDb, ingestAnalyticsEvents, recordConversion, runAnalyticsAggregation, runAnalyticsRetention, analyticsOverview, analyticsGroupBy, analyticsExportCsv, PlatformRole, analyticsIdempotencyKey } from "@guardora/db";
import { suppressLowCount } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const DAY = new Date(Date.UTC(2002, 0, 1 + (process.pid % 3000)));
const iso = DAY.toISOString();
const HOME = `/t${process.pid}/home`, PRICING = `/t${process.pid}/pricing`;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const BOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

let ownerId = "";
async function seedOwner() {
  const u = await systemDb.user.create({ data: { id: `paggu_${process.pid}`, email: `paggu_${process.pid}@t.local`, platformRole: PlatformRole.owner } });
  ownerId = u.id;
}
function ctx(vis: string, sess: string, consent: "ENABLED" | "DISABLED" = "ENABLED", ua = UA) {
  return { userAgent: ua, ip: "203.0.113.9", visitorToken: vis, sessionToken: sess, consent, now: DAY };
}
async function homeAgg() {
  return systemDb.websiteAnalyticsDailyAggregate.findFirst({ where: { date: DAY, normalizedPath: HOME, eventType: "PAGE_VIEW", botClassification: "HUMAN_LIKELY" } });
}

async function main() {
  // Defensive pre-clean (in case a prior run for this pid's day crashed before cleanup).
  await systemDb.websiteAnalyticsEvent.deleteMany({ where: { occurredAt: DAY } }).catch(() => {});
  await systemDb.websiteAnalyticsDailyAggregate.deleteMany({ where: { date: DAY } }).catch(() => {});
  await systemDb.user.deleteMany({ where: { id: `paggu_${process.pid}` } }).catch(() => {});
  await seedOwner();

  // Scenario on DAY: visitor A session A1 → 2 views on /home (engaged); visitor B session B1 → 1 view on /home
  // (bounce); visitor A session A2 → 1 view on /pricing; one bot view on /home; one registration conversion.
  console.log("\nA. ingest scenario");
  await ingestAnalyticsEvents([{ eventType: "PAGE_VIEW", path: HOME, occurredAt: iso }, { eventType: "PAGE_VIEW", path: HOME, occurredAt: iso }], ctx("A", "A1"));
  await ingestAnalyticsEvents([{ eventType: "PAGE_VIEW", path: HOME, occurredAt: iso }], ctx("B", "B1"));
  await ingestAnalyticsEvents([{ eventType: "PAGE_VIEW", path: PRICING, occurredAt: iso }], ctx("A", "A2"));
  await ingestAnalyticsEvents([{ eventType: "PAGE_VIEW", path: HOME, occurredAt: iso }], ctx("bot", "bot1", "ENABLED", BOT_UA));
  await recordConversion("REGISTRATION_COMPLETED", analyticsIdempotencyKey("reg", `agg-${process.pid}`), { now: DAY, path: `/t${process.pid}/register` });
  const rawCount = await systemDb.websiteAnalyticsEvent.count({ where: { occurredAt: DAY } });
  check("★ raw events ingested (5 page views + 1 conversion)", rawCount === 6, `${rawCount}`);

  // ── B. DETERMINISTIC AGGREGATION ──────────────────────────────────
  console.log("\nB. aggregation");
  const agg1 = await runAnalyticsAggregation({ from: DAY, to: DAY });
  check("★ aggregation produced day rows", agg1.daysProcessed === 1 && agg1.aggregatesUpserted >= 3);
  const home = await homeAgg();
  check("★ /home human aggregate: pageViews=3, sessions=2, approxUniqueVisitors=2", !!home && home.pageViews === 3 && home.sessions === 2 && home.approximateUniqueVisitors === 2, JSON.stringify(home && { pv: home.pageViews, s: home.sessions, v: home.approximateUniqueVisitors }));
  check("★ /home: bounces=1 (single-event session), engagedSessions=1 (2-event session)", !!home && home.bounces === 1 && home.engagedSessions === 1);
  const botAgg = await systemDb.websiteAnalyticsDailyAggregate.findFirst({ where: { date: DAY, normalizedPath: HOME, botClassification: "KNOWN_BOT" } });
  check("★ bot traffic is stored in the warehouse (separate botClassification dimension)", !!botAgg && botAgg.deviceCategory === "BOT");
  const convAgg = await systemDb.websiteAnalyticsDailyAggregate.findFirst({ where: { date: DAY, eventType: "REGISTRATION_COMPLETED" } });
  check("★ conversion aggregated (conversions=1)", !!convAgg && convAgg.conversions === 1);

  // ── C. IDEMPOTENT RECOMPUTE ───────────────────────────────────────
  console.log("\nC. idempotency");
  const before = await systemDb.websiteAnalyticsDailyAggregate.count({ where: { date: DAY } });
  await runAnalyticsAggregation({ from: DAY, to: DAY });
  const after = await systemDb.websiteAnalyticsDailyAggregate.count({ where: { date: DAY } });
  const home2 = await homeAgg();
  check("★ re-aggregation is idempotent (same row count + same measures, no doubling)", before === after && !!home2 && home2.pageViews === 3 && home2.sessions === 2);

  // ── D. READ LAYER: BOT EXCLUSION + OVERVIEW ───────────────────────
  console.log("\nD. read layer");
  const ov = await analyticsOverview(ownerId, { from: iso, to: iso, includeBots: false });
  check("★ overview excludes bots by default (pageViews=4 human, not 5)", ov.pageViews === 4, `${ov.pageViews}`);
  const ovBots = await analyticsOverview(ownerId, { from: iso, to: iso, includeBots: true });
  check("★ overview WITH bots includes the bot page view (5)", ovBots.pageViews === 5, `${ovBots.pageViews}`);
  check("★ overview reports approximate visitors + bounce/conversion rate", typeof ov.approximateUniqueVisitors === "number" && typeof ov.bounceRate === "number" && typeof ov.conversionRate === "number");
  const top = await analyticsGroupBy(ownerId, "path", { from: iso, to: iso });
  check("★ top-pages group-by (path→normalizedPath) applies low-count suppression: tiny cells hidden, no visible row < threshold", Array.isArray(top.rows) && top.suppressedGroups >= 1 && !top.rows.some((r) => r.count < 5));
  check("★ bad group-by dimension is rejected (no arbitrary SQL dimension)", await analyticsGroupBy(ownerId, "'; DROP TABLE" as never, { from: iso, to: iso }).then(() => false).catch(() => true));
  check("★ low-count suppression helper hides tiny cells", suppressLowCount([{ count: 1 }, { count: 10 }]).visible.length === 1);
  check("★ group-by result does NOT expose suppressedCount (single-group derivation leak closed)", !("suppressedCount" in top) && typeof top.suppressedGroups === "number");

  // ── D2. EXPORT: separate capability + recent-auth + no identifiers ──
  console.log("\nD2. export controls");
  const stale = new Date(Date.now() - 60 * 60 * 1000);
  check("★ export with STALE auth → stale_privileged_auth (recent-auth enforced server-side)", await analyticsExportCsv(ownerId, "path", stale, { from: iso, to: iso }).then(() => false).catch((e) => (e as { code?: string }).code === "stale_privileged_auth"));
  const csv = await analyticsExportCsv(ownerId, "path", new Date(), { from: iso, to: iso });
  check("★ export with fresh auth returns aggregated CSV with NO visitor/session hash or raw identifier", typeof csv === "string" && csv.startsWith("dimension,key,pageViews") && !/[a-f0-9]{40,}/.test(csv) && !/visitorId|sessionId|Hash/i.test(csv));
  const analyst = await systemDb.user.create({ data: { id: `paggu2_${process.pid}`, email: `paggu2_${process.pid}@t.local`, platformRole: PlatformRole.analyst } });
  check("★ analyst (no analytics.export) is DENIED export even with fresh auth", await analyticsExportCsv(analyst.id, "path", new Date(), { from: iso, to: iso }).then(() => false).catch((e) => (e as { code?: string }).code === "platform_forbidden"));
  await systemDb.user.delete({ where: { id: analyst.id } }).catch(() => {});

  // ── E. RETENTION (deletes expired raw; keeps aggregates) ──────────
  console.log("\nE. retention");
  const ret = await runAnalyticsRetention({ now: new Date(), rawRetentionDays: 90 }); // DAY is year 2002 → far beyond 90 days
  check("★ retention deleted expired raw events (>0)", ret.rawEventsDeleted >= 6);
  const rawAfter = await systemDb.websiteAnalyticsEvent.count({ where: { occurredAt: DAY } });
  const aggAfter = await systemDb.websiteAnalyticsDailyAggregate.count({ where: { date: DAY } });
  check("★ this day's raw events are gone but its AGGREGATES are retained", rawAfter === 0 && aggAfter > 0);
  const run = await systemDb.websiteAnalyticsRetentionRun.findFirst({ where: { runType: "retention" }, orderBy: { createdAt: "desc" } });
  check("★ retention run is auditable (bounded counters + window, content-free)", !!run && run.status === "completed" && !("rawBody" in run) && !("ip" in run));
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    await systemDb.websiteAnalyticsEvent.deleteMany({ where: { occurredAt: DAY } }).catch(() => {});
    await systemDb.websiteAnalyticsDailyAggregate.deleteMany({ where: { date: DAY } }).catch(() => {});
    await systemDb.websiteAnalyticsConversionIdempotency.deleteMany({ where: { idempotencyKey: { contains: String(process.pid) } } }).catch(() => {});
    if (ownerId) await systemDb.user.delete({ where: { id: ownerId } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Privacy Analytics Aggregation V1: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
