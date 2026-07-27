/**
 * Child Safety Analytics V1 — PURE view-model (no React, no I/O, no clock). All presentation logic that
 * must be deterministic and testable lives here: tones, bar geometry, granularity vocabulary, duration/
 * count/date formatting, and the SUPPRESSION display (a hidden count renders as a mask, never a number).
 * The server remains the single source of truth for the aggregated, already-suppressed data.
 */
import { AnalyticsGranularity, type SuppressibleCount, type SuppressibleDuration, type DistributionBucket } from "@guardora/core";

export type Tone = "neutral" | "brand" | "ok" | "warn" | "danger";

// ── Suppression display — a suppressed value is ALWAYS masked, never a number. ──
export const SUPPRESSED_MASK = "•••";
export function isSuppressed(c: SuppressibleCount | SuppressibleDuration): boolean {
  return c.suppressed === true;
}
/** Render a suppressible count for display: a number, or the mask when hidden. Never leaks the value. */
export function formatCount(c: SuppressibleCount): string {
  return c.suppressed || c.value === null ? SUPPRESSED_MASK : String(c.value);
}

// ── Duration formatting (compact, deterministic — mirrors the reviewer console). ──
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) { const rm = m % 60; return rm ? `${h}h ${rm}m` : `${h}h`; }
  const d = Math.floor(h / 24); const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}
/** Render a suppressible median duration: a duration, the mask when hidden, or an em dash when empty. */
export function formatDuration(d: SuppressibleDuration): string {
  if (d.suppressed) return SUPPRESSED_MASK;
  return formatDurationMs(d.medianMs);
}
/** Render the observation count for a median: a number, the mask, or 0. */
export function formatObservations(d: SuppressibleDuration): string {
  if (d.suppressed || d.observations === null) return SUPPRESSED_MASK;
  return String(d.observations);
}

// ── Granularity vocabulary (the trend switcher). ──
export const GRANULARITY_OPTIONS: readonly { value: AnalyticsGranularity; labelKey: "day" | "week" | "month" }[] = [
  { value: AnalyticsGranularity.Day, labelKey: "day" },
  { value: AnalyticsGranularity.Week, labelKey: "week" },
  { value: AnalyticsGranularity.Month, labelKey: "month" },
];

// ── Bar geometry — normalize a series to 0..100 (%) of its own max. All-zero → all-zero (flat). ──
export function seriesMax(values: readonly number[]): number {
  return values.reduce((m, v) => (Number.isFinite(v) && v > m ? v : m), 0);
}
/** Normalize each value to a 0..100 height percentage relative to the series max (0 when the max is 0). */
export function normalizeBars(values: readonly number[]): number[] {
  const max = seriesMax(values);
  if (max <= 0) return values.map(() => 0);
  return values.map((v) => (Number.isFinite(v) && v > 0 ? Math.max(2, Math.round((v / max) * 100)) : 0));
}

/** A distribution rendered as bars: value/suppressed + a width percent relative to the max revealed cell. */
export interface DistributionBar { key: string; display: string; suppressed: boolean; pct: number; }
export function distributionBars(buckets: readonly DistributionBucket[]): DistributionBar[] {
  const revealed = buckets.map((b) => (b.count.suppressed ? 0 : b.count.value ?? 0));
  const max = seriesMax(revealed);
  return buckets.map((b) => {
    const suppressed = b.count.suppressed;
    const v = suppressed ? 0 : b.count.value ?? 0;
    const pct = suppressed ? 100 : max <= 0 ? 0 : Math.max(v > 0 ? 4 : 0, Math.round((v / max) * 100));
    return { key: b.key, display: formatCount(b.count), suppressed, pct };
  });
}
/** Whether a distribution has any suppressed cell (drives the "some values hidden" note). */
export function hasSuppressed(buckets: readonly DistributionBucket[]): boolean {
  return buckets.some((b) => b.count.suppressed);
}

// ── Bucket label (compact) — day/week "MM-DD", month "YYYY-MM". Deterministic. ──
export function bucketLabel(key: string, g: AnalyticsGranularity): string {
  if (g === AnalyticsGranularity.Month) return key; // already YYYY-MM
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(key);
  return m ? `${m[1]}-${m[2]}` : key;
}

// ── Tones (deterministic maps; unknown → neutral). ──
export function severityTone(v: string): Tone {
  return v === "critical" ? "danger" : v === "high" ? "warn" : v === "medium" ? "brand" : "neutral";
}
export function urgencyTone(v: string): Tone {
  return v === "immediate" ? "danger" : v === "elevated" ? "warn" : "neutral";
}
export function statusTone(v: string): Tone {
  switch (v) {
    case "resolved": return "ok";
    case "action_required": return "danger";
    case "open": case "under_review": return "brand";
    case "waiting": case "reopened": case "monitoring": return "warn";
    default: return "neutral"; // dismissed / closed
  }
}
export function escalationStatusTone(v: string): Tone {
  return v === "triggered" ? "danger" : v === "acknowledged" ? "warn" : v === "resolved" ? "ok" : "neutral";
}
export function planStatusTone(v: string): Tone {
  switch (v) { case "active": return "brand"; case "completed": return "ok"; case "reopened": return "warn"; default: return "neutral"; }
}
export function actionStatusTone(v: string): Tone {
  switch (v) { case "in_progress": return "brand"; case "blocked": return "danger"; case "completed": return "ok"; case "reopened": return "warn"; default: return "neutral"; }
}
export function deliveryOutcomeTone(v: string): Tone {
  switch (v) {
    case "acknowledged": return "ok";
    case "declined": case "failed": return "danger";
    case "revoked": case "expired": case "superseded": return "warn";
    case "prepared": case "available": return "brand";
    default: return "neutral"; // archived
  }
}

/** Truncate an opaque reviewer id for compact display (keeps head + tail; never a content value). */
export function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;
}
