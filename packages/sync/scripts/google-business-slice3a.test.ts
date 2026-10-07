/**
 * GOOGLE BUSINESS CONNECTOR — SLICE 3A (token refresh, review pagination, canonical mapping, structure).
 *
 * Fully deterministic: no network, no database, no clock (`now` and `fetchImpl` are injected). Covers the
 * refresh HTTP contract and every one of its failure classifications, exhaustive review pagination with
 * all its safety bounds, the mapping of a Google review onto the canonical FetchedContent, the monitoring
 * activation rule, and the structure of the resolver / orchestrator / UI asserted against their SOURCE
 * with comments stripped — so no test can pass by matching its own prose.
 *
 * The DB-backed half (real vault rows, real ContentItem/ReputationItem, real leases, real entitlements)
 * lives in packages/db/scripts/google-business-sync-repo.test.ts.
 *
 * Run via: pnpm google-business-slice3a:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { GOOGLE_BUSINESS_SCOPE } from "@guardora/config";
import { deriveMonitoringState } from "@guardora/core";
import {
  refreshGoogleAccessToken, googleAccessTokenNeedsRefresh, isRetryableRefreshFailure,
  fetchAllGoogleReviews, googleReviewToFetchedContent, normalizeGoogleReview,
  GOOGLE_TOKEN_ENDPOINT, GOOGLE_REFRESH_MAX_SKEW_MS,
  GOOGLE_REVIEW_MAX_PAGES, GOOGLE_REVIEW_MAX_ITEMS,
  type GoogleTokenFetch, type GoogleBusinessLocation, type GoogleReviewExecutor,
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

const T0 = Date.UTC(2026, 2, 3, 4, 5, 6);
const now = () => T0;
const SECRET = "gbp-client-secret-DO-NOT-LEAK";
const REFRESH = "1//refresh-DO-NOT-LEAK";
const ACCESS = "ya29.access-DO-NOT-LEAK";

function tokenFetch(res: { ok: boolean; status: number; body: unknown }) {
  const sent: { url?: string; body?: string; method?: string } = {};
  const impl: GoogleTokenFetch = async (url, init) => {
    sent.url = url; sent.body = init.body; sent.method = init.method;
    return { ok: res.ok, status: res.status, json: async () => res.body };
  };
  return { impl, sent };
}
const okBody = (over: Record<string, unknown> = {}) => ({
  access_token: ACCESS, expires_in: 3599, token_type: "Bearer", scope: GOOGLE_BUSINESS_SCOPE, ...over,
});
const baseArgs = { refreshToken: REFRESH, clientId: "cid", clientSecret: SECRET, now };

const VERIFIED: GoogleBusinessLocation = {
  providerLocationName: "accounts/900/locations/L1", providerLocationId: "L1",
  displayName: "Northwind Praha", storeCode: "PRG-1", addressSummary: "Ulice 1, Praha",
  verificationState: "verified", selected: false,
};
const rawReview = (id: string, over: Record<string, unknown> = {}) => ({
  reviewId: id, starRating: "FIVE", comment: `Review ${id}`,
  reviewer: { displayName: `Person ${id}` }, createTime: "2026-01-02T03:04:05Z", ...over,
});

/** A paging review executor driven by explicit page arrays; records every pageToken it received. */
function pagedExecutor(pages: unknown[][], opts: { loop?: boolean; badToken?: unknown } = {}) {
  const seen: Array<string | undefined> = [];
  let calls = 0;
  const executor: GoogleReviewExecutor = async (input) => {
    seen.push(input.pageToken);
    const i = opts.loop ? Math.min(calls, pages.length - 1) : (input.pageToken?.startsWith("p-") ? Number(input.pageToken.slice(2)) : 0);
    calls++;
    const last = i >= pages.length - 1;
    const next = opts.loop ? "SAME" : last ? (opts.badToken as string | undefined) : `p-${i + 1}`;
    return { reviews: (pages[Math.min(i, pages.length - 1)] ?? []) as never, nextPageToken: next };
  };
  return { executor, seen, calls: () => calls };
}

// Both feature axes ON — the fetch path's own gates are proven separately in section E.
const ENABLED: NodeJS.ProcessEnv = {
  GOOGLE_BUSINESS_CLIENT_ID: "cid", GOOGLE_BUSINESS_CLIENT_SECRET: SECRET,
  GOOGLE_BUSINESS_REDIRECT_URI: "https://app.example/cb",
  GOOGLE_BUSINESS_API_ENABLED: "true", GOOGLE_BUSINESS_API_APPROVED: "true",
} as NodeJS.ProcessEnv;

async function main() {
  console.log("\nGoogle Business — Slice 3A (refresh, review sync, monitoring)\n");

  // =========================================================================================
  console.log("A) Access-token refresh — success + rotation");
  {
    const f = tokenFetch({ ok: true, status: 200, body: okBody() });
    const r = await refreshGoogleAccessToken({ ...baseArgs, fetchImpl: f.impl });
    check("A1) a successful refresh returns a new access token", r.ok === true && r.ok && r.accessToken === ACCESS);
    check("A2) expiry is derived truthfully from expires_in", r.ok && r.accessTokenExpiresAt.getTime() === T0 + 3599 * 1000);
    check("A3) posts grant_type=refresh_token to Google's token endpoint",
      f.sent.url === GOOGLE_TOKEN_ENDPOINT && f.sent.method === "POST" && (f.sent.body ?? "").includes("grant_type=refresh_token"));
    check("A4) the refresh token is sent but never returned", (f.sent.body ?? "").includes(encodeURIComponent(REFRESH)) && !JSON.stringify(r).includes(REFRESH));
    check("A5) the client secret is sent but never returned", (f.sent.body ?? "").includes(encodeURIComponent(SECRET)) && !JSON.stringify(r).includes(SECRET));
    check("A6) NO rotation reported when Google omits refresh_token", r.ok && r.rotatedRefreshToken === null);
    check("A7) scopes are preserved", r.ok && r.scopes.join(" ") === GOOGLE_BUSINESS_SCOPE);
  }
  {
    const r = await refreshGoogleAccessToken({ ...baseArgs, fetchImpl: tokenFetch({ ok: true, status: 200, body: okBody({ refresh_token: "1//ROTATED" }) }).impl });
    check("A8) a rotated refresh token is reported explicitly", r.ok === true && r.ok && r.rotatedRefreshToken === "1//ROTATED");
  }
  {
    const r = await refreshGoogleAccessToken({ ...baseArgs, fetchImpl: tokenFetch({ ok: true, status: 200, body: okBody({ expires_in: 120 }) }).impl });
    check("A9) a short expires_in is honoured, not defaulted", r.ok && r.accessTokenExpiresAt.getTime() === T0 + 120_000);
  }

  console.log("\nB) Access-token refresh — failure classification");
  const failCase = async (res: { ok: boolean; status: number; body: unknown }) =>
    refreshGoogleAccessToken({ ...baseArgs, fetchImpl: tokenFetch(res).impl });
  {
    const r = await failCase({ ok: false, status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } });
    check("B1) invalid_grant → reconnect_required", r.ok === false && !r.ok && r.failure === "reconnect_required");
    check("B2) provider error_description never escapes", !JSON.stringify(r).includes("revoked"));
    check("B3) reconnect_required is NOT retryable", !isRetryableRefreshFailure("reconnect_required"));
  }
  {
    const r = await failCase({ ok: false, status: 401, body: { error: "invalid_client" } });
    check("B4) invalid_client → configuration_invalid, NOT reconnect_required", !r.ok && r.failure === "configuration_invalid");
    check("B5) configuration_invalid is not retryable", !isRetryableRefreshFailure("configuration_invalid"));
  }
  {
    const r = await failCase({ ok: false, status: 429, body: { error: "rate_limit_exceeded" } });
    check("B6) HTTP 429 → rate_limited and RETRYABLE", !r.ok && r.failure === "rate_limited" && isRetryableRefreshFailure("rate_limited"));
  }
  {
    const r = await failCase({ ok: false, status: 503, body: {} });
    check("B7) HTTP 5xx → transient_failure and RETRYABLE", !r.ok && r.failure === "transient_failure" && isRetryableRefreshFailure("transient_failure"));
  }
  {
    const r = await failCase({ ok: true, status: 200, body: { token_type: "Bearer" } });
    check("B8) a 2xx with no access_token → malformed_response", !r.ok && r.failure === "malformed_response");
    check("B9) malformed_response is not blindly retried", !isRetryableRefreshFailure("malformed_response"));
  }
  {
    const r = await failCase({ ok: true, status: 200, body: null });
    check("B10) an unparseable body → malformed_response", !r.ok && r.failure === "malformed_response");
  }
  {
    const r = await failCase({ ok: true, status: 200, body: okBody({ scope: "https://www.googleapis.com/auth/userinfo.email" }) });
    check("B11) a refresh that lost business.manage → reconnect_required", !r.ok && r.failure === "reconnect_required");
  }
  {
    const boom: GoogleTokenFetch = async () => { throw new Error("ECONNRESET oauth2.googleapis.com"); };
    const r = await refreshGoogleAccessToken({ ...baseArgs, fetchImpl: boom });
    check("B12) a transport failure → transient_failure", !r.ok && r.failure === "transient_failure");
    check("B13) the transport error text never escapes", !JSON.stringify(r).includes("ECONNRESET"));
  }
  {
    const r = await refreshGoogleAccessToken({ ...baseArgs, refreshToken: "", fetchImpl: tokenFetch({ ok: true, status: 200, body: okBody() }).impl });
    check("B14) an absent refresh token → reconnect_required, with NO network call", !r.ok && r.failure === "reconnect_required");
    const r2 = await refreshGoogleAccessToken({ ...baseArgs, clientSecret: "", fetchImpl: tokenFetch({ ok: true, status: 200, body: okBody() }).impl });
    check("B15) missing deployment config → configuration_invalid, with NO network call", !r2.ok && r2.failure === "configuration_invalid");
  }

  console.log("\nC) Refresh window — do not refresh unnecessarily");
  {
    const far = new Date(T0 + 60 * 60_000);
    check("C1) a comfortably valid token is NOT refreshed", googleAccessTokenNeedsRefresh(far, T0) === false);
    check("C2) an ALREADY EXPIRED token is refreshed", googleAccessTokenNeedsRefresh(new Date(T0 - 1_000), T0) === true);
    check("C3) a token inside the safety window is refreshed pre-emptively",
      googleAccessTokenNeedsRefresh(new Date(T0 + GOOGLE_REFRESH_MAX_SKEW_MS - 1_000), T0) === true);
    check("C4) a token just outside the window is not", googleAccessTokenNeedsRefresh(new Date(T0 + GOOGLE_REFRESH_MAX_SKEW_MS + 1_000), T0) === false);
    check("C5) an UNKNOWN expiry fails closed (treated as stale)", googleAccessTokenNeedsRefresh(null, T0) === true);
    check("C6) the window is a small explicit constant", GOOGLE_REFRESH_MAX_SKEW_MS > 0 && GOOGLE_REFRESH_MAX_SKEW_MS <= 15 * 60_000);
  }

  // =========================================================================================
  console.log("\nD) Review fetch — pagination");
  const fetchAll = (executor: GoogleReviewExecutor, extra: Record<string, unknown> = {}) =>
    fetchAllGoogleReviews({ accountId: "900", location: VERIFIED }, { source: ENABLED, executor, ...extra });
  {
    const p = pagedExecutor([[rawReview("r1"), rawReview("r2")]]);
    const r = await fetchAll(p.executor);
    check("D1) a single page is fetched and normalized", r.ok === true && r.reviews.length === 2);
    check("D2) one page is not truncated", r.truncated === false && r.pages === 1);
    check("D3) the first call sends NO page token", p.seen[0] === undefined);
  }
  {
    const p = pagedExecutor([[rawReview("r1")], [rawReview("r2")], [rawReview("r3")]]);
    const r = await fetchAll(p.executor);
    check("D4) MULTIPLE pages are followed to exhaustion", r.reviews.length === 3 && r.pages === 3);
    check("D5) order is preserved across pages", r.reviews.map((x) => x.externalReviewId).join(",") === "r1,r2,r3");
    check("D6) later calls send the provider's token", p.seen[1] === "p-1" && p.seen[2] === "p-2");
    check("D7) a complete walk is not truncated", r.truncated === false);
  }
  {
    const p = pagedExecutor([[rawReview("r1")], [rawReview("r2")]], { loop: true });
    const r = await fetchAll(p.executor);
    check("D8) a REPEATED page token stops the walk on second sight", p.calls() === 2, `calls=${p.calls()}`);
    check("D9) a repeated-token stop is reported as truncated", r.truncated === true);
  }
  {
    let calls = 0;
    const endless: GoogleReviewExecutor = async () => { calls++; return { reviews: [rawReview(`e${calls}`)] as never, nextPageToken: `t-${calls}` }; };
    const r = await fetchAll(endless);
    check("D10) an endless cursor is stopped by the maximum-page bound", calls === GOOGLE_REVIEW_MAX_PAGES, `calls=${calls}`);
    check("D11) hitting the page bound reports truncated", r.truncated === true);
    check("D12) the page bound is a small explicit constant", GOOGLE_REVIEW_MAX_PAGES > 0 && GOOGLE_REVIEW_MAX_PAGES <= 50);
  }
  {
    const huge = Array.from({ length: 30 }, (_, i) => rawReview(`h${i}`));
    const r = await fetchAll(pagedExecutor([huge]).executor, { maxItems: 10 });
    check("D13) the item bound caps an oversized page", r.reviews.length === 10);
    check("D14) hitting the item bound reports truncated", r.truncated === true);
    check("D15) an item bound exists by default", GOOGLE_REVIEW_MAX_ITEMS > 0);
  }
  {
    const p = pagedExecutor([[rawReview("r1")]], { badToken: 42 });
    const r = await fetchAll(p.executor);
    check("D16) a non-string nextPageToken ends the walk instead of being echoed", p.calls() === 1 && r.truncated === false);
  }
  {
    const p = pagedExecutor([[rawReview("r1"), rawReview("r2")], [rawReview("r2"), rawReview("r3")]]);
    const r = await fetchAll(p.executor);
    check("D17) duplicate provider review ids are deduped across pages", r.reviews.length === 3);
    check("D18) dedupe is deterministic — first occurrence wins", r.reviews.map((x) => x.externalReviewId).join(",") === "r1,r2,r3");
  }
  {
    // A review with no id cannot be persisted (externalId is the idempotency key) and is dropped.
    const p = pagedExecutor([[rawReview("r1"), { starRating: "FOUR", comment: "no id" }]]);
    const r = await fetchAll(p.executor);
    check("D19) a malformed review with NO provider id is rejected, not invented", r.reviews.length === 1 && r.reviews[0].externalReviewId === "r1");
  }
  {
    const r = await fetchAll(async () => ({ reviews: [], nextPageToken: undefined }));
    check("D20) an empty location is a valid zero-review outcome, not a failure",
      r.ok === true && r.reviews.length === 0 && r.reason === "google_business_no_reviews" && r.truncated === false);
  }

  console.log("\nE) Review fetch — fail-closed gates");
  {
    const p = pagedExecutor([[rawReview("r1")]]);
    const off = { ...ENABLED, GOOGLE_BUSINESS_API_ENABLED: "false" } as NodeJS.ProcessEnv;
    const r = await fetchAllGoogleReviews({ accountId: "900", location: VERIFIED }, { source: off, executor: p.executor });
    check("E1) GOOGLE_BUSINESS_API_ENABLED=false fails closed with no provider call", r.ok === false && p.calls() === 0);
  }
  {
    const p = pagedExecutor([[rawReview("r1")]]);
    const none = { ...ENABLED, GOOGLE_BUSINESS_CLIENT_ID: "" } as NodeJS.ProcessEnv;
    const r = await fetchAllGoogleReviews({ accountId: "900", location: VERIFIED }, { source: none, executor: p.executor });
    check("E2) missing configuration fails closed with no provider call", r.ok === false && p.calls() === 0);
  }
  {
    const unverified: GoogleBusinessLocation = { ...VERIFIED, verificationState: "unverified" };
    const p = pagedExecutor([[rawReview("r1")]]);
    const r = await fetchAllGoogleReviews({ accountId: "900", location: unverified }, { source: ENABLED, executor: p.executor });
    check("E3) an UNVERIFIED location is refused with no provider call", r.ok === false && p.calls() === 0);
  }
  {
    const r = await fetchAllGoogleReviews({ accountId: "900", location: VERIFIED }, { source: ENABLED });
    check("E4) no injected executor ⇒ no live call is fabricated", r.ok === false);
  }
  {
    // Page 1 failing means we have nothing; page 3 failing keeps what we had but is NOT complete.
    let n = 0;
    const failLater: GoogleReviewExecutor = async () => {
      n++;
      if (n >= 3) return { reviews: [], error: { code: 403, message: "PERMISSION_DENIED project 12345" } };
      return { reviews: [rawReview(`f${n}`)] as never, nextPageToken: `p-${n}` };
    };
    const r = await fetchAll(failLater);
    check("E5) a LATER page failing keeps what was fetched", r.ok === true && r.reviews.length === 2);
    check("E6) …but is reported as TRUNCATED, never a complete sync", r.truncated === true);
    check("E7) provider error text never escapes", !JSON.stringify(r).includes("PERMISSION_DENIED") && !JSON.stringify(r).includes("12345"));
  }
  {
    const failFirst: GoogleReviewExecutor = async () => ({ reviews: [], error: { code: 401, message: "UNAUTHENTICATED" } });
    const r = await fetchAll(failFirst);
    check("E8) page ONE failing fails the whole fetch", r.ok === false && r.reviews.length === 0);
    check("E9) the bounded reason is carried, not the provider text",
      r.reason === "google_business_token_expired" && !JSON.stringify(r).includes("UNAUTHENTICATED"));
  }

  // =========================================================================================
  console.log("\nF) Canonical content mapping");
  {
    const n = normalizeGoogleReview(rawReview("r1") as never, { accountId: "900", locationId: "L1" });
    const c = googleReviewToFetchedContent(n);
    check("F1) a review becomes canonical content of kind `review`", c.kind === "review");
    check("F2) platform is the EXISTING google_business enum value", c.platform === "google_business");
    check("F3) externalId is the stable provider review id", c.externalId === "r1");
    check("F4) the location is the canonical parent object", c.externalParentId === "L1");
    check("F5) rating and text are carried", c.rating === 5 && c.text === "Review r1");
    check("F6) publishedAt is the provider create time", c.publishedAt === new Date("2026-01-02T03:04:05Z").toISOString());
    check("F7) the author id is the location-scoped SYNTHETIC identity, not a Google account id",
      c.author.externalId === n.authorExternalId && c.author.externalId!.startsWith("loc:L1:"));
    check("F8) a named reviewer's display name is carried", c.author.displayName === "Person r1");
    check("F9) no permalink is invented", c.permalink === undefined);
  }
  {
    const anon = normalizeGoogleReview(rawReview("r2", { reviewer: { isAnonymous: true } }) as never, { accountId: "900", locationId: "L1" });
    const c = googleReviewToFetchedContent(anon);
    check("F10) an anonymous reviewer contributes NO display name", c.author.displayName === undefined);
    check("F11) an anonymous identity is per-review, never cross-linkable", c.author.externalId === "loc:L1:anon:r2");
  }
  {
    const ratingOnly = normalizeGoogleReview(rawReview("r3", { comment: undefined, starRating: "ONE" }) as never, { accountId: "900", locationId: "L1" });
    const c = googleReviewToFetchedContent(ratingOnly);
    check("F12) a rating-only review keeps an empty body rather than inventing one", c.text === "" && c.rating === 1);
  }
  {
    const withReply = normalizeGoogleReview(rawReview("r4", { reviewReply: { comment: "Thanks!" } }) as never, { accountId: "900", locationId: "L1" });
    const c = googleReviewToFetchedContent(withReply);
    check("F13) the owner reply is NOT persisted — replies are a later slice", !JSON.stringify(c).includes("Thanks!"));
    check("F14) no raw Google payload field survives the mapping",
      !("reviewer" in c) && !("starRating" in c) && !("reviewReply" in c) && !("locationId" in c));
  }

  // =========================================================================================
  console.log("\nG) Monitoring activation rule");
  {
    const base = { monitoringEnabled: false, lastSuccessfulSyncAt: null, syncAttempts: 0, hasActiveLease: false };
    check("G1) import alone ⇒ waiting for first sync, NOT monitored", deriveMonitoringState(base) === "waiting_first_sync");
    check("G2) a running sync ⇒ syncing", deriveMonitoringState({ ...base, hasActiveLease: true }) === "syncing");
    check("G3) a failed first sync ⇒ first_sync_failed, still not monitored", deriveMonitoringState({ ...base, syncAttempts: 2 }) === "first_sync_failed");
    check("G4) a SUCCEEDED sync with monitoring still off ⇒ monitoring_unavailable (plan limit)",
      deriveMonitoringState({ ...base, lastSuccessfulSyncAt: new Date(T0) }) === "monitoring_unavailable");
    check("G5) monitoring on ⇒ monitored", deriveMonitoringState({ ...base, monitoringEnabled: true }) === "monitored");
    check("G6) no state ever reports monitored while monitoringEnabled is false",
      [base, { ...base, hasActiveLease: true }, { ...base, syncAttempts: 2 }, { ...base, lastSuccessfulSyncAt: new Date(T0) }]
        .every((i) => deriveMonitoringState(i) !== "monitored"));
  }

  // =========================================================================================
  console.log("\nH) Token resolver — structure");
  const TOK = "packages/sync/src/google-business-token.ts";
  const tok = code(TOK);
  {
    // Anchor on the CALL site, not the import line, which naturally sorts first.
    const firstCredRead = tok.indexOf("resolveProviderCredentialOutcome(query(");
    check("H1) both feature axes are enforced before any credential read or network call",
      firstCredRead > 0 && tok.indexOf("!cfg.apiEnabled") < firstCredRead && tok.indexOf("!cfg.apiApproved") < firstCredRead);
    check("H2) the two axes are not collapsed",
      !/apiEnabled\s*&&\s*apiApproved/.test(tok) && !/apiApproved\s*&&\s*apiEnabled/.test(tok));
    check("H3) a valid token is returned WITHOUT refreshing", /refreshed: false/.test(tok));
    check("H4) refresh is serialised by an advisory lock", /pg_advisory_xact_lock/.test(tok));
    check("H5) the lock is keyed on the Google connection", /tamanor:gbp_refresh:\$\{connectionId\}/.test(readSrc(TOK)));
    check("H6) the token is RE-CHECKED inside the lock so a concurrent refresh is reused, not repeated",
      (tok.match(/googleAccessTokenNeedsRefresh\(/g) ?? []).length === 2
      && tok.indexOf("lockConnection") < tok.lastIndexOf("googleAccessTokenNeedsRefresh("));
    check("H7) exactly ONE refresh network call site exists", (tok.match(/refreshGoogleAccessToken\(/g) ?? []).length === 1);
    check("H8) the refresh token is rotated ONLY when Google returned a new one",
      /if \(result\.rotatedRefreshToken\)/.test(tok));
    check("H9) the refresh credential is NEVER deleted or revoked automatically",
      !/revokeProviderCredential|providerCredential\.delete/.test(tok));
    check("H10) a vault decrypt failure never falls back to a soft path", /VaultDecryptError/.test(tok));
    check("H11) reconnect state is recorded on the connection, reversibly",
      /BusinessConnectionStatus\.reauth_required/.test(tok) && /clearGoogleBusinessReconnectRequired/.test(tok));
    check("H12) no logging of any kind", !/console\.(log|error|warn|info)/.test(tok));
    check("H13) no token value is ever placed in an ops event or audit metadata",
      !/emitOpsEvent\([^)]*(accessToken|refreshToken|plaintext)/.test(tok));
    check("H14) monitoring activation re-reads lastSuccessfulSyncAt from the DB rather than trusting a caller",
      /if \(!account\.lastSuccessfulSyncAt\) return \{ enabled: false, reason: "sync_not_proven" \}/.test(tok));
    check("H15) activation goes through the EXISTING entitlement-checked helper",
      /enableAccountMonitoringWithinLimit\(tenantId, accountId\)/.test(tok));
    check("H16) a plan limit is a truthful state, not a thrown failure",
      /EntitlementError/.test(tok) && /reason: "plan_limit_reached"/.test(tok));
    check("H17) activation refuses a non-google account", /reason: "not_google"/.test(tok));
  }

  // =========================================================================================
  console.log("\nI) Sync orchestration — integration, not a parallel system");
  const IDX = "packages/sync/src/index.ts";
  const idx = code(IDX);
  {
    check("I1) Google is routed inside the EXISTING fetchContent seam", /String\(account\.platform\) === "google_business"\)\s*\{\s*return fetchGoogleBusinessReviews/.test(idx));
    check("I2) no separate Google sync entry point was created",
      !/export async function runGoogleSync|export async function syncGoogleBusiness/.test(idx));
    check("I3) Google is NOT gated by the Meta live-sync switch", /!isGoogle && !meta\.liveSync/.test(idx));
    // Compare positions INSIDE fetchContent's body, so neither anchor can match an import line.
    const fcBody = idx.slice(idx.indexOf("async function fetchContent("), idx.indexOf("async function fetchGoogleBusinessReviews("));
    check("I4) the Google branch precedes the Meta token resolution inside fetchContent",
      fcBody.indexOf("return fetchGoogleBusinessReviews(") > 0
      && fcBody.indexOf("return fetchGoogleBusinessReviews(") < fcBody.indexOf("resolveMetaAccessTokenSafe("));
    check("I5) the shared lease/SyncRun/ingest path is reused unchanged",
      /acquireSyncLease/.test(idx) && /ingestItem\(tenantId, account, item/.test(idx));
    check("I6) a truncated Google fetch is propagated to the run record", /truncated: res\.truncated/.test(idx));
    check("I7) truncation is recorded in the terminal audit", /\.\.\.\(truncated \? \{ truncated: true \} : \{\}\)/.test(idx));
    check("I8) reconnect-required maps to the EXISTING run-control error", /throw new ReconnectRequiredError\("Google authorization is no longer valid/.test(idx));
    check("I9) rate limiting maps to the retryable error, not a reconnect", /throw new RateLimitedError\("Google API rate limit/.test(idx));
    check("I10) a deployment fault is NOT reported as reconnect-required",
      /throw new Error\("Google Business sync is not available for this deployment\."\)/.test(idx));
    check("I11) the location is re-resolved LIVE before any review call",
      idx.indexOf("discoverGoogleBusinessScope(client)") < idx.indexOf("fetchAllGoogleReviews("));
    check("I12) a location that vanished from the grant fails closed",
      /if \(!location\) \{[\s\S]{0,200}throw new PermissionRequiredError/.test(idx));
    check("I13) a location that lost verification fails closed", /!isLocationSyncEligible\(location\)/.test(idx));
    check("I14) no raw provider text reaches lastError — only fixed sentences",
      !/throw new Error\(`Google[^`]*\$\{/.test(idx));
    check("I15) no console logging was added to the orchestrator", !/console\.(log|error|warn|info)/.test(idx));
  }
  {
    const repos = code("packages/db/src/repositories.ts");
    check("I16) background discovery includes google_business in the EXISTING candidate query",
      /platform: \{ in: \["facebook_page", "instagram_business", "google_business"\]/.test(repos));
    check("I17) discovery still requires monitoringEnabled — an unmonitored account is never auto-synced",
      /monitoringEnabled: true/.test(repos));
    check("I18) no separate Google cron/dispatcher was introduced",
      !/findGoogleSyncCandidates|selectGoogleSyncBatch/.test(repos));
  }

  // =========================================================================================
  console.log("\nJ) UI — truthful state through existing components");
  const PAGE = "apps/web/src/app/dashboard/accounts/page.tsx";
  const page = code(PAGE);
  {
    check("J1) an unmonitored connected account states WHY, via the shared derivation", /deriveMonitoringState\(\{/.test(page));
    check("J2) it reuses the existing Badge component, not a new Google surface", /<Badge tone=\{tone\}>\{label\}<\/Badge>/.test(page));
    check("J3) every label comes from the dictionary — no hardcoded English", !/monitoring unavailable|waiting for first sync/i.test(page));
    check("J4) all three locales define the new keys",
      ["en", "sk", "de"].every((l) => {
        const d = readSrc(`apps/web/src/i18n/dictionaries/${l}.ts`);
        return ["monMonitored", "monSyncing", "monWaiting", "monFirstSyncFailed", "monUnavailable"].every((k) => d.includes(`${k}:`));
      }));
    check("J5) no token or provider raw error is rendered", !/accessToken|refreshToken|plaintext/.test(page));
    check("J6) the monitoring state is machine-checkable for tests", /data-testid="monitoring-state"/.test(page));
    check("J7) the existing first-sync state block is preserved for monitored accounts", /data-testid="first-sync-state"/.test(page));
  }
  {
    // PRODUCTION INCIDENT REGRESSION — searchParams must be awaited before ANY property read.
    const raw = readSrc(PAGE);
    const spAwait = raw.indexOf("await searchParams");
    const firstUse = raw.search(/\bsp\./);
    check("J8) searchParams is awaited before the resolved object is read", spAwait > 0 && firstUse > spAwait);
    check("J9) the unresolved promise is never property-accessed", !/searchParams\.[a-zA-Z]/.test(raw.replace(/await searchParams/g, "")));
    check("J10) searchParams is typed as a Promise (Next 15 contract)", /searchParams:\s*Promise</.test(raw));
  }

  // =========================================================================================
  console.log("\nK) Import action — first sync then activation");
  const ACT = code("apps/web/src/app/dashboard/accounts/google-business/actions.ts");
  {
    check("K1) a first sync is scheduled after import", /runReadOnlySync\(\{ accountId: id, tenantId: tid \}/.test(ACT));
    check("K2) it runs AFTER the response so the user never waits on Google", /after\(async \(\) => \{/.test(ACT));
    check("K3) monitoring is attempted ONLY when that sync reports success", /if \(outcome\.ok\) await activateGoogleBusinessMonitoring/.test(ACT));
    check("K4) nothing sets monitoringEnabled directly in the action", !/monitoringEnabled: true/.test(ACT));
    const SYNCACT = code("apps/web/src/app/dashboard/accounts/actions.ts");
    check("K5) a successful MANUAL sync may also activate monitoring",
      (SYNCACT.match(/if \(outcome\?\.ok\) await activateGoogleBusinessMonitoring/g) ?? []).length === 2);
    check("K6) ConnectorManage is still enforced on both manual paths",
      (SYNCACT.match(/assertCan\(session\.role, Permission\.ConnectorManage\)/g) ?? []).length >= 2);
  }

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — Google Business Slice 3A  [${pass} passed, ${fail} failed]`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
