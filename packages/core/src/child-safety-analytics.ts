/**
 * Child Safety Analytics & Trends V1 — pure vocabulary, privacy policy, and serialization.
 *
 * INTERNAL OPERATIONAL analytics ONLY. This module adds NO new analytical truth: it defines the coarse
 * dimensions, the deterministic time-bucketing, the k-anonymity SUPPRESSION primitive, and the CSV
 * serializer. It performs NO child profiling / ranking / scoring / behaviour prediction and holds NO raw
 * content — every input it serializes is an already-aggregated, tenant-scoped, content-free count or
 * duration. Everything here is deterministic and free of I/O, clock, and randomness.
 */
import { Role } from "./tenant";
import { Permission, can } from "./permissions";

// ─────────────────────────────────────────────────────────────────────────────
// Permissions — view = Owner / Administrator / Safety Reviewer; export = Owner / Administrator ONLY.
// ─────────────────────────────────────────────────────────────────────────────

/** May open the aggregated analytics dashboard (read-only, privacy-suppressed). */
export function canViewChildSafetyAnalytics(role: Role): boolean {
  return can(role, Permission.ChildSafetyAnalyticsView);
}
/** May export the aggregated-metrics CSV. Owner / Administrator only (never the Reviewer). */
export function canExportChildSafetyAnalytics(role: Role): boolean {
  return can(role, Permission.ChildSafetyAnalyticsExport);
}

// ─────────────────────────────────────────────────────────────────────────────
// Privacy — k-anonymity suppression. A non-zero cohort smaller than the minimum is SUPPRESSED
// (value=null, suppressed=true) so no individual child / reviewer can be re-identified or a rare cell
// reconstructed. Zero reveals nothing about an individual and is reported truthfully as 0.
// ─────────────────────────────────────────────────────────────────────────────

/** Minimum cohort size below which a non-zero count is hidden. */
export const CHILD_SAFETY_ANALYTICS_MIN_COHORT = 5;

/** A count that MAY be suppressed for privacy. When suppressed, `value` is null and no number leaks. */
export interface SuppressibleCount {
  value: number | null;
  suppressed: boolean;
}

/**
 * Apply the suppression policy to a raw count. 0 → {0,false} (safe); 1..(min-1) → {null,true} (hidden);
 * >=min → {n,false} (revealed). Deterministic and total. Never returns the hidden number in any field.
 */
export function suppressCount(n: number, min: number = CHILD_SAFETY_ANALYTICS_MIN_COHORT): SuppressibleCount {
  const c = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (c === 0) return { value: 0, suppressed: false };
  if (c < min) return { value: null, suppressed: true };
  return { value: c, suppressed: false };
}

/** A duration statistic that is itself suppressed when its observation cohort is too small. */
export interface SuppressibleDuration {
  medianMs: number | null;
  observations: number | null;
  suppressed: boolean;
}

/** Suppress a median-duration stat whose observation cohort is below the minimum (protects small-n medians). */
export function suppressDuration(medianMs: number | null, observations: number, min: number = CHILD_SAFETY_ANALYTICS_MIN_COHORT): SuppressibleDuration {
  const n = Number.isFinite(observations) && observations > 0 ? Math.floor(observations) : 0;
  if (n === 0) return { medianMs: null, observations: 0, suppressed: false };
  if (n < min) return { medianMs: null, observations: null, suppressed: true };
  return { medianMs, observations: n, suppressed: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Time bucketing — deterministic UTC. day | week (ISO, Monday start) | month. EVERY bucket in the range
// exists; a bucket with no events is a real zero (enumerated below), never a gap.
// ─────────────────────────────────────────────────────────────────────────────

export enum AnalyticsGranularity {
  Day = "day",
  Week = "week",
  Month = "month",
}
export const ANALYTICS_GRANULARITIES: readonly AnalyticsGranularity[] = Object.values(AnalyticsGranularity);
export function parseGranularity(v: string | null | undefined): AnalyticsGranularity {
  return (ANALYTICS_GRANULARITIES as readonly string[]).includes(v ?? "") ? (v as AnalyticsGranularity) : AnalyticsGranularity.Day;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

/** UTC midnight of a date's day (drops the time-of-day). */
function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
/** UTC Monday 00:00 of the ISO week containing `d` (Mon=0 … Sun=6). */
function utcWeekStart(d: Date): Date {
  const day = utcDayStart(d);
  const dow = (day.getUTCDay() + 6) % 7; // Monday-indexed
  return new Date(day.getTime() - dow * 86_400_000);
}
/** UTC first-of-month 00:00 for `d`. */
function utcMonthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** The canonical bucket start for a timestamp at a granularity (deterministic UTC). */
export function bucketStart(d: Date, g: AnalyticsGranularity): Date {
  switch (g) {
    case AnalyticsGranularity.Week: return utcWeekStart(d);
    case AnalyticsGranularity.Month: return utcMonthStart(d);
    default: return utcDayStart(d);
  }
}

/** The stable string key for a bucket start: `YYYY-MM-DD` for day/week, `YYYY-MM` for month. */
export function bucketKey(d: Date, g: AnalyticsGranularity): string {
  const s = bucketStart(d, g);
  if (g === AnalyticsGranularity.Month) return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}`;
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`;
}

/** Advance one bucket forward from a bucket start (deterministic; month is calendar-correct). */
function nextBucket(start: Date, g: AnalyticsGranularity): Date {
  if (g === AnalyticsGranularity.Month) return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  if (g === AnalyticsGranularity.Week) return new Date(start.getTime() + 7 * 86_400_000);
  return new Date(start.getTime() + 86_400_000);
}

/**
 * Enumerate EVERY bucket key from `from` to `to` inclusive of both endpoints' buckets, in ascending
 * order. This is what guarantees "missing bucket == zero": callers seed a zero map from this list. The
 * count is bounded because the analytics date range is clamped (see {@link clampAnalyticsRange}).
 */
export function enumerateBucketKeys(from: Date, to: Date, g: AnalyticsGranularity): string[] {
  const keys: string[] = [];
  let cur = bucketStart(from, g);
  const end = bucketStart(to, g);
  // Hard cap mirrors the max day-range so a bad input can never enumerate unbounded buckets.
  for (let i = 0; i <= CHILD_SAFETY_ANALYTICS_MAX_RANGE_DAYS + 1 && cur.getTime() <= end.getTime(); i++) {
    keys.push(bucketKey(cur, g));
    cur = nextBucket(cur, g);
  }
  return keys;
}

// ─────────────────────────────────────────────────────────────────────────────
// Date-range validation — always bounded. Invalid/oversized inputs are clamped, never rejected raw.
// ─────────────────────────────────────────────────────────────────────────────

export const CHILD_SAFETY_ANALYTICS_MAX_RANGE_DAYS = 366;
export const CHILD_SAFETY_ANALYTICS_DEFAULT_RANGE_DAYS = 30;
const DAY_MS = 86_400_000;

export interface AnalyticsRange { from: Date; to: Date; }

/**
 * Resolve a validated, bounded [from, to] range ending at (or before) `now`. Defaults to the last
 * {@link CHILD_SAFETY_ANALYTICS_DEFAULT_RANGE_DAYS} days; swaps reversed inputs; clamps the span to
 * {@link CHILD_SAFETY_ANALYTICS_MAX_RANGE_DAYS}; never lets `to` exceed `now`. Pure (now is injected).
 */
export function clampAnalyticsRange(fromInput: Date | null | undefined, toInput: Date | null | undefined, now: Date): AnalyticsRange {
  const valid = (d: Date | null | undefined): Date | null => (d && !Number.isNaN(d.getTime()) ? d : null);
  let to = valid(toInput) ?? now;
  if (to.getTime() > now.getTime()) to = now;
  let from = valid(fromInput) ?? new Date(to.getTime() - CHILD_SAFETY_ANALYTICS_DEFAULT_RANGE_DAYS * DAY_MS);
  if (from.getTime() > to.getTime()) { const t = from; from = to; to = t; } // swap reversed range
  const maxSpan = CHILD_SAFETY_ANALYTICS_MAX_RANGE_DAYS * DAY_MS;
  if (to.getTime() - from.getTime() > maxSpan) from = new Date(to.getTime() - maxSpan);
  return { from, to };
}

// ─────────────────────────────────────────────────────────────────────────────
// Distribution dimensions — the canonical, coarse value sets. A distribution ALWAYS reports every value
// in its set (zero-filled), so the shape is stable and content-free.
// ─────────────────────────────────────────────────────────────────────────────

export const CHILD_SAFETY_ANALYTICS_SEVERITIES: readonly string[] = ["low", "medium", "high", "critical"];
export const CHILD_SAFETY_ANALYTICS_URGENCIES: readonly string[] = ["routine", "elevated", "immediate"];
export const CHILD_SAFETY_ANALYTICS_RISK_FAMILIES: readonly string[] = ["sexual", "grooming", "violence", "coercion", "scam", "bullying", "identity"];
export const CHILD_SAFETY_ANALYTICS_INCIDENT_STATUSES: readonly string[] = ["open", "under_review", "action_required", "monitoring", "waiting", "resolved", "dismissed", "reopened", "closed"];
export const CHILD_SAFETY_ANALYTICS_ESCALATION_STATUSES: readonly string[] = ["triggered", "acknowledged", "resolved"];
export const CHILD_SAFETY_ANALYTICS_PLAN_STATUSES: readonly string[] = ["draft", "active", "completed", "cancelled", "reopened"];
export const CHILD_SAFETY_ANALYTICS_ACTION_STATUSES: readonly string[] = ["pending", "in_progress", "blocked", "completed", "skipped", "reopened"];
export const CHILD_SAFETY_ANALYTICS_DELIVERY_OUTCOMES: readonly string[] = ["prepared", "available", "acknowledged", "declined", "failed", "revoked", "expired", "superseded", "archived"];

/** The distribution dimensions offered by the report (stable ids for the API/UI/CSV). */
export enum AnalyticsDistributionDimension {
  Severity = "severity",
  Urgency = "urgency",
  RiskFamily = "risk_family",
  Status = "status",
  EscalationStatus = "escalation_status",
  PlanStatus = "plan_status",
  ActionStatus = "action_status",
  DeliveryOutcome = "delivery_outcome",
}
export const ANALYTICS_DISTRIBUTION_DIMENSIONS: readonly AnalyticsDistributionDimension[] = Object.values(AnalyticsDistributionDimension);

/** The canonical value set for a dimension (used to zero-fill + validate a distribution). */
export function distributionValues(dim: AnalyticsDistributionDimension): readonly string[] {
  switch (dim) {
    case AnalyticsDistributionDimension.Severity: return CHILD_SAFETY_ANALYTICS_SEVERITIES;
    case AnalyticsDistributionDimension.Urgency: return CHILD_SAFETY_ANALYTICS_URGENCIES;
    case AnalyticsDistributionDimension.RiskFamily: return CHILD_SAFETY_ANALYTICS_RISK_FAMILIES;
    case AnalyticsDistributionDimension.Status: return CHILD_SAFETY_ANALYTICS_INCIDENT_STATUSES;
    case AnalyticsDistributionDimension.EscalationStatus: return CHILD_SAFETY_ANALYTICS_ESCALATION_STATUSES;
    case AnalyticsDistributionDimension.PlanStatus: return CHILD_SAFETY_ANALYTICS_PLAN_STATUSES;
    case AnalyticsDistributionDimension.ActionStatus: return CHILD_SAFETY_ANALYTICS_ACTION_STATUSES;
    case AnalyticsDistributionDimension.DeliveryOutcome: return CHILD_SAFETY_ANALYTICS_DELIVERY_OUTCOMES;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic aggregation helpers (pure).
// ─────────────────────────────────────────────────────────────────────────────

/** Median of a numeric sample (ascending sort; even-length = mean of the two middle). Empty → null. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1]! + s[mid]!) / 2) : s[mid]!;
}

/**
 * Build a zero-filled, suppressed distribution for a dimension from a raw {value → count} tally. Every
 * canonical value appears exactly once (missing = 0); each count passes through {@link suppressCount}.
 * Unknown values in the tally are ignored (the value set is authoritative), so no unexpected label leaks.
 */
export interface DistributionBucket { key: string; count: SuppressibleCount; }

/**
 * SECONDARY (complementary) suppression — prevents a reconstruction-by-subtraction attack. If EXACTLY one
 * cell is primary-suppressed, a published total minus the known cells recovers it; so we also hide the
 * smallest revealed non-zero cell, guaranteeing at least two unknowns whenever any cell is hidden.
 * Deterministic (ties broken by canonical order). Never returns the hidden value.
 */
export function applySecondarySuppression(buckets: DistributionBucket[]): DistributionBucket[] {
  if (buckets.filter((b) => b.count.suppressed).length !== 1) return buckets;
  let idx = -1, best = Infinity;
  buckets.forEach((b, i) => {
    const v = b.count.value;
    if (!b.count.suppressed && v !== null && v > 0 && v < best) { best = v; idx = i; }
  });
  if (idx < 0) return buckets;
  return buckets.map((b, i) => (i === idx ? { key: b.key, count: { value: null, suppressed: true } } : b));
}

/**
 * Build a zero-filled, suppressed distribution for a dimension from a raw {value → count} tally. Every
 * canonical value appears exactly once (missing = 0); each count passes through {@link suppressCount};
 * then {@link applySecondarySuppression} guarantees a single hidden cell can't be recovered by subtraction.
 * Unknown values in the tally are ignored (the value set is authoritative), so no unexpected label leaks.
 */
export function buildDistribution(dim: AnalyticsDistributionDimension, tally: Record<string, number>, min: number = CHILD_SAFETY_ANALYTICS_MIN_COHORT): DistributionBucket[] {
  const primary = distributionValues(dim).map((key) => ({ key, count: suppressCount(tally[key] ?? 0, min) }));
  return applySecondarySuppression(primary);
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV — aggregated metrics ONLY. Never an incident/user/guardian id, note, message, evidence, or
// storage key. A suppressed value is written as the literal "suppressed" so no hidden count leaks.
// ─────────────────────────────────────────────────────────────────────────────

/** RFC-4180-safe CSV cell (quote when needed; neutralize spreadsheet formula injection). */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // formula-injection guard
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}
/** Render a suppressible count for CSV: a number, "suppressed", or "0" — never the hidden value. */
export function csvCount(c: SuppressibleCount): string {
  return c.suppressed ? "suppressed" : String(c.value ?? 0);
}

/** The content-free row model the CSV serializer consumes (section, metric, dimension, value). */
export interface AnalyticsCsvRow {
  section: string;
  metric: string;
  dimension?: string;
  value: string;
}
/** Serialize aggregated rows to CSV text with a stable header. Deterministic; no ids/PII by construction. */
export function serializeAnalyticsCsv(rows: readonly AnalyticsCsvRow[]): string {
  const header = ["section", "metric", "dimension", "value"].join(",");
  const body = rows.map((r) => [csvCell(r.section), csvCell(r.metric), csvCell(r.dimension ?? ""), csvCell(r.value)].join(","));
  return [header, ...body].join("\r\n") + "\r\n";
}
