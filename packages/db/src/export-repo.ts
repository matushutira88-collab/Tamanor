import { planEntitlements } from "@guardora/core";
import { withTenant } from "./repositories";
import { getUsageSummary } from "./usage-repo";
import { getTenantResourceUsage } from "./resource-limits";

/**
 * V1.69 (Release B / B3) — tenant-scoped datasets for CSV export. Every query runs inside withTenant
 * (RLS: a tenant can never read another tenant's rows), is bounded by a date range AND a hard row cap,
 * and returns a plain {headers, rows} table the route serializes with the injection-safe core CSV util.
 * No raw tokens/secrets are ever selected.
 */

export type ExportDataset = "comments" | "risky_comments" | "incidents" | "usage_summary";
export const EXPORT_DATASETS: readonly ExportDataset[] = ["comments", "risky_comments", "incidents", "usage_summary"];
export const EXPORT_MAX_ROWS = 5000;
export const EXPORT_MAX_RANGE_DAYS = 366;

export type CsvTable = { headers: string[]; rows: unknown[][]; truncated: boolean };

/** Clamp a requested [from,to] window to a sane default (last 30d) and the max range. Never inverts. */
export function clampExportRange(from: Date | null | undefined, to: Date | null | undefined, now: Date = new Date()): { from: Date; to: Date } {
  const end = to && !Number.isNaN(to.getTime()) ? to : now;
  let start = from && !Number.isNaN(from.getTime()) ? from : new Date(end.getTime() - 30 * 86_400_000);
  if (start.getTime() > end.getTime()) start = new Date(end.getTime() - 30 * 86_400_000);
  const maxMs = EXPORT_MAX_RANGE_DAYS * 86_400_000;
  if (end.getTime() - start.getTime() > maxMs) start = new Date(end.getTime() - maxMs);
  return { from: start, to: end };
}

async function exportComments(tenantId: string, from: Date, to: Date, riskyOnly: boolean): Promise<CsvTable> {
  const rows = await withTenant(tenantId, (db) => db.reputationItem.findMany({
    where: { tenantId, createdAt: { gte: from, lte: to }, ...(riskyOnly ? { riskLevel: { in: ["high", "critical"] } } : {}) },
    orderBy: [{ createdAt: "desc" }],
    take: EXPORT_MAX_ROWS + 1,
    select: {
      createdAt: true, platform: true, brandId: true, riskLevel: true, riskCategories: true, sentiment: true, status: true,
      contentItem: { select: { text: true, permalink: true, publishedAt: true } },
    },
  }));
  const truncated = rows.length > EXPORT_MAX_ROWS;
  return {
    headers: ["created_at", "platform", "brand_id", "risk_level", "risk_categories", "sentiment", "status", "published_at", "permalink", "text"],
    rows: rows.slice(0, EXPORT_MAX_ROWS).map((r) => [
      r.createdAt.toISOString(), r.platform, r.brandId, r.riskLevel, r.riskCategories.join("|"), r.sentiment, r.status,
      r.contentItem?.publishedAt?.toISOString() ?? "", r.contentItem?.permalink ?? "", r.contentItem?.text ?? "",
    ]),
    truncated,
  };
}

async function exportIncidents(tenantId: string, from: Date, to: Date): Promise<CsvTable> {
  const rows = await withTenant(tenantId, (db) => db.incident.findMany({
    where: { tenantId, createdAt: { gte: from, lte: to } },
    orderBy: [{ createdAt: "desc" }],
    take: EXPORT_MAX_ROWS + 1,
    select: { createdAt: true, brandId: true, title: true, category: true, severity: true, status: true },
  }));
  const truncated = rows.length > EXPORT_MAX_ROWS;
  return {
    headers: ["created_at", "brand_id", "title", "category", "severity", "status"],
    rows: rows.slice(0, EXPORT_MAX_ROWS).map((r) => [r.createdAt.toISOString(), r.brandId, r.title, r.category, r.severity, r.status]),
    truncated,
  };
}

async function exportUsageSummary(tenantId: string, plan: string): Promise<CsvTable> {
  const [summary, resources] = await Promise.all([getUsageSummary(tenantId, plan), getTenantResourceUsage(tenantId)]);
  const ent = planEntitlements(plan);
  const lim = (n: number | null) => (n === null ? "unlimited" : n);
  return {
    headers: ["metric", "used", "limit"],
    rows: [
      ["plan", summary.plan, ""],
      ["period_start", summary.periodStart.toISOString(), ""],
      ["period_end", summary.periodEnd.toISOString(), ""],
      ["basic_ai_checks", summary.basic.used, lim(summary.basic.limit)],
      ["premium_ai_calls", summary.premiumCalls.used, lim(summary.premiumCalls.limit)],
      ["connected_accounts", resources.connections, lim(ent.maxConnectedAccounts)],
      ["brands", resources.brands, lim(ent.maxBrands)],
    ],
    truncated: false,
  };
}

/** Build the requested dataset (tenant-scoped, bounded). `plan` is only used by usage_summary. */
export async function buildExportTable(
  tenantId: string, dataset: ExportDataset, opts: { from?: Date | null; to?: Date | null; plan: string },
): Promise<CsvTable> {
  const { from, to } = clampExportRange(opts.from, opts.to);
  switch (dataset) {
    case "comments": return exportComments(tenantId, from, to, false);
    case "risky_comments": return exportComments(tenantId, from, to, true);
    case "incidents": return exportIncidents(tenantId, from, to);
    case "usage_summary": return exportUsageSummary(tenantId, opts.plan);
  }
}
