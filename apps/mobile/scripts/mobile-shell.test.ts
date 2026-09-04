/**
 * M3 — mobile app shell + dashboard client.
 *
 * PURE tests in the existing harness (a `check()` counter under `tsx`), possible
 * because the behaviour that matters was kept out of React: the query reducer, the
 * request tracker, the locale resolver and the presentation mappers are all plain
 * functions.
 *
 * The properties asserted are the ones that would be dangerous to get wrong:
 *   - a stale timeframe response can NEVER overwrite a newer one
 *   - a duplicate request is refused
 *   - a pull-to-refresh keeps content on screen; a failed refresh keeps it too
 *   - a null delta is never rendered as a fabricated percentage
 *   - unknown account statuses / activity types degrade safely
 *   - no raw API error text reaches the UI, and there is no demo-data fallback
 *
 * Run: pnpm mobile-shell-client:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { ApiErrorCode, AccountStatus, ActivityType, Bootstrap, Dashboard, NavKey } from "../src/api/types";
import { TIMEFRAMES } from "../src/api/types";
import {
  createRequestTracker, initialQueryState, isBlockingError, isInitialLoad, isRefreshing,
  queryReducer, type QueryState,
} from "../src/data/query";
import { shellNeedsReload, shellPhase } from "../src/shell/shell-state";
import { resolveLocale, isLocale, dictionaryFor, LOCALES, DEFAULT_LOCALE } from "../src/i18n/locale";
import { en } from "../src/i18n/en";
import { sk } from "../src/i18n/sk";
import { de } from "../src/i18n/de";
import { protectionLevel } from "../src/components/dashboard/protection-level";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`);
  c ? pass++ : fail++;
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "..", rel), "utf8");
/** Source with comments stripped — the "never does X" checks must inspect CODE. */
const codeOf = (rel: string) =>
  readSrc(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const dump = (o: unknown) => JSON.stringify(o);

type DashState = QueryState<Dashboard>;
const S = () => initialQueryState<Dashboard>();
const fakeDashboard = (over: Partial<Dashboard> = {}): Dashboard =>
  ({ timeframe: 30, isEmpty: false, ...over }) as Dashboard;

async function run() {
  /* ===================== QUERY STATE ===================== */
  console.log("\nQUERY STATE");

  {
    const s0 = S();
    check("initial state is idle with no data", s0.status === "idle" && s0.data === null);
    const loading = queryReducer<Dashboard>(s0, { type: "START" });
    check("first START → loading", loading.status === "loading");
    check("first load is a BLOCKING load (skeleton)", isInitialLoad(loading));
    const ok = queryReducer<Dashboard>(loading, { type: "SUCCESS", data: fakeDashboard() });
    check("SUCCESS → success with data", ok.status === "success" && ok.data !== null);
    check("SUCCESS clears any previous error", ok.error === null);
  }
  {
    const withData = queryReducer<Dashboard>(S(), { type: "SUCCESS", data: fakeDashboard() });
    const refreshing = queryReducer<Dashboard>(withData, { type: "START", refresh: true });
    check("pull-to-refresh → refreshing, NOT loading", refreshing.status === "refreshing");
    check("pull-to-refresh KEEPS existing content on screen", refreshing.data !== null);
    check("refreshing is not a blocking load", !isInitialLoad(refreshing) && isRefreshing(refreshing));
  }
  {
    // A refresh before any data exists must still show the skeleton, not an empty screen.
    const refreshFirst = queryReducer<Dashboard>(S(), { type: "START", refresh: true });
    check("a refresh with no data yet is still a blocking load", isInitialLoad(refreshFirst));
  }
  {
    const failed = queryReducer<Dashboard>(queryReducer<Dashboard>(S(), { type: "START" }), { type: "FAILURE", error: "network" });
    check("a failed FIRST load is a blocking error", isBlockingError(failed) && failed.error === "network");
    check("a failed first load has no data to show", failed.data === null);
  }
  {
    const withData = queryReducer<Dashboard>(S(), { type: "SUCCESS", data: fakeDashboard() });
    const refreshFailed = queryReducer<Dashboard>(
      queryReducer<Dashboard>(withData, { type: "START", refresh: true }),
      { type: "FAILURE", error: "network" },
    );
    check("a failed REFRESH keeps the last good content", refreshFailed.data !== null);
    check("...and is NOT a blocking error", !isBlockingError(refreshFailed));
    check("...but still reports the error", refreshFailed.error === "network");
  }
  {
    const stale = queryReducer<Dashboard>(S(), { type: "FAILURE", error: "network" });
    const retry = queryReducer<Dashboard>(stale, { type: "START" });
    check("starting a retry clears the previous error", retry.error === null);
  }

  /* ===================== REQUEST SEQUENCING ===================== */
  console.log("\nREQUEST SEQUENCING");

  {
    const tracker = createRequestTracker();
    const a = tracker.begin("30");
    check("the first request is not a duplicate", a.duplicate === false);
    const b = tracker.begin("30");
    check("the SAME timeframe while in flight is a DUPLICATE", b.duplicate === true);
    tracker.end(a);
    const c = tracker.begin("30");
    check("after the first finishes, the same timeframe may run again", c.duplicate === false);
  }
  {
    const tracker = createRequestTracker();
    const first = tracker.begin("7");
    const second = tracker.begin("90");
    check("a DIFFERENT timeframe supersedes rather than duplicating", second.duplicate === false);
    check("the newer request is the latest", tracker.isLatest(second.seq));
    check("the older request is NO LONGER latest", !tracker.isLatest(first.seq));
  }
  {
    // The scenario the tracker exists for: 7d requested, 90d requested, 7d lands last.
    const tracker = createRequestTracker();
    const slow7 = tracker.begin("7");
    const fast90 = tracker.begin("90");

    let committed: string | null = null;
    const commit = (t: { seq: number }, value: string) => { if (tracker.isLatest(t.seq)) committed = value; };
    commit(fast90, "90d-data");
    commit(slow7, "7d-data"); // arrives late
    check("a STALE response cannot overwrite a newer one", committed === "90d-data");
  }
  {
    const tracker = createRequestTracker();
    const superseded = tracker.begin("7");
    const current = tracker.begin("30");
    tracker.end(superseded); // late finish of the abandoned request
    check("a superseded request finishing late does not unlock the newer one", tracker.inFlight === "30");
    tracker.end(current);
    check("the current request releases the slot", tracker.inFlight === null);
  }
  {
    const tracker = createRequestTracker();
    const results = [tracker.begin("30"), tracker.begin("30"), tracker.begin("30")];
    check("three taps on the same timeframe → one real request",
      results.filter((r) => !r.duplicate).length === 1);
  }

  /* ===================== KPI / DELTA PRESENTATION ===================== */
  console.log("\nKPI PRESENTATION");

  // The KpiCard's "good" rule, restated here as the contract the screen relies on.
  const isGood = (delta: number, higherIsBetter: boolean) =>
    delta === 0 ? true : delta > 0 ? higherIsBetter : !higherIsBetter;
  check("more analyzed comments is good", isGood(25, true));
  check("fewer analyzed comments is not good", !isGood(-25, true));
  check("more RISK comments is NOT good", !isGood(25, false));
  check("fewer RISK comments IS good", isGood(-25, false));
  check("no change is never alarming", isGood(0, true) && isGood(0, false));
  {
    const src = codeOf("src/components/dashboard/kpi-card.tsx");
    check("a null delta renders the no-baseline string, not a number",
      src.includes("strings.noBaseline") && src.includes("hasDelta"));
    check("the delta direction is stated in WORDS, not colour alone",
      src.includes("strings.up") && src.includes("strings.down"));
    check("the KPI card exposes one spoken label per metric", src.includes("accessibilityLabel={spoken}"));
    check("the KPI card never computes a delta itself", !src.includes("previous") && !src.includes("/ prev"));
  }

  /* ===================== ACCOUNT STATUS MAPPING ===================== */
  console.log("\nACCOUNT STATUS");

  {
    const src = readSrc("src/components/dashboard/account-summary-card.tsx");
    const statuses: AccountStatus[] = ["active", "permissions_expired", "sync_failed", "monitoring_off", "demo"];
    for (const s of statuses) {
      check(`status ${s} has a tone`, src.includes(`${s}:`));
      check(`status ${s} has a label in every locale`,
        [en, sk, de].every((d) => typeof (d.accounts.status as Record<string, string>)[s] === "string"));
    }
    check("an unknown status falls back to neutral, never to 'healthy'",
      codeOf("src/components/dashboard/account-summary-card.tsx").includes("?? 'neutral'"));
    check("the card never infers health from the counters",
      !codeOf("src/components/dashboard/account-summary-card.tsx").includes("risky >") );
  }
  check("web parity: sync_failed reads as 'Needs attention'", en.accounts.status.sync_failed === "Needs attention");
  check("web parity: permissions_expired reads as 'Permissions expired'", en.accounts.status.permissions_expired === "Permissions expired");

  /* ===================== PROTECTION ===================== */
  console.log("\nPROTECTION");

  check("score >= 80 → strong", protectionLevel(80) === "strong" && protectionLevel(100) === "strong");
  check("score 50..79 → partial", protectionLevel(50) === "partial" && protectionLevel(79) === "partial");
  check("score < 50 → weak", protectionLevel(49) === "weak" && protectionLevel(0) === "weak");
  check("thresholds match the web ring colour boundaries",
    protectionLevel(79) !== protectionLevel(80) && protectionLevel(49) !== protectionLevel(50));
  {
    const src = codeOf("src/components/dashboard/protection-summary.tsx");
    check("the score is rendered numerically, not only as a gauge", src.includes("String(clamped)"));
    check("each check states its status in WORDS", src.includes("strings.state[check.state]"));
    check("the meter is hidden from assistive tech (the number carries it)", src.includes("accessibilityElementsHidden"));
    check("protection is never recomputed on the client",
      !src.includes("reduce(") && !src.includes("components.filter"));
    check("an unknown check key falls back to the key, never a guess",
      codeOf("src/app/(app)/index.tsx").includes("[key] ?? key"));
    check("the score is clamped to 0..100", src.includes("Math.max(0, Math.min(100, score))"));
  }

  /* ===================== ACTIVITY ===================== */
  console.log("\nACTIVITY");

  {
    const types: ActivityType[] = [
      "sync.completed", "sync.failed", "auto_protect.would_auto_hide", "protection.action_executed",
      "incident.created", "proposal.created", "account.connected", "token.expired",
    ];
    for (const type of types) {
      check(`activity ${type} has a label in every locale`,
        [en, sk, de].every((d) => typeof (d.activity.types as Record<string, string>)[type] === "string"));
    }
    const src = readSrc("src/components/dashboard/activity-row.tsx");
    for (const type of types) check(`activity ${type} has a tone`, src.includes(`'${type}'`));
    check("an unknown activity tone falls back safely", codeOf("src/components/dashboard/activity-row.tsx").includes("?? 'brand'"));
    check("an unlabelled activity renders the bounded key, never raw server text",
      codeOf("src/app/(app)/index.tsx").includes("t.activity.types[event.type] ?? event.type"));
  }
  check("web parity: sync.completed label", en.activity.types["sync.completed"] === "Synchronization completed");
  check("web parity: token.expired label", en.activity.types["token.expired"] === "Permissions expired");

  /* ===================== LOCALIZATION ===================== */
  console.log("\nLOCALIZATION");

  check("the app ships en, sk and de", dump([...LOCALES]) === dump(["en", "sk", "de"]));
  check("the default locale is English", DEFAULT_LOCALE === "en");
  check("exact tags resolve", resolveLocale(["sk"]) === "sk" && resolveLocale(["de"]) === "de");
  check("regional tags resolve to their language", resolveLocale(["sk-SK"]) === "sk" && resolveLocale(["de-AT"]) === "de");
  check("case is ignored", resolveLocale(["DE-DE"]) === "de");
  check("the first SUPPORTED preference wins", resolveLocale(["fr-FR", "sk-SK", "en"]) === "sk");
  check("an unsupported list falls back to English", resolveLocale(["fr", "ja", "pt-BR"]) === "en");
  check("an empty list falls back to English", resolveLocale([]) === "en");
  check("null/undefined entries are skipped", resolveLocale([null, undefined, "de"]) === "de");
  check("garbage is not a locale", !isLocale("") && !isLocale("xx") && !isLocale(42) && !isLocale(null));
  {
    // Every locale must implement the full English shape — a missing key would
    // render `undefined` in the UI.
    const walk = (ref: unknown, cand: unknown, path: string): string[] => {
      if (typeof ref === "function") return typeof cand === "function" ? [] : [path];
      if (typeof ref === "object" && ref !== null) {
        if (typeof cand !== "object" || cand === null) return [path];
        return Object.keys(ref as object).flatMap((k) =>
          walk((ref as Record<string, unknown>)[k], (cand as Record<string, unknown>)[k], `${path}.${k}`));
      }
      return typeof cand === typeof ref ? [] : [path];
    };
    for (const [name, dict] of [["sk", sk], ["de", de]] as const) {
      const missing = walk(en, dict, name);
      check(`${name} implements every English key`, missing.length === 0, missing.slice(0, 3).join(", "));
    }
    check("dictionaryFor returns the right dictionary", dictionaryFor("sk").nav.overview === sk.nav.overview);
  }
  {
    const src = codeOf("src/i18n/index.ts");
    check("i18n never imports the web/Next dictionaries", !src.includes("@/i18n/server") && !src.includes("next/"));
    check("the locale read cannot crash startup", src.includes("catch"));
  }

  /* ===================== NAV GATING ===================== */
  console.log("\nNAV GATING");

  {
    const layout = codeOf("src/app/(app)/_layout.tsx");
    check("optional tabs are guarded by the SERVER-allowed set", layout.includes("allowedNav.includes"));
    check("the guard uses Tabs.Protected (unmounted, not just hidden)", layout.includes("Tabs.Protected"));
    check("Overview is always available so the shell has a destination", layout.includes('name="index"'));
    check("the alerts tab carries the pending badge", layout.includes("CountBadge") && layout.includes("pendingReview"));
    check("the badge count is also SPOKEN, not glyph-only", layout.includes("tabBarAccessibilityLabel"));
    check("no more than five permanent tabs", (layout.match(/<Tabs\.Screen/g) ?? []).length === 5);

    const provider = codeOf("src/shell/shell-provider.tsx");
    check("allowedNav FAILS CLOSED before bootstrap answers", provider.includes("?? []"));
    check("the shell routes 401 through the M2 auth machine", provider.includes("onSessionRejected"));
    check("the shell does not decide authorization itself",
      !provider.includes("can(") && !provider.includes("role ==="));
  }
  {
    // The More screen lists only what the server allowed.
    const more = codeOf("src/app/(app)/more.tsx");
    check("More filters its list by the allowed set", more.includes("allowedNav.includes"));
    const keys: NavKey[] = ["activity", "rules", "billing", "team", "settings"];
    check("every secondary destination has a label in all locales",
      keys.every((k) => [en, sk, de].every((d) => typeof (d.nav as Record<string, string>)[k] === "string")));
    check("an unlimited plan cap is never rendered as a number", more.includes("t.common.unlimited"));
  }

  /* ===================== TIMEFRAMES ===================== */
  console.log("\nTIMEFRAMES");

  check("the client offers exactly 7/30/90", dump([...TIMEFRAMES]) === dump([7, 30, 90]));
  {
    const screen = codeOf("src/app/(app)/index.tsx");
    check("the default timeframe is 30 (web parity)", screen.includes("useState<Timeframe>(30)"));
    check("a timeframe change triggers an authoritative refetch", screen.includes("void load(timeframe)"));
    check("the request is keyed by timeframe for dedup", screen.includes("tracker.current.begin(String(tf))"));
    check("a stale response is discarded before it commits", screen.includes("tracker.current.isLatest(ticket.seq)"));
    check("the timeframe picker is a tablist", screen.includes('accessibilityRole="tablist"'));
  }

  /* ===================== ERROR / SAFETY ===================== */
  console.log("\nERROR HANDLING");

  {
    const screen = codeOf("src/app/(app)/index.tsx");
    const codes: ApiErrorCode[] = ["network", "timeout", "config", "server_error"];
    for (const c of codes) {
      check(`error ${c} maps to a fixed sentence`, screen.includes(`'${c}'`) || screen.includes("default:"));
    }
    check("a raw API error is never rendered", !screen.includes("state.error}") && !screen.includes("String(state.error)"));
    check("there is NO demo/mock data fallback",
      !screen.includes("mockDashboard") && !screen.includes("DEMO_") && !screen.includes("fallbackData"));
    check("a blocking error offers a retry", screen.includes("onRetry"));
    check("a failed refresh keeps content and shows the error beside it",
      screen.includes("state.status === 'error' && dashboard"));
    check("401 is delegated, never handled locally", screen.includes("isSessionInvalid(result.error)"));
    check("pull-to-refresh uses the native RefreshControl", screen.includes("RefreshControl"));
    check("refresh reloads the shell counters too", screen.includes("reloadShell({ refresh: true })"));
    check("there is no polling timer", !screen.includes("setInterval"));
  }
  {
    const files = [
      "src/api/shell.ts", "src/shell/shell-provider.tsx", "src/data/query.ts",
      "src/app/(app)/index.tsx", "src/app/(app)/more.tsx", "src/app/(app)/_layout.tsx",
      "src/components/dashboard/kpi-card.tsx", "src/components/dashboard/trend-chart.tsx",
    ];
    check("nothing in the shell logs", files.every((f) => !/console\.(log|warn|error|info|debug)/.test(codeOf(f))));
    check("no WebView anywhere in the shell", files.every((f) => !/WebView|iframe/.test(codeOf(f))));
    check("no token is placed in a URL", files.every((f) => !/[?&]token=/.test(codeOf(f))));
    // The dashboard URL must carry exactly one query parameter, and it must be
    // `timeframe` — no tenant, role or workspace may ever be sent by the client.
    const shellSrc = codeOf("src/api/shell.ts");
    const queryStrings = shellSrc.match(/\$\{SHELL_ROUTES\.dashboard\}\?([^`]*)/g) ?? [];
    check("the dashboard request sends exactly one query parameter",
      queryStrings.length === 1 && (queryStrings[0]!.match(/&/g) ?? []).length === 0);
    check("...and that parameter is `timeframe`", queryStrings[0]!.includes("timeframe=${timeframe}"));
    check("the client never sends a tenant/role/workspace",
      !/tenantId|workspaceKind|\brole\b/.test(shellSrc));
  }

  /* ===================== PERFORMANCE ===================== */
  console.log("\nPERFORMANCE");

  {
    const screen = codeOf("src/app/(app)/index.tsx");
    check("the dashboard is a ScrollView (bounded content), not a nested FlatList",
      screen.includes("<ScrollView") && !screen.includes("FlatList"));
    check("date formatters are built once, not per row", screen.includes("useMemo"));
    check("the client does not fetch raw comments to compute KPIs",
      !screen.includes("/comments") && !screen.includes("reputationItem"));
    check("no chart library is used — the trend is drawn with the existing SVG",
      codeOf("src/components/dashboard/trend-chart.tsx").includes("react-native-svg"));
    const pkg = JSON.parse(readSrc("package.json")) as { dependencies: Record<string, string> };
    check("no charting dependency was added",
      !Object.keys(pkg.dependencies).some((d) => /chart|victory|d3|gifted/i.test(d)));
    check("no state-management framework was added",
      !Object.keys(pkg.dependencies).some((d) => /redux|zustand|mobx|jotai|recoil|react-query|tanstack/i.test(d)));
  }

  /* ===================== M8C — SHELL FAILURE & RECOVERY ===================== */
  console.log("\nM8C — SHELL FAILURE & RECOVERY (defect 1)");

  {
    const B = () => initialQueryState<Bootstrap>();
    const boot = (over: Partial<Bootstrap> = {}): Bootstrap =>
      ({
        user: { name: "QA", email: "qa@tamanor.test" },
        workspace: { name: "Tamanor Mobile QA", kind: "business", demo: false },
        role: "owner",
        access: { state: "active", billingStatus: "active", trialDaysLeft: null, planName: "Growth", banner: null, canWrite: true },
        usage: { processedItems: { used: 0, limit: 500 }, accounts: { used: 2, limit: 1 } },
        counts: { pendingReview: 2, unreadNotifications: 5 },
        nav: { allowed: ["comments", "accounts", "alerts", "settings"] as NavKey[] },
        generatedAt: "2026-09-04T00:00:00.000Z",
        ...over,
      }) as Bootstrap;

    /* ---- phase ---- */
    check("S1) idle with no bootstrap → booting (never an error)",
      shellPhase(B()) === "booting");
    const firstLoad = queryReducer<Bootstrap>(B(), { type: "START" });
    check("S2) first load in flight → booting", shellPhase(firstLoad) === "booting");

    const failed = queryReducer<Bootstrap>(firstLoad, { type: "FAILURE", error: "timeout" });
    check("S3) bootstrap failed with no data → error (the defect-1 state is now named)",
      shellPhase(failed) === "error");
    check("S3b) the failure carries the bounded code, not raw text", failed.error === "timeout");

    const ready = queryReducer<Bootstrap>(firstLoad, { type: "SUCCESS", data: boot() });
    check("S4) bootstrap answered → ready", shellPhase(ready) === "ready");

    const staleAfterFailedReload = queryReducer<Bootstrap>(
      queryReducer<Bootstrap>(ready, { type: "START", refresh: true }),
      { type: "FAILURE", error: "network" },
    );
    check("S5) a failed RELOAD keeps the shell usable — the tab bar must not collapse",
      shellPhase(staleAfterFailedReload) === "ready" && staleAfterFailedReload.data !== null);

    /* ---- needsReload: what a screen-level retry should drag along ---- */
    check("S6) failed with no data → a screen retry reloads the shell too",
      shellNeedsReload(failed));
    check("S7) STALE (data + last reload failed) still needs a reload",
      shellNeedsReload(staleAfterFailedReload));
    check("S8) a HEALTHY shell is NOT reloaded by a dashboard retry",
      !shellNeedsReload(ready));
    check("S9) never-loaded idle shell needs a reload", shellNeedsReload(B()));
    check("S10) first load in flight still reports needsReload (provider dedupes)",
      shellNeedsReload(firstLoad));

    /* ---- recovery ---- */
    const retrying = queryReducer<Bootstrap>(failed, { type: "START" });
    check("S11) retrying leaves the error state — the user sees progress, not the error",
      shellPhase(retrying) === "booting" && retrying.error === null);

    const recovered = queryReducer<Bootstrap>(retrying, { type: "SUCCESS", data: boot() });
    check("S12) retry success → ready", shellPhase(recovered) === "ready");
    check("S13) recovery restores the ALLOWED NAVIGATION (not permanently empty)",
      (recovered.data?.nav.allowed ?? []).length === 4);
    check("S13b) the degraded two-tab shell is gone: comments/accounts/alerts all allowed",
      ["comments", "accounts", "alerts"].every((k) => recovered.data!.nav.allowed.includes(k as NavKey)));
    check("S14) recovery restores the WORKSPACE NAME",
      recovered.data?.workspace.name === "Tamanor Mobile QA");
    check("S15) recovery restores the SHELL BADGES",
      recovered.data?.counts.pendingReview === 2 && recovered.data?.counts.unreadNotifications === 5);
    check("S16) recovery restores PLAN + USAGE (the More screen's content)",
      recovered.data?.access.planName === "Growth" && recovered.data?.usage.accounts.used === 2);
    check("S17) recovery clears the error", recovered.error === null);

    /* ---- a stale loser must not overwrite a successful retry ---- */
    const lateFailure = queryReducer<Bootstrap>(recovered, { type: "FAILURE", error: "timeout" });
    check("S18) a late FAILURE cannot erase the recovered bootstrap",
      lateFailure.data !== null && shellPhase(lateFailure) === "ready");

    /* ---- fail closed: nothing is fabricated while failed ---- */
    check("S19) a failed shell exposes NO navigation",
      (failed.data?.nav.allowed ?? []).length === 0);
    check("S20) a failed shell exposes NO workspace name", failed.data === null);
  }

  {
    const provider = codeOf("src/shell/shell-provider.tsx");
    const layout = codeOf("src/app/(app)/_layout.tsx");
    const overview = codeOf("src/app/(app)/index.tsx");
    const shellState = codeOf("src/shell/shell-state.ts");

    check("S21) the provider exposes an explicit phase",
      /phase:\s*shellPhase\(state\)/.test(provider));
    check("S22) the provider exposes needsReload",
      /needsReload:\s*shellNeedsReload\(state\)/.test(provider));
    check("S23) the provider still exposes a reload operation", /reload:\s*load/.test(provider));
    check("S24) ONE bootstrap at a time — the overlapping-request guard survives",
      /if\s*\(inFlight\.current\)\s*return;/.test(provider));
    check("S25) a stale response still cannot commit (mounted guard retained)",
      provider.includes("if (!mounted.current) return;"));
    check("S26) 401/expired/revoked STILL goes to the canonical M2 auth path",
      /isSessionInvalid\(result\.error\)/.test(provider) && /onSessionRejected\(result\.error\)/.test(provider));
    check("S27) a missing token still signs out through the same path",
      /onSessionRejected\("unauthenticated"\)/.test(provider));

    check("S28) the app shell RENDERS the failure instead of a silent degraded tab bar",
      /phase === 'error'/.test(layout) && layout.includes("<ErrorState"));
    check("S29) the error branch returns BEFORE the tab navigator is built",
      layout.indexOf("phase === 'error'") < layout.indexOf("<Tabs"));
    check("S30) the shell error offers a retry that re-runs bootstrap",
      /onRetry=\{\(\) => void reload\(\)\}/.test(layout));
    check("S31) the shell error message comes from the bounded vocabulary, not raw text",
      /messageFor\(state\.error \?\? 'server_error'\)/.test(layout));
    check("S32) the shell never fabricates an allowed-nav fallback",
      !/allowedNav\s*=\s*\[['"]/.test(layout) && /allowedNav\.includes/.test(layout));

    check("S33) Overview's retry reloads the shell when the shell needs it",
      /shellNeedsReload \? reloadShell\(\)/.test(overview));
    check("S34) Overview's retry does NOT unconditionally reload a healthy shell",
      !/onRetry=\{\(\) => void reloadShell/.test(overview));
    check("S35) the error card uses the coordinated retry, not the bare dashboard load",
      /onRetry=\{\(\) => void retry\(\)\}/.test(overview));
    check("S36) pull-to-refresh keeps its own separate path (no retry loop)",
      /onRefresh=\{\(\) => void onRefresh\(\)\}/.test(overview));

    check("S37) the shell rules are pure functions, not React state",
      !shellState.includes("useState") && !shellState.includes("useEffect"));
    check("S38) no state framework was introduced for this",
      !/redux|zustand|jotai|tanstack|react-query/i.test(shellState + provider + layout));
    check("S39) no second navigation system was introduced",
      !layout.includes("createBottomTabNavigator") && !layout.includes("NavigationContainer"));
  }

  /* ===================== M8C — GENERIC ERROR TITLE ===================== */
  console.log("\nM8C — GENERIC ERROR TITLE (defect 2)");

  {
    const DICTS = { en, sk, de } as const;
    const DASHBOARD_WORDS = /dashboard|prehľad|prehlad/i;

    for (const [name, d] of Object.entries(DICTS)) {
      check(`E1-${name}) has a generic errors.title`,
        typeof d.errors.title === "string" && d.errors.title.length > 0);
      check(`E2-${name}) the GENERIC title no longer names the dashboard`,
        !DASHBOARD_WORDS.test(d.errors.title));
      check(`E3-${name}) has a dashboard-specific errorTitle`,
        typeof d.dashboard.errorTitle === "string" && d.dashboard.errorTitle.length > 0);
      check(`E4-${name}) the dashboard title still names the dashboard`,
        DASHBOARD_WORDS.test(d.dashboard.errorTitle));
      check(`E5-${name}) generic and dashboard titles are different strings`,
        d.errors.title !== d.dashboard.errorTitle);
    }

    check("E6) EN generic copy", en.errors.title === "Something went wrong");
    // The M8B defect string must survive ONLY as the dashboard's own title (E9).
    check("E7) SK generic copy", sk.errors.title === "Niečo sa nepodarilo");
    check("E8) DE generic copy", de.errors.title === "Etwas ist schiefgelaufen");
    check("E9) SK dashboard copy is preserved verbatim",
      sk.dashboard.errorTitle === "Nepodarilo sa načítať prehľad");
  }

  {
    // Every ErrorState in the app, and which title it is allowed to use.
    const GENERIC_SCREENS = [
      "src/app/(app)/accounts/[accountId].tsx",
      "src/app/(app)/accounts/index.tsx",
      "src/app/(app)/accounts/connect.tsx",
      "src/app/(app)/alerts/[id].tsx",
      "src/app/(app)/alerts/index.tsx",
      "src/app/(app)/comments/[id].tsx",
      "src/app/(app)/comments/index.tsx",
      "src/app/(app)/_layout.tsx",
    ];
    for (const rel of GENERIC_SCREENS) {
      const src = codeOf(rel);
      const screen = rel.split("/").pop();
      check(`E10-${screen}) uses the GENERIC title`, src.includes("title={t.errors.title}"));
      check(`E11-${screen}) does NOT use the dashboard title`,
        !src.includes("t.dashboard.errorTitle"));
    }
    const overview = codeOf("src/app/(app)/index.tsx");
    check("E12) Overview — and only Overview — keeps the dashboard-specific title",
      overview.includes("title={t.dashboard.errorTitle}") && !overview.includes("title={t.errors.title}"));
    check("E13) no hardcoded English error title was introduced",
      !GENERIC_SCREENS.concat("src/app/(app)/index.tsx").some((rel) =>
        /title="(Something|Couldn|Failed|Error)/.test(codeOf(rel))));
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — mobile shell + dashboard client (M3): ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
