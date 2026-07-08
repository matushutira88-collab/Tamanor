import type { DayBucket } from "@/lib/trend";

/**
 * Minimal, dependency-free bar chart for a day-bucketed trend. Presentational
 * only — data is computed by the caller from real records.
 */
export function TrendChart({
  buckets,
  height = 160,
}: {
  buckets: DayBucket[];
  height?: number;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {buckets.map((b) => (
          <div key={b.key} className="group relative flex flex-1 flex-col items-center justify-end">
            <div
              className="w-full rounded-t-md bg-[var(--color-brand)] transition-all"
              style={{
                height: `${(b.count / max) * 100}%`,
                minHeight: b.count > 0 ? 4 : 2,
                opacity: b.count > 0 ? 1 : 0.25,
              }}
            />
            <span className="pointer-events-none absolute -top-6 rounded bg-[var(--color-fg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-bg)] opacity-0 transition group-hover:opacity-100">
              {b.count}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--color-muted)]">
        <span>{buckets[0]?.label}</span>
        <span>{buckets[Math.floor(buckets.length / 2)]?.label}</span>
        <span>{buckets[buckets.length - 1]?.label}</span>
      </div>
    </div>
  );
}

/** Horizontal labelled bars (breakdowns). */
export function BarList({
  rows,
}: {
  rows: { label: string; value: number; tone?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const bg: Record<string, string> = {
    brand: "bg-[var(--color-brand)]",
    ok: "bg-[var(--color-ok)]",
    warn: "bg-[var(--color-warn)]",
    danger: "bg-[var(--color-danger)]",
    neutral: "bg-[var(--color-muted)]",
  };
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 truncate text-[var(--color-muted)]">{r.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
            <div className={`h-full rounded-full ${bg[r.tone ?? "brand"] ?? bg.brand}`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="w-8 text-right text-xs font-medium">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
