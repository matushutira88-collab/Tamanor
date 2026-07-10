/** Deterministic date formatting (UTC) — safe for server rendering. */
const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export function formatDateTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${DATE_FMT.format(date)} UTC`;
}

const DATE_ONLY = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return DATE_ONLY.format(date);
}

/**
 * Human relative time (V1.28C). `justNow` / `minAgo` ("pred {n} min") / `today`
 * ("dnes {t}") templates come from i18n; older falls back to a date. UTC-based to
 * stay deterministic for SSR.
 */
export function relativeTime(
  d: Date | string,
  s: { justNow: string; minAgo: string; today: string },
  now: Date = new Date(),
): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const min = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (min < 1) return s.justNow;
  if (min < 60) return s.minAgo.replace("{n}", String(min));
  const sameDay = date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() === now.getUTCMonth() && date.getUTCDate() === now.getUTCDate();
  if (sameDay) {
    const hm = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
    return s.today.replace("{t}", hm);
  }
  return formatDate(date);
}

/** Turn snake_case / kebab-case enum values into a readable label. */
export function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
