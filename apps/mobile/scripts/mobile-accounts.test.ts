/**
 * M6 — mobile Accounts client.
 *
 * PURE tests in the existing harness. Possible because every Accounts rule was kept
 * out of React: the list reducer, the filters, the presentation mappers and the web
 * hand-off URL builder are all plain functions.
 *
 * Asserted FIRST, because their violation would be unsafe rather than merely wrong:
 *   - the OAUTH boundary: no bearer, session token, user id, tenant id, provider
 *     secret or provider auth URL can ever reach `Linking.openURL`
 *   - the PROVIDER-WRITE boundary: the only provider operation expressible is a
 *     read-only sync — no hide, delete, reply, moderation or kill-switch call
 *   - the TOKEN boundary: no token, fragment or vault id exists in any type or file
 *
 * Then the product rules:
 *   - connection / monitoring / auto-sync / capability stay FOUR separate truths
 *   - only CONNECTED_HEALTHY may be styled as a success
 *   - a never-synced account reads as waiting, never as failed
 *   - an unknown platform degrades generically, NEVER to Facebook
 *   - a failed refresh keeps the list; a mutation adopts the SERVER's row
 *   - a sync result never claims completion
 *   - en / sk / de cover the full bounded vocabulary
 *
 * Run: pnpm mobile-accounts-client:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  ACCOUNT_KINDS, ACCOUNT_PLATFORMS, ACCOUNT_REASONS, AUTO_SYNC_STATES, CAPABILITY_STATES,
  CONNECTION_STATES, FIRST_SYNC_STATES, REVOKE_RESULTS, SYNC_RESULTS, SYNC_RUN_STATUSES,
  TOKEN_HEALTHS,
  type AccountCapacity, type ConnectedAccountItem,
} from "../src/api/types";
import { ACCOUNT_ROUTES } from "../src/api/accounts";
import {
  ACCOUNT_FILTERS, accountsReducer, applyFilter, filterCounts, initialAccountsState,
  isBlockingError, isEmpty, isFilteredEmpty, isFirstLoad, isRefreshing,
  type AccountsState,
} from "../src/accounts/accounts-state";
import {
  accountTruths, autoSyncTone, canToggleMonitoring, canTriggerSync, capabilityTone,
  connectionTone, displayPlatform, fallbackPlatformLabel, firstSyncTone, monitoringTone,
  needsAttention, shouldOfferReconnect, shouldShowCapability, syncRunTone, tokenHealthTone,
} from "../src/accounts/presentation";
import { consumeAccountsStale, markAccountsStale, resetAccountsStale } from "../src/accounts/accounts-sync";
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
/** Source with comments stripped — an assertion must never be satisfied by prose. */
const codeOf = (rel: string) =>
  readSrc(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const dump = (o: unknown) => JSON.stringify(o);

/** Every mobile module that participates in Accounts. */
const ACCOUNT_MODULES = [
  "src/api/accounts.ts",
  "src/accounts/accounts-state.ts",
  "src/accounts/accounts-sync.ts",
  "src/accounts/presentation.ts",
  "src/accounts/use-accounts.ts",
  "src/components/accounts/account-row.tsx",
  "src/components/accounts/disconnect-sheet.tsx",
  "src/app/(app)/accounts/_layout.tsx",
  "src/app/(app)/accounts/index.tsx",
  "src/app/(app)/accounts/[accountId].tsx",
];

const PROD = "https://app.tamanor.com";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const caps = (over: Partial<ConnectedAccountItem["capabilities"]> = {}): ConnectedAccountItem["capabilities"] => ({
  canRead: "available", canSync: "available", canMonitor: "available",
  canReconnect: "requires_web", canDisconnect: "available",
  moderationState: "not_implemented", replyState: "not_implemented",
  ...over,
});

const acct = (over: Partial<ConnectedAccountItem> = {}): ConnectedAccountItem => ({
  id: "a1",
  platform: "facebook_page",
  platformLabel: "Facebook Page",
  name: "Tamanor Page",
  username: null,
  accountKind: "real",
  connectionState: "CONNECTED_HEALTHY",
  needsReconnect: false,
  reason: null,
  monitoringEnabled: true,
  monitoringCanBeEnabled: true,
  autoSyncState: "ENABLED_HEALTHY",
  firstSyncState: "synced",
  lastSuccessfulSyncAt: "2026-02-01T09:00:00.000Z",
  lastAttemptAt: "2026-02-01T09:00:00.000Z",
  commentsToday: 12,
  riskToday: 2,
  capabilities: caps(),
  canManage: true,
  ...over,
});

const capacity = (over: Partial<AccountCapacity> = {}): AccountCapacity =>
  ({ used: 1, limit: 5, remaining: 4, monitored: 1, ...over });

const ready = (accounts: ConnectedAccountItem[], over: Partial<AccountsState> = {}): AccountsState => ({
  ...initialAccountsState(), phase: "ready", accounts, capacity: capacity(),
  canManage: true, needsAttention: accounts.filter(needsAttention).length, ...over,
});

/* -------------------------------------------------------------------------- */
/* 1. OAUTH BOUNDARY — asserted first                                          */
/* -------------------------------------------------------------------------- */

console.log("\n1. OAuth boundary");

/** Nothing that could carry an identity may appear in any Accounts module. */
const OAUTH_LEAK_TOKENS = [
  "client_secret", "clientSecret", "META_APP_SECRET", "GOOGLE_CLIENT_SECRET",
  "app_secret", "refresh_token", "refreshToken", "oauth_state", "buildMetaAuthUrl",
  "facebook.com/v", "accounts.google.com", "oauth2/auth", "response_type=code",
];
for (const tok of OAUTH_LEAK_TOKENS) {
  const offenders = ACCOUNT_MODULES.filter((m) => codeOf(m).includes(tok));
  check(`no accounts module contains "${tok}"`, offenders.length === 0, dump(offenders));
}

/**
 * M7 — the M6 "manage on the web" hand-off is GONE. Connecting and reconnecting are
 * native now, so no Accounts module opens a URL at all: the provider authorization
 * URL is issued by the server and opened by the OAuth controller.
 */
check("no accounts module opens a URL any more",
  !ACCOUNT_MODULES.some((m) => /Linking\.openURL/.test(codeOf(m))));
check("the M6 web-handoff module no longer exists", (() => {
  try { readSrc("src/accounts/web-handoff.ts"); return false; } catch { return true; }
})());
check("the M6 web-connect notice no longer exists", (() => {
  try { readSrc("src/components/accounts/web-connect-notice.tsx"); return false; } catch { return true; }
})());
check("Connect starts the NATIVE flow",
  /router\.push\('\/accounts\/connect'\)/.test(codeOf("src/app/(app)/accounts/index.tsx")));
check("Reconnect starts the NATIVE flow with only an account id",
  /pathname: '\/accounts\/connect'/.test(codeOf("src/app/(app)/accounts/[accountId].tsx"))
  && /accountId: account\.id/.test(codeOf("src/app/(app)/accounts/[accountId].tsx")));
check("no accounts module puts a token in a URL",
  !ACCOUNT_MODULES.some((m) => /[?&](token|bearer|session|access_token|auth)=/i.test(codeOf(m))));
check("no accounts module uses a WebView", !ACCOUNT_MODULES.some((m) => /WebView/.test(codeOf(m))));

/* -------------------------------------------------------------------------- */
/* 2. PROVIDER-WRITE and TOKEN boundaries                                      */
/* -------------------------------------------------------------------------- */

console.log("\n2. Provider-write and token boundaries");

const MODERATION_PATTERNS: [string, RegExp][] = [
  ["hideComment", /hideComment/],
  ["deleteComment", /deleteComment/],
  ["replyToComment", /replyToComment|postReply|publishReply/],
  ["executeLive", /executeLive/],
  ["killSwitch mutation", /killSwitch\s*[:=]\s*(true|false)|toggleKillSwitch/],
  ["rollback", /performRollback|rollbackExecution/],
  ["bulk disconnect", /disconnectAll|bulkDisconnect|bulkMonitoring/],
];
for (const [label, re] of MODERATION_PATTERNS) {
  const offenders = ACCOUNT_MODULES.filter((m) => re.test(codeOf(m)));
  check(`no accounts module contains ${label}`, offenders.length === 0, dump(offenders));
}
for (const tok of ["accessToken", "longLivedToken", "pageAccessToken", "vaultId", "credentialId"]) {
  const offenders = ACCOUNT_MODULES.filter((m) => codeOf(m).includes(tok));
  check(`no accounts module names "${tok}"`, offenders.length === 0, dump(offenders));
}
check("no accounts module reads DATABASE_URL or a server secret",
  !ACCOUNT_MODULES.some((m) => /DATABASE_URL|SESSION_SECRET|ENCRYPTION_KEY/.test(codeOf(m))));

/** The API client can only reach the five mobile account routes. */
const apiSrc = codeOf("src/api/accounts.ts");
check("the accounts client exposes exactly five routes", Object.keys(ACCOUNT_ROUTES).length === 5, dump(ACCOUNT_ROUTES));
check("every route is under /api/mobile/accounts",
  ACCOUNT_ROUTES.list === "/api/mobile/accounts"
  && ACCOUNT_ROUTES.item("x").startsWith("/api/mobile/accounts/")
  && ACCOUNT_ROUTES.monitoring("x").endsWith("/monitoring")
  && ACCOUNT_ROUTES.sync("x").endsWith("/sync")
  && ACCOUNT_ROUTES.disconnect("x").endsWith("/disconnect"));
check("the accounts client issues only GET and POST",
  !/method:\s*"(PUT|PATCH|DELETE)"/.test(apiSrc));
check("the accounts client never sends tenant / workspace / role / capacity",
  !/tenantId|workspaceId|\brole\b|monitoringCanBeEnabled|limit:/i.test(apiSrc));
check("the monitoring request body carries ONLY `enabled`",
  /body:\s*\{\s*enabled\s*\}/.test(apiSrc), apiSrc.match(/body:[^\n]*/)?.[0] ?? "");
check("the sync and disconnect requests carry no body",
  (apiSrc.match(/method:\s*"POST", token \}/g) ?? []).length === 2);

/** The account id is always encoded before it joins a path. */
check("account ids are URL-encoded in every route",
  (apiSrc.match(/encodeURIComponent\(id\)/g) ?? []).length === 4);

/** Sync results cannot express a completion or a moderation outcome. */
check("SYNC_RESULTS is bounded to five read-only outcomes",
  dump(SYNC_RESULTS) === dump(["started", "already_running", "reconnect_required", "not_supported", "not_found"]));
for (const forbidden of ["completed", "synced", "finished", "hidden", "deleted"]) {
  check(`SYNC_RESULTS has no "${forbidden}" member`, !(SYNC_RESULTS as readonly string[]).includes(forbidden));
}
check("no accounts module fabricates a sync completion",
  !ACCOUNT_MODULES.some((m) => /result\s*===?\s*["'](completed|synced|finished)["']/.test(codeOf(m))));
check("no accounts module polls",
  !ACCOUNT_MODULES.some((m) => /setInterval|setTimeout\([^)]*\d{3,}/.test(codeOf(m))));

/* -------------------------------------------------------------------------- */
/* 3. THE FOUR SEPARATE TRUTHS                                                 */
/* -------------------------------------------------------------------------- */

console.log("\n3. Four separate truths");

{
  // Connected + monitoring OFF + auto-sync running stays representable.
  const a = acct({ monitoringEnabled: false, autoSyncState: "ENABLED_HEALTHY" });
  const truths = accountTruths(a);
  check("connected + monitoring off + auto-sync running is representable",
    truths.connection === "CONNECTED_HEALTHY" && truths.monitoring === false && truths.autoSync === "ENABLED_HEALTHY");
  check("monitoring off does not make the connection unhealthy", truths.overallHealthy === true);
  check("monitoring off is not an attention state", needsAttention(a) === false);

  // Reconnect required + monitoring ON must not read as healthy.
  const bad = acct({
    connectionState: "REAUTH_REQUIRED", needsReconnect: true, monitoringEnabled: true,
    autoSyncState: "ENABLED_REAUTH_REQUIRED", reason: "token_expired",
    capabilities: caps({ canSync: "unavailable" }),
  });
  const badTruths = accountTruths(bad);
  check("reconnect required + monitoring on is NOT healthy", badTruths.overallHealthy === false);
  check("reconnect required + monitoring on keeps monitoring true", badTruths.monitoring === true);
  check("reconnect required needs attention", needsAttention(bad) === true);
  check("reconnect required is never styled green", connectionTone(bad.connectionState) !== "success");
  check("reconnect required offers the reconnect hand-off", shouldOfferReconnect(bad) === true);
  check("reconnect required cannot trigger a sync", canTriggerSync(bad) === false);

  check("overallHealthy is derived from the CONNECTION alone",
    accountTruths(acct({ monitoringEnabled: false, autoSyncState: "DISABLED" })).overallHealthy === true);
  check("there is no combined status field on the DTO",
    !("status" in acct()) && !("active" in acct()), dump(Object.keys(acct())));
}

/* -------------------------------------------------------------------------- */
/* 4. Tones — exactly one green                                                */
/* -------------------------------------------------------------------------- */

console.log("\n4. Tones");

const TONES = ["neutral", "brand", "success", "warning", "danger"];
const mappers: [string, (v: string) => string, readonly string[]][] = [
  ["connectionTone", connectionTone, CONNECTION_STATES],
  ["autoSyncTone", autoSyncTone, AUTO_SYNC_STATES],
  ["firstSyncTone", firstSyncTone, FIRST_SYNC_STATES],
  ["tokenHealthTone", tokenHealthTone, TOKEN_HEALTHS],
  ["capabilityTone", capabilityTone, CAPABILITY_STATES],
  ["syncRunTone", syncRunTone, SYNC_RUN_STATUSES],
];
for (const [name, fn, keys] of mappers) {
  check(`${name} covers every key`, keys.every((k) => TONES.includes(fn(k))));
  check(`${name} degrades an unknown key to neutral`, fn("something_new") === "neutral");
  // The M4/M5/M6 prototype-lookup bug, guarded here too.
  check(`${name} is prototype-safe`, fn("__proto__") === "neutral" && fn("constructor") === "neutral");
  check(`${name} handles an empty key`, fn("") === "neutral");
}

check("CONNECTED_HEALTHY is the ONLY green connection state",
  CONNECTION_STATES.filter((s) => connectionTone(s) === "success").length === 1
  && connectionTone("CONNECTED_HEALTHY") === "success");
for (const s of ["WAITING_FIRST_SYNC", "DEGRADED", "SYNC_FAILED", "REAUTH_REQUIRED", "DISCONNECTED"] as const) {
  check(`${s} is never green`, connectionTone(s) !== "success");
}
check("an unknown connection state is never green", connectionTone("SOMETHING_NEW") !== "success");

check("a waiting first sync is not styled as a failure", firstSyncTone("waiting_first_sync") === "neutral");
check("a failed first sync is styled as a danger", firstSyncTone("failed") === "danger");
check("monitoring ON is not green — it is not a health signal", monitoringTone(true) !== "success");
check("monitoring OFF is neutral, not an alarm", monitoringTone(false) === "neutral");
check("an unknown token health is not green", tokenHealthTone("???") !== "success");

check("a capability that is not configured is hidden", !shouldShowCapability("not_configured"));
check("an available capability is shown", shouldShowCapability("available"));
check("a not-implemented capability is still shown truthfully", shouldShowCapability("not_implemented"));

/* -------------------------------------------------------------------------- */
/* 5. Platform — no Facebook fallback                                          */
/* -------------------------------------------------------------------------- */

console.log("\n5. Platform");

check("the server's label wins",
  displayPlatform({ platform: "google_business", platformLabel: "Google Business Profile" }) === "Google Business Profile");
check("a missing label falls back per platform",
  displayPlatform({ platform: "instagram_business", platformLabel: "" }) === "Instagram Business");
for (const unknown of ["threads", "bluesky", "", "__proto__", "constructor"]) {
  const label = fallbackPlatformLabel(unknown);
  check(`unknown platform "${unknown}" gets a generic label`, label === "Connected account", label);
  check(`unknown platform "${unknown}" NEVER becomes Facebook`, !/facebook/i.test(label));
}
check("the unknown key itself gets the generic label", fallbackPlatformLabel("unknown") === "Connected account");
check("google_business never falls back to Facebook", !/facebook/i.test(fallbackPlatformLabel("google_business")));
check("no accounts module contains a two-way platform conditional",
  !ACCOUNT_MODULES.some((m) => /instagram["']?\s*\?[^:]*:\s*["']?facebook/i.test(codeOf(m))));
for (const p of ACCOUNT_PLATFORMS) {
  check(`platform "${p}" has a non-empty fallback label`, fallbackPlatformLabel(p).length > 0);
}

/* -------------------------------------------------------------------------- */
/* 6. Reducer                                                                  */
/* -------------------------------------------------------------------------- */

console.log("\n6. Reducer");

{
  const s0 = initialAccountsState();
  check("initial state is idle and empty", s0.phase === "idle" && s0.accounts.length === 0);
  check("initial state cannot manage", s0.canManage === false);
  check("initial filter is all", s0.filter === "all");

  const loading = accountsReducer(s0, { type: "LOAD_START", refresh: false });
  check("a first load is 'loading'", loading.phase === "loading" && isFirstLoad(loading));

  const loaded = accountsReducer(loading, {
    type: "LOAD_SUCCESS",
    accounts: [acct({ id: "a1" }), acct({ id: "a2", connectionState: "REAUTH_REQUIRED" })],
    capacity: capacity({ used: 2, monitored: 2 }), canManage: true, needsAttention: 1,
  });
  check("a load replaces the list", loaded.accounts.length === 2 && loaded.phase === "ready");
  check("capacity is stored", loaded.capacity?.monitored === 2);
  check("the server's canManage is adopted", loaded.canManage === true);
  check("the server's needsAttention is adopted", loaded.needsAttention === 1);

  const refreshing = accountsReducer(loaded, { type: "LOAD_START", refresh: true });
  check("a refresh with rows is 'refreshing'", isRefreshing(refreshing));
  const refreshFailed = accountsReducer(refreshing, { type: "LOAD_FAILURE", error: "network" });
  check("a failed refresh KEEPS the list", refreshFailed.accounts.length === 2);
  check("a failed refresh stays ready", refreshFailed.phase === "ready" && !isBlockingError(refreshFailed));

  const emptyFailed = accountsReducer(
    accountsReducer(initialAccountsState(), { type: "LOAD_START", refresh: false }),
    { type: "LOAD_FAILURE", error: "server_error" },
  );
  check("a failed first load with no rows IS blocking", isBlockingError(emptyFailed));
  check("isEmpty only when ready, empty and error-free", isEmpty(ready([])));
  check("isEmpty is false while an error stands", !isEmpty(ready([], { error: "network" })));
}
{
  const s = ready([acct({ id: "a1", monitoringEnabled: true }), acct({ id: "a2" })]);
  const updated = accountsReducer(s, {
    type: "ACCOUNT_UPDATED",
    account: acct({ id: "a1", monitoringEnabled: false, connectionState: "REAUTH_REQUIRED" }),
    capacity: capacity({ used: 1, monitored: 1 }),
  });
  check("a mutation patches only its own row",
    updated.accounts[0]!.monitoringEnabled === false && updated.accounts[1]!.monitoringEnabled === true);
  check("a mutation adopts the SERVER's row", updated.accounts[0]!.connectionState === "REAUTH_REQUIRED");
  check("a mutation adopts the SERVER's capacity", updated.capacity?.monitored === 1);
  check("needsAttention is recomputed from the rows", updated.needsAttention === 1, String(updated.needsAttention));

  const noCapacity = accountsReducer(s, { type: "ACCOUNT_UPDATED", account: acct({ id: "a1" }) });
  check("an omitted capacity keeps the last known one", dump(noCapacity.capacity) === dump(capacity()));

  const unknown = accountsReducer(s, { type: "ACCOUNT_UPDATED", account: acct({ id: "zzz" }) });
  check("a mutation on an absent row does not insert it", unknown.accounts.length === 2);

  const removed = accountsReducer(s, { type: "ACCOUNT_REMOVED", accountId: "a1" });
  check("a disconnect removes the row", removed.accounts.length === 1 && removed.accounts[0]!.id === "a2");
  const removeMissing = accountsReducer(s, { type: "ACCOUNT_REMOVED", accountId: "nope" });
  check("removing an absent row is a no-op", removeMissing === s);
}

/* -------------------------------------------------------------------------- */
/* 7. Filters                                                                  */
/* -------------------------------------------------------------------------- */

console.log("\n7. Filters");

{
  const rows = [
    acct({ id: "a1", connectionState: "CONNECTED_HEALTHY", monitoringEnabled: true }),
    acct({ id: "a2", connectionState: "REAUTH_REQUIRED", monitoringEnabled: true }),
    acct({ id: "a3", connectionState: "CONNECTED_HEALTHY", monitoringEnabled: false }),
    acct({ id: "a4", connectionState: "SYNC_FAILED", monitoringEnabled: false }),
  ];
  check("there are four bounded filters", dump(ACCOUNT_FILTERS) === dump(["all", "attention", "monitored", "unmonitored"]));
  check("all shows everything", applyFilter(rows, "all").length === 4);
  check("attention shows only unhealthy connections",
    dump(applyFilter(rows, "attention").map((a) => a.id)) === dump(["a2", "a4"]));
  check("monitored shows only monitored", dump(applyFilter(rows, "monitored").map((a) => a.id)) === dump(["a1", "a2"]));
  check("unmonitored shows only unmonitored", dump(applyFilter(rows, "unmonitored").map((a) => a.id)) === dump(["a3", "a4"]));
  check("all returns a COPY, never the original array", applyFilter(rows, "all") !== rows);

  const counts = filterCounts(rows);
  check("filter counts are complete", dump(counts) === dump({ all: 4, attention: 2, monitored: 2, unmonitored: 2 }));

  const s = ready(rows, { filter: "attention" });
  check("a filtered-empty state is distinguishable",
    isFilteredEmpty(ready([acct({ connectionState: "CONNECTED_HEALTHY" })], { filter: "attention" })));
  check("a filter with matches is not filtered-empty", !isFilteredEmpty(s));
  check("a truly empty list is not filtered-empty", !isFilteredEmpty(ready([], { filter: "attention" })));

  const changed = accountsReducer(s, { type: "SET_FILTER", filter: "monitored" });
  check("a filter change is recorded", changed.filter === "monitored");
  check("re-setting the same filter is a no-op",
    accountsReducer(changed, { type: "SET_FILTER", filter: "monitored" }) === changed);
  check("a filter change does not refetch (no cursor/page state exists)",
    !("cursor" in changed) && !("hasMore" in changed));
}

/* -------------------------------------------------------------------------- */
/* 8. Action gating                                                            */
/* -------------------------------------------------------------------------- */

console.log("\n8. Action gating");

check("a healthy manageable account can sync", canTriggerSync(acct()) === true);
check("a viewer cannot sync", canTriggerSync(acct({ capabilities: caps({ canSync: "missing_permission" }) })) === false);
check("a Google Business account cannot sync from mobile",
  canTriggerSync(acct({ platform: "google_business", capabilities: caps({ canSync: "requires_web" }) })) === false);
check("a disconnected account cannot sync",
  canTriggerSync(acct({ capabilities: caps({ canSync: "unavailable" }) })) === false);

check("monitoring can be turned OFF even at the plan limit",
  canToggleMonitoring(acct({ monitoringEnabled: true, monitoringCanBeEnabled: false })) === true);
check("monitoring cannot be turned ON at the plan limit",
  canToggleMonitoring(acct({ monitoringEnabled: false, monitoringCanBeEnabled: false })) === false);
check("monitoring can be turned ON with capacity",
  canToggleMonitoring(acct({ monitoringEnabled: false, monitoringCanBeEnabled: true })) === true);
check("a viewer cannot toggle monitoring",
  canToggleMonitoring(acct({ capabilities: caps({ canMonitor: "missing_permission" }) })) === false);

check("a healthy account does not offer reconnect", shouldOfferReconnect(acct()) === false);
check("a disconnected account offers reconnect",
  shouldOfferReconnect(acct({ connectionState: "DISCONNECTED" })) === true);
check("a viewer is not offered reconnect",
  shouldOfferReconnect(acct({ connectionState: "DISCONNECTED", capabilities: caps({ canReconnect: "missing_permission" }) })) === false);
check("a degraded account does not demand a reconnect",
  shouldOfferReconnect(acct({ connectionState: "DEGRADED" })) === false);

/* -------------------------------------------------------------------------- */
/* 9. Staleness signal                                                         */
/* -------------------------------------------------------------------------- */

console.log("\n9. Staleness signal");

resetAccountsStale();
check("clean by default", consumeAccountsStale() === false);
markAccountsStale();
check("a mutation marks the accounts stale", consumeAccountsStale() === true);
check("consuming clears the flag", consumeAccountsStale() === false);
markAccountsStale();
markAccountsStale();
check("marking is idempotent", consumeAccountsStale() === true && consumeAccountsStale() === false);

/* -------------------------------------------------------------------------- */
/* 10. Error mapping                                                           */
/* -------------------------------------------------------------------------- */

console.log("\n10. Error mapping");

check("409 maps to conflict by status", mapErrorPayload(409, null) === "conflict");
check("a plan-limit body is honoured",
  mapErrorPayload(409, { error: "account_limit_reached" }) === "account_limit_reached");
check("403 permission_denied is honoured", mapErrorPayload(403, { error: "permission_denied" }) === "permission_denied");
check("403 workspace_unsupported is honoured",
  mapErrorPayload(403, { error: "workspace_unsupported" }) === "workspace_unsupported");
check("404 maps to not_found", mapErrorPayload(404, null) === "not_found");
check("429 maps to rate_limited", mapErrorPayload(429, null) === "rate_limited");
check("an unknown server code degrades to server_error",
  mapErrorPayload(500, { error: "provider_graph_error_190" }) === "server_error");
check("a raw provider message never becomes a code",
  mapErrorPayload(500, { error: "(#200) Requires pages_manage_engagement" }) === "server_error");
check("a plan limit does not invalidate the session", !isSessionInvalid("account_limit_reached"));
check("a permission denial does not invalidate the session", !isSessionInvalid("permission_denied"));
check("session_expired does invalidate the session", isSessionInvalid("session_expired"));

/* -------------------------------------------------------------------------- */
/* 11. Localization                                                            */
/* -------------------------------------------------------------------------- */

console.log("\n11. Localization");

const locales: [string, typeof en][] = [["en", en], ["sk", sk as typeof en], ["de", de as typeof en]];
const groups: [string, readonly string[], (d: typeof en) => Record<string, string>][] = [
  ["connection", CONNECTION_STATES, (d) => d.accounts.connection],
  ["autoSync", AUTO_SYNC_STATES, (d) => d.accounts.autoSync],
  ["firstSync", FIRST_SYNC_STATES, (d) => d.accounts.firstSync],
  ["accountKind", ACCOUNT_KINDS, (d) => d.accounts.accountKind],
  ["tokenHealth", TOKEN_HEALTHS, (d) => d.accounts.tokenHealth],
  ["reason", ACCOUNT_REASONS, (d) => d.accounts.reason],
  ["capabilityState", CAPABILITY_STATES, (d) => d.accounts.capabilityState],
  ["syncRun.status", SYNC_RUN_STATUSES, (d) => d.accounts.syncRun.status],
  ["syncResult", SYNC_RESULTS, (d) => d.accounts.syncResult],
  ["filters", ACCOUNT_FILTERS, (d) => d.accounts.filters],
];

for (const [name, dict] of locales) {
  for (const [group, keys, pick] of groups) {
    const map = pick(dict) as Record<string, string>;
    const missing = keys.filter((k) => typeof map[k] !== "string" || map[k]!.trim() === "");
    check(`${name}: accounts.${group} covers every key`, missing.length === 0, dump(missing));
  }
  for (const cap of ["canRead", "canSync", "canMonitor", "canReconnect", "canDisconnect", "moderationState", "replyState"]) {
    check(`${name}: a label exists for capability "${cap}"`,
      typeof (dict.accounts.capability as Record<string, string>)[cap] === "string");
  }
  for (const key of ["identity", "connection", "monitoring", "sync", "permissions", "activity", "danger"]) {
    check(`${name}: a heading exists for section "${key}"`,
      typeof (dict.accounts.sections as Record<string, string>)[key] === "string");
  }
  for (const key of ["syncNow", "connect", "reconnect", "disconnect", "cancel", "manageOnWeb"]) {
    check(`${name}: an action label exists for "${key}"`,
      typeof (dict.accounts.actions as Record<string, string>)[key] === "string");
  }
  check(`${name}: the M3 dashboard account strings survived the merge`,
    typeof dict.accounts.section === "string" && typeof dict.accounts.neverSync === "string");
}

/**
 * The copy that carries the M6 product promises. Each must be present and
 * substantive in every locale — a one-word placeholder would technically pass a
 * key check while destroying the meaning.
 */
for (const [name, dict] of locales) {
  check(`${name}: monitoring copy explains what monitoring is NOT`,
    dict.accounts.monitoringMeaning.length > 80, dict.accounts.monitoringMeaning);
  check(`${name}: disconnect copy states nothing public is deleted`,
    dict.accounts.disconnectConfirm.publicNotice.length > 60);
  check(`${name}: manual-cleanup guidance exists`,
    dict.accounts.disconnectResult.manualCleanup.length > 60);
  check(`${name}: the web hand-off warns about signing in again`,
    dict.accounts.webHandoff.connectBody.length > 40 && dict.accounts.webHandoff.reconnectBody.length > 40);
  check(`${name}: the sync-started copy does not claim completion`,
    !/completed|finished|dokončen|abgeschlossen/i.test(dict.accounts.syncResult.started),
    dict.accounts.syncResult.started);
  check(`${name}: the plan-limit message is explained, not a bare error`,
    dict.accounts.monitoringLimitReached.length > 40);
  check(`${name}: an empty state exists for viewers too`,
    dict.accounts.empty.viewerBody.length > 20);
}

check("sk and en have the same accounts key shape",
  dump(Object.keys(en.accounts).sort()) === dump(Object.keys(sk.accounts).sort()));
check("de and en have the same accounts key shape",
  dump(Object.keys(en.accounts).sort()) === dump(Object.keys(de.accounts).sort()));

/* -------------------------------------------------------------------------- */
/* 12. Screens and controller                                                  */
/* -------------------------------------------------------------------------- */

console.log("\n12. Screens and controller");

const listSrc = codeOf("src/app/(app)/accounts/index.tsx");
const detailSrc = codeOf("src/app/(app)/accounts/[accountId].tsx");
const controllerSrc = codeOf("src/accounts/use-accounts.ts");

check("the M3 accounts placeholder is gone", (() => {
  try { readSrc("src/app/(app)/accounts.tsx"); return false; } catch { return true; }
})());
check("the accounts stack exists", codeOf("src/app/(app)/accounts/_layout.tsx").includes("Stack"));
check("the detail route is a nested stack screen, not a second tab bar",
  !detailSrc.includes("Tabs") && !listSrc.includes("Tabs"));

for (const [label, src] of [["list", listSrc], ["detail", detailSrc]] as const) {
  check(`${label} renders no raw server error`, !/result\.error\s*\}|\{\s*error\s*\}/.test(src));
  check(`${label} maps errors through messageFor`, src.includes("messageFor("));
  check(`${label} contains no demo or mock data`, !/demo Data|mockAccount|fixture|lorem/i.test(src));
  check(`${label} never logs`, !/console\.(log|warn|error|info)/.test(src));
}
check("the list supports pull-to-refresh", listSrc.includes("RefreshControl"));
check("the list virtualizes", listSrc.includes("FlatList"));
check("the list reconciles on focus", listSrc.includes("consumeAccountsStale"));
check("the list has no pagination (bounded management list)",
  !listSrc.includes("onEndReached") && !listSrc.includes("cursor"));
check("the list hides management controls from a viewer",
  /state\.canManage \?/.test(listSrc) && /!state\.canManage/.test(listSrc));
check("the list renders the three truths as separate badges",
  /connection:/.test(listSrc) && /monitoringValue:/.test(listSrc) && /autoSyncValue:/.test(listSrc));

check("the detail exposes a monitoring switch", /Switch/.test(detailSrc));
check("the detail states what monitoring does NOT mean", detailSrc.includes("monitoringMeaning"));
check("the detail gates every write on the SERVER's canManage", /canManage \?/.test(detailSrc));
check("the detail confirms before disconnecting", /DisconnectSheet/.test(detailSrc));
check("the detail surfaces manual-cleanup guidance",
  /manualCleanupRecommended[\s\S]{0,80}manualCleanup/.test(detailSrc));
check("the detail surfaces the cluster count truthfully",
  /clusterCount[\s\S]{0,120}clusterAffected/.test(detailSrc));
check("the detail never invents a disconnect pre-flight",
  !/preflight|previewDisconnect|fetchCluster/i.test(detailSrc));
check("the detail refetches rather than guessing after a disconnect",
  /markAccountsStale\(\)/.test(detailSrc) && /load\('refresh'\)/.test(detailSrc));
check("the detail shows sync history without provider internals",
  /syncRuns\.map/.test(detailSrc) && !/providerError|rawError|stack/.test(detailSrc));

check("the controller drops superseded responses", /ticket !== seq\.current/.test(controllerSrc));
check("the controller aborts a superseded request", /inFlight\.current\?\.abort\(\)/.test(controllerSrc));
check("the controller guards one mutation per account", /pendingIds\.includes\(accountId\)/.test(controllerSrc));
check("the controller never mutates a row optimistically",
  /ACCOUNT_UPDATED[\s\S]{0,80}result\.data\.account/.test(controllerSrc));
check("a failed mutation retains the account",
  !/ACCOUNT_REMOVED[\s\S]{0,40}\}\s*\n\s*return \{ ok: false/.test(controllerSrc));
check("a stale account is removed and the list marked stale",
  /"not_found"[\s\S]{0,120}ACCOUNT_REMOVED[\s\S]{0,80}markAccountsStale/.test(controllerSrc));
check("monitoring reconciles the shell counters",
  /toggleMonitoring[\s\S]{0,1400}reloadShell\(\{ refresh: true \}\)/.test(controllerSrc));
check("disconnect reconciles the shell counters",
  /disconnect[\s\S]{0,1400}reloadShell\(\{ refresh: true \}\)/.test(controllerSrc));
{
  // Slice the syncNow callback exactly — a sync changes no counted resource, so it
  // must not reload the shell, while the two neighbouring mutations must.
  const syncBody = controllerSrc.split("const syncNow")[1]?.split("const disconnect")[0] ?? "";
  check("the syncNow body was located", syncBody.length > 100, String(syncBody.length));
  check("a sync does NOT reload the whole shell (nothing counted changed)",
    !syncBody.includes("reloadShell"), syncBody.slice(0, 80));
  check("a sync does not fabricate a completion", !/completed|finished/.test(syncBody));
}
check("the controller starts no polling loop", !/setInterval|poll/i.test(controllerSrc));

/* -------------------------------------------------------------------------- */
/* 13. Privacy                                                                 */
/* -------------------------------------------------------------------------- */

console.log("\n13. Privacy");

for (const m of ACCOUNT_MODULES) {
  const src = codeOf(m);
  check(`${m} does not log`, !/console\.(log|warn|error|info|debug)/.test(src));
  check(`${m} never names Authorization`, !src.includes("Authorization"));
  check(`${m} never embeds a bearer literal`, !/Bearer\s/.test(src));
}
check("the accounts client never stringifies a token",
  !/JSON\.stringify\([^)]*token/.test(codeOf("src/api/accounts.ts")));
{
  // The M6 types block may name `tokenHealth` / `tokenExpiresAt` — bounded PRESENTATION
  // — but must contain no field that could carry a credential.
  // Comments stripped first: prose like "no token ever reaches the app" must not
  // be able to fail — or to satisfy — a declaration check.
  const typesCode = codeOf("src/api/types.ts");
  // Anchored on the first M6 declaration, so the slice covers the whole block.
  const m6Types = typesCode.slice(typesCode.indexOf("export const CONNECTION_STATES"));
  check("the M6 types block was located", m6Types.length > 500, String(m6Types.length));
  for (const forbidden of [
    "accessToken", "longLivedToken", "refreshToken", "pageAccessToken",
    "apiToken", "vaultId", "credentialId", "clientSecret", "secret",
  ]) {
    check(`no accounts type declares "${forbidden}"`, !m6Types.includes(forbidden));
  }
  // camelCase only, so the bounded reason key `token_expired` is not mistaken for a field.
  const tokenFields = [...new Set(m6Types.match(/\btoken[A-Z][A-Za-z]*/g) ?? [])].sort();
  check("the only token-shaped fields are tokenHealth and tokenExpiresAt",
    dump(tokenFields) === dump(["tokenExpiresAt", "tokenHealth"]), dump(tokenFields));
  check("no accounts type declares a bare `token` field",
    !/\btoken\??:/.test(m6Types), m6Types.match(/\btoken\??:.*/)?.[0] ?? "");
}
check("REVOKE_RESULTS is bounded", dump(REVOKE_RESULTS) === dump(["revoked", "unsupported", "already_invalid", "failed"]));

/* -------------------------------------------------------------------------- */

console.log(
  `\n${fail === 0 ? "PASS" : "FAIL"} — mobile Accounts client (M6): ${pass} passed, ${fail} failed`,
);
process.exit(fail === 0 ? 0 : 1);
