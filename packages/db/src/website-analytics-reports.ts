/**
 * Platform Privacy Analytics V1 — admin-facing analytics READ service. Every function enforces a platform
 * capability (`analytics.view`; export is the separate `analytics.export`), reads ONLY the aggregate warehouse
 * (never raw identifiers), applies low-count suppression + a group-by allow-list, bounds the date range, and
 * NEVER exposes a visitor/session hash or an exact per-user timeline.
 */
import { systemDb } from "./index";
import { requirePlatformCapability } from "./platform-repo";
import { platformAudit, requireRecentAuth } from "./platform-admin";
import {
  isAllowedGroupBy, suppressLowCount, bounceRate, conversionRate, type AggregateDimension,
} from "@guardora/core";

const MAX_RANGE_DAYS = 400;
const utcDay = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
function boundedRange(from?: string, to?: string): { from: Date; to: Date } {
  const now = new Date();
  let end = to && !Number.isNaN(Date.parse(to)) ? new Date(to) : now;
  let start = from && !Number.isNaN(Date.parse(from)) ? new Date(from) : new Date(now.getTime() - 30 * 86400000);
  if (start.getTime() > end.getTime()) [start, end] = [end, start];
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86400000) start = new Date(end.getTime() - MAX_RANGE_DAYS * 86400000);
  return { from: utcDay(start), to: utcDay(end) };
}
/** Bot rows are excluded by default (KNOWN_BOT/SUSPECTED_BOT); pass includeBots to show them separately. */
function botFilter(includeBots: boolean): Record<string, unknown> {
  return includeBots ? {} : { botClassification: { in: ["HUMAN_LIKELY", "UNKNOWN"] } };
}

export interface AnalyticsQuery { from?: string; to?: string; includeBots?: boolean; }

/** Summary cards over the daily aggregates. Sessions/visitors are approximate (documented). */
export async function analyticsOverview(actorUserId: string, q: AnalyticsQuery = {}) {
  await requirePlatformCapability(actorUserId, "analytics.view");
  const { from, to } = boundedRange(q.from, q.to);
  const rows = await systemDb.websiteAnalyticsDailyAggregate.findMany({ where: { date: { gte: from, lte: to }, ...botFilter(q.includeBots ?? false) }, select: { pageViews: true, sessions: true, approximateUniqueVisitors: true, engagedSessions: true, bounces: true, conversions: true } });
  const sum = rows.reduce((a, r) => ({ pageViews: a.pageViews + r.pageViews, sessions: a.sessions + r.sessions, approximateUniqueVisitors: a.approximateUniqueVisitors + r.approximateUniqueVisitors, engagedSessions: a.engagedSessions + r.engagedSessions, bounces: a.bounces + r.bounces, conversions: a.conversions + r.conversions }), { pageViews: 0, sessions: 0, approximateUniqueVisitors: 0, engagedSessions: 0, bounces: 0, conversions: 0 });
  await platformAudit(actorUserId, "analytics.viewed", { reportType: "overview", dateRangeStart: from, dateRangeEnd: to });
  return { range: { from: from.toISOString(), to: to.toISOString() }, ...sum, bounceRate: bounceRate(sum.sessions, sum.bounces), conversionRate: conversionRate(sum.sessions, sum.conversions) };
}

/** Daily time-series for a chosen measure (with an accessible table equivalent in the UI). */
export async function analyticsTimeseries(actorUserId: string, q: AnalyticsQuery & { metric?: string } = {}) {
  await requirePlatformCapability(actorUserId, "analytics.view");
  const { from, to } = boundedRange(q.from, q.to);
  const metric = ["pageViews", "sessions", "approximateUniqueVisitors", "conversions", "engagedSessions", "errorPageViews"].includes(q.metric ?? "") ? q.metric! : "pageViews";
  const rows = await systemDb.websiteAnalyticsDailyAggregate.groupBy({ by: ["date"], where: { date: { gte: from, lte: to }, ...botFilter(q.includeBots ?? false) }, _sum: { pageViews: true, sessions: true, approximateUniqueVisitors: true, conversions: true, engagedSessions: true, errorPageViews: true }, orderBy: { date: "asc" } });
  return { metric, range: { from: from.toISOString(), to: to.toISOString() }, points: rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), value: (r._sum as Record<string, number | null>)[metric] ?? 0 })) };
}

/** Top groups for an allow-listed dimension, with low-count suppression. */
export async function analyticsGroupBy(actorUserId: string, dimension: string, q: AnalyticsQuery & { limit?: number } = {}) {
  await requirePlatformCapability(actorUserId, "analytics.view");
  if (!isAllowedGroupBy(dimension)) throw new Error("bad_dimension");
  const { from, to } = boundedRange(q.from, q.to);
  // The allow-list dimension "path" maps to the DB column "normalizedPath"; all others match directly.
  const col = (dimension === "path" ? "normalizedPath" : dimension) as AggregateDimension;
  // The dimension is validated against the allow-list above (never arbitrary SQL); cast the dynamic `by`.
  const groupByFn = systemDb.websiteAnalyticsDailyAggregate.groupBy as unknown as (a: unknown) => Promise<Array<Record<string, unknown> & { _sum: { pageViews: number | null; sessions: number | null; conversions: number | null } }>>;
  const rows = await groupByFn({ by: [col], where: { date: { gte: from, lte: to }, ...botFilter(q.includeBots ?? false) }, _sum: { pageViews: true, sessions: true, conversions: true } });
  const mapped = rows.map((r) => ({ key: String(r[col] ?? ""), count: r._sum.pageViews ?? 0, sessions: r._sum.sessions ?? 0, conversions: r._sum.conversions ?? 0 }))
    .sort((a, b) => b.count - a.count);
  // Low-count suppression: expose ONLY the number of suppressed groups, never their total count — with a
  // single suppressed group, `suppressedCount` would equal that group's exact hidden value (a derivation
  // leak). The visible rows all satisfy the threshold; the residual is bounded below it by construction.
  const { visible, suppressedGroups } = suppressLowCount(mapped);
  const limit = Math.min(Math.max(1, Math.floor(q.limit ?? 20)), 100);
  await platformAudit(actorUserId, "analytics.viewed", { reportType: `groupBy:${dimension}`, dateRangeStart: from, dateRangeEnd: to });
  return { dimension, range: { from: from.toISOString(), to: to.toISOString() }, rows: visible.slice(0, limit), suppressedGroups };
}

/** Conversion counts by context + overall conversion rate. */
export async function analyticsConversions(actorUserId: string, q: AnalyticsQuery = {}) {
  await requirePlatformCapability(actorUserId, "analytics.view");
  const { from, to } = boundedRange(q.from, q.to);
  const rows = await systemDb.websiteAnalyticsDailyAggregate.groupBy({ by: ["eventType"], where: { date: { gte: from, lte: to }, eventType: { in: ["REGISTRATION_COMPLETED", "LOGIN_COMPLETED", "CONTACT_FORM_SUBMITTED", "INTEGRATION_CONNECT_COMPLETED"] } }, _sum: { conversions: true, pageViews: true } });
  const totals = await systemDb.websiteAnalyticsDailyAggregate.aggregate({ where: { date: { gte: from, lte: to }, ...botFilter(false) }, _sum: { sessions: true, conversions: true } });
  return { range: { from: from.toISOString(), to: to.toISOString() }, byEvent: rows.map((r) => ({ eventType: r.eventType, count: (r._sum as { conversions: number | null }).conversions ?? 0 })), conversionRate: conversionRate(totals._sum.sessions ?? 0, totals._sum.conversions ?? 0) };
}

/** Deterministic funnel summaries (started → completed) for the three key flows. */
export async function analyticsFunnels(actorUserId: string, q: AnalyticsQuery = {}) {
  await requirePlatformCapability(actorUserId, "analytics.view");
  const { from, to } = boundedRange(q.from, q.to);
  const rows = await systemDb.websiteAnalyticsDailyAggregate.groupBy({ by: ["eventType"], where: { date: { gte: from, lte: to } }, _sum: { pageViews: true, sessions: true, conversions: true } });
  const count = (t: string, field: "sessions" | "conversions" | "pageViews") => (rows.find((r) => r.eventType === t)?._sum as Record<string, number | null> | undefined)?.[field] ?? 0;
  const funnel = (startType: string, endType: string) => {
    const started = count(startType, "sessions") || count(startType, "pageViews");
    const completed = count(endType, "conversions");
    return { started, completed, completionRate: started > 0 ? Math.round((completed / started) * 1000) / 10 : 0 };
  };
  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    registration: funnel("REGISTRATION_STARTED", "REGISTRATION_COMPLETED"),
    contact: funnel("CONTACT_FORM_STARTED", "CONTACT_FORM_SUBMITTED"),
    integration: funnel("INTEGRATION_CONNECT_STARTED", "INTEGRATION_CONNECT_COMPLETED"),
  };
}

/** Bot-traffic summary (shown separately; excluded from default metrics). */
export async function analyticsBotTraffic(actorUserId: string, q: AnalyticsQuery = {}) {
  await requirePlatformCapability(actorUserId, "analytics.view");
  const { from, to } = boundedRange(q.from, q.to);
  const rows = await systemDb.websiteAnalyticsDailyAggregate.groupBy({ by: ["botClassification"], where: { date: { gte: from, lte: to } }, _sum: { pageViews: true } });
  return { range: { from: from.toISOString(), to: to.toISOString() }, rows: rows.map((r) => ({ botClassification: r.botClassification, pageViews: (r._sum as { pageViews: number | null }).pageViews ?? 0 })) };
}

/** Retention + aggregation run status (collection health). Never exposes raw data. */
export async function analyticsRetentionStatus(actorUserId: string) {
  await requirePlatformCapability(actorUserId, "analytics.view");
  const [runs, rawCount, aggCount, latestEvent] = await Promise.all([
    systemDb.websiteAnalyticsRetentionRun.findMany({ orderBy: { createdAt: "desc" }, take: 10, select: { id: true, runType: true, status: true, rawEventsDeleted: true, aggregatesUpserted: true, startedAt: true, completedAt: true } }),
    systemDb.websiteAnalyticsEvent.count(),
    systemDb.websiteAnalyticsDailyAggregate.count(),
    systemDb.websiteAnalyticsEvent.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
  ]);
  return {
    rawEventCount: rawCount, aggregateRowCount: aggCount,
    lastIngestionAt: latestEvent?.receivedAt.toISOString() ?? null,
    runs: runs.map((r) => ({ id: r.id, runType: r.runType, status: r.status, rawEventsDeleted: r.rawEventsDeleted, aggregatesUpserted: r.aggregatesUpserted, startedAt: r.startedAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null })),
  };
}

/**
 * CSV export of an aggregate group-by. Requires the SEPARATE `analytics.export` capability AND recent
 * authentication (a privileged action), and is audited. Aggregated metrics only — never raw events or
 * visitor/session identifiers.
 */
export async function analyticsExportCsv(actorUserId: string, dimension: string, authenticatedAt: Date | null, q: AnalyticsQuery = {}): Promise<string> {
  requireRecentAuth(authenticatedAt); // privileged: export requires a recent sign-in
  await requirePlatformCapability(actorUserId, "analytics.export");
  const data = await analyticsGroupBy(actorUserId, dimension, q); // also asserts analytics.view
  await platformAudit(actorUserId, "analytics.exported", { reportType: `csv:${dimension}`, dateRangeStart: new Date(data.range.from), dateRangeEnd: new Date(data.range.to) });
  const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
  const header = ["dimension", "key", "pageViews", "sessions", "conversions"].join(",");
  const lines = data.rows.map((r) => [dimension, r.key, r.count, r.sessions, r.conversions].map(esc).join(","));
  return [header, ...lines].join("\n");
}
