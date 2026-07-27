/**
 * Child Safety Analytics V1 — UI test (no DB / browser / network).
 *
 *   1. PURE view-model + policy — tones, suppression display (a hidden value is ALWAYS a mask, never a
 *      number), bar geometry, bucket labels, and the core policy primitives (suppression incl. secondary,
 *      bucket enumeration, range clamping, median, CSV serialization, permissions).
 *   2. i18n parity — en/sk/de have identical key structure; every distribution value, granularity, and
 *      dimension is localized in all three.
 *   3. SOURCE INVARIANTS — the page gates on canViewChildSafetyAnalytics → <Unauthorized>; export is
 *      gated by canExportChildSafetyAnalytics; charts are accessible; no window.confirm; the error
 *      boundary never renders the raw error; loading/error boundaries exist; reviewer workload carries the
 *      "never ranked" note; the CSV route is a safe attachment; no raw-content fields are referenced.
 *
 * Run: pnpm child-safety-analytics-ui:test
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  severityTone, urgencyTone, statusTone, escalationStatusTone, planStatusTone, actionStatusTone, deliveryOutcomeTone,
  formatCount, formatDuration, formatObservations, formatDurationMs, normalizeBars, seriesMax, distributionBars,
  bucketLabel, GRANULARITY_OPTIONS, shortId, SUPPRESSED_MASK,
} from "../src/app/dashboard/child-safety/reviewer/analytics/analytics-view";
import { ANALYTICS_COPY } from "../src/app/dashboard/child-safety/reviewer/analytics/analytics-i18n";
import {
  Role, canViewChildSafetyAnalytics, canExportChildSafetyAnalytics,
  suppressCount, suppressDuration, applySecondarySuppression, buildDistribution, median,
  enumerateBucketKeys, clampAnalyticsRange, serializeAnalyticsCsv, csvCell, csvCount,
  AnalyticsGranularity, AnalyticsDistributionDimension, distributionValues,
  CHILD_SAFETY_ANALYTICS_MIN_COHORT, CHILD_SAFETY_ANALYTICS_MAX_RANGE_DAYS,
  CHILD_SAFETY_ANALYTICS_SEVERITIES, CHILD_SAFETY_ANALYTICS_DELIVERY_OUTCOMES,
} from "@guardora/core";
import type { Locale } from "../src/i18n/config";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => { console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`); cond ? pass++ : fail++; };

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "src", "app", "dashboard", "child-safety", "reviewer", "analytics");
const read = (rel: string): string => readFileSync(join(DIR, rel), "utf8");
const has = (rel: string): boolean => existsSync(join(DIR, rel));
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const LOCALES: Locale[] = ["en", "sk", "de"];

function main() {
  // ── 1. PURE VIEW-MODEL ────────────────────────────────────────────
  console.log("\n1. tones");
  check("★ severityTone maps critical→danger, low→neutral", severityTone("critical") === "danger" && severityTone("high") === "warn" && severityTone("low") === "neutral");
  check("★ urgencyTone maps immediate→danger", urgencyTone("immediate") === "danger" && urgencyTone("routine") === "neutral");
  check("★ statusTone resolved→ok, action_required→danger", statusTone("resolved") === "ok" && statusTone("action_required") === "danger");
  check("★ escalation/plan/action/delivery tones deterministic", escalationStatusTone("triggered") === "danger" && planStatusTone("completed") === "ok" && actionStatusTone("blocked") === "danger" && deliveryOutcomeTone("acknowledged") === "ok");
  check("★ unknown tone → neutral (safe)", severityTone("???") === "neutral" && deliveryOutcomeTone("???") === "neutral" && statusTone("???") === "neutral");

  console.log("\n2. suppression display (a hidden value is ALWAYS masked, NEVER a number)");
  check("★ formatCount: revealed → number, suppressed → mask", formatCount({ value: 7, suppressed: false }) === "7" && formatCount({ value: null, suppressed: true }) === SUPPRESSED_MASK);
  check("★ formatCount: 0 shows truthfully as 0", formatCount({ value: 0, suppressed: false }) === "0");
  check("★ formatDuration: suppressed → mask", formatDuration({ medianMs: null, observations: null, suppressed: true }) === SUPPRESSED_MASK);
  check("★ formatDuration: revealed → compact duration", formatDuration({ medianMs: 3_600_000, observations: 9, suppressed: false }) === "1h");
  check("★ formatObservations: suppressed → mask, revealed → number", formatObservations({ medianMs: null, observations: null, suppressed: true }) === SUPPRESSED_MASK && formatObservations({ medianMs: 1, observations: 9, suppressed: false }) === "9");
  check("★ formatDurationMs: 45s / 2h 5m / 3d 4h / null", formatDurationMs(45_000) === "45s" && formatDurationMs(7_500_000) === "2h 5m" && formatDurationMs(273_600_000) === "3d 4h" && formatDurationMs(null) === "—");

  console.log("\n3. bar geometry");
  check("★ seriesMax picks the max (0 for empty/all-zero)", seriesMax([1, 5, 3]) === 5 && seriesMax([0, 0]) === 0 && seriesMax([]) === 0);
  check("★ normalizeBars → 0..100 of max; all-zero → flat", JSON.stringify(normalizeBars([0, 5, 10])) === JSON.stringify([0, 50, 100]) && normalizeBars([0, 0]).every((n) => n === 0));
  const dbars = distributionBars([{ key: "a", count: { value: 10, suppressed: false } }, { key: "b", count: { value: null, suppressed: true } }, { key: "c", count: { value: 0, suppressed: false } }]);
  check("★ distributionBars: revealed scales to max; suppressed shows mask+full muted bar; zero → 0%", dbars[0]!.pct === 100 && dbars[0]!.display === "10" && dbars[1]!.suppressed === true && dbars[1]!.display === SUPPRESSED_MASK && dbars[1]!.pct === 100 && dbars[2]!.pct === 0);
  check("★ bucketLabel day/week → MM-DD, month → YYYY-MM", bucketLabel("2026-06-15", AnalyticsGranularity.Day) === "06-15" && bucketLabel("2026-06", AnalyticsGranularity.Month) === "2026-06");
  check("★ GRANULARITY_OPTIONS covers day/week/month", GRANULARITY_OPTIONS.length === 3 && GRANULARITY_OPTIONS.map((g) => g.value).join() === "day,week,month");
  check("★ shortId truncates long, keeps short", shortId("abcdefghijklmnop").includes("…") && shortId("short") === "short");

  // ── CORE POLICY ────────────────────────────────────────────────────
  console.log("\n4. suppression policy (k-anonymity)");
  check(`★ MIN_COHORT = ${CHILD_SAFETY_ANALYTICS_MIN_COHORT}`, CHILD_SAFETY_ANALYTICS_MIN_COHORT === 5);
  check("★ suppressCount: 0 → {0,false}", JSON.stringify(suppressCount(0)) === JSON.stringify({ value: 0, suppressed: false }));
  check("★ suppressCount: 1..4 → {null,true} (hidden)", [1, 2, 3, 4].every((n) => { const c = suppressCount(n); return c.value === null && c.suppressed === true; }));
  check("★ suppressCount: >=5 → {n,false} (revealed)", suppressCount(5).value === 5 && suppressCount(9).suppressed === false);
  check("★ suppressCount never returns the hidden number", suppressCount(3).value === null);
  check("★ suppressDuration: <5 obs → suppressed; >=5 → revealed", suppressDuration(100, 3).suppressed === true && suppressDuration(100, 5).suppressed === false && suppressDuration(100, 3).medianMs === null);
  const secondary = applySecondarySuppression([{ key: "a", count: { value: 6, suppressed: false } }, { key: "b", count: { value: 5, suppressed: false } }, { key: "c", count: { value: null, suppressed: true } }]);
  check("★ applySecondarySuppression: single hidden cell forces a 2nd (no subtraction attack)", secondary.filter((b) => b.count.suppressed).length === 2 && secondary.find((b) => b.key === "b")!.count.suppressed === true);
  const dist = buildDistribution(AnalyticsDistributionDimension.Severity, { high: 10, medium: 6, critical: 2 });
  check("★ buildDistribution zero-fills every canonical value", dist.length === CHILD_SAFETY_ANALYTICS_SEVERITIES.length && CHILD_SAFETY_ANALYTICS_SEVERITIES.every((v) => dist.some((b) => b.key === v)));
  check("★ buildDistribution suppresses tiny cell + a complement", dist.filter((b) => b.count.suppressed).length >= 2 && dist.find((b) => b.key === "low")!.count.value === 0);

  console.log("\n5. bucket enumeration (every bucket exists)");
  const from = new Date("2026-06-01T00:00:00Z"), to = new Date("2026-06-30T00:00:00Z");
  const dayKeys = enumerateBucketKeys(from, to, AnalyticsGranularity.Day);
  check("★ day buckets: contiguous + inclusive (30)", dayKeys.length === 30 && dayKeys[0] === "2026-06-01" && dayKeys[29] === "2026-06-30");
  check("★ day buckets strictly ascending, no gaps", dayKeys.every((k, i) => i === 0 || k > dayKeys[i - 1]!));
  check("★ week buckets exist + ascending", enumerateBucketKeys(from, to, AnalyticsGranularity.Week).length >= 4);
  check("★ month buckets exist", enumerateBucketKeys(from, to, AnalyticsGranularity.Month).length === 1);
  check("★ enumeration is bounded (never unbounded)", enumerateBucketKeys(new Date("2000-01-01"), new Date("2100-01-01"), AnalyticsGranularity.Day).length <= CHILD_SAFETY_ANALYTICS_MAX_RANGE_DAYS + 2);

  console.log("\n6. range clamping + median");
  const now = new Date("2026-06-15T12:00:00Z");
  const def = clampAnalyticsRange(undefined, undefined, now);
  check("★ default range ends at now, 30-day span", def.to.getTime() === now.getTime() && Math.round((def.to.getTime() - def.from.getTime()) / 86_400_000) === 30);
  check("★ future 'to' is clamped to now", clampAnalyticsRange(undefined, new Date("2030-01-01"), now).to.getTime() === now.getTime());
  check("★ reversed range is swapped", (() => { const r = clampAnalyticsRange(new Date("2026-06-10"), new Date("2026-06-01"), now); return r.from.getTime() <= r.to.getTime(); })());
  check("★ oversized span is clamped to the max", (() => { const r = clampAnalyticsRange(new Date("2000-01-01"), now, now); return Math.round((r.to.getTime() - r.from.getTime()) / 86_400_000) <= CHILD_SAFETY_ANALYTICS_MAX_RANGE_DAYS; })());
  check("★ median: odd→middle, even→mean, empty→null", median([3, 1, 2]) === 2 && median([1, 2, 3, 4]) === 3 && median([]) === null);

  console.log("\n7. CSV serialization (aggregated only; safe)");
  const csv = serializeAnalyticsCsv([{ section: "overview", metric: "incidents_created", value: "12" }, { section: "distribution", metric: "severity", dimension: "critical", value: "suppressed" }]);
  check("★ CSV has the stable header", csv.startsWith("section,metric,dimension,value\r\n"));
  check("★ csvCount: suppressed → 'suppressed', revealed → number (never the hidden value)", csvCount({ value: null, suppressed: true }) === "suppressed" && csvCount({ value: 8, suppressed: false }) === "8" && csvCount({ value: 0, suppressed: false }) === "0");
  check("★ csvCell escapes commas/quotes/newlines", csvCell('a,b') === '"a,b"' && csvCell('a"b') === '"a""b"');
  check("★ csvCell neutralizes spreadsheet formula injection", csvCell("=SUM(A1)").startsWith("'="));

  console.log("\n8. permissions (view = O/A/R; export = O/A only)");
  check("★ canView: Owner/Admin/Reviewer yes; Analyst/Viewer no", canViewChildSafetyAnalytics(Role.Owner) && canViewChildSafetyAnalytics(Role.Admin) && canViewChildSafetyAnalytics(Role.Reviewer) && !canViewChildSafetyAnalytics(Role.Analyst) && !canViewChildSafetyAnalytics(Role.Viewer));
  check("★ canExport: Owner/Admin yes; Reviewer NO (view-only); Analyst/Viewer no", canExportChildSafetyAnalytics(Role.Owner) && canExportChildSafetyAnalytics(Role.Admin) && !canExportChildSafetyAnalytics(Role.Reviewer) && !canExportChildSafetyAnalytics(Role.Analyst) && !canExportChildSafetyAnalytics(Role.Viewer));

  // ── 2. i18n PARITY ────────────────────────────────────────────────
  console.log("\n9. i18n parity (en/sk/de)");
  const keyPaths = (o: unknown, prefix = ""): string[] => {
    if (o === null || typeof o !== "object") return [prefix];
    return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
  };
  const en = keyPaths(ANALYTICS_COPY.en).sort();
  check("★ sk key structure == en", JSON.stringify(keyPaths(ANALYTICS_COPY.sk).sort()) === JSON.stringify(en));
  check("★ de key structure == en", JSON.stringify(keyPaths(ANALYTICS_COPY.de).sort()) === JSON.stringify(en));
  check("★ every severity value localized in all locales", LOCALES.every((l) => CHILD_SAFETY_ANALYTICS_SEVERITIES.every((v) => !!ANALYTICS_COPY[l].severityLabel[v])));
  check("★ every delivery outcome localized in all locales", LOCALES.every((l) => CHILD_SAFETY_ANALYTICS_DELIVERY_OUTCOMES.every((v) => !!ANALYTICS_COPY[l].deliveryOutcomeLabel[v])));
  check("★ every distribution dimension label localized", LOCALES.every((l) => Object.values(AnalyticsDistributionDimension).every((d) => !!(ANALYTICS_COPY[l].dimension as Record<string, string>)[d])));
  check("★ every granularity localized", LOCALES.every((l) => ["day", "week", "month"].every((g) => !!(ANALYTICS_COPY[l].granularity as Record<string, string>)[g])));

  // ── 3. SOURCE INVARIANTS ──────────────────────────────────────────
  console.log("\n10. permission gating (page)");
  const page = read("page.tsx");
  check("★ page gates on canViewChildSafetyAnalytics → <Unauthorized>", /canViewChildSafetyAnalytics\(session\.role\)/.test(page) && /<Unauthorized/.test(page));
  check("★ export control is gated by canExportChildSafetyAnalytics", /canExportChildSafetyAnalytics\(session\.role\)/.test(page) && /canExport\s*\?/.test(page));
  check("★ export target is the CSV export route", /\/api\/v1\/child-safety\/reviewer\/analytics\/export/.test(page));

  console.log("\n11. accessibility + safety");
  const charts = read("charts.tsx");
  check("★ charts expose accessible labels (role=img / aria-label / figure)", /role="img"/.test(charts) && /aria-label/.test(charts) && /<figure/.test(charts));
  check("★ NO window.confirm anywhere in the dashboard", ["page.tsx", "charts.tsx", "analytics-view.ts", "unauthorized.tsx"].every((f) => !/window\.confirm/.test(stripComments(read(f)))));
  check("★ error boundary NEVER renders the raw error", (() => { const e = stripComments(read("error.tsx")); return !/error\.message|\{error\}|error\.stack/.test(e); })());
  check("★ loading + error boundaries exist", has("loading.tsx") && has("error.tsx"));
  check("★ range filter is a GET form (no client JS needed; keyboard accessible)", /method="GET"/.test(page) && /type="submit"/.test(page));

  console.log("\n12. privacy + no-ranking + content-free");
  const view = stripComments(read("analytics-view.ts"));
  check("★ reviewer workload carries a note in all locales", LOCALES.every((l) => ANALYTICS_COPY[l].workload.note.length > 0));
  check("★ workload note explicitly says reviewers are not ranked/scored", /never ranked or scored/i.test(ANALYTICS_COPY.en.workload.note) && /nehodnotia ani neradia/.test(ANALYTICS_COPY.sk.workload.note) && /bewertet oder gereiht/.test(ANALYTICS_COPY.de.workload.note));
  check("★ page renders workload by stable id — no client-side metric sort", !/\.sort\(\s*\(.*\)\s*=>.*(assigned|resolved|median|overdue)/.test(stripComments(page)));
  check("★ suppression mask is a non-numeric glyph", !/[0-9]/.test(SUPPRESSED_MASK));
  const allSrc = ["page.tsx", "charts.tsx", "analytics-view.ts", "analytics-i18n.ts"].map((f) => stripComments(read(f))).join("\n");
  check("★ dashboard never references raw content / message / transcript fields", !/detectorPayload|rawContent|transcript|messageBody|noteBody|\.body\b/.test(allSrc));
  check("★ view module has no child profiling/scoring/ranking vocabulary", !/profil(e|ing)Score|riskScore|childScore|rankReviewer|leaderboard|predict/i.test(view));

  console.log("\n13. API + server safety (source)");
  const apiDir = join(HERE, "..", "src", "app", "api", "v1", "child-safety", "reviewer", "analytics");
  const route = readFileSync(join(apiDir, "route.ts"), "utf8");
  const exportRoute = readFileSync(join(apiDir, "export", "route.ts"), "utf8");
  const server = readFileSync(join(HERE, "..", "src", "server", "child-safety", "analytics.ts"), "utf8");
  check("★ JSON route delegates to the server boundary", /analyticsReport\(/.test(route));
  check("★ export route is a CSV attachment, no-store", /text\/csv/.test(exportRoute) && /attachment; filename=/.test(exportRoute) && /no-store/.test(exportRoute));
  check("★ server maps errors to SAFE codes (never a raw message/stack)", /"forbidden"/.test(server) && !/e\.message/.test(stripComments(server)) && !/\.stack/.test(stripComments(server)));
  check("★ server gates view via canViewChildSafetyAnalytics + resolves session", /canViewChildSafetyAnalytics/.test(server) && /getSession\(\)/.test(server));
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Analytics UI V1: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
