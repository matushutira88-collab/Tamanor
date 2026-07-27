/**
 * Child Safety Analytics & Trends V1 — the operational analytics service (SYSTEM-scoped, systemDb).
 *
 * READ-ONLY aggregation over the SAME accepted canonical records the reviewer console uses (incidents,
 * escalations, protection plans/actions, evidence, interventions, guardian deliveries, review events).
 * There is NO duplicate analytical truth: every number is derived on read from canonical tables. Every
 * query is tenant-isolated by an explicit `tenantId` (these are SYSTEM tables — RLS is not the
 * enforcement; explicit scoping + composite (id, tenantId) FKs are), bounded by a validated date range,
 * indexed, and content-free. Small cohorts are k-anonymity SUPPRESSED before they leave this layer, so a
 * hidden count is NEVER returned. No child profiling / ranking / scoring / behaviour prediction.
 */
import {
  Role,
  canViewChildSafetyAnalytics, canExportChildSafetyAnalytics,
  AnalyticsGranularity, AnalyticsDistributionDimension,
  clampAnalyticsRange, enumerateBucketKeys, bucketKey, buildDistribution, median,
  suppressCount, suppressDuration, serializeAnalyticsCsv, csvCount,
  type SuppressibleCount, type SuppressibleDuration, type DistributionBucket, type AnalyticsCsvRow,
} from "@guardora/core";
import { systemDb } from "./index";

/** The human requesting analytics — tenant + identity + role from the authenticated session. */
export interface AnalyticsActor { tenantId: string; userId: string; role: Role; }

/** Fail-closed, non-leaky authorization error (the web layer maps this to 403). */
export class ChildSafetyAnalyticsForbiddenError extends Error {
  constructor(public readonly reason: string) { super("child_safety_analytics_forbidden"); }
}

export interface AnalyticsInput {
  from?: Date; to?: Date; granularity?: AnalyticsGranularity; now?: Date;
}

// ── Report shape ──────────────────────────────────────────────────────────────

export interface AnalyticsOverview {
  incidentsCreated: number; incidentsResolved: number; openIncidents: number;
  escalations: number; activeEscalations: number;
  activeProtectionPlans: number; completedProtectionPlans: number;
  overdueActions: number; blockedActions: number;
  evidenceCount: number; interventionCount: number;
  guardianDeliveryOutcomes: DistributionBucket[];
}
export interface AnalyticsTimeSeries {
  granularity: AnalyticsGranularity; buckets: string[];
  incidents: number[]; resolutions: number[]; escalations: number[]; interventions: number[]; protectionPlans: number[];
}
export interface AnalyticsPerformance {
  incidentToFirstReview: SuppressibleDuration;
  incidentToResolved: SuppressibleDuration;
  planActivationToCompletion: SuppressibleDuration;
}
export interface ReviewerWorkloadRow {
  reviewerId: string;
  assignedIncidents: SuppressibleCount; resolvedIncidents: SuppressibleCount;
  activeActions: SuppressibleCount; overdueActions: SuppressibleCount;
  medianFirstReview: SuppressibleDuration; medianResolution: SuppressibleDuration;
}
export interface ProtectionPlanAnalytics {
  active: number; completed: number; draft: number; cancelled: number; reopened: number;
  overdueActions: number; blockedActions: number;
  statusDistribution: DistributionBucket[]; actionStatusDistribution: DistributionBucket[];
}
export interface ChildSafetyAnalyticsReport {
  range: { from: string; to: string; granularity: AnalyticsGranularity };
  generatedAt: string;
  overview: AnalyticsOverview;
  timeSeries: AnalyticsTimeSeries;
  distributions: Record<string, DistributionBucket[]>;
  performance: AnalyticsPerformance;
  reviewerWorkload: ReviewerWorkloadRow[];
  protectionPlans: ProtectionPlanAnalytics;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const OPEN_STATUSES = ["open", "under_review", "action_required", "monitoring", "waiting", "reopened"] as const;
const ACTIVE_PLAN_STATUSES = ["draft", "active", "reopened"] as const;
const ACTIVE_ACTION_STATUSES = ["pending", "in_progress"] as const;

function assertView(actor: AnalyticsActor): void {
  if (!canViewChildSafetyAnalytics(actor.role)) throw new ChildSafetyAnalyticsForbiddenError("view");
}
function tally<T extends string>(rows: Array<{ key: T; n: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.key] = (out[r.key] ?? 0) + r.n;
  return out;
}
/** Zero-filled per-bucket series aligned to `buckets`, from {bucketKey → count}. Missing bucket == 0. */
function alignSeries(buckets: string[], byKey: Map<string, number>): number[] {
  return buckets.map((k) => byKey.get(k) ?? 0);
}

// ── Main report ───────────────────────────────────────────────────────────────

/**
 * Compute the whole analytics report for the actor's tenant over a validated, bounded date range. Every
 * query below is `where: { tenantId, <timeCol> in [from,to] }` — tenant-scoped and range-bounded. The
 * heavy list reads (for medians / distributions / workload) select ONLY the coarse columns they need.
 */
export async function getChildSafetyAnalyticsReport(actor: AnalyticsActor, input: AnalyticsInput = {}): Promise<ChildSafetyAnalyticsReport> {
  assertView(actor);
  const tenantId = actor.tenantId;
  const now = input.now ?? new Date();
  const { from, to } = clampAnalyticsRange(input.from, input.to, now);
  const g = input.granularity ?? AnalyticsGranularity.Day;
  const inRange = { gte: from, lte: to };

  // Pull the coarse, content-free columns once per canonical table (range-bounded, tenant-scoped).
  const [incidents, escalations, plans, actions, evidenceCount, interventions, deliveries, reviewEvents] = await Promise.all([
    systemDb.childSafetyIncident.findMany({
      where: { tenantId, createdAt: inRange },
      select: { id: true, status: true, severity: true, urgency: true, riskFamily: true, escalationState: true, assignedReviewerId: true, openedAt: true, closedAt: true, createdAt: true },
    }),
    systemDb.childSafetyEscalation.findMany({ where: { tenantId, triggeredAt: inRange }, select: { status: true, triggeredAt: true } }),
    systemDb.childSafetyProtectionPlan.findMany({ where: { tenantId, createdAt: inRange }, select: { status: true, createdAt: true, activatedAt: true, completedAt: true } }),
    systemDb.childSafetyProtectionAction.findMany({ where: { tenantId, createdAt: inRange }, select: { status: true, assignedReviewerId: true, dueAt: true, completedAt: true } }),
    systemDb.childSafetyEvidence.count({ where: { tenantId, createdAt: inRange } }),
    systemDb.childSafetyIntervention.findMany({ where: { tenantId, createdAt: inRange }, select: { createdAt: true } }),
    systemDb.safetySignalDelivery.findMany({ where: { tenantId, preparedAt: inRange }, select: { deliveryStatus: true } }),
    systemDb.childSafetyReviewEvent.findMany({
      where: { tenantId, eventType: { in: ["assigned", "status_changed", "reopened"] } },
      orderBy: [{ createdAt: "asc" }], select: { incidentId: true, createdAt: true },
    }),
  ]);

  const incById = new Map(incidents.map((i) => [i.id, i]));
  const openIncidents = incidents.filter((i) => (OPEN_STATUSES as readonly string[]).includes(i.status)).length;
  const resolvedIncidents = incidents.filter((i) => i.status === "resolved");
  const activeEscalations = escalations.filter((e) => e.status === "triggered" || e.status === "acknowledged").length;
  const overdueActions = actions.filter((a) => a.dueAt !== null && a.dueAt.getTime() < now.getTime() && a.status !== "completed" && a.status !== "skipped").length;
  const blockedActions = actions.filter((a) => a.status === "blocked").length;

  // First-review timestamp per incident (earliest review event that belongs to a range incident).
  const firstReviewByIncident = new Map<string, Date>();
  for (const e of reviewEvents) if (incById.has(e.incidentId) && !firstReviewByIncident.has(e.incidentId)) firstReviewByIncident.set(e.incidentId, e.createdAt);

  // ── Overview ────────────────────────────────────────────────────────────────
  const deliveryTally = tally(deliveries.map((d) => ({ key: d.deliveryStatus, n: 1 })));
  const guardianDeliveryOutcomes = buildDistribution(AnalyticsDistributionDimension.DeliveryOutcome, deliveryTally);
  const overview: AnalyticsOverview = {
    incidentsCreated: incidents.length,
    incidentsResolved: resolvedIncidents.length,
    openIncidents,
    escalations: escalations.length,
    activeEscalations,
    activeProtectionPlans: plans.filter((p) => (ACTIVE_PLAN_STATUSES as readonly string[]).includes(p.status)).length,
    completedProtectionPlans: plans.filter((p) => p.status === "completed").length,
    overdueActions, blockedActions,
    evidenceCount, interventionCount: interventions.length,
    guardianDeliveryOutcomes,
  };

  // ── Time series (zero-filled; every bucket exists) ────────────────────────────
  const buckets = enumerateBucketKeys(from, to, g);
  const seriesFrom = (dates: Date[]): number[] => {
    const m = new Map<string, number>();
    for (const d of dates) { const k = bucketKey(d, g); m.set(k, (m.get(k) ?? 0) + 1); }
    return alignSeries(buckets, m);
  };
  const timeSeries: AnalyticsTimeSeries = {
    granularity: g, buckets,
    incidents: seriesFrom(incidents.map((i) => i.createdAt)),
    resolutions: seriesFrom(resolvedIncidents.map((i) => i.closedAt ?? i.createdAt)),
    escalations: seriesFrom(escalations.map((e) => e.triggeredAt)),
    interventions: seriesFrom(interventions.map((i) => i.createdAt)),
    protectionPlans: seriesFrom(plans.map((p) => p.createdAt)),
  };

  // ── Distributions (each zero-filled + suppressed) ─────────────────────────────
  const D = AnalyticsDistributionDimension;
  const distributions: Record<string, DistributionBucket[]> = {
    [D.Severity]: buildDistribution(D.Severity, tally(incidents.map((i) => ({ key: i.severity, n: 1 })))),
    [D.Urgency]: buildDistribution(D.Urgency, tally(incidents.map((i) => ({ key: i.urgency, n: 1 })))),
    [D.RiskFamily]: buildDistribution(D.RiskFamily, tally(incidents.map((i) => ({ key: i.riskFamily, n: 1 })))),
    [D.Status]: buildDistribution(D.Status, tally(incidents.map((i) => ({ key: i.status, n: 1 })))),
    [D.EscalationStatus]: buildDistribution(D.EscalationStatus, tally(escalations.map((e) => ({ key: e.status, n: 1 })))),
    [D.PlanStatus]: buildDistribution(D.PlanStatus, tally(plans.map((p) => ({ key: p.status, n: 1 })))),
    [D.ActionStatus]: buildDistribution(D.ActionStatus, tally(actions.map((a) => ({ key: a.status, n: 1 })))),
    [D.DeliveryOutcome]: guardianDeliveryOutcomes,
  };

  // ── Performance medians (+ suppressed observation counts) ─────────────────────
  const firstReviewDurations: number[] = [];
  for (const [incidentId, first] of firstReviewByIncident) {
    const inc = incById.get(incidentId)!;
    const d = first.getTime() - inc.openedAt.getTime();
    if (d >= 0) firstReviewDurations.push(d);
  }
  const resolutionDurations = resolvedIncidents
    .filter((i) => i.closedAt)
    .map((i) => i.closedAt!.getTime() - i.openedAt.getTime())
    .filter((d) => d >= 0);
  const planCycleDurations = plans
    .filter((p) => p.activatedAt && p.completedAt)
    .map((p) => p.completedAt!.getTime() - p.activatedAt!.getTime())
    .filter((d) => d >= 0);
  const performance: AnalyticsPerformance = {
    incidentToFirstReview: suppressDuration(median(firstReviewDurations), firstReviewDurations.length),
    incidentToResolved: suppressDuration(median(resolutionDurations), resolutionDurations.length),
    planActivationToCompletion: suppressDuration(median(planCycleDurations), planCycleDurations.length),
  };

  // ── Reviewer workload (per-reviewer; NEVER ranked/scored; suppressed) ─────────
  const reviewerWorkload = buildReviewerWorkload(incidents, actions, firstReviewByIncident, now);

  // ── Protection plans ──────────────────────────────────────────────────────────
  const protectionPlans: ProtectionPlanAnalytics = {
    active: plans.filter((p) => p.status === "active").length,
    completed: plans.filter((p) => p.status === "completed").length,
    draft: plans.filter((p) => p.status === "draft").length,
    cancelled: plans.filter((p) => p.status === "cancelled").length,
    reopened: plans.filter((p) => p.status === "reopened").length,
    overdueActions, blockedActions,
    statusDistribution: distributions[D.PlanStatus]!,
    actionStatusDistribution: distributions[D.ActionStatus]!,
  };

  return {
    range: { from: from.toISOString(), to: to.toISOString(), granularity: g },
    generatedAt: now.toISOString(),
    overview, timeSeries, distributions, performance, reviewerWorkload, protectionPlans,
  };
}

/**
 * Per-reviewer operational workload. Deterministic ordering is by reviewer id (a STABLE identifier order)
 * — explicitly NOT by any metric — so this is a workload view, never a leaderboard/ranking/score. Every
 * per-reviewer number is k-anonymity suppressed so a reviewer handling a tiny caseload can't be singled
 * out (which incidents they touched can't be reconstructed).
 */
function buildReviewerWorkload(
  incidents: Array<{ id: string; status: string; assignedReviewerId: string | null; openedAt: Date; closedAt: Date | null }>,
  actions: Array<{ status: string; assignedReviewerId: string | null; dueAt: Date | null }>,
  firstReviewByIncident: Map<string, Date>,
  now: Date,
): ReviewerWorkloadRow[] {
  const ids = new Set<string>();
  for (const i of incidents) if (i.assignedReviewerId) ids.add(i.assignedReviewerId);
  for (const a of actions) if (a.assignedReviewerId) ids.add(a.assignedReviewerId);

  const rows: ReviewerWorkloadRow[] = [];
  for (const reviewerId of [...ids].sort()) { // STABLE id order — not a ranking
    const mine = incidents.filter((i) => i.assignedReviewerId === reviewerId);
    const myActions = actions.filter((a) => a.assignedReviewerId === reviewerId);
    const firstReviewDurations = mine
      .map((i) => { const f = firstReviewByIncident.get(i.id); return f ? f.getTime() - i.openedAt.getTime() : null; })
      .filter((d): d is number => d !== null && d >= 0);
    const resolutionDurations = mine
      .filter((i) => i.status === "resolved" && i.closedAt)
      .map((i) => i.closedAt!.getTime() - i.openedAt.getTime())
      .filter((d) => d >= 0);
    rows.push({
      reviewerId,
      assignedIncidents: suppressCount(mine.length),
      resolvedIncidents: suppressCount(mine.filter((i) => i.status === "resolved").length),
      activeActions: suppressCount(myActions.filter((a) => (ACTIVE_ACTION_STATUSES as readonly string[]).includes(a.status)).length),
      overdueActions: suppressCount(myActions.filter((a) => a.dueAt !== null && a.dueAt.getTime() < now.getTime() && a.status !== "completed" && a.status !== "skipped").length),
      medianFirstReview: suppressDuration(median(firstReviewDurations), firstReviewDurations.length),
      medianResolution: suppressDuration(median(resolutionDurations), resolutionDurations.length),
    });
  }
  return rows;
}

// ── CSV export (aggregated metrics ONLY — no ids/users/guardian/notes/messages/evidence/storage keys) ──

/**
 * Flatten a report into content-free CSV rows. By construction this writes ONLY section/metric/dimension
 * labels + aggregated (already-suppressed) values. It NEVER emits an incident id, user id, guardian,
 * note, message, evidence, or storage key. Reviewer workload rows are keyed by an OPAQUE, positional
 * "reviewer_N" label (not the real reviewer id) so the CSV cannot re-identify a reviewer.
 */
export function buildAnalyticsCsvRows(report: ChildSafetyAnalyticsReport): AnalyticsCsvRow[] {
  const rows: AnalyticsCsvRow[] = [];
  const o = report.overview;
  rows.push({ section: "range", metric: "from", value: report.range.from });
  rows.push({ section: "range", metric: "to", value: report.range.to });
  rows.push({ section: "range", metric: "granularity", value: report.range.granularity });
  const ov: Array<[string, number]> = [
    ["incidents_created", o.incidentsCreated], ["incidents_resolved", o.incidentsResolved], ["open_incidents", o.openIncidents],
    ["escalations", o.escalations], ["active_escalations", o.activeEscalations],
    ["active_protection_plans", o.activeProtectionPlans], ["completed_protection_plans", o.completedProtectionPlans],
    ["overdue_actions", o.overdueActions], ["blocked_actions", o.blockedActions],
    ["evidence_count", o.evidenceCount], ["intervention_count", o.interventionCount],
  ];
  for (const [metric, value] of ov) rows.push({ section: "overview", metric, value: String(value) });

  for (const [dim, buckets] of Object.entries(report.distributions)) {
    for (const b of buckets) rows.push({ section: "distribution", metric: dim, dimension: b.key, value: csvCount(b.count) });
  }

  for (let i = 0; i < report.timeSeries.buckets.length; i++) {
    const k = report.timeSeries.buckets[i]!;
    rows.push({ section: "timeseries", metric: "incidents", dimension: k, value: String(report.timeSeries.incidents[i] ?? 0) });
    rows.push({ section: "timeseries", metric: "resolutions", dimension: k, value: String(report.timeSeries.resolutions[i] ?? 0) });
    rows.push({ section: "timeseries", metric: "escalations", dimension: k, value: String(report.timeSeries.escalations[i] ?? 0) });
    rows.push({ section: "timeseries", metric: "interventions", dimension: k, value: String(report.timeSeries.interventions[i] ?? 0) });
    rows.push({ section: "timeseries", metric: "protection_plans", dimension: k, value: String(report.timeSeries.protectionPlans[i] ?? 0) });
  }

  const perf: Array<[string, SuppressibleDuration]> = [
    ["incident_to_first_review_ms", report.performance.incidentToFirstReview],
    ["incident_to_resolved_ms", report.performance.incidentToResolved],
    ["plan_activation_to_completion_ms", report.performance.planActivationToCompletion],
  ];
  for (const [metric, d] of perf) {
    rows.push({ section: "performance", metric, value: d.suppressed ? "suppressed" : String(d.medianMs ?? 0) });
    rows.push({ section: "performance", metric: `${metric}_observations`, value: d.suppressed ? "suppressed" : String(d.observations ?? 0) });
  }

  report.reviewerWorkload.forEach((r, idx) => {
    const label = `reviewer_${idx + 1}`; // OPAQUE positional label — never the real reviewer id
    rows.push({ section: "reviewer_workload", metric: "assigned_incidents", dimension: label, value: csvCount(r.assignedIncidents) });
    rows.push({ section: "reviewer_workload", metric: "resolved_incidents", dimension: label, value: csvCount(r.resolvedIncidents) });
    rows.push({ section: "reviewer_workload", metric: "active_actions", dimension: label, value: csvCount(r.activeActions) });
    rows.push({ section: "reviewer_workload", metric: "overdue_actions", dimension: label, value: csvCount(r.overdueActions) });
    rows.push({ section: "reviewer_workload", metric: "median_first_review_ms", dimension: label, value: r.medianFirstReview.suppressed ? "suppressed" : String(r.medianFirstReview.medianMs ?? 0) });
    rows.push({ section: "reviewer_workload", metric: "median_resolution_ms", dimension: label, value: r.medianResolution.suppressed ? "suppressed" : String(r.medianResolution.medianMs ?? 0) });
  });

  return rows;
}

/** Build the deterministic CSV text + a safe filename for a report. Aggregated metrics only. */
export function exportChildSafetyAnalyticsCsv(actor: AnalyticsActor, report: ChildSafetyAnalyticsReport): { filename: string; csv: string } {
  if (!canExportChildSafetyAnalytics(actor.role)) throw new ChildSafetyAnalyticsForbiddenError("export");
  const stamp = report.range.from.slice(0, 10) + "_" + report.range.to.slice(0, 10);
  return { filename: `child-safety-analytics_${stamp}.csv`, csv: serializeAnalyticsCsv(buildAnalyticsCsvRows(report)) };
}
