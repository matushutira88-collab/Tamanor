/**
 * M6 — mobile Accounts API.
 *
 * Deterministic tests in the house harness: no database, no Next, no provider. The
 * whole module is dependency-injected, so every rule below is exercised against a
 * fake `AccountsDeps` that records exactly what the handlers asked for.
 *
 * Asserted FIRST, because their violation would be unsafe rather than merely wrong:
 *   - the PROVIDER-WRITE boundary (only a read-only sync is reachable)
 *   - the TOKEN boundary (no token, fragment, refresh token or vault id in any DTO)
 *   - the OAUTH boundary (no bearer, secret or auth URL is produced server-side)
 *
 * Then the product rules:
 *   - connection / monitoring / auto-sync / capability stay FOUR separate truths
 *   - the canonical resolvers' verdicts are passed through, never re-derived
 *   - an unknown platform degrades to `unknown`, NEVER to Facebook
 *   - tenant comes from the session; a client tenantId/role/canEnable is ignored
 *   - the monitored-account limit is enforced by the canonical atomic function
 *   - a manual sync is blocked for reconnect-required, disconnected and unsupported
 *   - disconnect delegates to the canonical service and returns bounded results
 *
 * Run: pnpm mobile-accounts:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  ACCOUNT_KINDS, ACCOUNT_REASONS, AUTO_SYNC_STATES, CAPABILITY_STATES, CONNECTION_STATES,
  FIRST_SYNC_STATES, PLATFORM_KEYS, REVOKE_RESULTS, SYNC_RESULTS, SYNC_RUN_STATUSES,
  TOKEN_HEALTHS,
  countNeedsAttention, handleAccountDetail, handleAccountDisconnect, handleAccountSync,
  handleAccountsList, handleMonitoringToggle, normalizePlatform, normalizeReason,
  platformLabelFor, resolveCapabilities, toAccountDto, toDetailDto, toSyncRunDto,
  type AccountDetailSource, type AccountDto, type AccountSourceRow, type AccountsDeps,
} from "../src/server/mobile-accounts";

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

/** Every server module that participates in the mobile Accounts surface. */
const ACCOUNT_MODULES = [
  "src/server/mobile-accounts.ts",
  "src/server/mobile-accounts-deps.ts",
  "src/app/api/mobile/accounts/route.ts",
  "src/app/api/mobile/accounts/[accountId]/route.ts",
  "src/app/api/mobile/accounts/[accountId]/monitoring/route.ts",
  "src/app/api/mobile/accounts/[accountId]/sync/route.ts",
  "src/app/api/mobile/accounts/[accountId]/disconnect/route.ts",
];

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const AUTH = "Bearer good-token";

const row = (over: Partial<AccountSourceRow> = {}): AccountSourceRow => ({
  id: "a1",
  platform: "facebook_page",
  name: "Tamanor Page",
  username: null,
  monitoringEnabled: true,
  monitoringCanBeEnabled: true,
  connectionState: "CONNECTED_HEALTHY",
  autoSyncState: "ENABLED_HEALTHY",
  reconnectRequired: false,
  commentsToday: 12,
  riskToday: 2,
  lastSuccessAt: new Date("2026-02-01T09:00:00.000Z"),
  lastAttemptAt: new Date("2026-02-01T09:00:00.000Z"),
  accountKind: "real",
  firstSyncState: "synced",
  lastError: null,
  requiresReconnectReason: null,
  grantedPermissions: ["pages_manage_engagement"],
  ...over,
});

const detailSrc = (over: Partial<AccountDetailSource> = {}): AccountDetailSource => ({
  ...row(),
  tokenHealth: "ok",
  tokenExpiresAt: new Date("2026-06-01T00:00:00.000Z"),
  lastSuccessfulGraphCheckAt: new Date("2026-02-01T08:00:00.000Z"),
  killSwitch: false,
  globalKillSwitch: false,
  brandName: "Tamanor",
  syncRuns: [],
  ...over,
});

interface Spy {
  enableCalls: { tenantId: string; accountId: string }[];
  disableCalls: { tenantId: string; accountId: string }[];
  syncCalls: { tenantId: string; accountId: string }[];
  disconnectCalls: { tenantId: string; accountId: string }[];
  audits: { event: string; targetId: string; metadata: Record<string, unknown> }[];
}

function makeDeps(over: Partial<AccountsDeps> = {}, spy?: Spy): AccountsDeps {
  const s = spy ?? { enableCalls: [], disableCalls: [], syncCalls: [], disconnectCalls: [], audits: [] };
  return {
    readUserSession: async (token) =>
      token === "good-token"
        ? {
            ok: true,
            session: {
              userId: "u1", tenantId: "tenant-a", role: "owner",
              emailVerified: true, workspaceKind: "business",
            } as never,
          }
        : { ok: false, reason: "session_revoked" as never },
    classifyWorkspace: () => "business",
    emitOpsEvent: () => {},
    canManageConnectors: () => true,
    listAccounts: async () => ({ rows: [row()], capacity: { used: 1, limit: 5, remaining: 4 }, monitored: 1 }),
    getAccount: async () => detailSrc(),
    getAccountRow: async () => row(),
    getCapacity: async () => ({ used: 1, limit: 5, remaining: 4, monitored: 1 }),
    enableMonitoring: async (i) => { s.enableCalls.push(i); return { ok: true }; },
    disableMonitoring: async (i) => { s.disableCalls.push(i); return 1; },
    startReadOnlySync: (i) => { s.syncCalls.push(i); },
    hasActiveSyncLease: async () => false,
    disconnectAccount: async (i) => {
      s.disconnectCalls.push(i);
      return { found: true, clusterCount: 2, clusterPlatforms: ["facebook_page", "instagram_business"], providerRevoke: "unsupported", manualCleanupRecommended: true };
    },
    writeAudit: async (a) => { s.audits.push({ event: a.event, targetId: a.targetId, metadata: a.metadata }); },
    ...over,
  };
}

/** Every string that appears anywhere inside a response body. */
function allStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => allStrings(x, out));
  return out;
}
/** Every key that appears anywhere inside a response body. */
function allKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v)) { out.push(k); allKeys(val, out); }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* 1. PROVIDER-WRITE BOUNDARY                                                  */
/* -------------------------------------------------------------------------- */

console.log("\n1. Provider-write boundary");

/** Moderation verbs must not be callable from any mobile accounts module. */
const MODERATION_PATTERNS: [string, RegExp][] = [
  ["attemptFacebookHide", /attemptFacebookHide/],
  ["runHideForQueueItem", /runHideForQueueItem/],
  ["hideComment", /hideComment/],
  ["deleteComment", /deleteComment/],
  ["replyToComment|postReply", /replyToComment|postReply|publishReply/],
  ["executeLiveHide", /executeLiveHide/],
  ["toggleAccountKillSwitch", /toggleAccountKillSwitch|setKillSwitch/],
  ["moderation transport", /instagram-moderation|live-actions/],
];
for (const [label, re] of MODERATION_PATTERNS) {
  const offenders = ACCOUNT_MODULES.filter((m) => re.test(codeOf(m)));
  check(`no accounts module references ${label}`, offenders.length === 0, dump(offenders));
}

const depsSrc = codeOf("src/server/mobile-accounts-deps.ts");
check("the only @guardora/sync import is the read-only sync + canonical disconnect",
  /import \{ runReadOnlySync, disconnectAccount \} from "@guardora\/sync"/.test(depsSrc));
check("the sync trigger is the canonical read-only service",
  /runReadOnlySync\(\{ accountId, tenantId \}, "manual"\)/.test(depsSrc));
check("disconnect delegates to the canonical service",
  /disconnectAccount\(tenantId, accountId\)/.test(depsSrc));
check("no accounts module nulls a token column itself",
  !ACCOUNT_MODULES.some((m) => /accessToken:\s*null|longLivedToken:\s*null|refreshToken:\s*null/.test(codeOf(m))));
check("the pure service imports no runtime value",
  !/^import (?!type )/m.test(codeOf("src/server/mobile-accounts.ts")));

/** The sync result vocabulary cannot express a moderation outcome. */
check("SYNC_RESULTS is bounded to five read-only outcomes",
  dump(SYNC_RESULTS) === dump(["started", "already_running", "reconnect_required", "not_supported", "not_found"]));
for (const forbidden of ["hidden", "deleted", "replied", "moderated", "executed"]) {
  check(`SYNC_RESULTS has no "${forbidden}" member`, !(SYNC_RESULTS as readonly string[]).includes(forbidden));
}

/* -------------------------------------------------------------------------- */
/* 2. TOKEN BOUNDARY                                                           */
/* -------------------------------------------------------------------------- */

console.log("\n2. Token boundary");

const TOKEN_TOKENS = [
  "accessToken", "longLivedToken", "refreshToken", "pageAccessToken",
  "vaultId", "credentialId", "client_secret", "clientSecret", "Authorization:",
];
for (const t of TOKEN_TOKENS) {
  const offenders = ACCOUNT_MODULES.filter((m) => codeOf(m).includes(t));
  check(`no accounts module names "${t}"`, offenders.length === 0, dump(offenders));
}
check("the detail query selects no token column",
  !/select:[\s\S]{0,900}(accessToken|longLivedToken|refreshToken)/.test(depsSrc));

{
  const res = await handleAccountDetail({ authorization: AUTH, accountId: "a1" }, makeDeps());
  const keys = allKeys(res.body);
  for (const forbidden of ["accessToken", "longLivedToken", "refreshToken", "token", "secret", "lastCursor", "scopes"]) {
    check(`the detail DTO has no "${forbidden}" key`, !keys.includes(forbidden), dump(keys.filter((k) => k.toLowerCase().includes(forbidden.toLowerCase()))));
  }
  check("the detail DTO carries only a bounded tokenHealth key",
    keys.includes("tokenHealth")
    && (TOKEN_HEALTHS as readonly string[]).includes(
      (res.body as { account: { tokenHealth: string } }).account.tokenHealth));
  check("no tenantId or brandId leaks into the detail DTO",
    !keys.includes("tenantId") && !keys.includes("brandId"));
}

/* -------------------------------------------------------------------------- */
/* 3. OAUTH BOUNDARY                                                           */
/* -------------------------------------------------------------------------- */

console.log("\n3. OAuth boundary");

for (const t of ["buildMetaAuthUrl", "facebook.com/v", "accounts.google.com", "oauth2/auth", "oauth_state", "META_APP_SECRET", "GOOGLE_CLIENT_SECRET"]) {
  const offenders = ACCOUNT_MODULES.filter((m) => codeOf(m).includes(t));
  check(`no accounts module produces "${t}"`, offenders.length === 0, dump(offenders));
}
check("no accounts route redirects", !ACCOUNT_MODULES.some((m) => /NextResponse\.redirect|redirect\(/.test(codeOf(m))));
check("no accounts route reads a cookie", !ACCOUNT_MODULES.some((m) => /cookies\(\)/.test(codeOf(m))));
{
  const res = await handleAccountsList({ authorization: AUTH }, makeDeps());
  const strings = allStrings(res.body);
  check("no response string is an external URL", !strings.some((s) => /^https?:\/\//.test(s)), dump(strings.filter((s) => /^https?:/.test(s))));
  check("no response string contains a bearer", !strings.some((s) => /Bearer\s/i.test(s)));
}

/* -------------------------------------------------------------------------- */
/* 4. Authentication and workspace                                             */
/* -------------------------------------------------------------------------- */

console.log("\n4. Authentication and workspace");

const HANDLERS: [string, (auth: string | null, deps: AccountsDeps) => Promise<{ status: number; body: Record<string, unknown> }>][] = [
  ["list", (a, d) => handleAccountsList({ authorization: a }, d)],
  ["detail", (a, d) => handleAccountDetail({ authorization: a, accountId: "a1" }, d)],
  ["monitoring", (a, d) => handleMonitoringToggle({ authorization: a, accountId: "a1", body: { enabled: true } }, d)],
  ["sync", (a, d) => handleAccountSync({ authorization: a, accountId: "a1" }, d)],
  ["disconnect", (a, d) => handleAccountDisconnect({ authorization: a, accountId: "a1" }, d)],
];

for (const [name, call] of HANDLERS) {
  check(`${name}: a missing bearer is 401`, (await call(null, makeDeps())).status === 401);
  check(`${name}: a malformed bearer is 401`, (await call("Token abc", makeDeps())).status === 401);
  check(`${name}: "Bearer" with no value is 401`, (await call("Bearer", makeDeps())).status === 401);
  {
    const r = await call("Bearer revoked", makeDeps());
    check(`${name}: a revoked session is 401 session_revoked`, r.status === 401 && r.body.error === "session_revoked", dump(r.body));
  }
  {
    const deps = makeDeps({
      readUserSession: async () => ({ ok: true, session: { userId: "u", tenantId: "t", role: "owner", emailVerified: false, workspaceKind: "business" } as never }),
    });
    const r = await call(AUTH, deps);
    check(`${name}: an unverified email is 403 verification_required`, r.status === 403 && r.body.error === "verification_required", dump(r.body));
  }
  {
    const deps = makeDeps({ classifyWorkspace: () => "family" });
    const r = await call(AUTH, deps);
    check(`${name}: a FAMILY workspace is 403 workspace_unsupported`, r.status === 403 && r.body.error === "workspace_unsupported", dump(r.body));
  }
  {
    const deps = makeDeps({ classifyWorkspace: () => "unsupported" });
    const r = await call(AUTH, deps);
    check(`${name}: an unknown workspace is 403 workspace_unsupported`, r.status === 403 && r.body.error === "workspace_unsupported");
  }
}

/* -------------------------------------------------------------------------- */
/* 5. Tenancy — never from the client                                          */
/* -------------------------------------------------------------------------- */

console.log("\n5. Tenancy");

{
  const seen: string[] = [];
  const deps = makeDeps({
    listAccounts: async ({ tenantId }) => { seen.push(tenantId); return { rows: [], capacity: { used: 0, limit: 5, remaining: 5 }, monitored: 0 }; },
  });
  await handleAccountsList({ authorization: AUTH }, deps);
  check("the list reads the tenant from the SESSION", dump(seen) === dump(["tenant-a"]), dump(seen));
}
{
  const spy: Spy = { enableCalls: [], disableCalls: [], syncCalls: [], disconnectCalls: [], audits: [] };
  const deps = makeDeps({}, spy);
  // A forged tenantId / role / canEnable in the body must change nothing.
  await handleMonitoringToggle({
    authorization: AUTH, accountId: "a1",
    body: { enabled: true, tenantId: "tenant-b", role: "owner", monitoringCanBeEnabled: true, limit: 999 },
  }, deps);
  check("a forged tenantId in the body is ignored", spy.enableCalls[0]?.tenantId === "tenant-a", dump(spy.enableCalls));
  check("a forged limit in the body is ignored (the atomic function decides)", spy.enableCalls.length === 1);
}
check("the pure service never reads a tenantId from a request",
  !/req\.[a-zA-Z]*tenant|body\.[a-zA-Z]*tenant|body as \{[^}]*tenantId/.test(codeOf("src/server/mobile-accounts.ts")));

/* -------------------------------------------------------------------------- */
/* 6. THE FOUR SEPARATE TRUTHS                                                 */
/* -------------------------------------------------------------------------- */

console.log("\n6. Four separate truths");

{
  // Connected + monitoring OFF + auto-sync running must remain representable.
  const dto = toAccountDto(row({ monitoringEnabled: false, autoSyncState: "ENABLED_HEALTHY" }), true);
  check("connected + monitoring off + auto-sync running is representable",
    dto.connectionState === "CONNECTED_HEALTHY" && dto.monitoringEnabled === false && dto.autoSyncState === "ENABLED_HEALTHY");

  // Reconnect required + monitoring ON must NOT read as healthy anywhere.
  const bad = toAccountDto(row({
    connectionState: "REAUTH_REQUIRED", reconnectRequired: true,
    monitoringEnabled: true, autoSyncState: "ENABLED_REAUTH_REQUIRED",
    requiresReconnectReason: "no_token",
  }), true);
  check("reconnect required + monitoring on keeps the reconnect state",
    bad.connectionState === "REAUTH_REQUIRED" && bad.monitoringEnabled === true);
  check("reconnect required never becomes CONNECTED_HEALTHY", bad.connectionState !== "CONNECTED_HEALTHY");
  check("reconnect required surfaces needsReconnect", bad.needsReconnect === true);
  check("reconnect required carries a bounded reason", bad.reason === "no_token");
  check("reconnect required is not syncable", bad.capabilities.canSync === "unavailable");

  check("there is no single collapsed status field",
    !("status" in dto) && !("active" in dto) && !("ok" in dto), dump(Object.keys(dto)));
  check("the four truths are four distinct fields",
    "connectionState" in dto && "monitoringEnabled" in dto && "autoSyncState" in dto && "capabilities" in dto);
}

/* -------------------------------------------------------------------------- */
/* 7. Canonical state pass-through                                             */
/* -------------------------------------------------------------------------- */

console.log("\n7. Canonical states");

for (const state of CONNECTION_STATES) {
  const dto = toAccountDto(row({ connectionState: state }), true);
  check(`connection state "${state}" is passed through verbatim`, dto.connectionState === state);
}
check("an unknown connection state degrades to DISCONNECTED, never to healthy",
  toAccountDto(row({ connectionState: "SOMETHING_NEW" }), true).connectionState === "DISCONNECTED");
check("a prototype key cannot become a connection state",
  toAccountDto(row({ connectionState: "__proto__" }), true).connectionState === "DISCONNECTED");

for (const state of AUTO_SYNC_STATES) {
  check(`auto-sync state "${state}" is passed through verbatim`,
    toAccountDto(row({ autoSyncState: state }), true).autoSyncState === state);
}
check("an unknown auto-sync state degrades to NOT_CONFIGURED",
  toAccountDto(row({ autoSyncState: "nope" }), true).autoSyncState === "NOT_CONFIGURED");

for (const state of FIRST_SYNC_STATES) {
  check(`first-sync state "${state}" is passed through verbatim`,
    toAccountDto(row({ firstSyncState: state }), true).firstSyncState === state);
}
check("a never-synced account is waiting_first_sync, NOT failed",
  toAccountDto(row({ firstSyncState: "waiting_first_sync", lastSuccessAt: null }), true).firstSyncState === "waiting_first_sync");
check("an unknown first-sync state degrades to waiting_first_sync, never to failed",
  toAccountDto(row({ firstSyncState: "???" }), true).firstSyncState === "waiting_first_sync");

for (const kind of ACCOUNT_KINDS) {
  check(`account kind "${kind}" is passed through verbatim`,
    toAccountDto(row({ accountKind: kind }), true).accountKind === kind);
}
check("an unknown account kind degrades to test (the least-privileged reading)",
  toAccountDto(row({ accountKind: "??" }), true).accountKind === "test");

check("the service does not re-derive connection state",
  !/resolveConnectionState|health ===|tokenExpiresAt <|connectionStatus ===/.test(codeOf("src/server/mobile-accounts.ts")));
check("the deps layer uses the canonical batched overview",
  /getDashboardAccountsOverview\(tenantId\)/.test(depsSrc));
check("the deps layer uses the canonical first-sync resolver",
  /deriveFirstSyncState\(\{/.test(depsSrc));
check("the deps layer uses the canonical active-lease query",
  /getActiveSyncLeaseAccountIds\(tenantId\)/.test(depsSrc));

/* -------------------------------------------------------------------------- */
/* 8. Platform — no Facebook fallback                                          */
/* -------------------------------------------------------------------------- */

console.log("\n8. Platform mapping");

for (const p of PLATFORM_KEYS) {
  check(`platform "${p}" round-trips`, normalizePlatform(p) === p);
  check(`platform "${p}" has a non-empty label`, platformLabelFor(p).length > 0);
}
for (const unknown of ["threads", "bluesky", "", "__proto__", "constructor", "FACEBOOK_PAGE"]) {
  check(`unknown platform "${unknown}" becomes unknown`, normalizePlatform(unknown) === "unknown");
  check(`unknown platform "${unknown}" NEVER becomes facebook`, normalizePlatform(unknown) !== "facebook_page");
}
check("a null platform becomes unknown", normalizePlatform(null) === "unknown");
check("the unknown label is generic, not a platform name",
  !/facebook|instagram|google/i.test(platformLabelFor("unknown")));
check("google_business is labelled as Google", /google/i.test(platformLabelFor("google_business")));
check("google_business is never labelled Facebook", !/facebook/i.test(platformLabelFor("google_business")));
check("no accounts module contains a two-way platform conditional",
  !ACCOUNT_MODULES.some((m) => /instagram["']?\s*\?[^:]*:\s*["']?facebook/i.test(codeOf(m))));

{
  const dto = toAccountDto(row({ platform: "google_business", grantedPermissions: [] }), true);
  check("a Google Business row keeps its own platform key", dto.platform === "google_business");
  check("a Google Business row is labelled Google Business", dto.platformLabel === "Google Business Profile");
}

/* -------------------------------------------------------------------------- */
/* 9. Capabilities — truthful, never optimistic                                */
/* -------------------------------------------------------------------------- */

console.log("\n9. Capabilities");

const capOf = (over: Parameters<typeof resolveCapabilities>[0]) => resolveCapabilities(over);
const base = { connectionState: "CONNECTED_HEALTHY", accountKind: "real", grantedPermissions: ["pages_manage_engagement"], canManage: true } as const;

{
  const fb = capOf({ ...base, platform: "facebook_page" });
  check("Facebook can read", fb.canRead === "available");
  check("Facebook can sync", fb.canSync === "available");
  check("Facebook can monitor", fb.canMonitor === "available");
  check("Facebook can disconnect", fb.canDisconnect === "available");
  check("reconnect always requires the web", fb.canReconnect === "requires_web");
  check("reply is reported as not implemented", fb.replyState === "not_implemented");
  check("moderation is never 'available' from mobile", fb.moderationState !== "available");

  const ig = capOf({ ...base, platform: "instagram_business" });
  check("Instagram can sync", ig.canSync === "available");
  check("Instagram moderation is not implemented here", ig.moderationState === "not_implemented");

  // Google Business locations are real ConnectedAccount rows, but `runReadOnlySync`
  // has no ingestion for them — claiming otherwise would fire a doomed request.
  const gb = capOf({ ...base, platform: "google_business", grantedPermissions: [] });
  check("Google Business can read", gb.canRead === "available");
  check("Google Business sync is truthfully requires_web, not available", gb.canSync === "requires_web");
  check("Google Business can still be monitored", gb.canMonitor === "available");
  check("Google Business can be disconnected", gb.canDisconnect === "available");
  check("Google Business moderation is not implemented", gb.moderationState === "not_implemented");

  const unk = capOf({ ...base, platform: "unknown", grantedPermissions: [] });
  check("an unknown platform is not claimed syncable", unk.canSync === "requires_web");

  const reauth = capOf({ ...base, platform: "facebook_page", connectionState: "REAUTH_REQUIRED" });
  check("a reconnect-required account cannot sync", reauth.canSync === "unavailable");
  const gone = capOf({ ...base, platform: "facebook_page", connectionState: "DISCONNECTED" });
  check("a disconnected account cannot read", gone.canRead === "unavailable");
  check("a disconnected account cannot sync", gone.canSync === "unavailable");
  check("a disconnected account cannot be disconnected again", gone.canDisconnect === "unavailable");

  const viewer = capOf({ ...base, platform: "facebook_page", canManage: false });
  check("a viewer cannot sync", viewer.canSync === "missing_permission");
  check("a viewer cannot monitor", viewer.canMonitor === "missing_permission");
  check("a viewer cannot disconnect", viewer.canDisconnect === "missing_permission");
  check("a viewer can still read", viewer.canRead === "available");

  const noPerm = capOf({ ...base, platform: "facebook_page", grantedPermissions: [] });
  check("Facebook without the engagement permission reports missing_permission",
    noPerm.moderationState === "missing_permission");

  const test = capOf({ ...base, platform: "facebook_page", accountKind: "test" });
  check("a demo account has no moderation capability", test.moderationState === "unavailable");

  const all = Object.values(fb).concat(Object.values(gb), Object.values(viewer));
  check("every capability value is bounded", all.every((v) => (CAPABILITY_STATES as readonly string[]).includes(v)), dump(all));
}

/* -------------------------------------------------------------------------- */
/* 10. Reason normalization — no raw provider text                             */
/* -------------------------------------------------------------------------- */

console.log("\n10. Reason normalization");

for (const r of ACCOUNT_REASONS) check(`reason "${r}" round-trips`, normalizeReason(r) === r);
check("a null reason stays null", normalizeReason(null) === null);
check("an empty reason stays null", normalizeReason("") === null);
for (const raw of [
  "(#200) Requires pages_manage_engagement",
  "Error validating access token: Session has expired on Tuesday",
  "OAuthException: The access token EAAG... is invalid",
  "ECONNRESET",
  "__proto__",
]) {
  const out = normalizeReason(raw);
  check(`raw provider text is normalized away: ${raw.slice(0, 28)}…`, out === "unknown", dump(out));
}
check("a normalized reason never contains a token fragment",
  normalizeReason("token EAAGm0PX4ZCpsBA") === "unknown");

{
  const runs = [
    { id: "r1", status: "failed", startedAt: new Date("2026-02-01T09:00:00.000Z"), finishedAt: new Date("2026-02-01T09:00:05.000Z"), fetched: 0, created: 0, error: "Graph API error: (#190) invalid token EAAG...", mock: false },
    { id: "r2", status: "rate_limited", startedAt: new Date("2026-02-01T08:00:00.000Z"), finishedAt: null, fetched: 0, created: 0, error: "rate limited, retry after 3600s", mock: false },
    { id: "r3", status: "completed", startedAt: new Date("2026-02-01T07:00:00.000Z"), finishedAt: new Date("2026-02-01T07:00:09.000Z"), fetched: 30, created: 4, error: null, mock: true },
  ];
  const dtos = runs.map(toSyncRunDto);
  check("a failed run maps to a bounded reason", dtos[0]!.reason === "sync_failed", dump(dtos[0]));
  check("a rate-limited run maps to rate_limited", dtos[1]!.reason === "rate_limited");
  check("a successful run carries no reason", dtos[2]!.reason === null);
  check("the raw run error text NEVER travels",
    !allStrings(dtos).some((s) => /Graph API|EAAG|retry after/.test(s)), dump(allStrings(dtos)));
  check("run counts are bounded numbers only", dtos[2]!.fetched === 30 && dtos[2]!.created === 4);
  check("a demo run is flagged as demo", dtos[2]!.demo === true);
  check("every run status is bounded", dtos.every((d) => (SYNC_RUN_STATUSES as readonly string[]).includes(d.status)));
  const keys = allKeys(dtos);
  for (const forbidden of ["cursor", "error", "durationMs", "deduped"]) {
    check(`the sync-run DTO has no "${forbidden}" key`, !keys.includes(forbidden));
  }
}

/* -------------------------------------------------------------------------- */
/* 11. List response                                                           */
/* -------------------------------------------------------------------------- */

console.log("\n11. List response");

{
  const rows = [
    row({ id: "a1", connectionState: "CONNECTED_HEALTHY" }),
    row({ id: "a2", connectionState: "REAUTH_REQUIRED", reconnectRequired: true }),
    row({ id: "a3", platform: "google_business", connectionState: "WAITING_FIRST_SYNC", firstSyncState: "waiting_first_sync", lastSuccessAt: null }),
  ];
  const deps = makeDeps({ listAccounts: async () => ({ rows, capacity: { used: 2, limit: 5, remaining: 3 }, monitored: 2 }) });
  const res = await handleAccountsList({ authorization: AUTH }, deps);
  const body = res.body as unknown as { accounts: AccountDto[]; capacity: { used: number; limit: number; remaining: number; monitored: number }; capabilities: { canManageConnectors: boolean }; needsAttention: number };

  check("the list is 200", res.status === 200);
  check("every account is returned", body.accounts.length === 3);
  check("capacity is returned", body.capacity.used === 2 && body.capacity.limit === 5 && body.capacity.remaining === 3);
  check("monitored usage is returned", body.capacity.monitored === 2);
  check("the connector capability is returned", body.capabilities.canManageConnectors === true);
  check("needsAttention counts only non-healthy accounts", body.needsAttention === 2, String(body.needsAttention));
  check("a healthy account is not counted as needing attention",
    countNeedsAttention([toAccountDto(row(), true)]) === 0);

  const strings = allStrings(body);
  check("no raw provider text appears anywhere in the list", !strings.some((s) => /Graph|OAuth|EAAG|#\d{3}\)/.test(s)));
  check("an unlimited plan is reported as -1, never as 0",
    ((await handleAccountsList({ authorization: AUTH }, makeDeps({
      listAccounts: async () => ({ rows: [], capacity: { used: 0, limit: -1, remaining: -1 }, monitored: 0 }),
    }))).body as { capacity: { limit: number } }).capacity.limit === -1);
}
{
  const deps = makeDeps({ canManageConnectors: () => false });
  const res = await handleAccountsList({ authorization: AUTH }, deps);
  const body = res.body as unknown as { accounts: AccountDto[]; capabilities: { canManageConnectors: boolean } };
  check("a viewer can still READ the list", res.status === 200 && body.accounts.length === 1);
  check("a viewer is told it cannot manage", body.capabilities.canManageConnectors === false);
  check("a viewer's rows report canManage false", body.accounts[0]!.canManage === false);
}
{
  const deps = makeDeps({ listAccounts: async () => { throw new Error("db down"); } });
  const res = await handleAccountsList({ authorization: AUTH }, deps);
  check("a data failure is a generic 500", res.status === 500 && res.body.error === "server_error");
  check("a thrown error message never reaches the body", !dump(res.body).includes("db down"));
}

/* -------------------------------------------------------------------------- */
/* 12. Detail response                                                         */
/* -------------------------------------------------------------------------- */

console.log("\n12. Detail response");

{
  const res = await handleAccountDetail({ authorization: AUTH, accountId: "a1" }, makeDeps());
  const account = (res.body as { account: Record<string, unknown> }).account;
  check("the detail is 200", res.status === 200);
  check("the detail carries the brand name", account.brandName === "Tamanor");
  check("the detail carries the provider check time", typeof account.lastSuccessfulProviderCheckAt === "string");
  check("the detail reports protection paused as a display-only fact", account.protectionPaused === false);
}
{
  const deps = makeDeps({ getAccount: async () => detailSrc({ globalKillSwitch: true }) });
  const res = await handleAccountDetail({ authorization: AUTH, accountId: "a1" }, deps);
  check("a global kill switch shows protection paused",
    ((res.body as { account: { protectionPaused: boolean } }).account).protectionPaused === true);
}
check("no accounts module WRITES the kill switch (reading it for display is fine)",
  !ACCOUNT_MODULES.some((m) => /data:\s*\{[^}]*killSwitch/.test(codeOf(m)))
  && !ACCOUNT_MODULES.some((m) => /killSwitch\s*=[^=]/.test(codeOf(m))));
check("no accounts module updates a ConnectedAccount row directly",
  !ACCOUNT_MODULES.some((m) => /connectedAccount\.(update|updateMany|delete|create)/.test(codeOf(m))));

{
  // A foreign account and a missing account must be ONE outcome.
  const missing = await handleAccountDetail({ authorization: AUTH, accountId: "gone" }, makeDeps({ getAccount: async () => null }));
  const foreign = await handleAccountDetail({ authorization: AUTH, accountId: "tenant-b-acct" }, makeDeps({ getAccount: async () => null }));
  check("a missing account is 404 not_found", missing.status === 404 && missing.body.error === "not_found");
  check("a foreign account is INDISTINGUISHABLE from missing", dump(foreign) === dump(missing));
  check("an empty accountId is 400", (await handleAccountDetail({ authorization: AUTH, accountId: "  " }, makeDeps())).status === 400);
}
{
  const src = detailSrc({
    syncRuns: [
      { id: "r1", status: "completed", startedAt: new Date("2026-02-01T09:00:00.000Z"), finishedAt: new Date("2026-02-01T09:00:03.000Z"), fetched: 10, created: 2, error: null, mock: false },
      { id: "r2", status: "failed", startedAt: new Date("2026-02-01T08:00:00.000Z"), finishedAt: null, fetched: 0, created: 0, error: "boom EAAG", mock: false },
    ],
  });
  const res = await handleAccountDetail({ authorization: AUTH, accountId: "a1" }, makeDeps({ getAccount: async () => src }));
  const account = (res.body as { account: { syncRuns: { id: string; reason: string | null }[] } }).account;
  check("bounded sync history is returned", account.syncRuns.length === 2);
  check("a failed run's reason is bounded", account.syncRuns[1]!.reason === "sync_failed");
  check("no run error text survives", !allStrings(account).some((s) => s.includes("boom")));
}
for (const state of CONNECTION_STATES) {
  const res = await handleAccountDetail({ authorization: AUTH, accountId: "a1" },
    makeDeps({ getAccount: async () => detailSrc({ connectionState: state }) }));
  check(`detail renders connection state "${state}"`,
    ((res.body as { account: { connectionState: string } }).account).connectionState === state);
}
{
  const dto = toDetailDto(detailSrc({ tokenHealth: "totally-made-up" }), true);
  check("an unknown token health degrades to unknown, never to ok", dto.tokenHealth === "unknown");
  check("a prototype token health degrades to unknown",
    toDetailDto(detailSrc({ tokenHealth: "__proto__" }), true).tokenHealth === "unknown");
}

/* -------------------------------------------------------------------------- */
/* 13. Monitoring mutation                                                     */
/* -------------------------------------------------------------------------- */

console.log("\n13. Monitoring");

{
  const spy: Spy = { enableCalls: [], disableCalls: [], syncCalls: [], disconnectCalls: [], audits: [] };
  const res = await handleMonitoringToggle({ authorization: AUTH, accountId: "a1", body: { enabled: true } }, makeDeps({}, spy));
  check("enable is 200", res.status === 200);
  check("enable goes through the canonical atomic function", spy.enableCalls.length === 1 && spy.disableCalls.length === 0);
  check("enable returns the canonical account", typeof (res.body as { account: { id: string } }).account.id === "string");
  check("enable returns canonical capacity", typeof (res.body as { capacity: { used: number } }).capacity.used === "number");
  check("enable writes a token-free audit entry",
    spy.audits.length === 1 && spy.audits[0]!.event === "account.monitoring_enabled"
    && !dump(spy.audits[0]!.metadata).toLowerCase().includes("token"), dump(spy.audits));
}
{
  const spy: Spy = { enableCalls: [], disableCalls: [], syncCalls: [], disconnectCalls: [], audits: [] };
  const res = await handleMonitoringToggle({ authorization: AUTH, accountId: "a1", body: { enabled: false } }, makeDeps({}, spy));
  check("disable is 200", res.status === 200);
  check("disable goes through the canonical setter", spy.disableCalls.length === 1 && spy.enableCalls.length === 0);
  check("disable writes its own audit event", spy.audits[0]!.event === "account.monitoring_disabled");
}
{
  const deps = makeDeps({ enableMonitoring: async () => ({ ok: false, reason: "account_limit_reached" }) });
  const res = await handleMonitoringToggle({ authorization: AUTH, accountId: "a1", body: { enabled: true } }, deps);
  check("a plan limit is 409 account_limit_reached", res.status === 409 && res.body.error === "account_limit_reached", dump(res.body));
}
{
  // The client's own `monitoringCanBeEnabled` must not be able to bypass the limit.
  const deps = makeDeps({
    enableMonitoring: async () => ({ ok: false, reason: "account_limit_reached" }),
    getAccountRow: async () => row({ monitoringCanBeEnabled: true }),
  });
  const res = await handleMonitoringToggle({ authorization: AUTH, accountId: "a1", body: { enabled: true, monitoringCanBeEnabled: true } }, deps);
  check("a forged monitoringCanBeEnabled cannot bypass the limit", res.status === 409);
}
{
  const deps = makeDeps({ canManageConnectors: () => false });
  const res = await handleMonitoringToggle({ authorization: AUTH, accountId: "a1", body: { enabled: true } }, deps);
  check("a viewer cannot toggle monitoring", res.status === 403 && res.body.error === "permission_denied");
}
for (const bad of [{}, { enabled: "true" }, { enabled: 1 }, null, "enabled", { enable: true }]) {
  const res = await handleMonitoringToggle({ authorization: AUTH, accountId: "a1", body: bad }, makeDeps());
  check(`a malformed monitoring body is 400: ${dump(bad)}`, res.status === 400 && res.body.error === "invalid_request");
}
{
  const deps = makeDeps({ disableMonitoring: async () => 0 });
  const res = await handleMonitoringToggle({ authorization: AUTH, accountId: "foreign", body: { enabled: false } }, deps);
  check("disabling a foreign account is 404 not_found", res.status === 404 && res.body.error === "not_found");
}
{
  // Idempotence: repeating an enable/disable must stay safe.
  const spy: Spy = { enableCalls: [], disableCalls: [], syncCalls: [], disconnectCalls: [], audits: [] };
  const deps = makeDeps({}, spy);
  await handleMonitoringToggle({ authorization: AUTH, accountId: "a1", body: { enabled: true } }, deps);
  const second = await handleMonitoringToggle({ authorization: AUTH, accountId: "a1", body: { enabled: true } }, deps);
  check("a repeated enable stays 200 (the canonical function is idempotent)", second.status === 200);
  check("a repeated enable never double-counts capacity itself", spy.enableCalls.length === 2);
  // The plan limit lives in ONE place: the canonical atomic enable. The service must
  // not know the entitlement name or re-implement the within-limit comparison.
  check("the service never names the plan entitlement",
    !codeOf("src/server/mobile-accounts.ts").includes("maxConnectedAccounts"));
  check("the service never re-implements the within-limit check",
    !/isWithinLimit|countMonitoredAccounts|remaining\s*>\s*0/.test(codeOf("src/server/mobile-accounts.ts")));
}
{
  // Another operator changed the account between the write and the re-read.
  const deps = makeDeps({ getAccountRow: async () => null });
  const res = await handleMonitoringToggle({ authorization: AUTH, accountId: "a1", body: { enabled: true } }, deps);
  check("a stale account after the write is 404, not a fabricated success", res.status === 404);
}
{
  // The response must carry the SERVER's resulting state, not the requested one.
  const deps = makeDeps({ getAccountRow: async () => row({ monitoringEnabled: false }) });
  const res = await handleMonitoringToggle({ authorization: AUTH, accountId: "a1", body: { enabled: true } }, deps);
  check("the reply reflects the SERVER's state, not the request",
    ((res.body as { account: { monitoringEnabled: boolean } }).account).monitoringEnabled === false);
}

/* -------------------------------------------------------------------------- */
/* 14. Manual sync                                                             */
/* -------------------------------------------------------------------------- */

console.log("\n14. Manual sync");

{
  const spy: Spy = { enableCalls: [], disableCalls: [], syncCalls: [], disconnectCalls: [], audits: [] };
  const res = await handleAccountSync({ authorization: AUTH, accountId: "a1" }, makeDeps({}, spy));
  check("a healthy Meta account starts a sync", res.status === 202 && res.body.result === "started", dump(res.body));
  check("the canonical read-only sync was scheduled", dump(spy.syncCalls) === dump([{ tenantId: "tenant-a", accountId: "a1" }]));
  check("sync writes a read-only audit entry",
    spy.audits[0]?.event === "connector.sync_started" && spy.audits[0]?.metadata.readOnly === true, dump(spy.audits));
  check("the sync reply carries no provider internals", dump(res.body) === dump({ result: "started" }));
}
for (const state of ["REAUTH_REQUIRED", "DISCONNECTED"] as const) {
  const spy: Spy = { enableCalls: [], disableCalls: [], syncCalls: [], disconnectCalls: [], audits: [] };
  const deps = makeDeps({ getAccountRow: async () => row({ connectionState: state }) }, spy);
  const res = await handleAccountSync({ authorization: AUTH, accountId: "a1" }, deps);
  check(`${state} blocks the sync`, res.body.result === "reconnect_required", dump(res.body));
  check(`${state} launches NO provider request`, spy.syncCalls.length === 0);
}
for (const state of ["CONNECTED_HEALTHY", "WAITING_FIRST_SYNC", "DEGRADED", "SYNC_FAILED"] as const) {
  const deps = makeDeps({ getAccountRow: async () => row({ connectionState: state }) });
  const res = await handleAccountSync({ authorization: AUTH, accountId: "a1" }, deps);
  check(`${state} allows a sync`, res.body.result === "started", dump(res.body));
}
{
  const spy: Spy = { enableCalls: [], disableCalls: [], syncCalls: [], disconnectCalls: [], audits: [] };
  const deps = makeDeps({ getAccountRow: async () => row({ platform: "google_business" }) }, spy);
  const res = await handleAccountSync({ authorization: AUTH, accountId: "a1" }, deps);
  check("Google Business sync is truthfully not_supported", res.body.result === "not_supported", dump(res.body));
  check("Google Business launches NO doomed provider request", spy.syncCalls.length === 0);
}
{
  const spy: Spy = { enableCalls: [], disableCalls: [], syncCalls: [], disconnectCalls: [], audits: [] };
  const deps = makeDeps({ getAccountRow: async () => row({ platform: "tiktok" }) }, spy);
  check("an unimplemented platform is not_supported",
    (await handleAccountSync({ authorization: AUTH, accountId: "a1" }, deps)).body.result === "not_supported");
  check("an unimplemented platform launches nothing", spy.syncCalls.length === 0);
}
{
  const spy: Spy = { enableCalls: [], disableCalls: [], syncCalls: [], disconnectCalls: [], audits: [] };
  const deps = makeDeps({ hasActiveSyncLease: async () => true }, spy);
  const res = await handleAccountSync({ authorization: AUTH, accountId: "a1" }, deps);
  check("a held lease reports already_running", res.body.result === "already_running", dump(res.body));
  check("a held lease starts no second provider cycle", spy.syncCalls.length === 0);
}
{
  // A lease-read failure must not block a legitimate sync — the lease still guards it.
  const deps = makeDeps({ hasActiveSyncLease: async () => { throw new Error("lease read failed"); } });
  const res = await handleAccountSync({ authorization: AUTH, accountId: "a1" }, deps);
  check("a lease-read failure still allows the canonical lease to decide", res.body.result === "started");
}
{
  const spy: Spy = { enableCalls: [], disableCalls: [], syncCalls: [], disconnectCalls: [], audits: [] };
  const deps = makeDeps({ getAccountRow: async () => null }, spy);
  const res = await handleAccountSync({ authorization: AUTH, accountId: "gone" }, deps);
  check("syncing a missing/foreign account is not_found", res.status === 404 && res.body.result === "not_found");
  check("a missing account launches nothing", spy.syncCalls.length === 0);
}
{
  const spy: Spy = { enableCalls: [], disableCalls: [], syncCalls: [], disconnectCalls: [], audits: [] };
  const deps = makeDeps({ canManageConnectors: () => false }, spy);
  const res = await handleAccountSync({ authorization: AUTH, accountId: "a1" }, deps);
  check("a viewer cannot start a sync", res.status === 403 && res.body.error === "permission_denied");
  check("a denied viewer launches nothing", spy.syncCalls.length === 0);
}
check("the sync handler never claims completion",
  !/result:\s*"(completed|synced|done|finished)"/.test(codeOf("src/server/mobile-accounts.ts")));
check("the sync is scheduled after the response, not awaited",
  /after\(async \(\) => \{ await runReadOnlySync/.test(depsSrc));

/* -------------------------------------------------------------------------- */
/* 15. Disconnect                                                              */
/* -------------------------------------------------------------------------- */

console.log("\n15. Disconnect");

{
  const spy: Spy = { enableCalls: [], disableCalls: [], syncCalls: [], disconnectCalls: [], audits: [] };
  const res = await handleAccountDisconnect({ authorization: AUTH, accountId: "a1" }, makeDeps({}, spy));
  const body = res.body as unknown as { disconnected: boolean; clusterCount: number; clusterPlatforms: string[]; providerRevoke: string; manualCleanupRecommended: boolean };
  check("disconnect is 200", res.status === 200);
  check("disconnect delegates to the canonical service", dump(spy.disconnectCalls) === dump([{ tenantId: "tenant-a", accountId: "a1" }]));
  check("disconnect reports the truthful result", body.disconnected === true);
  check("the cluster COUNT is returned", body.clusterCount === 2);
  check("cluster platforms are bounded keys", body.clusterPlatforms.every((p) => (PLATFORM_KEYS as readonly string[]).includes(p)), dump(body.clusterPlatforms));
  check("the provider revoke classification is bounded", (REVOKE_RESULTS as readonly string[]).includes(body.providerRevoke));
  check("Meta reports unsupported revocation, never a fabricated success", body.providerRevoke === "unsupported");
  check("manual cleanup guidance is surfaced", body.manualCleanupRecommended === true);
  check("no internal account id from the cluster is exposed",
    !allStrings(body).some((s) => /^c[a-z0-9]{20,}$/.test(s)) && !("accountIds" in body), dump(Object.keys(body)));
  check("disconnect writes a token-free audit entry",
    spy.audits[0]?.event === "connector.disconnected"
    && !dump(spy.audits[0]?.metadata).toLowerCase().includes("accesstoken"));
  check("no token is returned", !allKeys(body).some((k) => /token/i.test(k)));
}
{
  const deps = makeDeps({
    disconnectAccount: async () => ({ found: true, clusterCount: 1, clusterPlatforms: ["facebook_page"], providerRevoke: "revoked", manualCleanupRecommended: false }),
  });
  const body = (await handleAccountDisconnect({ authorization: AUTH, accountId: "a1" }, deps)).body as unknown as { manualCleanupRecommended: boolean; providerRevoke: string };
  check("a genuine revoke reports no manual cleanup", body.manualCleanupRecommended === false && body.providerRevoke === "revoked");
}
{
  const deps = makeDeps({
    disconnectAccount: async () => ({ found: true, clusterCount: 0, clusterPlatforms: [], providerRevoke: "not-a-real-value", manualCleanupRecommended: false }),
  });
  const body = (await handleAccountDisconnect({ authorization: AUTH, accountId: "a1" }, deps)).body as { providerRevoke: string };
  check("an unrecognized revoke classification degrades to failed, never to revoked", body.providerRevoke === "failed");
}
{
  const spy: Spy = { enableCalls: [], disableCalls: [], syncCalls: [], disconnectCalls: [], audits: [] };
  const deps = makeDeps({ canManageConnectors: () => false }, spy);
  const res = await handleAccountDisconnect({ authorization: AUTH, accountId: "a1" }, deps);
  check("a viewer cannot disconnect", res.status === 403 && res.body.error === "permission_denied");
  check("a denied viewer never reaches the canonical service", spy.disconnectCalls.length === 0);
}
{
  const missing = await handleAccountDisconnect({ authorization: AUTH, accountId: "gone" },
    makeDeps({ disconnectAccount: async () => ({ found: false, clusterCount: 0, clusterPlatforms: [], providerRevoke: "already_invalid", manualCleanupRecommended: false }) }));
  const foreign = await handleAccountDisconnect({ authorization: AUTH, accountId: "tenant-b" },
    makeDeps({ disconnectAccount: async () => ({ found: false, clusterCount: 0, clusterPlatforms: [], providerRevoke: "already_invalid", manualCleanupRecommended: false }) }));
  check("disconnecting a missing account is 404", missing.status === 404 && missing.body.error === "not_found");
  check("a foreign account is indistinguishable from missing", dump(foreign) === dump(missing));
  check("a repeated/stale disconnect is safe and truthful", missing.status === 404);
}
{
  const deps = makeDeps({ disconnectAccount: async () => { throw new Error("provider blew up"); } });
  const res = await handleAccountDisconnect({ authorization: AUTH, accountId: "a1" }, deps);
  check("a thrown disconnect is a generic 500", res.status === 500 && res.body.error === "server_error");
  check("the thrown message never reaches the body", !dump(res.body).includes("provider blew up"));
}

/* -------------------------------------------------------------------------- */
/* 16. Route hygiene                                                           */
/* -------------------------------------------------------------------------- */

console.log("\n16. Route hygiene");

const ROUTES = ACCOUNT_MODULES.filter((m) => m.includes("/api/"));
for (const r of ROUTES) {
  const src = codeOf(r);
  check(`${r} is no-store`, src.includes('"Cache-Control": "no-store"'));
  check(`${r} is nodejs + force-dynamic`, src.includes('runtime = "nodejs"') && src.includes('dynamic = "force-dynamic"'));
  check(`${r} reads the bearer from the header`, src.includes('req.headers.get("authorization")'));
  check(`${r} never logs`, !/console\.(log|warn|error|info)/.test(src));
}
check("the list route is GET-only", !/export async function (POST|PUT|DELETE)/.test(codeOf("src/app/api/mobile/accounts/route.ts")));
check("the detail route is GET-only", !/export async function (POST|PUT|DELETE)/.test(codeOf("src/app/api/mobile/accounts/[accountId]/route.ts")));
for (const m of ["monitoring", "sync", "disconnect"]) {
  check(`the ${m} route is POST-only`,
    /export async function POST/.test(codeOf(`src/app/api/mobile/accounts/[accountId]/${m}/route.ts`))
    && !/export async function GET/.test(codeOf(`src/app/api/mobile/accounts/[accountId]/${m}/route.ts`)));
}
for (const m of ACCOUNT_MODULES) {
  check(`${m} never logs`, !/console\.(log|warn|error|info|debug)/.test(codeOf(m)));
}

/* -------------------------------------------------------------------------- */

console.log(
  `\n${fail === 0 ? "PASS" : "FAIL"} — mobile Accounts API (M6): ${pass} passed, ${fail} failed`,
);
process.exit(fail === 0 ? 0 : 1);
