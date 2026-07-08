/** A single day bucket in a trend series. */
export interface DayBucket {
  /** UTC day key, e.g. "2026-07-08". */
  key: string;
  /** Short label, e.g. "Jul 8". */
  label: string;
  count: number;
}

const LABEL_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Bucket a list of dates into the last `days` UTC days (inclusive of today),
 * returning a fixed-length series suitable for a bar/line chart.
 */
export function bucketByDay(dates: Date[], days = 14): DayBucket[] {
  const buckets: DayBucket[] = [];
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const index = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(todayUtc - i * 86_400_000);
    const key = dayKey(d);
    index.set(key, buckets.length);
    buckets.push({ key, label: LABEL_FMT.format(d), count: 0 });
  }

  for (const date of dates) {
    const key = dayKey(date);
    const at = index.get(key);
    if (at !== undefined) buckets[at]!.count += 1;
  }
  return buckets;
}
