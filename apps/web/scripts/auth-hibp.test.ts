/**
 * V1.58.9 — HIBP breached-password check via k-anonymity. Pure (mocked fetch). Asserts that ONLY the
 * 5-char SHA-1 prefix is ever sent (never the full password or full hash), that a match rejects, a
 * miss allows, and a transient error FAILS OPEN (degraded). Run: pnpm auth-hibp:test
 */
import { createHash } from "node:crypto";
import { createHibpChecker } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const PW = "hunter2hunter2";
const sha1 = createHash("sha1").update(PW, "utf8").digest("hex").toUpperCase();
const prefix = sha1.slice(0, 5), suffix = sha1.slice(5);
let capturedUrl = "";
let capturedBody = "";

const mkFetch = (body: string, ok = true) => async (url: string, init?: { headers?: Record<string, string> }) => {
  capturedUrl = url; capturedBody = body;
  void init;
  return { ok, status: ok ? 200 : 503, text: async () => body };
};

async function run() {
  // Breached: the range returns our suffix with a positive count.
  const breachedChecker = createHibpChecker({ fetchImpl: mkFetch(`${suffix}:42\r\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1`) });
  const r1 = await breachedChecker.isBreached(PW);
  check("breached password rejected (count>0)", r1.breached === true && r1.count === 42 && r1.degraded === false);
  check("ONLY the 5-char SHA-1 prefix is sent (k-anonymity)", capturedUrl.endsWith(`/range/${prefix}`) && /\/range\/[0-9A-F]{5}$/.test(capturedUrl));
  check("full password never appears in request", !capturedUrl.includes(PW) && !capturedBody.includes(PW));
  check("full hash suffix never SENT (only received)", !capturedUrl.includes(suffix));

  // Not found: range returns other suffixes only → not breached.
  const cleanChecker = createHibpChecker({ fetchImpl: mkFetch("0000000000000000000000000000000000A:5\r\nBBBB:2") });
  const r2 = await cleanChecker.isBreached("a-very-unique-passphrase-9281");
  check("unbreached password allowed", r2.breached === false && r2.degraded === false);

  // Transient error (non-200) → FAIL OPEN (degraded, not breached).
  const downChecker = createHibpChecker({ fetchImpl: mkFetch("", false) });
  const r3 = await downChecker.isBreached(PW);
  check("HIBP outage → fail-open (degraded, not breached)", r3.breached === false && r3.degraded === true);

  // Thrown/timeout → fail open too.
  const throwChecker = createHibpChecker({ fetchImpl: (async () => { throw new Error("timeout"); }) as never });
  const r4 = await throwChecker.isBreached(PW);
  check("HIBP timeout → fail-open (degraded)", r4.breached === false && r4.degraded === true);

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — HIBP breached-password (V1.58.9): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
