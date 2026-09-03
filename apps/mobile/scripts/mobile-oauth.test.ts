/**
 * M7 — native connector OAuth client.
 *
 * PURE tests in the existing harness. Possible because every rule was kept out of
 * React: the deep-link parser, the flow reducer and the pending-flow storage are
 * plain functions.
 *
 * Asserted FIRST, because their violation would be unsafe rather than merely wrong:
 *   - THE DEEP LINK IS NOT AUTHORITATIVE. A spoofed callback cannot fake a
 *     connection, because the parser has no way to express an outcome and the
 *     reducer has no event that carries one from the device.
 *   - NO CREDENTIAL LEAVES THE APP. No bearer in a URL, no provider secret, no
 *     provider token, no OAuth state on the device, no WebView, and no provider
 *     authorization URL constructed in React Native.
 *
 * Then the product rules: start, cancel, selection, expiry, cold start and the
 * Accounts refresh rule.
 *
 * Run: pnpm mobile-oauth-client:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  OAUTH_INTENTS, OAUTH_PROVIDERS, OAUTH_RESULT_CODES, OAUTH_STATUSES,
  type OAuthFlow, type OAuthSelectableOption,
} from "../src/api/types";
import { OAUTH_ROUTES } from "../src/api/oauth";
import { OAUTH_CALLBACK_PATH, OAUTH_SCHEME, parseOAuthDeepLink } from "../src/oauth/deep-link";
import {
  canSubmitSelection, didFail, initialOAuthState, isBusy, isTerminal, oauthReducer,
  shouldRefreshAccounts, type OAuthFlowState,
} from "../src/oauth/oauth-state";
import {
  PENDING_FLOW_KEY, PENDING_MAX_AGE_MS, createPendingFlowStorage, parsePendingFlow,
} from "../src/oauth/oauth-storage";
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

/** Every mobile module that participates in native OAuth. */
const OAUTH_MODULES = [
  "src/api/oauth.ts",
  "src/oauth/deep-link.ts",
  "src/oauth/oauth-state.ts",
  "src/oauth/oauth-storage.ts",
  "src/oauth/oauth-storage-deps.ts",
  "src/oauth/use-oauth-flow.ts",
  "src/app/(app)/accounts/connect.tsx",
];

const NOW = new Date("2026-03-01T12:00:00.000Z");

const flow = (over: Partial<OAuthFlow> = {}): OAuthFlow => ({
  id: "flow-1", provider: "meta", intent: "connect", status: "pending",
  expiresAt: new Date(NOW.getTime() + 600_000).toISOString(),
  resultCode: null, accountId: null, selectionRequired: false, ...over,
});

const option = (over: Partial<OAuthSelectableOption> = {}): OAuthSelectableOption => ({
  id: "facebook:PAGE_A", displayName: "Page A", kind: "facebook_page",
  alreadyConnected: false, eligible: true, reason: null, ...over,
});

const started = (): OAuthFlowState =>
  oauthReducer(
    oauthReducer(initialOAuthState(), { type: "START", provider: "meta", intent: "connect" }),
    { type: "STARTED", flowId: "flow-1" },
  );

/* -------------------------------------------------------------------------- */
/* 1. THE DEEP LINK IS NOT AUTHORITATIVE                                       */
/* -------------------------------------------------------------------------- */

console.log("\n1. The deep link is not authoritative");

{
  const ok = parseOAuthDeepLink("tamanor://oauth/callback?flow=abc123");
  check("a well-formed callback yields a flow id", ok.kind === "oauth_callback" && ok.flowId === "abc123");
  check("the parse result has NO outcome field at all",
    ok.kind === "oauth_callback" && dump(Object.keys(ok).sort()) === dump(["flowId", "kind"]), dump(ok));
}
/**
 * The spoof suite. Every one of these carries a claim; the parser must return the
 * flow id and NOTHING else, so the claim cannot enter the app.
 */
for (const spoof of [
  "tamanor://oauth/callback?flow=abc123&success=true",
  "tamanor://oauth/callback?flow=abc123&status=completed",
  "tamanor://oauth/callback?flow=abc123&connected=1&accountId=acct-evil",
  "tamanor://oauth/callback?flow=abc123&access_token=SECRET",
  "tamanor://oauth/callback?flow=abc123&code=AUTHCODE&state=STATE",
  "tamanor://oauth/callback?flow=abc123&error=nope",
]) {
  const p = parseOAuthDeepLink(spoof);
  check(`a spoofed claim is discarded: ${spoof.slice(28, 62)}`,
    p.kind === "oauth_callback" && dump(Object.keys(p).sort()) === dump(["flowId", "kind"]), dump(p));
}
for (const bad of [
  null, undefined, "", "not a url",
  "https://tamanor.com/oauth/callback?flow=abc",
  "evil://oauth/callback?flow=abc",
  "tamanor://oauth/other?flow=abc",
  "tamanor://something?flow=abc",
  "tamanor://oauth/callback",
  "tamanor://oauth/callback?flow=",
  "tamanor://oauth/callback?flow=../../etc",
  "tamanor://oauth/callback?flow=a b",
  `tamanor://oauth/callback?flow=${"x".repeat(65)}`,
]) {
  check(`an unusable link is ignored: ${dump(bad)?.slice(0, 44)}`,
    parseOAuthDeepLink(bad as string).kind === "ignored");
}
check("the scheme matches the app config", OAUTH_SCHEME === "tamanor");
check("the callback path is the one the server redirects to", OAUTH_CALLBACK_PATH === "oauth/callback");
{
  const src = codeOf("src/oauth/deep-link.ts");
  check("the parser never reads a success flag", !/success/.test(src));
  check("the parser never reads a status", !/searchParams\.get\("status"\)/.test(src));
  check("the parser never reads a code or state",
    !/searchParams\.get\("code"\)/.test(src) && !/searchParams\.get\("state"\)/.test(src));
  check("the parser reads exactly ONE query parameter",
    (src.match(/searchParams\.get\(/g) ?? []).length === 1);
}

/**
 * The reducer half of the same guarantee: no device-originated event can set an
 * outcome, so even a parser bug could not fake a connection.
 */
{
  const s = started();
  const afterBrowser = oauthReducer(s, { type: "BROWSER_RETURNED" });
  check("the browser closing sets NO status", afterBrowser.status === null);
  check("the browser closing only triggers a check", afterBrowser.phase === "checking");
  const afterSignal = oauthReducer(s, { type: "CALLBACK_SIGNAL", flowId: "flow-1" });
  check("a deep-link signal sets NO status", afterSignal.status === null);
  check("a deep-link signal only triggers a check", afterSignal.phase === "checking");
  check("neither event can produce a refresh",
    !shouldRefreshAccounts(afterBrowser) && !shouldRefreshAccounts(afterSignal));

  // A deep link naming a DIFFERENT flow must not hijack the one in progress.
  const hijack = oauthReducer(s, { type: "CALLBACK_SIGNAL", flowId: "flow-EVIL" });
  check("a deep link for another flow is ignored", hijack === s);

  // Only the server's status may complete a flow.
  const completed = oauthReducer(afterBrowser, { type: "STATUS_RESOLVED", flow: flow({ status: "completed" }) });
  check("only STATUS_RESOLVED can complete a flow", completed.status === "completed" && completed.phase === "done");
  check("only a server-confirmed completion refreshes Accounts", shouldRefreshAccounts(completed));
}
{
  const src = codeOf("src/oauth/oauth-state.ts");
  check("no reducer event carries a status from the device",
    !/BROWSER_RETURNED;[^}]*status/.test(src) && !/CALLBACK_SIGNAL;[^}]*status/.test(src));
  check("STATUS_RESOLVED is the only event carrying a server flow", (src.match(/flow: OAuthFlow/g) ?? []).length === 1);
  const ctrl = codeOf("src/oauth/use-oauth-flow.ts");
  check("the deep link handler only triggers an authenticated status read",
    /CALLBACK_SIGNAL[\s\S]{0,120}void resolve\(parsed\.flowId\)/.test(ctrl));
  check("the browser return only triggers an authenticated status read",
    /BROWSER_RETURNED[\s\S]{0,120}await resolve\(flowId\)/.test(ctrl));
  check("the controller never sets a status from a deep link",
    !/parsed\.[a-z]*status|parsed\.success/.test(ctrl));
  check("Accounts are marked stale ONLY on a server-confirmed completion",
    (ctrl.match(/markAccountsStale\(\)/g) ?? []).length === 2
    && /status === "completed"\) markAccountsStale\(\)/.test(ctrl));
}

/* -------------------------------------------------------------------------- */
/* 2. No credential leaves the app                                             */
/* -------------------------------------------------------------------------- */

console.log("\n2. Credential boundary");

for (const forbidden of [
  "META_CLIENT_SECRET", "META_APP_SECRET", "GOOGLE_BUSINESS_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET", "client_secret", "clientSecret",
  "access_token", "accessToken", "refresh_token", "refreshToken",
]) {
  const offenders = OAUTH_MODULES.filter((m) => codeOf(m).includes(forbidden));
  check(`no OAuth module contains "${forbidden}"`, offenders.length === 0, dump(offenders));
}
check("no OAuth module uses a WebView", !OAUTH_MODULES.some((m) => /WebView/.test(codeOf(m))));
check("no OAuth module constructs a Meta authorization URL",
  !OAUTH_MODULES.some((m) => /facebook\.com\/v\d|dialog\/oauth/.test(codeOf(m))));
check("no OAuth module constructs a Google authorization URL",
  !OAUTH_MODULES.some((m) => /accounts\.google\.com|oauth2\/v2\/auth/.test(codeOf(m))));
check("no OAuth module builds an authorization URL at all",
  !OAUTH_MODULES.some((m) => /response_type=code|client_id=/.test(codeOf(m))));
{
  const ctrl = codeOf("src/oauth/use-oauth-flow.ts");
  check("the browser is opened with the SERVER's URL, unmodified",
    /openAuthSessionAsync\(\s*authorizationUrl,/.test(ctrl));
  check("nothing is appended to the authorization URL",
    !/authorizationUrl\s*\+/.test(ctrl) && !/\$\{authorizationUrl\}/.test(ctrl));
  check("the system auth session is used, not a plain browser",
    /WebBrowser\.openAuthSessionAsync/.test(ctrl) && !/WebBrowser\.openBrowserAsync/.test(ctrl));
  check("the bearer is read from the canonical session storage only",
    (ctrl.match(/readToken\(\)/g) ?? []).length >= 1 && !/EXPO_PUBLIC_[A-Z_]*(TOKEN|SECRET)/.test(ctrl));
}
for (const m of OAUTH_MODULES) {
  const src = codeOf(m);
  check(`${m} never logs`, !/console\.(log|warn|error|info|debug)/.test(src));
  check(`${m} never names Authorization`, !src.includes("Authorization"));
  check(`${m} embeds no bearer literal`, !/Bearer\s[A-Za-z0-9]/.test(src));
}
{
  // The wire client sends no identity of its own.
  const api = codeOf("src/api/oauth.ts");
  check("the OAuth client exposes exactly six routes", Object.keys(OAUTH_ROUTES).length === 6);
  check("every route is under /api/mobile/oauth",
    OAUTH_ROUTES.providers.startsWith("/api/mobile/oauth")
    && OAUTH_ROUTES.start.startsWith("/api/mobile/oauth")
    && OAUTH_ROUTES.flow("x").startsWith("/api/mobile/oauth/flows/"));
  check("flow ids are URL-encoded", (api.match(/encodeURIComponent\(id\)/g) ?? []).length === 4);
  check("the client never sends tenant / user / role / session",
    !/tenantId|userId|\brole\b|sessionId/.test(api));
  check("start sends only provider, intent and ONE target",
    /provider: input\.provider/.test(api) && /intent: input\.intent/.test(api)
    && /brandId: input\.brandId/.test(api) && /accountId: input\.accountId/.test(api));
  check("the client issues only GET and POST", !/method:\s*"(PUT|PATCH|DELETE)"/.test(api));
}

/* -------------------------------------------------------------------------- */
/* 3. Device storage — the minimum, and nothing secret                         */
/* -------------------------------------------------------------------------- */

console.log("\n3. Device storage");

{
  const src = codeOf("src/oauth/oauth-storage.ts");
  for (const forbidden of ["state", "code", "token", "secret"]) {
    // The PendingFlow interface must declare none of these.
    const iface = src.slice(src.indexOf("export interface PendingFlow"), src.indexOf("export const PENDING_MAX_AGE_MS"));
    check(`the pending marker declares no "${forbidden}"`, !new RegExp(`\\b${forbidden}\\b`, "i").test(iface), iface.trim());
  }
  check("the marker stores exactly four fields",
    dump(Object.keys(parsePendingFlow(JSON.stringify({
      flowId: "f1", provider: "meta", intent: "connect", startedAt: NOW.toISOString(),
    }), NOW) ?? {}).sort()) === dump(["flowId", "intent", "provider", "startedAt"]));
}
{
  const valid = JSON.stringify({ flowId: "f1", provider: "meta", intent: "connect", startedAt: NOW.toISOString() });
  check("a valid marker parses", parsePendingFlow(valid, NOW)?.flowId === "f1");
  check("a null marker is null", parsePendingFlow(null, NOW) === null);
  check("malformed JSON is null", parsePendingFlow("{not json", NOW) === null);
  check("a non-object is null", parsePendingFlow('"hello"', NOW) === null);
  for (const bad of [
    { flowId: "../etc", provider: "meta", intent: "connect", startedAt: NOW.toISOString() },
    { flowId: "f1", provider: "evil", intent: "connect", startedAt: NOW.toISOString() },
    { flowId: "f1", provider: "meta", intent: "hack", startedAt: NOW.toISOString() },
    { flowId: "f1", provider: "meta", intent: "connect", startedAt: "not-a-date" },
    { flowId: "f1", provider: "meta", intent: "connect" },
    { provider: "meta", intent: "connect", startedAt: NOW.toISOString() },
  ]) {
    check(`an invalid marker is rejected: ${dump(bad).slice(0, 46)}`, parsePendingFlow(JSON.stringify(bad), NOW) === null);
  }
  const stale = JSON.stringify({
    flowId: "f1", provider: "meta", intent: "connect",
    startedAt: new Date(NOW.getTime() - PENDING_MAX_AGE_MS - 1).toISOString(),
  });
  check("a stale marker is dropped", parsePendingFlow(stale, NOW) === null);
  check("the marker window outlives the server TTL", PENDING_MAX_AGE_MS > 10 * 60 * 1000);
}
check("the marker uses the same keychain class as the session",
  /WHEN_UNLOCKED_THIS_DEVICE_ONLY/.test(codeOf("src/oauth/oauth-storage-deps.ts")));

/* -------------------------------------------------------------------------- */
/* 4. Reducer — the full lifecycle                                             */
/* -------------------------------------------------------------------------- */

console.log("\n4. Flow lifecycle");

{
  const s0 = initialOAuthState();
  check("the initial state is idle and empty", s0.phase === "idle" && s0.flowId === null && s0.status === null);

  const starting = oauthReducer(s0, { type: "START", provider: "meta", intent: "connect" });
  check("START enters 'starting'", starting.phase === "starting" && starting.provider === "meta");
  check("START is busy", isBusy(starting));

  const s = oauthReducer(starting, { type: "STARTED", flowId: "flow-1" });
  check("STARTED stores the correlation id", s.flowId === "flow-1" && s.phase === "awaiting_browser");
  check("STARTED sets no status", s.status === null);

  const failedStart = oauthReducer(starting, { type: "START_FAILED", error: "network" });
  check("a failed start returns to idle with a bounded error",
    failedStart.phase === "idle" && failedStart.error === "network");
}
for (const st of OAUTH_STATUSES) {
  const resolved = oauthReducer(started(), { type: "STATUS_RESOLVED", flow: flow({ status: st }) });
  check(`status "${st}" is adopted from the server`, resolved.status === st);
  const expectedPhase = st === "selection_required" ? "selecting" : isTerminal(st) ? "done" : "awaiting_browser";
  check(`status "${st}" maps to phase "${expectedPhase}"`, resolved.phase === expectedPhase, resolved.phase);
  check(`only "completed" refreshes Accounts (${st})`,
    shouldRefreshAccounts(resolved) === (st === "completed"));
}
check("didFail is true for every terminal non-completion", (() => {
  return (["failed", "cancelled", "expired"] as const).every((st) =>
    didFail(oauthReducer(started(), { type: "STATUS_RESOLVED", flow: flow({ status: st }) })));
})());
check("didFail is false for a completion",
  !didFail(oauthReducer(started(), { type: "STATUS_RESOLVED", flow: flow({ status: "completed" }) })));
{
  const failedRead = oauthReducer(started(), { type: "STATUS_FAILED", error: "network" });
  check("a failed status read RETAINS the flow id", failedRead.flowId === "flow-1");
  check("a failed status read never claims a completion", !shouldRefreshAccounts(failedRead));
}
{
  // Repeated signals must be safe.
  let s = started();
  s = oauthReducer(s, { type: "CALLBACK_SIGNAL", flowId: "flow-1" });
  const once = oauthReducer(s, { type: "STATUS_RESOLVED", flow: flow({ status: "completed" }) });
  const twice = oauthReducer(once, { type: "CALLBACK_SIGNAL", flowId: "flow-1" });
  const thrice = oauthReducer(twice, { type: "STATUS_RESOLVED", flow: flow({ status: "completed" }) });
  check("a repeated deep link is safe", thrice.status === "completed");
  check("a repeated status read is idempotent", dump(once.status) === dump(thrice.status));
}
{
  const reset = oauthReducer(
    oauthReducer(started(), { type: "STATUS_RESOLVED", flow: flow({ status: "completed" }) }),
    { type: "RESET" },
  );
  check("RESET clears everything", dump(reset) === dump(initialOAuthState()));
}

/* -------------------------------------------------------------------------- */
/* 5. Selection                                                                */
/* -------------------------------------------------------------------------- */

console.log("\n5. Selection");

{
  let s = oauthReducer(started(), { type: "STATUS_RESOLVED", flow: flow({ status: "selection_required" }) });
  check("selection_required enters 'selecting'", s.phase === "selecting");
  check("nothing can be submitted with no choice", !canSubmitSelection(s));

  s = oauthReducer(s, {
    type: "OPTIONS_LOADED",
    options: [option(), option({ id: "instagram:IG_A", kind: "instagram_business" }), option({ id: "facebook:PAGE_B", eligible: false, reason: "unverified" })],
  });
  check("options are stored", s.options.length === 3);

  s = oauthReducer(s, { type: "TOGGLE_OPTION", id: "facebook:PAGE_A" });
  check("an offered option can be ticked", dump(s.selected) === dump(["facebook:PAGE_A"]));
  check("a ticked option enables submit", canSubmitSelection(s));

  s = oauthReducer(s, { type: "TOGGLE_OPTION", id: "facebook:PAGE_A" });
  check("ticking again unticks", s.selected.length === 0);

  // Only options the SERVER offered, and only eligible ones.
  const forged = oauthReducer(s, { type: "TOGGLE_OPTION", id: "facebook:NOT_OFFERED" });
  check("an option the server never offered cannot be ticked", forged === s);
  const ineligible = oauthReducer(s, { type: "TOGGLE_OPTION", id: "facebook:PAGE_B" });
  check("an ineligible option cannot be ticked", ineligible === s);

  // A reload must not resurrect a tick for a vanished option.
  const ticked = oauthReducer(s, { type: "TOGGLE_OPTION", id: "instagram:IG_A" });
  const reloaded = oauthReducer(ticked, { type: "OPTIONS_LOADED", options: [option()] });
  check("a vanished option's tick is dropped on reload", dump(reloaded.selected) === dump([]));

  const submitting = oauthReducer(ticked, { type: "SUBMITTING" });
  check("SUBMITTING is busy", isBusy(submitting) && submitting.phase === "submitting");
  check("nothing can be submitted twice", !canSubmitSelection(submitting));

  const applied = oauthReducer(submitting, {
    type: "SELECTION_APPLIED", status: "completed", resultCode: null,
    connected: 2, limited: 1, slotTaken: 0,
  });
  check("a completed selection ends the flow", applied.phase === "done" && applied.status === "completed");
  check("the counts are carried for the confirmation", applied.connected === 2 && applied.limited === 1);
  check("a completed selection refreshes Accounts", shouldRefreshAccounts(applied));

  const rejected = oauthReducer(submitting, {
    type: "SELECTION_APPLIED", status: "failed", resultCode: "account_limit_reached",
    connected: 0, limited: 2, slotTaken: 0,
  });
  check("a failed selection does NOT refresh Accounts", !shouldRefreshAccounts(rejected));
  check("a failed selection carries the bounded reason", rejected.resultCode === "account_limit_reached");
}

/* -------------------------------------------------------------------------- */
/* 6. Screens and controller                                                   */
/* -------------------------------------------------------------------------- */

console.log("\n6. Screens and controller");

{
  const connect = codeOf("src/app/(app)/accounts/connect.tsx");
  check("the connect screen exists and shows both providers",
    /t\.oauth\.provider\[p\.provider\]/.test(connect));
  check("an unavailable provider cannot be started", /disabled=\{blocked\}/.test(connect));
  check("the selection step is NATIVE", /OptionRow/.test(connect) && /controller\.submit\(\)/.test(connect));
  check("the outcome is read from the SERVER's status",
    /state\.status === 'completed'/.test(connect));
  check("the screen never derives a result from a deep link",
    !/success|params\.get\('status'\)/.test(connect));
  check("a viewer sees no connect control", /!canManage/.test(connect));
  check("the browser step is explained before it happens", /browserNotice/.test(connect));
  check("the screen renders no raw server error", /messageFor\(/.test(connect));
  check("reconnect passes ONLY an account id",
    /intent: 'reconnect', accountId/.test(connect) && !/intent: 'reconnect'[^}]*brandId/.test(connect));
}
{
  const ctrl = codeOf("src/oauth/use-oauth-flow.ts");
  check("a cold start resumes from the persisted marker",
    /pendingFlowStorage\.read\(\)/.test(ctrl) && /CALLBACK_SIGNAL[\s\S]{0,80}pending\.flowId/.test(ctrl));
  check("resuming from the background re-reads the status",
    /AppState\.addEventListener/.test(ctrl) && /next !== "active"/.test(ctrl));
  check("the initial URL is handled for a cold deep link", /getInitialURL\(\)/.test(ctrl));
  check("concurrent status reads are guarded", /resolving\.current/.test(ctrl));
  check("cancel is server-authoritative", /cancelOAuthFlow\(token, current\.flowId\)/.test(ctrl));
  check("the marker is cleared on every terminal outcome",
    (ctrl.match(/pendingFlowStorage\.clear\(\)/g) ?? []).length >= 3);
  check("the controller starts no polling loop", !/setInterval/.test(ctrl));
  check("a session rejection is handed to the M2 machine",
    (ctrl.match(/onSessionRejected\(/g) ?? []).length >= 4);
}
{
  const list = codeOf("src/app/(app)/accounts/index.tsx");
  const detail = codeOf("src/app/(app)/accounts/[accountId].tsx");
  check("Accounts Connect starts the native flow", /router\.push\('\/accounts\/connect'\)/.test(list));
  check("Account detail Reconnect starts the native flow", /pathname: '\/accounts\/connect'/.test(detail));
  check("Reconnect sends the account id, never a brand",
    /accountId: account\.id/.test(detail) && !/brandId:/.test(detail));
  check("neither Accounts screen opens a URL",
    !/Linking\.openURL/.test(list) && !/Linking\.openURL/.test(detail));
}

/* -------------------------------------------------------------------------- */
/* 7. Localization                                                             */
/* -------------------------------------------------------------------------- */

console.log("\n7. Localization");

const locales: [string, typeof en][] = [["en", en], ["sk", sk as typeof en], ["de", de as typeof en]];
for (const [name, dict] of locales) {
  const missing = OAUTH_RESULT_CODES.filter(
    (c) => typeof (dict.oauth.reason as Record<string, string>)[c] !== "string",
  );
  check(`${name}: every bounded result code has a message`, missing.length === 0, dump(missing));
  for (const p of OAUTH_PROVIDERS) {
    check(`${name}: provider "${p}" has a label`, typeof (dict.oauth.provider as Record<string, string>)[p] === "string");
    check(`${name}: provider "${p}" has a hint`, typeof (dict.oauth.providerHint as Record<string, string>)[p] === "string");
  }
  check(`${name}: the browser step is explained`, dict.oauth.browserNotice.length > 40);
  check(`${name}: the browser notice says the user stays signed in to Tamanor`,
    /Tamanor/.test(dict.oauth.browserNotice));
  check(`${name}: the selection step is not phrased as a failure`,
    !/error|chyba|Fehler/i.test(dict.oauth.selectTitle));
  check(`${name}: no reason text is raw provider output`,
    Object.values(dict.oauth.reason).every((v) => !/Graph|OAuthException|EAAG|#\d{3}\)/.test(v)));
}
check("sk and en have the same oauth key shape",
  dump(Object.keys(en.oauth).sort()) === dump(Object.keys(sk.oauth).sort()));
check("de and en have the same oauth key shape",
  dump(Object.keys(en.oauth).sort()) === dump(Object.keys(de.oauth).sort()));

/* -------------------------------------------------------------------------- */
/* 8. Vocabularies                                                             */
/* -------------------------------------------------------------------------- */

console.log("\n8. Vocabularies");

check("providers are exactly meta + google_business", dump(OAUTH_PROVIDERS) === dump(["meta", "google_business"]));
check("intents are exactly connect + reconnect", dump(OAUTH_INTENTS) === dump(["connect", "reconnect"]));
check("selection_required is a first-class status", (OAUTH_STATUSES as readonly string[]).includes("selection_required"));
check("isTerminal covers the four terminal states",
  isTerminal("completed") && isTerminal("failed") && isTerminal("cancelled") && isTerminal("expired")
  && !isTerminal("selection_required") && !isTerminal("pending") && !isTerminal(null));

/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* 9. Storage behaviour (async)                                                */
/* -------------------------------------------------------------------------- */

/**
 * The only asynchronous assertions in the suite, so they live in one place rather
 * than forcing the whole file into a promise chain. The harness runs as CJS, which
 * has no top-level await.
 */
async function storageBehaviour(): Promise<void> {
  console.log("\n9. Storage behaviour");
  {
    // Storage failures must never break a flow — the server remains authoritative.
    const throwing = {
      getItemAsync: async () => { throw new Error("keychain locked"); },
      setItemAsync: async () => { throw new Error("keychain locked"); },
      deleteItemAsync: async () => { throw new Error("keychain locked"); },
    };
    const s = createPendingFlowStorage(throwing);
    check("a failing read yields null, not a throw", (await s.read(NOW)) === null);
    await s.write({ flowId: "f1", provider: "meta", intent: "connect", startedAt: NOW.toISOString() });
    await s.clear();
    check("a failing write and clear do not throw", true);

    const mem = new Map<string, string>();
    const good = {
      getItemAsync: async (k: string) => mem.get(k) ?? null,
      setItemAsync: async (k: string, v: string) => { mem.set(k, v); },
      deleteItemAsync: async (k: string) => { mem.delete(k); },
    };
    const st = createPendingFlowStorage(good);
    await st.write({ flowId: "f9", provider: "google_business", intent: "reconnect", startedAt: NOW.toISOString() });
    check("a written marker round-trips", (await st.read(NOW))?.flowId === "f9");
    check("the marker is stored under the dedicated key", mem.has(PENDING_FLOW_KEY));
    check("the marker is not stored under the session key", !mem.has("tamanor.session.token"));
    await st.clear();
    check("clearing removes the marker", (await st.read(NOW)) === null);
  }
}

async function main(): Promise<void> {
  await storageBehaviour();
  console.log(
    `\n${fail === 0 ? "PASS" : "FAIL"} — mobile connector OAuth client (M7): ${pass} passed, ${fail} failed`,
  );
  process.exit(fail === 0 ? 0 : 1);
}
void main();
