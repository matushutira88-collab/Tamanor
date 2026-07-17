/**
 * V1.58.6 — behavioural tests for the central Meta HTTP layer (timeout + bounded retry + backoff +
 * classification). Mocks the fetch boundary and INJECTS sleep/clock — no real waiting. Asserts no
 * token/secret/proof leaks into errors.
 */
import { metaFetch, MetaHttpError, MetaGraphClient, MetaGraphError } from "@guardora/connectors";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

// ---- fetch mock + injected clock ----
type Step = Response | Error;
let calls = 0;
function mock(steps: Step[]) {
  calls = 0;
  (globalThis as unknown as { fetch: unknown }).fetch = async () => {
    const s = steps[Math.min(calls++, steps.length - 1)];
    if (s instanceof Error) throw s;
    return s;
  };
}
const resp = (status: number, body = "{}", headers: Record<string, string> = {}): Response =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => JSON.parse(body), text: async () => body } as unknown as Response);
const timeoutErr = () => Object.assign(new Error("aborted (timeout)"), { name: "TimeoutError" });
function clock() { let t = 0; const delays: number[] = []; return { now: () => t, sleep: async (ms: number) => { delays.push(ms); t += ms; }, delays }; }
const GRAPH = "https://graph.facebook.com/v21.0/me/accounts?access_token=SECRET_TOKEN_xyz&appsecret_proof=PROOF_abc";

async function run() {
  // A1/A2/A7) timeout aborts, is retryable, exhausts to a stable classified error.
  { const ck = clock(); mock([timeoutErr(), timeoutErr(), timeoutErr()]);
    let err: MetaHttpError | null = null;
    try { await metaFetch(GRAPH, { category: "graph_read", retryable: true, sleep: ck.sleep, now: ck.now }); } catch (e) { err = e as MetaHttpError; }
    check("A1/A2/A7) timeout → retried then stable MetaHttpError(kind=timeout)", err instanceof MetaHttpError && err.kind === "timeout" && calls === 3 && ck.delays.length === 2, `calls=${calls}`);
    check("A8) error message carries NO token/proof/URL", !!err && !err.message.includes("SECRET_TOKEN") && !err.message.includes("PROOF") && !err.message.includes("graph.facebook")); }

  // A4) 429 retried respecting a (bounded) Retry-After, then succeeds.
  { const ck = clock(); mock([resp(429, "{}", { "retry-after": "2" }), resp(200, '{"data":[]}')]);
    const r = await metaFetch(GRAPH, { category: "graph_read", retryable: true, sleep: ck.sleep, now: ck.now });
    check("A4) 429 retried honoring Retry-After (2s), then 200", r.status === 200 && calls === 2 && ck.delays[0] === 2000, `delay=${ck.delays[0]}`); }

  // A5) 5xx retried (bounded); exhausted → returns the final 5xx response for the caller to classify.
  { const ck = clock(); mock([resp(503), resp(503), resp(503)]);
    const r = await metaFetch(GRAPH, { category: "graph_read", retryable: true, sleep: ck.sleep, now: ck.now });
    check("A5) 5xx retried up to maxAttempts then returns final 503", r.status === 503 && calls === 3 && ck.delays.length === 2); }

  // A6) a 4xx permanent error is returned immediately (no retry).
  { const ck = clock(); mock([resp(400, '{"error":{"code":100}}')]);
    const r = await metaFetch(GRAPH, { category: "graph_read", retryable: true, sleep: ck.sleep, now: ck.now });
    check("A6) 4xx permanent → returned immediately, no retry", r.status === 400 && calls === 1); }

  // A10) total retry budget is never exceeded.
  { const ck = clock(); mock([timeoutErr(), timeoutErr(), timeoutErr(), timeoutErr(), timeoutErr()]);
    try { await metaFetch(GRAPH, { category: "graph_read", retryable: true, maxAttempts: 5, maxTotalMs: 1000, sleep: ck.sleep, now: ck.now }); } catch { /* expected */ }
    const total = ck.delays.reduce((a, b) => a + b, 0);
    check("A10) total retry budget (maxTotalMs) not exceeded", total <= 1000 && calls < 5, `total=${total} calls=${calls}`); }

  // Side-effect with retryable:false performs exactly one attempt (no blind repeat of a moderation action).
  { const ck = clock(); mock([timeoutErr()]);
    try { await metaFetch(GRAPH, { category: "side_effect", retryable: false, sleep: ck.sleep, now: ck.now }); } catch { /* expected */ }
    check("B) retryable:false side-effect makes exactly ONE attempt", calls === 1 && ck.delays.length === 0); }

  // MetaGraphClient mapping: invalid token (code 190) → token_expired, NOT retryable, single call.
  { mock([resp(400, '{"error":{"code":190,"message":"Invalid OAuth access token","fbtrace_id":"tr1"}}')]);
    let err: MetaGraphError | null = null;
    try { await new MetaGraphClient("tok", "sec").get("me/accounts"); } catch (e) { err = e as MetaGraphError; }
    check("A3) invalid token (190) → kind=token_expired, retryable=false, ONE call", !!err && err.detail.kind === "token_expired" && err.detail.retryable === false && calls === 1); }

  // A9) invalid/HTML success body → classified invalid_response, not a raw parser error.
  { mock([resp(200, "<html>not json</html>")]);
    let err: MetaGraphError | null = null;
    try { await new MetaGraphClient("tok", "sec").get("me/accounts"); } catch (e) { err = e as MetaGraphError; }
    check("A9) invalid JSON success body → kind=invalid_response (safe)", !!err && err.detail.kind === "invalid_response"); }

  // Rate-limit surfaced through the client is classified retryable.
  { mock([resp(429), resp(429), resp(429)]);
    let err: MetaGraphError | null = null;
    try { await new MetaGraphClient("tok", "sec").get("me", {}); } catch (e) { err = e as MetaGraphError; }
    check("B) exhausted 429 → MetaGraphError kind=rate_limit, retryable=true", !!err && err.detail.kind === "rate_limit" && err.detail.retryable === true); }

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — meta HTTP resilience (V1.58.6): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch((e) => { console.error(String(e).slice(0, 200)); process.exit(1); });
