/**
 * Child Safety Analytics V1 — pure presentational charts (server components; no client JS, no external
 * chart library → CSP-safe). Theme-aware via CSS variables (light/dark). Each chart is keyboard/AT
 * accessible: a labelled figure/table with per-bar titles + aria-labels. Suppressed cells render a mask,
 * never a number.
 */
import type { DistributionBucket } from "@guardora/core";
import { Badge } from "@/components/dashboard/ui";
import { normalizeBars, distributionBars, bucketLabel, formatCount, SUPPRESSED_MASK, type Tone } from "./analytics-view";
import { AnalyticsGranularity } from "@guardora/core";

const toneBar: Record<Tone, string> = {
  neutral: "bg-[var(--color-muted)]",
  brand: "bg-[var(--color-brand)]",
  ok: "bg-[var(--color-ok)]",
  warn: "bg-[var(--color-warn)]",
  danger: "bg-[var(--color-danger)]",
};

/** A vertical bar chart for one time series. Responsive; each bar exposes its bucket + value to AT. */
export function BarChart({ labels, values, granularity, ariaLabel }: {
  labels: string[]; values: number[]; granularity: AnalyticsGranularity; ariaLabel: string;
}) {
  const heights = normalizeBars(values);
  return (
    <figure role="img" aria-label={ariaLabel} className="w-full">
      <div className="flex h-40 items-end gap-[2px] overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
        {values.map((v, i) => (
          <div key={i} className="flex min-w-[6px] flex-1 flex-col items-center justify-end gap-1" title={`${bucketLabel(labels[i]!, granularity)}: ${v}`}>
            <div
              className="w-full rounded-t bg-[var(--color-brand)]"
              style={{ height: `${heights[i]}%`, minHeight: v > 0 ? 2 : 0 }}
              aria-hidden="true"
            />
          </div>
        ))}
      </div>
    </figure>
  );
}

/** A horizontal distribution bar list. Suppressed cells show the mask + a muted, striped bar. */
export function DistributionChart({ buckets, labelFor, toneFor, title, someHiddenLabel }: {
  buckets: DistributionBucket[]; labelFor: (key: string) => string; toneFor: (key: string) => Tone; title: string; someHiddenLabel: string;
}) {
  const bars = distributionBars(buckets);
  const anyHidden = buckets.some((b) => b.count.suppressed);
  return (
    <figure aria-label={title} className="space-y-1.5">
      <ul className="space-y-1.5">
        {bars.map((b) => (
          <li key={b.key} className="flex items-center gap-2 text-sm">
            <span className="w-28 shrink-0 truncate text-xs text-[var(--color-muted)]" title={labelFor(b.key)}>{labelFor(b.key)}</span>
            <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-[var(--color-neutral-soft)]">
              <span
                className={`absolute inset-y-0 left-0 rounded-full ${b.suppressed ? "bg-[var(--color-muted)] opacity-40" : toneBar[toneFor(b.key)]}`}
                style={{ width: `${b.pct}%` }}
                aria-hidden="true"
              />
            </span>
            <span className={`w-10 shrink-0 text-right text-xs tabular-nums ${b.suppressed ? "text-[var(--color-muted)]" : "font-semibold"}`} aria-label={b.suppressed ? someHiddenLabel : `${b.display}`}>
              {b.display}
            </span>
          </li>
        ))}
      </ul>
      {anyHidden ? <figcaption className="text-[11px] text-[var(--color-muted)]">{SUPPRESSED_MASK} {someHiddenLabel}</figcaption> : null}
    </figure>
  );
}

/** A compact multi-series trend table (accessible tabular form of the trend chart). Scrolls on overflow. */
export function TrendTable({ buckets, granularity, series }: {
  buckets: string[]; granularity: AnalyticsGranularity; series: { label: string; values: number[] }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-xs">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left uppercase tracking-wider text-[var(--color-muted)]">
            <th className="px-2 py-1.5 font-semibold">#</th>
            {series.map((s) => <th key={s.label} className="px-2 py-1.5 text-right font-semibold">{s.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {buckets.map((k, i) => (
            <tr key={k} className="border-b border-[var(--color-border)] last:border-0">
              <td className="px-2 py-1.5 font-mono text-[var(--color-muted)]">{bucketLabel(k, granularity)}</td>
              {series.map((s) => <td key={s.label} className="px-2 py-1.5 text-right tabular-nums">{s.values[i] ?? 0}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Re-export for the page's inline suppressed badge use. */
export function SuppressedBadge({ label }: { label: string }) {
  return <Badge tone="neutral">{SUPPRESSED_MASK} {label}</Badge>;
}
