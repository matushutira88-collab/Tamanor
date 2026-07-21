/**
 * V1.74 (Sprint C9) — pure tests for the typed Google Business Profile READ client
 * (packages/sync/src/google-business-api-client.ts). Mocks the transport seam and
 * INJECTS sleep/clock — no network, no real waiting. Proves: pagination pass-through,
 * ONE 401→refresh→retry, 403 access_denied / 404 not_found (terminal), bounded
 * 429/5xx/timeout retry honoring Retry-After, redacted errors (no token/URL/body),
 * the executor adapter mapping into normalized product reasons, and the fail-closed
 * approval gate (no live executor while approval is pending). NO write path exists.
 *
 * Run: pnpm google-business-api:test
 */
import {
  GoogleBusinessApiClient, GoogleBusinessApiError, createLiveGoogleReviewExecutor,
  toReviewExecutor, listGoogleBusinessReviews, isRetryableGoogleKind,
  type GoogleBusinessTransport, type GoogleHttpRequest, type GoogleHttpResponse, type GoogleBusinessLocation,
} from "@guardora/sync";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

type Step = GoogleHttpResponse | Error;
class MockTransport implements GoogleBusinessTransport {
  readonly name = "mock";
  readonly reqs: GoogleHttpRequest[] = [];
  private i = 0;
  constructor(private readonly steps: Step[]) {}
  async send(req: GoogleHttpRequest): Promise<GoogleHttpResponse> {
    this.reqs.push(req);
    const s = this.steps[Math.min(this.i++, this.steps.length - 1)];
    if (s instanceof Error) throw s;
    return s;
  }
}
const resp = (status: number, body: unknown = {}, retryAfterMs = 0): GoogleHttpResponse => ({ status, retryAfterMs, json: async () => body });
const badBody = (status: number): GoogleHttpResponse => ({ status, json: async () => { throw new Error("not json"); } });
const timeoutErr = () => new GoogleBusinessApiError({ status: 0, kind: "timeout", retryable: true });
const clock = () => { let t = 0; const delays: number[] = []; return { now: () => t, sleep: async (ms: number) => { delays.push(ms); t += ms; }, delays }; };

const verifiedLoc: GoogleBusinessLocation = { providerLocationName: "locations/L1", providerLocationId: "L1", displayName: "Store A", verificationState: "verified", selected: true };
const CONFIGURED = { GOOGLE_BUSINESS_CLIENT_ID: "cid", GOOGLE_BUSINESS_CLIENT_SECRET: "sec", GOOGLE_BUSINESS_REDIRECT_URI: "http://localhost/cb" };
const ENABLED = { ...CONFIGURED, GOOGLE_BUSINESS_API_ENABLED: "true" };
const APPROVED = { ...ENABLED, GOOGLE_BUSINESS_API_APPROVED: "true" };
const SECRET = "ya29.SECRET_ACCESS_TOKEN_xyz";

async function run() {
  // 1) Pagination pass-through: reviews + nextPageToken flow straight through.
  { const ck = clock();
    const t = new MockTransport([resp(200, { reviews: [{ reviewId: "r1", starRating: "FIVE" }], nextPageToken: "TOK2" })]);
    const client = new GoogleBusinessApiClient({ transport: t, accessToken: SECRET, sleep: ck.sleep, now: ck.now });
    const page = await client.listReviews({ accountId: "A1", location: verifiedLoc });
    check("1) pagination pass-through (reviews + nextPageToken)", page.reviews?.length === 1 && page.nextPageToken === "TOK2" && t.reqs.length === 1); }

  // 2) 401 → refresh → retry ONCE → success. Refresh called once; second token used.
  { const ck = clock(); let refreshCalls = 0;
    const t = new MockTransport([resp(401), resp(200, { reviews: [] })]);
    const client = new GoogleBusinessApiClient({ transport: t, accessToken: SECRET, refreshAccessToken: async () => { refreshCalls++; return "ya29.FRESH"; }, sleep: ck.sleep, now: ck.now });
    const page = await client.listReviews({ accountId: "A1", location: verifiedLoc });
    check("2) 401 → refresh → retry once → success", Array.isArray(page.reviews) && refreshCalls === 1 && t.reqs.length === 2 && t.reqs[1]!.accessToken === "ya29.FRESH"); }

  // 3) 401 with NO refresh fn → terminal token_expired, exactly one call.
  { const ck = clock();
    const t = new MockTransport([resp(401)]);
    const client = new GoogleBusinessApiClient({ transport: t, accessToken: SECRET, sleep: ck.sleep, now: ck.now });
    let err: GoogleBusinessApiError | null = null;
    try { await client.listReviews({ accountId: "A1", location: verifiedLoc }); } catch (e) { err = e as GoogleBusinessApiError; }
    check("3) 401 w/o refresh → token_expired, ONE call, not retryable", !!err && err.detail.kind === "token_expired" && err.detail.retryable === false && t.reqs.length === 1); }

  // 3b) 401 → refresh → still 401 → token_expired (retry is ONCE only).
  { const ck = clock(); let refreshCalls = 0;
    const t = new MockTransport([resp(401), resp(401)]);
    const client = new GoogleBusinessApiClient({ transport: t, accessToken: SECRET, refreshAccessToken: async () => { refreshCalls++; return "ya29.FRESH"; }, sleep: ck.sleep, now: ck.now });
    let err: GoogleBusinessApiError | null = null;
    try { await client.listReviews({ accountId: "A1", location: verifiedLoc }); } catch (e) { err = e as GoogleBusinessApiError; }
    check("3b) 401 refresh-once then 401 → token_expired (single refresh)", !!err && err.detail.kind === "token_expired" && refreshCalls === 1 && t.reqs.length === 2); }

  // 4) 403 → access_denied, terminal (no retry).
  { const ck = clock();
    const t = new MockTransport([resp(403), resp(200)]);
    const client = new GoogleBusinessApiClient({ transport: t, accessToken: SECRET, sleep: ck.sleep, now: ck.now });
    let err: GoogleBusinessApiError | null = null;
    try { await client.listReviews({ accountId: "A1", location: verifiedLoc }); } catch (e) { err = e as GoogleBusinessApiError; }
    check("4) 403 → access_denied, no retry (ONE call)", !!err && err.detail.kind === "access_denied" && err.detail.retryable === false && t.reqs.length === 1); }

  // 4b) 404 → not_found, terminal.
  { const ck = clock();
    const t = new MockTransport([resp(404)]);
    const client = new GoogleBusinessApiClient({ transport: t, accessToken: SECRET, sleep: ck.sleep, now: ck.now });
    let err: GoogleBusinessApiError | null = null;
    try { await client.listReviews({ accountId: "A1", location: verifiedLoc }); } catch (e) { err = e as GoogleBusinessApiError; }
    check("4b) 404 → not_found, terminal", !!err && err.detail.kind === "not_found" && t.reqs.length === 1); }

  // 5) 429 → retried honoring (bounded) Retry-After, then 200.
  { const ck = clock();
    const t = new MockTransport([resp(429, {}, 2000), resp(200, { reviews: [] })]);
    const client = new GoogleBusinessApiClient({ transport: t, accessToken: SECRET, sleep: ck.sleep, now: ck.now });
    const page = await client.listReviews({ accountId: "A1", location: verifiedLoc });
    check("5) 429 → retried honoring Retry-After (2s) → 200", Array.isArray(page.reviews) && t.reqs.length === 2 && ck.delays[0] === 2000); }

  // 5b) 429 exhausted → rate_limit (retryable classification).
  { const ck = clock();
    const t = new MockTransport([resp(429), resp(429), resp(429)]);
    const client = new GoogleBusinessApiClient({ transport: t, accessToken: SECRET, sleep: ck.sleep, now: ck.now });
    let err: GoogleBusinessApiError | null = null;
    try { await client.listReviews({ accountId: "A1", location: verifiedLoc }); } catch (e) { err = e as GoogleBusinessApiError; }
    check("5b) 429 exhausted → rate_limit, retryable, 3 attempts", !!err && err.detail.kind === "rate_limit" && err.detail.retryable === true && t.reqs.length === 3 && ck.delays.length === 2); }

  // 6) 5xx → retried then exhausted → server_error.
  { const ck = clock();
    const t = new MockTransport([resp(503), resp(503), resp(503)]);
    const client = new GoogleBusinessApiClient({ transport: t, accessToken: SECRET, sleep: ck.sleep, now: ck.now });
    let err: GoogleBusinessApiError | null = null;
    try { await client.listReviews({ accountId: "A1", location: verifiedLoc }); } catch (e) { err = e as GoogleBusinessApiError; }
    check("6) 5xx retried then server_error", !!err && err.detail.kind === "server_error" && t.reqs.length === 3); }

  // 7) transport timeout → retried then exhausted → timeout.
  { const ck = clock();
    const t = new MockTransport([timeoutErr(), timeoutErr(), timeoutErr()]);
    const client = new GoogleBusinessApiClient({ transport: t, accessToken: SECRET, sleep: ck.sleep, now: ck.now });
    let err: GoogleBusinessApiError | null = null;
    try { await client.listReviews({ accountId: "A1", location: verifiedLoc }); } catch (e) { err = e as GoogleBusinessApiError; }
    check("7) timeout retried then classified timeout", !!err && err.detail.kind === "timeout" && t.reqs.length === 3); }

  // 7b) total budget (maxTotalMs) never exceeded.
  { const ck = clock();
    const t = new MockTransport([timeoutErr(), timeoutErr(), timeoutErr(), timeoutErr(), timeoutErr()]);
    const client = new GoogleBusinessApiClient({ transport: t, accessToken: SECRET, maxAttempts: 5, maxTotalMs: 1000, sleep: ck.sleep, now: ck.now });
    try { await client.listReviews({ accountId: "A1", location: verifiedLoc }); } catch { /* expected */ }
    const total = ck.delays.reduce((a, b) => a + b, 0);
    check("7b) total retry budget not exceeded", total <= 1000 && t.reqs.length < 5, `total=${total}`); }

  // 8) invalid JSON success body → invalid_response (not a raw parser error).
  { const ck = clock();
    const t = new MockTransport([badBody(200)]);
    const client = new GoogleBusinessApiClient({ transport: t, accessToken: SECRET, sleep: ck.sleep, now: ck.now });
    let err: GoogleBusinessApiError | null = null;
    try { await client.listReviews({ accountId: "A1", location: verifiedLoc }); } catch (e) { err = e as GoogleBusinessApiError; }
    check("8) invalid JSON → invalid_response", !!err && err.detail.kind === "invalid_response"); }

  // 9) REDACTION — the token never reaches the request URL/query, and no error carries it.
  { const ck = clock();
    const t = new MockTransport([resp(401)]);
    const client = new GoogleBusinessApiClient({ transport: t, accessToken: SECRET, sleep: ck.sleep, now: ck.now });
    let err: GoogleBusinessApiError | null = null;
    try { await client.listReviews({ accountId: "A1", location: verifiedLoc }); } catch (e) { err = e as GoogleBusinessApiError; }
    const req = t.reqs[0]!;
    const queryStr = JSON.stringify(req.query ?? {});
    check("9) token not in query; error carries no token/URL/body",
      !queryStr.includes(SECRET) && !req.path.includes(SECRET) && !!err && !err.message.includes(SECRET) && !err.message.includes("mybusiness") && !err.message.includes("Bearer")); }

  // 10) listAccounts / listLocations pagination pass-through.
  { const ck = clock();
    const t = new MockTransport([resp(200, { accounts: [{ name: "accounts/1" }], nextPageToken: "A2" })]);
    const client = new GoogleBusinessApiClient({ transport: t, accessToken: SECRET, sleep: ck.sleep, now: ck.now });
    const a = await client.listAccounts();
    const locT = new MockTransport([resp(200, { locations: [{ name: "locations/L1" }], nextPageToken: "L2" })]);
    const locClient = new GoogleBusinessApiClient({ transport: locT, accessToken: SECRET, sleep: ck.sleep, now: ck.now });
    const l = await locClient.listLocations("accounts/1");
    check("10) listAccounts/listLocations pagination", a.accounts.length === 1 && a.nextPageToken === "A2" && l.locations.length === 1 && l.nextPageToken === "L2"
      && t.reqs[0]!.service === "accountManagement" && locT.reqs[0]!.service === "businessInformation" && locT.reqs[0]!.path === "v1/accounts/1/locations"); }

  // 11) Executor adapter → normalized product reasons via listGoogleBusinessReviews.
  { const ck = clock();
    // 200 with reviews → succeeds through the existing seam.
    const okClient = new GoogleBusinessApiClient({ transport: new MockTransport([resp(200, { reviews: [{ reviewId: "r1", starRating: "FOUR", comment: "ok" }] })]), accessToken: SECRET, sleep: ck.sleep, now: ck.now });
    const okRes = await listGoogleBusinessReviews({ accountId: "A1", location: verifiedLoc }, { source: ENABLED, executor: toReviewExecutor(okClient) });
    check("11) executor adapter → sync_succeeded + normalized review", okRes.ok === true && okRes.reason === "google_business_sync_succeeded" && okRes.reviews.length === 1);

    // 401 → token_expired reason (no raw payload).
    const authClient = new GoogleBusinessApiClient({ transport: new MockTransport([resp(401)]), accessToken: SECRET, sleep: ck.sleep, now: ck.now });
    const authRes = await listGoogleBusinessReviews({ accountId: "A1", location: verifiedLoc }, { source: ENABLED, executor: toReviewExecutor(authClient) });
    check("11b) executor 401 → google_business_token_expired", authRes.ok === false && authRes.reason === "google_business_token_expired");

    // 403 → access_denied reason.
    const denyClient = new GoogleBusinessApiClient({ transport: new MockTransport([resp(403)]), accessToken: SECRET, sleep: ck.sleep, now: ck.now });
    const denyRes = await listGoogleBusinessReviews({ accountId: "A1", location: verifiedLoc }, { source: ENABLED, executor: toReviewExecutor(denyClient) });
    check("11c) executor 403 → google_business_access_denied", denyRes.ok === false && denyRes.reason === "google_business_access_denied");

    // 429 → quota/rate reason.
    const rlClient = new GoogleBusinessApiClient({ transport: new MockTransport([resp(429), resp(429), resp(429)]), accessToken: SECRET, sleep: ck.sleep, now: ck.now });
    const rlRes = await listGoogleBusinessReviews({ accountId: "A1", location: verifiedLoc }, { source: ENABLED, executor: toReviewExecutor(rlClient) });
    check("11d) executor 429 → google_business_quota_exceeded", rlRes.ok === false && rlRes.reason === "google_business_quota_exceeded"); }

  // 12) FAIL-CLOSED approval gate — no live executor unless configured+enabled+APPROVED+token.
  { const transport = new MockTransport([resp(200, { reviews: [] })]);
    const mk = (source: NodeJS.ProcessEnv, token: string | null) => createLiveGoogleReviewExecutor({ transport, accessToken: token, source });
    check("12) no executor when only enabled (approval pending)", mk(ENABLED, "tok") === null);
    check("12b) no executor when approved but no token", mk(APPROVED, null) === null);
    check("12c) no executor when not configured", mk({ GOOGLE_BUSINESS_API_APPROVED: "true" }, "tok") === null);
    check("12d) executor EXISTS only when configured+enabled+approved+token", typeof mk(APPROVED, "tok") === "function"); }

  // 13) retryable-kind classification is transport/transient only.
  check("13) isRetryableGoogleKind: transient only", isRetryableGoogleKind("rate_limit") && isRetryableGoogleKind("server_error") && isRetryableGoogleKind("timeout") && isRetryableGoogleKind("network") && !isRetryableGoogleKind("token_expired") && !isRetryableGoogleKind("access_denied") && !isRetryableGoogleKind("not_found"));

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — Google Business API read client (V1.74): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
