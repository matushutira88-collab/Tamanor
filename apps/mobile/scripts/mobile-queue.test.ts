/**
 * M5 — mobile Action Queue client.
 *
 * PURE tests in the existing harness. Possible because every queue rule was kept out
 * of React: the list reducer, tab membership, the presentation mappers and the query
 * builder are plain functions.
 *
 * The PROVIDER-WRITE BOUNDARY is asserted FIRST and by source inspection, because it
 * is the one property whose violation would be unsafe rather than merely wrong: no
 * mobile queue module may name a provider, a provider SDK, a hide/delete/reply/report
 * call, a live-execution control, a retry or a rollback.
 *
 * The other properties asserted are those that would be dangerous to get wrong:
 *   - a decision and a platform execution never collapse into one state
 *   - a page append NEVER duplicates a row
 *   - a tab change resets the page chain
 *   - a failed refresh or load-more keeps the list
 *   - a decision patches one row from the SERVER's state and drops it when the row
 *     no longer belongs to the active tab; counts come from the server
 *   - no raw API error and no demo data ever reaches the UI
 *   - en / sk / de cover the full bounded vocabulary
 *
 * Run: pnpm mobile-queue-client:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  EXECUTION_STATUSES, LIFECYCLE_STATES, PROPOSED_ACTIONS, QUEUE_AUDIT_EVENTS,
  QUEUE_DECISIONS, QUEUE_REASONS, QUEUE_STATES, QUEUE_TABS, READINESS_STATES,
  type QueueCounts, type QueueItem, type QueueTab,
} from "../src/api/types";
import { QUEUE_ROUTES, queueQueryString } from "../src/api/queue";
import {
  appendUnique, belongsInTab, initialQueueState, isBlockingError, isEmpty, isFirstLoad,
  isLoadingMore, isRefreshing, queueReducer, type QueueState,
} from "../src/queue/queue-state";
import {
  executionSummary, executionTone, lifecycleTone, needsDecision, platformLabel,
  proposedActionTone, queueStateTone, readinessTone, riskTone, shouldShowLifecycle,
  shouldShowReadiness,
} from "../src/queue/presentation";
import { consumeQueueStale, markQueueStale, resetQueueStale } from "../src/queue/queue-sync";
import { mapErrorPayload, isSessionInvalid } from "../src/api/client";
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
/** Source with comments stripped — assertions must not match prose. */
const codeOf = (rel: string) =>
  readSrc(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const dump = (o: unknown) => JSON.stringify(o);

/** Every mobile module that participates in the Action Queue. */
const QUEUE_MODULES = [
  "src/api/queue.ts",
  "src/queue/queue-state.ts",
  "src/queue/queue-sync.ts",
  "src/queue/presentation.ts",
  "src/queue/use-queue.ts",
  "src/components/queue/queue-row.tsx",
  "src/components/queue/decision-sheet.tsx",
  "src/app/(app)/alerts/_layout.tsx",
  "src/app/(app)/alerts/index.tsx",
  "src/app/(app)/alerts/[id].tsx",
];

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: "q1",
  relatedInboxItemId: "i1",
  proposedAction: "hide_comment",
  queueState: "approval_required",
  category: "harassment",
  reason: null,
  createdAt: "2026-01-05T10:00:00.000Z",
  contentPreview: "preview",
  contentType: "comment",
  author: "Someone",
  platform: "facebook",
  account: "Page",
  rating: null,
  risk: "high",
  execution: null,
  lifecycle: "visible",
  canApprove: true,
  canReject: true,
  canResolve: true,
  ...over,
});

const counts = (over: Partial<QueueCounts> = {}): QueueCounts =>
  ({ active: 3, approval: 2, blocked: 1, ...over });

const ready = (items: QueueItem[], over: Partial<QueueState> = {}): QueueState => ({
  ...initialQueueState(), phase: "ready", items, counts: counts(), canDecide: true, ...over,
});

/* -------------------------------------------------------------------------- */
/* 1. PROVIDER-WRITE BOUNDARY — asserted first                                 */
/* -------------------------------------------------------------------------- */

console.log("\n1. Provider-write boundary");

/**
 * Provider identities and SDKs. A queue module may name a platform only through the
 * display-label table in `presentation.ts`, which is checked separately below.
 */
const PROVIDER_SDK_TOKENS = [
  "graph.facebook", "graph.instagram", "googleapis", "fb-sdk", "facebook-nodejs",
  "instagram-api", "tiktok-api", "mybusiness", "OAuth", "oauth", "access_token",
  "page_token", "pageAccessToken", "connectedAccount", "providerToken",
];
for (const token of PROVIDER_SDK_TOKENS) {
  const offenders = QUEUE_MODULES.filter((m) => codeOf(m).includes(token));
  check(`no queue module references "${token}"`, offenders.length === 0, dump(offenders));
}

/** Provider MUTATIONS. These verbs must never appear as callable names. */
const PROVIDER_CALL_PATTERNS: [string, RegExp][] = [
  ["attemptFacebookHide", /attemptFacebookHide/],
  ["hideComment(", /hideComment\s*\(/],
  ["deleteComment", /deleteComment/],
  ["replyToComment", /replyToComment/],
  ["postReply", /postReply/],
  ["publishReply", /publishReply/],
  ["reportToProvider", /reportTo[A-Z]\w*/],
  ["executeLive", /executeLive/],
  ["performRollback", /performRollback|rollbackExecution/],
  ["retryExecution", /retryExecution|retryQueueItem|retryLive/],
];
for (const [label, re] of PROVIDER_CALL_PATTERNS) {
  const offenders = QUEUE_MODULES.filter((m) => re.test(codeOf(m)));
  check(`no queue module calls ${label}`, offenders.length === 0, dump(offenders));
}

/** The M5 live-hide confirmation UI must not be reproduced on mobile. */
for (const phrase of ["LIVE HIDE", "liveConfirm", "confirmationPhrase", "confirmPhrase"]) {
  const offenders = QUEUE_MODULES.filter((m) => codeOf(m).includes(phrase));
  check(`no queue module reproduces "${phrase}"`, offenders.length === 0, dump(offenders));
}

/** The decision vocabulary itself is the structural guarantee. */
check(
  "QUEUE_DECISIONS is exactly approve/reject/resolve",
  dump(QUEUE_DECISIONS) === dump(["approve", "reject", "resolve"]),
  dump(QUEUE_DECISIONS),
);
for (const forbidden of ["hide", "delete", "reply", "report", "execute", "retry", "rollback"]) {
  check(
    `QUEUE_DECISIONS has no "${forbidden}" member`,
    !(QUEUE_DECISIONS as readonly string[]).includes(forbidden),
  );
}

/** The client can only reach the three mobile queue routes. */
const queueSrc = codeOf("src/api/queue.ts");
check("queue client exposes exactly three routes", Object.keys(QUEUE_ROUTES).length === 3, dump(QUEUE_ROUTES));
check(
  "every queue route is under /api/mobile/action-queue",
  QUEUE_ROUTES.list === "/api/mobile/action-queue"
    && QUEUE_ROUTES.item("x").startsWith("/api/mobile/action-queue/")
    && QUEUE_ROUTES.decision("x").endsWith("/decision"),
  dump([QUEUE_ROUTES.list, QUEUE_ROUTES.item("x"), QUEUE_ROUTES.decision("x")]),
);
check("queue client issues only GET and POST", !/method:\s*"(PUT|PATCH|DELETE)"/.test(queueSrc));
check(
  "queue client never sends tenant / workspace / role / permission",
  !/tenantId|workspaceId|\brole\b|permission/i.test(queueSrc),
);

/** Rollback appears only as canonical STATE names, never as a control. */
const rollbackOffenders: string[] = [];
for (const m of QUEUE_MODULES) {
  for (const hit of codeOf(m).match(/rollback\w*/gi) ?? []) {
    if (!["rollback_needed", "rollback_pending", "rolled_back", "rollbackPending"].includes(hit)) {
      rollbackOffenders.push(`${m}:${hit}`);
    }
  }
}
check("rollback appears only as a state name", rollbackOffenders.length === 0, dump(rollbackOffenders));

/** Platform names appear only as display labels. */
const labelOnly = codeOf("src/queue/presentation.ts");
check(
  "platform names live only in the label table",
  /PLATFORM_LABEL/.test(labelOnly)
    && QUEUE_MODULES.filter((m) => m !== "src/queue/presentation.ts")
      .every((m) => !/["']facebook["']|["']instagram["']|["']tiktok["']/.test(codeOf(m))),
);

/* -------------------------------------------------------------------------- */
/* 2. Decision and execution are never merged                                  */
/* -------------------------------------------------------------------------- */

console.log("\n2. Decision vs platform execution");

{
  // The dangerous case: approved in Tamanor, but only a dry run on the platform.
  const approvedDryRun = item({
    queueState: "approved",
    execution: { status: "dry_run", trigger: "approval", reason: "dry_run_mode", at: "2026-01-05T11:00:00.000Z" },
    lifecycle: "visible",
  });
  const s = executionSummary(approvedDryRun);
  check("approved + dry_run keeps the decision state", s.decisionState === "approved", dump(s));
  check("approved + dry_run reports the platform status separately", s.platformStatus === "dry_run", dump(s));
  check("approved + dry_run did NOT change public content", s.publicallyChanged === false, dump(s));

  const never = item({ queueState: "approved", execution: null });
  check("no execution reports a null platform status", executionSummary(never).platformStatus === null);
  check("no execution never claims a public change", executionSummary(never).publicallyChanged === false);

  const hidden = item({
    queueState: "executed", lifecycle: "hidden",
    execution: { status: "executed", trigger: "autonomous", reason: null, at: "2026-01-05T11:00:00.000Z" },
  });
  const hs = executionSummary(hidden);
  check("an executed hide reports a public change", hs.publicallyChanged === true, dump(hs));
  check("an executed hide preserves the trigger", hs.platformTrigger === "autonomous", dump(hs));
}

check("a safety block is not styled as a failure", executionTone("blocked") === "neutral");
check("a failed execution is styled as a danger", executionTone("failed") === "danger");
check("a dry run is not styled as a success", executionTone("dry_run") !== "success");

/* -------------------------------------------------------------------------- */
/* 3. Presentation mappers are total and prototype-safe                        */
/* -------------------------------------------------------------------------- */

console.log("\n3. Presentation mappers");

const TONES = ["neutral", "brand", "success", "warning", "danger"];
const mappers: [string, (v: string) => string, readonly string[]][] = [
  ["queueStateTone", queueStateTone, QUEUE_STATES],
  ["executionTone", executionTone, EXECUTION_STATUSES],
  ["readinessTone", readinessTone, READINESS_STATES],
  ["lifecycleTone", lifecycleTone, LIFECYCLE_STATES],
  ["proposedActionTone", proposedActionTone, PROPOSED_ACTIONS],
];
for (const [name, fn, keys] of mappers) {
  check(`${name} covers every key`, keys.every((k) => TONES.includes(fn(k))));
  check(`${name} degrades an unknown key to neutral`, fn("something_new") === "neutral");
  // The M4 prototype-lookup bug, guarded here too.
  check(`${name} is prototype-safe`, fn("__proto__") === "neutral" && fn("constructor") === "neutral");
  check(`${name} handles an empty key`, fn("") === "neutral");
}
check("riskTone handles null", riskTone(null) === "neutral");
check("riskTone maps critical to danger", riskTone("critical") === "danger");
check("riskTone is prototype-safe", riskTone("__proto__") === "neutral");

check("platformLabel handles null", platformLabel(null) === null);
check("platformLabel falls back to the raw key", platformLabel("new_network") === "new_network");
check("platformLabel is prototype-safe", typeof platformLabel("__proto__") === "string");

check("needsDecision is true only when awaiting approval AND permitted",
  needsDecision({ queueState: "approval_required", canApprove: true }) === true);
check("needsDecision is false without permission",
  needsDecision({ queueState: "approval_required", canApprove: false }) === false);
check("needsDecision is false for a failed item",
  needsDecision({ queueState: "failed", canApprove: true }) === false);
check("needsDecision is false for a safety block",
  needsDecision({ queueState: "blocked_by_safety", canApprove: true }) === false);

check("lifecycle noise is hidden", !shouldShowLifecycle("unknown") && !shouldShowLifecycle("visible"));
check("a hidden lifecycle is surfaced", shouldShowLifecycle("hidden"));
check("readiness is hidden when not applicable", !shouldShowReadiness("not_applicable"));
check("readiness is surfaced when blocked", shouldShowReadiness("blocked"));

/* -------------------------------------------------------------------------- */
/* 4. Query string                                                             */
/* -------------------------------------------------------------------------- */

console.log("\n4. Query string");

check("tab is always sent", queueQueryString("approval", null) === "tab=approval");
check("cursor is appended when present",
  queueQueryString("active", "abc.def") === "tab=active&cursor=abc.def");
check("a cursor is URL-encoded", queueQueryString("all", "a b&c=d").includes("cursor=a%20b%26c%3Dd"));
check("a null cursor sends no cursor param", !queueQueryString("all", null).includes("cursor"));
check("an empty cursor sends no cursor param", !queueQueryString("all", "").includes("cursor"));
for (const tab of QUEUE_TABS) {
  check(`tab "${tab}" round-trips`, queueQueryString(tab, null) === `tab=${tab}`);
}

/* -------------------------------------------------------------------------- */
/* 5. Reducer — paging                                                         */
/* -------------------------------------------------------------------------- */

console.log("\n5. Reducer: paging");

{
  const s0 = initialQueueState();
  check("initial state is idle and empty", s0.phase === "idle" && s0.items.length === 0);
  check("initial state cannot decide", s0.canDecide === false);

  const loading = queueReducer(s0, { type: "LOAD_START", mode: "first" });
  check("a first load is 'loading'", loading.phase === "loading");
  check("isFirstLoad is true only with no items", isFirstLoad(loading));

  const page1 = queueReducer(loading, {
    type: "LOAD_SUCCESS", mode: "first",
    items: [item({ id: "a" }), item({ id: "b" })],
    cursor: "cur1", hasMore: true, counts: counts(), canDecide: true,
  });
  check("a first page replaces the list", dump(page1.items.map((i) => i.id)) === dump(["a", "b"]));
  check("a first page stores the cursor", page1.cursor === "cur1" && page1.hasMore);
  check("a first page adopts the server's canDecide", page1.canDecide === true);

  const more = queueReducer(page1, {
    type: "LOAD_SUCCESS", mode: "more",
    items: [item({ id: "b" }), item({ id: "c" })],
    cursor: null, hasMore: false, counts: counts(), canDecide: true,
  });
  check("a page append never duplicates", dump(more.items.map((i) => i.id)) === dump(["a", "b", "c"]));
  check("the end of the list clears hasMore", more.hasMore === false && more.cursor === null);

  check("appendUnique returns the same array when nothing is new",
    appendUnique(page1.items, [item({ id: "a" })]) === page1.items);
  check("appendUnique returns the same array for an empty page",
    appendUnique(page1.items, []) === page1.items);
}

/* -------------------------------------------------------------------------- */
/* 6. Reducer — failures never destroy a list                                  */
/* -------------------------------------------------------------------------- */

console.log("\n6. Reducer: failures");

{
  const s = ready([item({ id: "a" })], { hasMore: true, cursor: "c" });

  const refreshFailed = queueReducer(
    queueReducer(s, { type: "LOAD_START", mode: "refresh" }),
    { type: "LOAD_FAILURE", mode: "refresh", error: "network" },
  );
  check("a failed refresh keeps the list", refreshFailed.items.length === 1);
  check("a failed refresh stays 'ready'", refreshFailed.phase === "ready");
  check("a failed refresh is not a blocking error", !isBlockingError(refreshFailed));

  const emptyFailed = queueReducer(
    queueReducer(initialQueueState(), { type: "LOAD_START", mode: "first" }),
    { type: "LOAD_FAILURE", mode: "first", error: "server_error" },
  );
  check("a failed first load with no items IS blocking", isBlockingError(emptyFailed));

  const moreFailed = queueReducer(
    queueReducer(s, { type: "LOAD_START", mode: "more" }),
    { type: "LOAD_FAILURE", mode: "more", error: "timeout" },
  );
  check("a failed load-more keeps the list", moreFailed.items.length === 1);
  check("a failed load-more flags itself", moreFailed.loadMoreFailed === true);
  check("a failed load-more keeps the cursor", moreFailed.cursor === "c" && moreFailed.hasMore);

  check("isRefreshing only during a refresh with items",
    isRefreshing(queueReducer(s, { type: "LOAD_START", mode: "refresh" })));
  check("isLoadingMore during a load-more",
    isLoadingMore(queueReducer(s, { type: "LOAD_START", mode: "more" })));
  check("isEmpty only when ready, empty and error-free", isEmpty(ready([])));
  check("isEmpty is false while an error stands", !isEmpty(ready([], { error: "network" })));
}

/* -------------------------------------------------------------------------- */
/* 7. Tab membership and decision reconciliation                               */
/* -------------------------------------------------------------------------- */

console.log("\n7. Tab membership and decisions");

check("approval_required belongs to Approval", belongsInTab(item({ queueState: "approval_required" }), "approval"));
check("approved does NOT belong to Approval", !belongsInTab(item({ queueState: "approved" }), "approval"));
check("approved belongs to Resolved", belongsInTab(item({ queueState: "approved" }), "resolved"));
check("blocked_by_safety belongs to Blocked", belongsInTab(item({ queueState: "blocked_by_safety" }), "blocked"));
check("History accepts every state",
  QUEUE_STATES.every((s) => belongsInTab(item({ queueState: s }), "all")));

/**
 * The mobile mirror must not DRIFT from `QUEUE_TAB_STATES` in @guardora/ai.
 *
 * Compared by parsing the canonical source rather than importing it: the mobile
 * package must not gain a dependency on a server package just to be tested, and a
 * text comparison catches a silent edit on either side just as well.
 */
{
  const canonicalSrc = readFileSync(
    resolve(SCRIPT_DIR, "../../../packages/ai/src/control-center.ts"), "utf8",
  );
  const block = canonicalSrc.match(/QUEUE_TAB_STATES[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
  const canonical: Record<string, string[]> = {};
  for (const [, tab, list] of block.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    canonical[tab!] = [...list!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
  }
  check("the canonical tab map was parsed", Object.keys(canonical).length === 4, dump(canonical));
  for (const tab of QUEUE_TABS) {
    if (tab === "all") continue;
    const expected = canonical[tab] ?? [];
    const actual = QUEUE_STATES.filter((st) => belongsInTab(item({ queueState: st }), tab as QueueTab));
    check(`tab "${tab}" mirrors @guardora/ai exactly`,
      dump([...expected].sort()) === dump([...actual].sort()),
      `canonical=${dump(expected)} mobile=${dump(actual)}`);
  }
}

{
  const s = ready([item({ id: "a" }), item({ id: "b" })]);

  // Approving inside the Approval tab must remove the row.
  const approvedElsewhere = queueReducer(s, {
    type: "ITEM_DECIDED",
    item: item({ id: "a", queueState: "approved", canApprove: false }),
    tab: "approval",
    counts: counts({ approval: 1, active: 2 }),
  });
  check("a decided row leaves a tab it no longer belongs to",
    dump(approvedElsewhere.items.map((i) => i.id)) === dump(["b"]));
  check("counts come from the server after a decision",
    approvedElsewhere.counts?.approval === 1 && approvedElsewhere.counts?.active === 2);

  // The same decision inside History must keep the row, patched.
  const inAll = queueReducer(s, {
    type: "ITEM_DECIDED",
    item: item({ id: "a", queueState: "approved", canApprove: false }),
    tab: "all",
    counts: counts(),
  });
  check("History keeps a decided row", inAll.items.length === 2);
  check("the kept row adopts the SERVER's state",
    inAll.items[0]?.queueState === "approved" && inAll.items[0]?.canApprove === false);

  // A decision on a row that is not on screen must not resurrect it.
  const unknown = queueReducer(s, {
    type: "ITEM_DECIDED", item: item({ id: "zzz", queueState: "approved" }), tab: "all", counts: counts(),
  });
  check("a decision on an absent row does not insert it", unknown.items.length === 2);
  check("a decision on an absent row still updates counts", unknown.counts !== null);

  // Missing counts must not wipe the badge.
  const noCounts = queueReducer(s, {
    type: "ITEM_DECIDED", item: item({ id: "a", queueState: "rejected" }), tab: "all",
  });
  check("an omitted counts payload keeps the last known counts",
    dump(noCounts.counts) === dump(counts()));

  const reset = queueReducer(s, { type: "RESET" });
  check("RESET clears the page chain", reset.items.length === 0 && reset.cursor === null);
  check("RESET preserves canDecide", reset.canDecide === true);
  check("RESET preserves counts so the tab badges do not flicker", dump(reset.counts) === dump(counts()));
}

/* -------------------------------------------------------------------------- */
/* 8. List/detail staleness signal                                             */
/* -------------------------------------------------------------------------- */

console.log("\n8. Staleness signal");

resetQueueStale();
check("clean by default", consumeQueueStale() === false);
markQueueStale();
check("a decision marks the queue stale", consumeQueueStale() === true);
check("consuming clears the flag", consumeQueueStale() === false);
markQueueStale();
markQueueStale();
check("marking is idempotent", consumeQueueStale() === true && consumeQueueStale() === false);

/* -------------------------------------------------------------------------- */
/* 9. Error mapping — bounded, never raw                                       */
/* -------------------------------------------------------------------------- */

console.log("\n9. Error mapping");

check("409 maps to conflict", mapErrorPayload(409, null) === "conflict");
check("403 maps to permission_denied", mapErrorPayload(403, null) === "permission_denied");
check("404 maps to not_found", mapErrorPayload(404, null) === "not_found");
check("a read_only body is honoured", mapErrorPayload(403, { error: "read_only" }) === "read_only");
check("an unknown server code degrades to server_error",
  mapErrorPayload(500, { error: "provider_graph_error_190" }) === "server_error");
check("a raw provider message never becomes a code",
  mapErrorPayload(500, { error: "(#200) Requires pages_manage_engagement" }) === "server_error");
check("a conflict does not invalidate the session", !isSessionInvalid("conflict"));
check("a permission denial does not invalidate the session", !isSessionInvalid("permission_denied"));
check("session_revoked does invalidate the session", isSessionInvalid("session_revoked"));

/* -------------------------------------------------------------------------- */
/* 10. Localization — full en / sk / de coverage                               */
/* -------------------------------------------------------------------------- */

console.log("\n10. Localization");

const locales: [string, typeof en][] = [["en", en], ["sk", sk as typeof en], ["de", de as typeof en]];
const groups: [string, readonly string[], (d: typeof en) => Record<string, string>][] = [
  ["tabs", QUEUE_TABS, (d) => d.queue.tabs],
  ["state", QUEUE_STATES, (d) => d.queue.state],
  ["proposedAction", PROPOSED_ACTIONS, (d) => d.queue.proposedAction],
  ["execution", EXECUTION_STATUSES, (d) => d.queue.execution],
  ["readiness", READINESS_STATES, (d) => d.queue.readiness],
  ["lifecycle", LIFECYCLE_STATES, (d) => d.queue.lifecycle],
  ["reason", QUEUE_REASONS, (d) => d.queue.reason],
  ["activityEvent", QUEUE_AUDIT_EVENTS, (d) => d.queue.activityEvent],
];

for (const [name, dict] of locales) {
  for (const [group, keys, pick] of groups) {
    const map = pick(dict) as Record<string, string>;
    const missing = keys.filter((k) => typeof map[k] !== "string" || map[k]!.trim() === "");
    check(`${name}: queue.${group} covers every key`, missing.length === 0, dump(missing));
  }
  for (const key of QUEUE_DECISIONS) {
    check(`${name}: a confirmation exists for "${key}"`,
      typeof (dict.queue.confirm as Record<string, string>)[`${key}Title`] === "string"
      && typeof (dict.queue.confirm as Record<string, string>)[`${key}Body`] === "string");
  }
  for (const tab of QUEUE_TABS) {
    const suffix = tab === "all" ? "all" : tab;
    check(`${name}: an empty state exists for "${tab}"`,
      typeof (dict.queue.empty as Record<string, string>)[`${suffix}Title`] === "string"
      && typeof (dict.queue.empty as Record<string, string>)[`${suffix}Body`] === "string");
  }
  check(`${name}: a back label exists`, typeof dict.common.back === "string" && dict.common.back !== "");
}

/**
 * The approve confirmation must NOT promise a platform change. It has to name the
 * decision and explicitly deny the provider action, in every locale.
 */
for (const [name, dict] of locales) {
  const body = dict.queue.confirm.approveBody.toLowerCase();
  const denies =
    name === "en" ? body.includes("does not hide")
      : name === "sk" ? body.includes("neskryje")
        : body.includes("nichts ausgeblendet");
  check(`${name}: approve copy denies a platform change`, denies, dict.queue.confirm.approveBody);
  check(`${name}: approve copy is not a bare "are you sure"`, dict.queue.confirm.approveBody.length > 60);
  check(`${name}: readiness carries the "status only" note`,
    typeof dict.queue.readiness.note === "string" && dict.queue.readiness.note.length > 20);
}

check("sk and en have the same queue key shape",
  dump(Object.keys(en.queue).sort()) === dump(Object.keys(sk.queue).sort()));
check("de and en have the same queue key shape",
  dump(Object.keys(en.queue).sort()) === dump(Object.keys(de.queue).sort()));

/* -------------------------------------------------------------------------- */
/* 11. Screens — server-authoritative, no demo data                            */
/* -------------------------------------------------------------------------- */

console.log("\n11. Screens");

const listSrc = codeOf("src/app/(app)/alerts/index.tsx");
const detailSrc = codeOf("src/app/(app)/alerts/[id].tsx");
const controllerSrc = codeOf("src/queue/use-queue.ts");

check("the M3 alerts placeholder is gone", (() => {
  try { readSrc("src/app/(app)/alerts.tsx"); return false; } catch { return true; }
})());
check("the alerts stack exists", codeOf("src/app/(app)/alerts/_layout.tsx").includes("Stack"));

for (const [label, src] of [["list", listSrc], ["detail", detailSrc]] as const) {
  check(`${label} renders no raw server error`, !/result\.error\s*\}|\{\s*error\s*\}/.test(src));
  check(`${label} maps errors through messageFor`, src.includes("messageFor("));
  check(`${label} contains no demo or mock data`, !/demo|mock|fixture|lorem/i.test(src));
  check(`${label} never logs`, !/console\.(log|warn|error|info)/.test(src));
  check(`${label} reads no token into state`, !/setToken|token\s*=\s*use/.test(src));
}

check("the list supports pull-to-refresh", listSrc.includes("RefreshControl"));
check("the list paginates on end reached", listSrc.includes("onEndReached"));
check("the list virtualizes", listSrc.includes("FlatList"));
check("the list reconciles on focus", listSrc.includes("consumeQueueStale"));
check("the detail refetches rather than guessing after a decision",
  /markQueueStale\(\)/.test(detailSrc) && /load\('refresh'\)/.test(detailSrc));
check("the detail exposes no execution control",
  !/onPress=\{[^}]*execut/i.test(detailSrc));
check("readiness is rendered with its status-only note", detailSrc.includes("readiness.note"));
check("the decision buttons are gated on the SERVER's flags",
  /item\.canApprove/.test(detailSrc) && /item\.canReject/.test(detailSrc) && /item\.canResolve/.test(detailSrc));
check("the inbox link is rendered only when the server gave one",
  /item\.relatedInboxItemId\s*\?/.test(detailSrc));
check("the inbox link is an in-app route",
  /router\.push\(`\/comments\//.test(detailSrc) && !/Linking\.openURL/.test(detailSrc));

check("the controller reconciles the shell badge after a decision",
  /reloadShell\(\{\s*refresh:\s*true\s*\}\)/.test(controllerSrc));
check("the controller drops superseded responses", /ticket !== seq\.current/.test(controllerSrc));
check("the controller aborts a superseded request", /inFlight\.current\?\.abort\(\)/.test(controllerSrc));
check("the controller guards one decision per item", /pendingIds\.includes\(itemId\)/.test(controllerSrc));
check("the controller never guards a first load, so a tab switch is not swallowed",
  !/mode !== "more"[\s\S]{0,80}phase === "loading"/.test(controllerSrc)
  && /mode === "refresh" && current\.phase === "refreshing"/.test(controllerSrc));
check("a tab change resets the page chain before loading",
  /RESET[\s\S]{0,80}load\("first"\)[\s\S]{0,40}\[tab, load\]/.test(controllerSrc));
check("the controller resyncs on a conflict rather than retrying",
  /"conflict"[\s\S]{0,160}load\("refresh"\)/.test(controllerSrc));
check("the controller never optimistically mutates a row",
  !/ITEM_DECIDED[\s\S]{0,200}optimistic/i.test(controllerSrc)
  && /result\.data\.item/.test(controllerSrc));

/* -------------------------------------------------------------------------- */
/* 12. Privacy — nothing sensitive is ever logged                              */
/* -------------------------------------------------------------------------- */

console.log("\n12. Privacy");

for (const m of QUEUE_MODULES) {
  const src = codeOf(m);
  check(`${m} does not log`, !/console\.(log|warn|error|info|debug)/.test(src));
  check(`${m} never names Authorization`, !src.includes("Authorization"));
  check(`${m} never embeds a bearer literal`, !/Bearer\s/.test(src));
}
check("the queue client never stringifies a token",
  !/JSON\.stringify\([^)]*token/.test(codeOf("src/api/queue.ts")));

/* ===================== M8C — CONFIDENCE LABEL ===================== */
console.log("\nM8C — CONFIDENCE IS NOT A REASON (defect 3)");

{
  const DICTS = { en, sk, de } as const;

  for (const [name, d] of Object.entries(DICTS)) {
    check(`C1-${name}) a DEDICATED confidence label exists`,
      typeof d.queue.confidence === "string" && d.queue.confidence.length > 0);
    check(`C2-${name}) the label is NOT the low_confidence blocked-reason sentence`,
      (d.queue.confidence as string) !== (d.queue.reason.low_confidence as string));
    check(`C3-${name}) the label carries no percentage or digits — the VALUE holds those`,
      !/[0-9%]/.test(d.queue.confidence));
    check(`C4-${name}) the label is a short noun label, not a sentence`,
      !d.queue.confidence.includes(".") && d.queue.confidence.split(" ").length <= 3);
    check(`C5-${name}) the blocked-reason vocabulary still covers low_confidence`,
      typeof d.queue.reason.low_confidence === "string" && d.queue.reason.low_confidence.length > 0);
  }

  check("C6) EN label", en.queue.confidence === "Confidence");
  check("C7) SK label", sk.queue.confidence === "Istota");
  check("C8) DE label", de.queue.confidence === "Konfidenz");

  // The exact M8B defect: the reason sentence used as a label rendered
  // "Istota bola príliš nízka: 90 %" for an item whose confidence was 90%.
  check("C9) SK reason copy is unchanged and still a full sentence",
    sk.queue.reason.low_confidence === "Istota bola príliš nízka");
  check("C10) EN reason copy is unchanged",
    en.queue.reason.low_confidence === "Confidence was too low");
  check("C11) every locale's confidence label is distinct from EVERY blocked reason",
    Object.values(DICTS).every((d) =>
      !(Object.values(d.queue.reason) as string[]).includes(d.queue.confidence)));
}

{
  const detail = codeOf("src/app/(app)/alerts/[id].tsx");

  check("C12) the confidence Row uses the DEDICATED label",
    /<Row\s+label=\{t\.queue\.confidence\}/.test(detail));
  check("C13) no blocked reason is used as a Row LABEL anywhere on the screen",
    !/label=\{t\.queue\.reason\./.test(detail));
  check("C14) the M8B defect line is gone",
    !detail.includes("label={t.queue.reason.low_confidence}"));
  check("C15) confidence ABSENT → the row is not rendered at all",
    /\{item\.confidence !== null \? \(/.test(detail));
  check("C16) the percentage lives in the VALUE, not the label",
    /value=\{`\$\{Math\.round\(item\.confidence \* 100\)\}%`\}/.test(detail));

  // Reason and confidence stay independent: the reason is whatever the SERVER
  // said, rendered from item.reason — never derived from the number.
  check("C17) the reason is rendered from the server's own field",
    /t\.queue\.reason\[item\.reason\]/.test(detail));
  check("C18) the client never infers a reason from the confidence value",
    !/confidence\s*[<>]=?\s*[0-9.]/.test(detail));
  check("C19) confidence and reason render as separate elements",
    detail.indexOf("t.queue.confidence") < detail.indexOf("t.queue.reason[item.reason]"));
  check("C20) a high-confidence item with a NON-confidence reason still renders both",
    /\{item\.reason \? \(/.test(detail) && /\{item\.confidence !== null \? \(/.test(detail));
}

/* -------------------------------------------------------------------------- */

console.log(
  `\n${fail === 0 ? "PASS" : "FAIL"} — mobile Action Queue client (M5): ${pass} passed, ${fail} failed`,
);
process.exit(fail === 0 ? 0 : 1);
