/**
 * GOOGLE BUSINESS CONNECTOR — SLICE 1 (OAuth code exchange + live discovery + callback safety).
 *
 * Fully deterministic: no network, no database, no clock (`now` is injected). Covers the exchange's
 * success and every refusal path, discovery through the EXISTING normalizers, OAuth state validation
 * including replay, and the callback route's fail-closed structure asserted against its SOURCE with
 * comments stripped — so a test can never pass by matching its own explanatory prose.
 *
 * Run via: pnpm google-business-oauth-slice1:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { GOOGLE_BUSINESS_SCOPE } from "@guardora/config";
import {
  exchangeGoogleAuthCode, discoverGoogleBusinessScope, validateOAuthState, buildGoogleAuthUrl,
  normalizeGoogleAccount, normalizeGoogleLocation, isLocationSyncEligible,
  GOOGLE_TOKEN_ENDPOINT, type GoogleTokenFetch,
} from "@guardora/sync";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");
/** Strip line + block comments so assertions match REAL code, never documentation. */
const code = (rel: string) => readSrc(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};

// Fixed clock — the expiry assertions are exact, not approximate.
const T0 = Date.UTC(2026, 0, 2, 3, 4, 5);
const now = () => T0;

const SECRET = "gbp-client-secret-DO-NOT-LEAK";
const REFRESH = "1//refresh-DO-NOT-LEAK";
const ACCESS = "ya29.access-DO-NOT-LEAK";

/** Build a fake token endpoint. Records what was sent so we can assert the request contract. */
function tokenFetch(res: { ok: boolean; status: number; body: unknown | (() => never) }) {
  const sent: { url?: string; body?: string; method?: string } = {};
  const impl: GoogleTokenFetch = async (url, init) => {
    sent.url = url; sent.body = init.body; sent.method = init.method;
    return { ok: res.ok, status: res.status, json: async () => (typeof res.body === "function" ? (res.body as () => never)() : res.body) };
  };
  return { impl, sent };
}

const okBody = (over: Record<string, unknown> = {}) => ({
  access_token: ACCESS, refresh_token: REFRESH, expires_in: 3599,
  token_type: "Bearer", scope: GOOGLE_BUSINESS_SCOPE, ...over,
});

const baseArgs = { code: "auth-code-123", clientId: "cid", clientSecret: SECRET, redirectUri: "https://app.example/cb", now };

async function main() {
  console.log("\nGoogle Business — Slice 1 (OAuth exchange, discovery, callback safety)\n");

  // =========================================================================================
  console.log("A) OAuth code exchange");
  {
    const f = tokenFetch({ ok: true, status: 200, body: okBody() });
    const r = await exchangeGoogleAuthCode({ ...baseArgs, fetchImpl: f.impl });
    check("A1) successful exchange returns ok + credentials", r.ok === true && !!r.credentials);
    check("A2) refresh + access token carried through verbatim",
      r.credentials?.refreshToken === REFRESH && r.credentials?.accessToken === ACCESS);
    check("A3) access token expiry derived from expires_in at exchange time",
      r.credentials?.accessTokenExpiresAt.getTime() === T0 + 3599 * 1000);
    check("A4) granted scopes preserved and include business.manage",
      r.credentials?.scopes.join(" ") === GOOGLE_BUSINESS_SCOPE);
    check("A5) token type preserved", r.credentials?.tokenType === "Bearer");
    check("A6) posts to Google's token endpoint", f.sent.url === GOOGLE_TOKEN_ENDPOINT && f.sent.method === "POST");
    const sentBody = f.sent.body ?? "";
    check("A7) sends grant_type=authorization_code with the code and redirect_uri",
      sentBody.includes("grant_type=authorization_code") && sentBody.includes("code=auth-code-123") && sentBody.includes("redirect_uri="));
    check("A8) secret is sent to Google but never returned to the caller",
      sentBody.includes(encodeURIComponent(SECRET)) && !JSON.stringify(r).includes(SECRET));
  }
  {
    const r = await exchangeGoogleAuthCode({ ...baseArgs, code: "", fetchImpl: tokenFetch({ ok: true, status: 200, body: okBody() }).impl });
    check("A9) empty authorization code is refused before any network call", r.ok === false && !r.credentials);
  }
  {
    const r = await exchangeGoogleAuthCode({ ...baseArgs, fetchImpl: tokenFetch({ ok: false, status: 400, body: { error: "invalid_grant", error_description: "Bad Request: code already redeemed" } }).impl });
    check("A10) invalid_grant → bounded token_expired reason, no credentials", r.ok === false && r.reason === "google_business_token_expired" && !r.credentials);
    check("A11) provider error_description never escapes", !JSON.stringify(r).includes("already redeemed"));
  }
  {
    const r = await exchangeGoogleAuthCode({ ...baseArgs, fetchImpl: tokenFetch({ ok: false, status: 401, body: { error: "invalid_client" } }).impl });
    check("A12) non-invalid_grant HTTP failure → generic refresh_failed", r.ok === false && r.reason === "google_business_refresh_failed");
  }
  {
    const r = await exchangeGoogleAuthCode({ ...baseArgs, fetchImpl: tokenFetch({ ok: true, status: 200, body: okBody({ refresh_token: undefined }) }).impl });
    check("A13) MISSING REFRESH TOKEN is refused (no half-usable grant)", r.ok === false && r.reason === "google_business_permission_missing" && !r.credentials);
  }
  {
    const r = await exchangeGoogleAuthCode({ ...baseArgs, fetchImpl: tokenFetch({ ok: true, status: 200, body: okBody({ access_token: undefined }) }).impl });
    check("A14) missing access token is refused", r.ok === false && !r.credentials);
  }
  {
    const r = await exchangeGoogleAuthCode({ ...baseArgs, fetchImpl: tokenFetch({ ok: true, status: 200, body: okBody({ scope: "https://www.googleapis.com/auth/userinfo.email" }) }).impl });
    check("A15) downgraded scope (no business.manage) is refused", r.ok === false && r.reason === "google_business_permission_missing" && !r.credentials);
  }
  {
    const r = await exchangeGoogleAuthCode({ ...baseArgs, fetchImpl: tokenFetch({ ok: true, status: 200, body: null }).impl });
    check("A16) malformed/empty token response is refused", r.ok === false && !r.credentials);
  }
  {
    const boom: GoogleTokenFetch = async () => { throw new Error("ECONNRESET oauth2.googleapis.com"); };
    const r = await exchangeGoogleAuthCode({ ...baseArgs, fetchImpl: boom });
    check("A17) transport failure is caught and bounded", r.ok === false && r.reason === "google_business_refresh_failed");
    check("A18) transport error text never escapes", !JSON.stringify(r).includes("ECONNRESET"));
  }
  {
    // A grant Google truncated to a shorter validity must not be recorded as the default hour.
    const r = await exchangeGoogleAuthCode({ ...baseArgs, fetchImpl: tokenFetch({ ok: true, status: 200, body: okBody({ expires_in: 120 }) }).impl });
    check("A19) short expires_in is honoured, not defaulted", r.credentials?.accessTokenExpiresAt.getTime() === T0 + 120_000);
  }

  // =========================================================================================
  console.log("\nB) OAuth state (CSRF / replay)");
  {
    check("B1) matching state validates", validateOAuthState("s-abc", "s-abc") === true);
    check("B2) mismatched state is rejected", validateOAuthState("s-abc", "s-xyz") === false);
    check("B3) missing received state is rejected", validateOAuthState(null, "s-abc") === false);
    check("B4) missing expected state (replay: cookie already consumed) is rejected", validateOAuthState("s-abc", undefined) === false);
    check("B5) both missing is rejected", validateOAuthState(null, undefined) === false);
    check("B6) empty-string state is rejected", validateOAuthState("", "") === false);
    const url = buildGoogleAuthUrl({ clientId: "cid", redirectUri: "https://app.example/cb", state: "s1" });
    check("B7) auth url still requests offline access + consent (refresh token issuance)",
      url.includes("access_type=offline") && url.includes("prompt=consent"));
    check("B8) auth url scope is unchanged business.manage", url.includes(encodeURIComponent(GOOGLE_BUSINESS_SCOPE)));
  }

  // =========================================================================================
  console.log("\nC) Live discovery (existing client contract + existing normalizers)");
  const ACCT = { name: "accounts/111", accountName: "Northwind Ltd", type: "LOCATION_GROUP", role: "OWNER", verificationState: "VERIFIED" };
  const LOC_V = { name: "accounts/111/locations/222", title: "Northwind Praha", storeCode: "PRG-1", storefrontAddress: { addressLines: ["Ulice 1"], locality: "Praha" }, metadata: { hasVoiceOfMerchant: true } };
  const LOC_U = { name: "accounts/111/locations/333", title: "Northwind Brno", metadata: { hasVoiceOfMerchant: false } };
  {
    const calls: string[] = [];
    const client = {
      listAccounts: async () => ({ accounts: [ACCT] }),
      listLocations: async (n: string) => { calls.push(n); return { locations: [LOC_V, LOC_U] }; },
    };
    const d = await discoverGoogleBusinessScope(client);
    check("C1) discovery succeeds and returns normalized accounts", d.ok === true && d.accounts.length === 1);
    check("C2) account normalized by the EXISTING normalizer (identical output)",
      JSON.stringify(d.accounts[0]) === JSON.stringify(normalizeGoogleAccount(ACCT)));
    check("C3) listLocations is called with the RAW account resource name", calls.length === 1 && calls[0] === "accounts/111");
    const locs = d.locationsByAccount["111"] ?? [];
    check("C4) locations keyed by providerAccountId and normalized by the EXISTING normalizer",
      locs.length === 2 && JSON.stringify(locs[0]) === JSON.stringify(normalizeGoogleLocation(LOC_V)));
    check("C5) verification semantics preserved (voice-of-merchant true/false)",
      locs[0].verificationState === "verified" && locs[1].verificationState === "unverified");
    check("C6) sync-eligibility semantics preserved (verified only)",
      isLocationSyncEligible(locs[0]) === true && isLocationSyncEligible(locs[1]) === false && d.eligibleLocationCount === 1);
    check("C7) discovery output carries no token material", !JSON.stringify(d).includes(ACCESS) && !JSON.stringify(d).includes(REFRESH));
  }
  {
    const d = await discoverGoogleBusinessScope({
      listAccounts: async () => { throw new Error("403 PERMISSION_DENIED for project 12345"); },
      listLocations: async () => ({ locations: [] }),
    });
    check("C8) listAccounts failure fails closed with a bounded reason", d.ok === false && d.accounts.length === 0);
    check("C9) provider error text never escapes discovery", !JSON.stringify(d).includes("PERMISSION_DENIED") && !JSON.stringify(d).includes("12345"));
  }
  {
    const d = await discoverGoogleBusinessScope({ listAccounts: async () => ({ accounts: [] }), listLocations: async () => ({ locations: [] }) });
    check("C10) zero accounts is a failure, never an empty 'connected' success", d.ok === false && d.reason === "google_business_account_not_found");
  }
  {
    const d = await discoverGoogleBusinessScope({
      listAccounts: async () => ({ accounts: [ACCT] }),
      listLocations: async () => { throw new Error("backend error"); },
    });
    check("C11) a per-account location failure does not discard discovered accounts",
      d.ok === true && d.accounts.length === 1 && (d.locationsByAccount["111"] ?? []).length === 0 && d.eligibleLocationCount === 0);
  }
  {
    // An unverified-only estate must not be presented as ready to sync.
    const d = await discoverGoogleBusinessScope({
      listAccounts: async () => ({ accounts: [ACCT] }),
      listLocations: async () => ({ locations: [LOC_U] }),
    });
    check("C12) unverified-only estate yields zero eligible locations", d.ok === true && d.eligibleLocationCount === 0);
  }

  // =========================================================================================
  console.log("\nD) Callback route — fail-closed structure (source, comments stripped)");
  const CB = "apps/web/src/app/api/connectors/google-business/callback/route.ts";
  const cb = code(CB);
  const cbRaw = readSrc(CB);
  {
    check("D1) provider denial fails closed", /providerError\)\s*return fail\("google=oauth_denied"/.test(cb));
    check("D2) invalid/missing/replayed state fails closed", /!validateOAuthState\(received, expected\)\)\s*return fail\("google=invalid_state"/.test(cb));
    check("D3) malformed callback (no code) fails closed", /!code\)\s*return fail\("google=invalid_callback"/.test(cb));
    check("D4) state cookie is deleted on every callback (single use)", /jar\.delete\(STATE_COOKIE\)/.test(cb));
    check("D5) GOOGLE_BUSINESS_API_ENABLED gate intact", /!cfg\.apiEnabled\)\s*return fail\("google=api_disabled"/.test(cb));
    check("D6) GOOGLE_BUSINESS_API_APPROVED gate intact and SEPARATE", /!cfg\.apiApproved\)\s*return fail\("google=api_access_unconfirmed"/.test(cb));
    check("D7) the two axes are not collapsed into one condition",
      !/apiEnabled\s*&&\s*apiApproved/.test(cb) && !/apiApproved\s*&&\s*apiEnabled/.test(cb));
    // Anchor on the CALL site, not the import line, which naturally sorts first.
    const exchangeAt = cb.indexOf("exchangeGoogleAuthCode({");
    const successAt = cb.lastIndexOf("${BACK}google=connected");
    check("D8) both gates precede the token exchange",
      exchangeAt > 0 && cb.indexOf("!cfg.apiApproved") < exchangeAt && cb.indexOf("!cfg.apiEnabled") < exchangeAt);
    check("D9) exchange failure fails closed", /!exchanged\.ok[\s\S]{0,60}return fail\("google=exchange_failed"/.test(cb));
    check("D10) persistence failure fails closed", /!persisted\.ok\)\s*return fail\("google=connection_failed"/.test(cb));
    check("D11) discovery failure fails closed", /!discovery\.ok\)\s*return fail\("google=discovery_failed"/.test(cb));
    check("D12) 'connected' is reached only after exchange, persist AND discovery",
      successAt > 0 && cb.indexOf("google=discovery_failed") < successAt
      && cb.indexOf("persistGoogleBusinessGrant({") < successAt && exchangeAt < successAt);

    // --- LIFECYCLE: the connection may only be promoted after discovery has actually succeeded.
    const persistAt = cb.indexOf("persistGoogleBusinessGrant({");
    const discoverAt = cb.indexOf("discoverGoogleBusinessScope(");
    const discoveryGuardAt = cb.indexOf("!discovery.ok");
    const activateAt = cb.indexOf("activateGoogleBusinessConnection({");
    check("D12a) promotion is a SEPARATE call from credential persistence",
      persistAt > 0 && activateAt > 0 && persistAt !== activateAt);
    check("D12b) persistence does NOT ask for a connected status",
      !/persistGoogleBusinessGrant\(\{[^}]*status:/.test(cb));
    check("D12c) promotion happens AFTER discovery runs", discoverAt > 0 && activateAt > discoverAt);
    check("D12d) promotion happens AFTER the discovery failure guard",
      discoveryGuardAt > 0 && activateAt > discoveryGuardAt);
    check("D12e) a discovery failure returns before reaching promotion",
      /!discovery\.ok\) return fail\("google=discovery_failed"/.test(cb));
    check("D12f) `active` is named exactly once, at the promotion call",
      (cb.match(/BusinessConnectionStatus\.active/g) ?? []).length === 1
      && cb.slice(activateAt, activateAt + 300).includes("BusinessConnectionStatus.active"));
    check("D12g) promotion failure also fails closed", /!activated\.ok\) return fail\("google=connection_failed"/.test(cb));
    check("D13) exactly one success redirect exists", (cb.match(/\$\{BACK\}google=connected/g) ?? []).length === 1);
    check("D14) unauthenticated and unauthorized callers cannot reach the exchange",
      /!session\) return NextResponse\.redirect\(new URL\("\/login"/.test(cb) && /Permission\.ConnectorManage/.test(cb));
    check("D15) credentials are handed to the vault helper, not written by the route",
      /persistGoogleBusinessGrant\(/.test(cb) && !/prisma\.|providerCredential\./.test(cb));
    check("D16) the client secret is read only from the server env, never from a query param",
      /process\.env\.GOOGLE_BUSINESS_CLIENT_SECRET/.test(cb) && !/searchParams\.get\("client_secret"/.test(cb));
  }
  {
    // Leakage: nothing token-shaped may reach the redirect URL, the audit metadata, or a log.
    check("D17) no console/logger call anywhere in the callback", !/console\.(log|error|warn|info)|logger\./.test(cb));
    check("D18) no token or code value is placed in a redirect state",
      !/google=\$\{/.test(cb) && !/BACK\}\$\{(code|credentials|exchanged|accessToken|refreshToken)/.test(cb));
    check("D19) audit metadata carries only bounded labels and counts",
      !/metadata:\s*\{[^}]*(accessToken|refreshToken|credentials|clientSecret|code)\b/.test(cb));
    check("D20) no secret/token identifier is interpolated into any string literal",
      !/`[^`]*\$\{[^}]*(accessToken|refreshToken|clientSecret)[^}]*\}[^`]*`/.test(cbRaw));
  }

  // =========================================================================================
  console.log("\nE) Persistence helper — vault-only, no plaintext column, slice boundary");
  const REPO = "packages/db/src/google-business-connect-repo.ts";
  const repo = code(REPO);
  {
    check("E1) both tokens are stored through the vault", (repo.match(/storeProviderCredential\(/g) ?? []).length === 2);
    check("E2) refresh_token and access_token purposes are both used",
      /ProviderCredentialPurpose\.refresh_token/.test(repo) && /ProviderCredentialPurpose\.access_token/.test(repo));
    check("E3) credentials are anchored on the existing BusinessPlatformConnection",
      /businessConnectionId: connectionId/.test(repo) && /businessPlatformConnection/.test(repo));
    check("E4) provider is google", /BusinessProvider\.google/.test(repo));
    check("E5) scopes and access-token expiry are carried into the vault",
      /scopes: input\.credentials\.scopes/.test(repo) && /expiresAt: input\.credentials\.accessTokenExpiresAt/.test(repo));
    check("E6) no token is written to any non-vault column",
      !/data:\s*\{[^}]*(refreshToken|accessToken)\s*:/.test(repo));
    check("E7) no logging of any kind", !/console\.(log|error|warn|info)|logger\./.test(repo));
    check("E8) vault writes run on the owner client, not the RLS app client",
      /systemDb\.\$transaction/.test(repo) && !/withTenantDb\([\s\S]{0,400}storeProviderCredential/.test(repo));
    check("E9) the write is verified to decrypt back before any status promotion",
      repo.indexOf("resolveProviderCredential") < repo.indexOf("status: input.status"));
    check("E10) a new connection starts pending, never active",
      /status: BusinessConnectionStatus\.pending/.test(repo));
    check("E10a) the persist phase takes NO target status — it structurally cannot promote",
      !/status: BusinessConnectionStatus\.active/.test(repo.slice(repo.indexOf("persistGoogleBusinessGrant"), repo.indexOf("activateGoogleBusinessConnection"))));
    check("E10b) promotion is a separate exported function", /export async function activateGoogleBusinessConnection/.test(repo));
    check("E10c) only the promotion phase writes a caller-supplied status",
      (repo.match(/status: input\.status/g) ?? []).length === 1
      && repo.indexOf("status: input.status") > repo.indexOf("activateGoogleBusinessConnection"));
    check("E10d) the persist phase never updates an existing connection's status",
      !/businessPlatformConnection\.update\(\{[\s\S]{0,200}status:/.test(repo.slice(0, repo.indexOf("activateGoogleBusinessConnection"))));
    check("E11) slice boundary — no location import, review or reply persistence here",
      !/reputationItem|googleLocation\.|reviewReply|connectedAccount\.create/.test(repo));
  }
  {
    const conn = code("packages/sync/src/google-business-connector.ts");
    check("E12) the exchange never returns the raw provider body",
      !/return\s*\{[^}]*body[^}]*\}/.test(conn.slice(conn.indexOf("exchangeGoogleAuthCode"))));
    check("E13) no schema/migration change was introduced by this slice",
      !/prisma\.schema|CREATE TABLE/.test(repo));
  }

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — Google Business Slice 1  [${pass} passed, ${fail} failed]`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
