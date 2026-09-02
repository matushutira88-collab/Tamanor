/**
 * M4 — mobile Inbox client.
 *
 * PURE tests in the existing harness. Possible because the Inbox rules were kept
 * out of React: the list reducer, the dedup/append logic, the view-membership rule
 * and the presentation mappers are all plain functions.
 *
 * The properties asserted are the ones that would be dangerous to get wrong:
 *   - a page append NEVER duplicates a row
 *   - a filter/view/search change resets the page chain
 *   - a failed refresh or load-more keeps the list
 *   - a mutation patches one row from the SERVER's state, and drops it when the
 *     row no longer belongs to the active view
 *   - no raw API error and no demo data ever reaches the UI
 *
 * Run: pnpm mobile-inbox-client:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  INBOX_ACTION_STATES, INBOX_PRIORITIES, INBOX_PROCESSING_STATES, INBOX_RISKS,
  INBOX_SENTIMENTS, INBOX_VIEWS, INBOX_WORKFLOWS, INBOX_AUDIT_EVENTS, CONNECTOR_HEALTH_STATES,
  CLASSIFICATION_STATES, INBOX_RANGES, INBOX_TYPES,
  type InboxFilters, type InboxItem, type InboxView,
} from "../src/api/types";
import { inboxQueryString } from "../src/api/inbox";
import {
  DEFAULT_FILTERS, activeFilterCount, appendUnique, belongsInView, clearedFilters,
  inboxReducer, initialInboxState, isBlockingError, isEmpty, isFilteredEmpty, isFirstLoad,
  isLoadingMore, isRefreshing, type InboxState,
} from "../src/inbox/inbox-state";
import {
  actionStateTone, classificationTone, connectorTone, isRatingOnlyReview, platformLabel,
  priorityTone, processingTone, riskTone, sentimentTone, shouldShowActionState,
  shouldShowConnector, shouldShowProcessing, workflowTone,
} from "../src/inbox/presentation";
import { consumeInboxStale, markInboxStale, resetInboxStale } from "../src/inbox/inbox-sync";
import { en } from "../src/i18n/en";
import { sk } from "../src/i18n/sk";
import { de } from "../src/i18n/de";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`);
  c ? pass++ : fail++;
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "..", rel), "utf8");
const codeOf = (rel: string) =>
  readSrc(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const dump = (o: unknown) => JSON.stringify(o);

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: "i1", type: "comment", preview: "This shop is a scam", author: "Jan",
  platform: "facebook", account: "Acme", createdAt: "2026-06-14T10:00:00.000Z",
  permalink: null, rating: null, sentiment: "risky", risk: "high",
  classification: "confirmed", categories: ["scam"], requiresReanalysis: false,
  isRead: false, archived: false, priority: "normal", workflow: "new",
  assignee: null, labels: [], noteCount: 0,
  actionState: "captured", processing: "processed_paid", connectorHealth: "healthy",
  ...over,
});

const counts = { total: 10, unread: 4, archived: 2, assigned: 1, unassigned: 5 };
const S = () => initialInboxState();
const success = (
  s: InboxState, items: InboxItem[], mode: "first" | "refresh" | "more" = "first",
  opts: { cursor?: string | null; hasMore?: boolean } = {},
) =>
  inboxReducer(s, {
    type: "LOAD_SUCCESS", mode, items,
    cursor: opts.cursor ?? null, hasMore: opts.hasMore ?? false, counts, canAct: true,
  });

async function run() {
  /* ===================== LIST STATE ===================== */
  console.log("\nLIST STATE");

  {
    const s0 = S();
    check("initial state is idle and empty", s0.phase === "idle" && s0.items.length === 0);
    const loading = inboxReducer(s0, { type: "LOAD_START", mode: "first" });
    check("first load blocks with a skeleton", isFirstLoad(loading));
    const ready = success(loading, [item()]);
    check("first page replaces the list", ready.items.length === 1 && ready.phase === "ready");
    check("counts are stored", ready.counts?.total === 10);
    check("canAct comes from the server", ready.canAct === true);
  }
  {
    const ready = success(S(), [item()]);
    const refreshing = inboxReducer(ready, { type: "LOAD_START", mode: "refresh" });
    check("refresh keeps rows on screen", isRefreshing(refreshing) && refreshing.items.length === 1);
    check("refresh is not a blocking load", !isFirstLoad(refreshing));
  }
  {
    const ready = success(S(), [item()], "first", { hasMore: true, cursor: "c1" });
    const more = inboxReducer(ready, { type: "LOAD_START", mode: "more" });
    check("load-more keeps rows and marks the footer", isLoadingMore(more) && more.items.length === 1);
  }
  {
    const first = success(S(), [item({ id: "a" })], "first", { hasMore: true, cursor: "c1" });
    const second = success(first, [item({ id: "b" })], "more");
    check("a page append MERGES rather than replacing", second.items.length === 2);
    check("order is preserved", dump(second.items.map((i) => i.id)) === dump(["a", "b"]));
  }
  {
    const first = success(S(), [item({ id: "a" }), item({ id: "b" })], "first", { hasMore: true });
    // The server re-sent "b" because it moved between reads.
    const second = success(first, [item({ id: "b" }), item({ id: "c" })], "more");
    check("a repeated row is DEDUPLICATED on append", second.items.length === 3);
    check("...keeping the first occurrence's position", dump(second.items.map((i) => i.id)) === dump(["a", "b", "c"]));
  }
  {
    const ready = success(S(), [item({ id: "a" })], "first", { hasMore: true });
    const refreshed = success(ready, [item({ id: "z" })], "refresh");
    check("a refresh REPLACES rather than appending", dump(refreshed.items.map((i) => i.id)) === dump(["z"]));
  }
  check("appendUnique is a no-op for an empty page", appendUnique([item()], []).length === 1);
  check("appendUnique drops a wholly duplicate page",
    appendUnique([item({ id: "a" })], [item({ id: "a" })]).length === 1);

  /* --------------------- failures --------------------- */
  {
    const failed = inboxReducer(inboxReducer(S(), { type: "LOAD_START", mode: "first" }), {
      type: "LOAD_FAILURE", mode: "first", error: "network",
    });
    check("a failed FIRST load is a blocking error", isBlockingError(failed));
    check("...with the bounded code retained", failed.error === "network");
  }
  {
    const ready = success(S(), [item()]);
    const failed = inboxReducer(inboxReducer(ready, { type: "LOAD_START", mode: "refresh" }), {
      type: "LOAD_FAILURE", mode: "refresh", error: "network",
    });
    check("a failed REFRESH keeps the list", failed.items.length === 1 && !isBlockingError(failed));
    check("...and does not clear a valid list", failed.phase === "ready");
  }
  {
    const ready = success(S(), [item()], "first", { hasMore: true });
    const failed = inboxReducer(inboxReducer(ready, { type: "LOAD_START", mode: "more" }), {
      type: "LOAD_FAILURE", mode: "more", error: "server_error",
    });
    check("a failed load-more keeps the list", failed.items.length === 1);
    check("...and flags a retryable footer", failed.loadMoreFailed === true && failed.phase === "ready");
    const retrying = inboxReducer(failed, { type: "LOAD_START", mode: "more" });
    check("retrying clears the footer failure", retrying.loadMoreFailed === false);
  }
  {
    const ready = success(S(), [item()], "first", { hasMore: true, cursor: "c1" });
    const reset = inboxReducer(ready, { type: "RESET" });
    check("RESET clears rows", reset.items.length === 0);
    check("RESET clears the cursor chain", reset.cursor === null && reset.hasMore === false);
    check("RESET preserves the server's canAct verdict", reset.canAct === true);
  }
  {
    const empty = success(S(), []);
    check("a successful empty page is EMPTY, not an error", isEmpty(empty) && !isBlockingError(empty));
  }

  /* ===================== MUTATION RECONCILIATION ===================== */
  console.log("\nMUTATION RECONCILIATION");

  {
    const ready = success(S(), [item({ id: "a", isRead: false }), item({ id: "b" })]);
    const patched = inboxReducer(ready, {
      type: "ITEM_PATCHED", item: item({ id: "a", isRead: true }), view: "default",
    });
    check("a patched row is replaced in place", patched.items[0]!.isRead === true);
    check("...and other rows are untouched", patched.items.length === 2 && patched.items[1]!.id === "b");
  }
  {
    const ready = success(S(), [item({ id: "a" }), item({ id: "b" })]);
    const archived = inboxReducer(ready, {
      type: "ITEM_PATCHED", item: item({ id: "a", archived: true }), view: "default",
    });
    check("archiving REMOVES the row from the default view", archived.items.length === 1);
    check("...leaving the rest", archived.items[0]!.id === "b");
  }
  {
    const ready = success(S(), [item({ id: "a", archived: true })]);
    const unarchived = inboxReducer(ready, {
      type: "ITEM_PATCHED", item: item({ id: "a", archived: false }), view: "archived",
    });
    check("un-archiving removes the row from the ARCHIVED view", unarchived.items.length === 0);
  }
  {
    const ready = success(S(), [item({ id: "a", isRead: false })]);
    const read = inboxReducer(ready, {
      type: "ITEM_PATCHED", item: item({ id: "a", isRead: true }), view: "unread",
    });
    check("marking read removes the row from the UNREAD view", read.items.length === 0);
  }
  {
    const ready = success(S(), [item({ id: "a" })]);
    const patched = inboxReducer(ready, {
      type: "ITEM_PATCHED", item: item({ id: "a", priority: "urgent" }), view: "default",
    });
    check("a priority change KEEPS the row", patched.items.length === 1 && patched.items[0]!.priority === "urgent");
  }
  {
    const ready = success(S(), [item({ id: "a" })]);
    const unknown = inboxReducer(ready, {
      type: "ITEM_PATCHED", item: item({ id: "ghost" }), view: "default",
    });
    check("patching an id not in the list is a no-op", unknown.items.length === 1 && unknown.items[0]!.id === "a");
  }
  // View membership, matching the server's where-builder.
  check("archived view holds only archived", belongsInView(item({ archived: true }), "archived") && !belongsInView(item(), "archived"));
  check("unread view excludes read", !belongsInView(item({ isRead: true }), "unread"));
  check("unread view excludes archived", !belongsInView(item({ isRead: false, archived: true }), "unread"));
  for (const view of ["default", "assigned_me", "unassigned"] as InboxView[]) {
    check(`${view} view hides archived`, !belongsInView(item({ archived: true }), view));
  }

  /* ===================== FILTERS ===================== */
  console.log("\nFILTERS");

  check("defaults count as no active filters", activeFilterCount(DEFAULT_FILTERS) === 0);
  check("a date range counts", activeFilterCount({ ...DEFAULT_FILTERS, range: "7d" }) === 1);
  check("each narrowing counts once",
    activeFilterCount({ ...DEFAULT_FILTERS, risk: "high", priority: "urgent", type: "review" }) === 3);
  check("a view change is NOT an advanced filter", activeFilterCount({ ...DEFAULT_FILTERS, view: "unread" }) === 0);
  check("a search alone is not an advanced filter", activeFilterCount({ ...DEFAULT_FILTERS, q: "scam" }) === 0);
  check("but a search DOES make an empty result 'filtered'", isFilteredEmpty({ ...DEFAULT_FILTERS, q: "scam" }));
  check("no filters + no search is not 'filtered'", !isFilteredEmpty(DEFAULT_FILTERS));
  {
    const messy: InboxFilters = { ...DEFAULT_FILTERS, view: "unread", q: "scam", risk: "high", range: "7d", priority: "urgent" };
    const cleared = clearedFilters(messy);
    check("clearing removes every advanced narrowing", activeFilterCount(cleared) === 0);
    check("...but PRESERVES the view", cleared.view === "unread");
    check("...and preserves the search", cleared.q === "scam");
  }

  /* ===================== QUERY BUILDING ===================== */
  console.log("\nQUERY BUILDING");

  {
    const qs = inboxQueryString(DEFAULT_FILTERS, null);
    check("defaults send view + range only", qs === "view=default&range=all");
    check("no null filter is sent", !qs.includes("null"));
  }
  {
    const qs = inboxQueryString({ ...DEFAULT_FILTERS, risk: "high", q: "scam & co" }, "CURSOR1");
    check("applied filters are sent", qs.includes("risk=high"));
    check("the search term is URL-encoded", qs.includes("q=scam%20%26%20co"));
    check("the cursor is forwarded verbatim", qs.includes("cursor=CURSOR1"));
  }
  {
    const src = codeOf("src/api/inbox.ts");
    check("the client never sends a tenant/user/role", !/tenantId|userId|\brole\b|canWrite/.test(src));
    check("the cursor is never constructed client-side", !src.includes("btoa") && !src.includes("base64"));
    check("provider write actions are not expressible", !/["']hide["']|["']delete["']|["']reply["']|["']ban["']/.test(src));
  }

  /* ===================== PRESENTATION MAPPING ===================== */
  console.log("\nPRESENTATION MAPPING");

  for (const v of INBOX_RISKS) check(`risk ${v} has a tone + label in all locales`,
    !!riskTone(v) && [en, sk, de].every((d) => typeof d.inbox.risk[v] === "string"));
  for (const v of INBOX_SENTIMENTS) check(`sentiment ${v} maps`,
    !!sentimentTone(v) && [en, sk, de].every((d) => typeof d.inbox.sentiment[v] === "string"));
  for (const v of INBOX_WORKFLOWS) check(`workflow ${v} maps`,
    !!workflowTone(v) && [en, sk, de].every((d) => typeof d.inbox.workflow[v] === "string"));
  for (const v of INBOX_PRIORITIES) check(`priority ${v} maps`,
    !!priorityTone(v) && [en, sk, de].every((d) => typeof d.inbox.priority[v] === "string"));
  for (const v of INBOX_PROCESSING_STATES) check(`processing ${v} maps`,
    !!processingTone(v) && [en, sk, de].every((d) => typeof d.inbox.processing[v] === "string"));
  for (const v of CONNECTOR_HEALTH_STATES) check(`connector ${v} maps`,
    !!connectorTone(v) && [en, sk, de].every((d) => typeof d.inbox.connector[v] === "string"));
  for (const v of INBOX_ACTION_STATES) check(`action state ${v} maps`,
    !!actionStateTone(v) && [en, sk, de].every((d) => typeof d.inbox.actionState[v] === "string"));
  for (const v of CLASSIFICATION_STATES) check(`classification ${v} maps`,
    !!classificationTone(v) && [en, sk, de].every((d) => typeof d.inbox.classification[v] === "string"));
  for (const v of INBOX_VIEWS) check(`view ${v} has a label in all locales`,
    [en, sk, de].every((d) => typeof d.inbox.views[v] === "string"));
  for (const v of INBOX_RANGES) check(`range ${v} has a label in all locales`,
    [en, sk, de].every((d) => typeof d.inbox.range[v] === "string"));
  for (const v of INBOX_TYPES) check(`type ${v} has a label in all locales`,
    [en, sk, de].every((d) => typeof d.inbox.type[v] === "string"));
  for (const v of INBOX_AUDIT_EVENTS) check(`audit ${v} has a label in all locales`,
    [en, sk, de].every((d) => typeof (d.audit as Record<string, string>)[v] === "string"));

  // Every mapper is TOTAL: an unknown key from a future server can never crash or
  // be rendered raw.
  for (const junk of ["", "UNKNOWN", "critical_extreme", "__proto__", "quantum"]) {
    check(`unknown key ${dump(junk)} degrades to neutral`,
      riskTone(junk) === "neutral" && workflowTone(junk) === "neutral" &&
      processingTone(junk) === "neutral" && connectorTone(junk) === "neutral" &&
      actionStateTone(junk) === "neutral" && priorityTone(junk) === "neutral");
  }
  check("an unknown platform falls back to its key", platformLabel("threads") === "threads");
  check("a known platform gets a display label", platformLabel("google_business") === "Google Business");

  /* --------------------- truthful processing --------------------- */
  check("a paid-analysed row reads as success", processingTone("processed_paid") === "success");
  for (const limited of ["basic_limit_reached", "premium_limit_reached", "paid_ai_disabled", "failed"] as const) {
    check(`${limited} is NEVER shown as success`, processingTone(limited) !== "success");
    check(`${limited} is surfaced to the user`, shouldShowProcessing(limited));
  }
  check("a normally-analysed row does not add a chip", !shouldShowProcessing("processed_paid"));
  check("a healthy connector adds no chip", !shouldShowConnector("healthy"));
  for (const bad of ["disconnected", "permission_missing", "error", "rate_limited"] as const) {
    check(`connector ${bad} is surfaced`, shouldShowConnector(bad));
  }
  check("the resting action state adds no chip",
    !shouldShowActionState("captured") && !shouldShowActionState("kept"));
  for (const notable of ["deleted", "hidden", "cannot_hide", "pending"] as const) {
    check(`action state ${notable} is surfaced`, shouldShowActionState(notable));
  }
  check("an English limit label states the truth",
    en.inbox.processing.premium_limit_reached.toLowerCase().includes("not ai analysed"));

  /* --------------------- reviews --------------------- */
  check("a rating-only review is detected", isRatingOnlyReview({ type: "review", preview: null, rating: 3 }));
  check("a review WITH text is not rating-only", !isRatingOnlyReview({ type: "review", preview: "Good", rating: 5 }));
  check("a comment is never rating-only", !isRatingOnlyReview({ type: "comment", preview: null, rating: null }));
  check("a rating-only review has localized copy in all locales",
    [en, sk, de].every((d) => typeof d.inbox.ratingOnly === "string" && d.inbox.ratingOnly.length > 0));

  /* ===================== LIST/DETAIL SYNC ===================== */
  console.log("\nLIST/DETAIL SYNC");

  {
    resetInboxStale();
    check("nothing to reconcile by default", consumeInboxStale() === false);
    markInboxStale();
    check("a detail mutation flags the list", consumeInboxStale() === true);
    check("...and the flag is consumed exactly once", consumeInboxStale() === false);
    markInboxStale();
    markInboxStale();
    check("repeated marks collapse to one refresh", consumeInboxStale() === true && consumeInboxStale() === false);
    resetInboxStale();
  }
  {
    const detail = codeOf("src/app/(app)/comments/[id].tsx");
    const list = codeOf("src/app/(app)/comments/index.tsx");
    check("the detail flags the list after a SUCCESSFUL mutation", detail.includes("markInboxStale()"));
    check("the list reconciles on focus", list.includes("useFocusEffect") && list.includes("consumeInboxStale()"));
    check("a focus with no change costs no request", list.includes("if (consumeInboxStale())"));
  }

  /* ===================== LOCALIZATION ===================== */
  console.log("\nLOCALIZATION");

  {
    // The whole dictionary shape must match — a missing key renders `undefined`.
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
      check(`${name} implements every English key (incl. inbox + auth)`, missing.length === 0, missing.slice(0, 3).join(", "));
    }
  }
  // M3 carried gap: the login screen was English on a Slovak/German device.
  {
    const login = codeOf("src/app/(auth)/login.tsx");
    check("login uses the dictionary", login.includes("t.auth."));
    for (const literal of ["Sign in to Tamanor", "Keep me signed in", "Your password", "you@company.com"]) {
      check(`login no longer hardcodes ${dump(literal)}`, !login.includes(literal));
    }
    const verify = codeOf("src/app/(auth)/verify-email.tsx");
    check("verify-email is localized", verify.includes("t.auth.") && !verify.includes("Verify your email"));
    const unsupported = codeOf("src/app/(auth)/unsupported-workspace.tsx");
    check("unsupported-workspace is localized", unsupported.includes("t.auth.") && !unsupported.includes("Workspace not available"));
    check("auth strings exist in every locale",
      [en, sk, de].every((d) => typeof d.auth.signInTitle === "string" && d.auth.signInTitle.length > 0));
    check("the three locales genuinely differ", en.auth.signInTitle !== sk.auth.signInTitle && sk.auth.signInTitle !== de.auth.signInTitle);
  }

  /* ===================== SCREEN GUARDS ===================== */
  console.log("\nSCREEN GUARDS");

  {
    const list = codeOf("src/app/(app)/comments/index.tsx");
    const detail = codeOf("src/app/(app)/comments/[id].tsx");
    const hook = codeOf("src/inbox/use-inbox.ts");

    check("the list is a virtualized FlatList", list.includes("<FlatList"));
    check("the list has a stable keyExtractor", list.includes("keyExtractor={(item) => item.id}"));
    check("rows are memoized", codeOf("src/components/inbox/inbox-row.tsx").includes("memo("));
    check("pagination is driven by onEndReached", list.includes("onEndReached"));
    check("pull-to-refresh uses RefreshControl", list.includes("RefreshControl"));
    check("row rendering is bounded", list.includes("initialNumToRender") && list.includes("windowSize"));

    check("search is debounced", hook.includes("SEARCH_DEBOUNCE_MS") && hook.includes("setTimeout"));
    check("search length is bounded", hook.includes("MAX_SEARCH_LENGTH"));
    check("requests are abortable", hook.includes("AbortController") && hook.includes(".abort()"));
    check("stale responses cannot commit", hook.includes("ticket !== seq.current"));
    check("a duplicate load-more is refused", hook.includes('phase === "loading_more"'));
    check("a filter change resets the page chain", hook.includes('dispatch({ type: "RESET" })'));
    check("one mutation per row at a time", hook.includes("pendingIds.includes(itemId)"));
    check("401 is delegated to the M2 auth machine", hook.includes("onSessionRejected"));
    check("the shell badge is reconciled after read/archive", hook.includes("reloadShell"));
    check("...but NOT after a harmless field change", hook.includes('action !== "priority"'));
    check("no polling timer", !hook.includes("setInterval"));

    check("no raw API error is rendered",
      !list.includes("{state.error}") && !detail.includes("{error}") && !detail.includes("String(error)"));
    check("there is NO demo/mock fallback",
      [list, detail, hook].every((s) => !/mockItems|DEMO_|fallbackData|sampleInbox/.test(s)));
    check("no client-side filtering of the loaded page",
      !list.includes("items.filter(") && !list.includes(".filter((i) =>"));
    check("nothing in the Inbox path logs",
      [list, detail, hook, codeOf("src/api/inbox.ts"), codeOf("src/inbox/inbox-state.ts")]
        .every((s) => !/console\.(log|warn|error|info|debug)/.test(s)));
    check("no WebView anywhere in the Inbox", [list, detail].every((s) => !/WebView|iframe/.test(s)));

    check("the detail opens links via Linking, not a WebView", detail.includes("Linking.openURL"));
    check("...and checks the URL can be opened first", detail.includes("canOpenURL"));
    check("the detail exposes no provider write action",
      !/['"]hide['"]|['"]delete['"]|['"]reply['"]|['"]ban['"]/.test(detail));
    check("mutation controls are gated on the SERVER's canAct", detail.includes("!canAct"));
    check("a busy mutation disables its controls", detail.includes("disabled={busy}"));
    check("archive copy distinguishes it from provider delete", en.detail.archiveNote.toLowerCase().includes("does not delete"));
    check("no bulk/multi-select UI shipped",
      [list, detail].every((s) => !/selectedIds|bulk|multiSelect/i.test(s)));
  }
  {
    const layout = codeOf("src/app/(app)/comments/_layout.tsx");
    check("comments is a nested Stack (detail pushes above the tabs)", layout.includes("<Stack"));
    check("the nested stack does not re-declare tabs", !layout.includes("Tabs"));
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — mobile Inbox client (M4): ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
