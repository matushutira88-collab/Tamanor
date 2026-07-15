/**
 * V1.51B — shared-store rate limiting (multi-instance). Pure unit test (Upstash fetch mocked).
 * Run via: pnpm rate-limit-store:test
 */
import {
  InMemoryRateLimitStore, UpstashRateLimitStore, SharedRateLimiter, createRateLimitStore,
  minimizeKey, type RateLimitStore, type RateLimitDecision,
} from "@guardora/core";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  // minimizeKey — hashes the raw identifier (no raw IP/email retained), stable + bounded.
  const k1 = minimizeKey("1.2.3.4"), k2 = minimizeKey("1.2.3.4"), k3 = minimizeKey("5.6.7.8");
  check("minimizeKey: hashed (no raw identifier), stable, differs per input", k1 === k2 && k1 !== k3 && !k1.includes("1.2.3.4") && k1.length <= 24);

  // InMemoryRateLimitStore — allows up to the limit then denies; window resets.
  const mem = new InMemoryRateLimitStore();
  let allowed = 0;
  for (let i = 0; i < 5; i++) if ((await mem.hit("k", 60_000, 3)).allowed) allowed++;
  check("in-memory: allows exactly `limit` then denies", allowed === 3, String(allowed));
  const shortWin = new InMemoryRateLimitStore();
  await shortWin.hit("k", 1, 1); await new Promise((r) => setTimeout(r, 5));
  check("in-memory: window resets after windowMs", (await shortWin.hit("k", 1, 1)).allowed === true);

  // SharedRateLimiter over an injected fake store — allows to limit, then denies.
  const shared = new SharedRateLimiter(mem, { windowMs: 60_000, limit: 2 });
  const d1 = await shared.check("ip:9.9.9.9"), d2 = await shared.check("ip:9.9.9.9"), d3 = await shared.check("ip:9.9.9.9");
  check("SharedRateLimiter: allows up to limit then denies", d1.allowed && d2.allowed && !d3.allowed);

  // Distributed counting — TWO SharedRateLimiter "server instances" over ONE shared store share the
  // count (models multiple Vercel instances hitting Upstash): 5 total hits across both → 3 allowed.
  const sharedStore = new InMemoryRateLimitStore();
  const instA = new SharedRateLimiter(sharedStore, { windowMs: 60_000, limit: 3 });
  const instB = new SharedRateLimiter(sharedStore, { windowMs: 60_000, limit: 3 });
  const seq = [await instA.check("ip:7"), await instB.check("ip:7"), await instA.check("ip:7"), await instB.check("ip:7"), await instA.check("ip:7")];
  check("distributed: 2 instances/1 store → exactly `limit` allowed across both", seq.filter((d) => d.allowed).length === 3, String(seq.filter((d) => d.allowed).length));
  // Retry after expiry — a short-window shared limiter resets.
  const expStore = new InMemoryRateLimitStore();
  const expLim = new SharedRateLimiter(expStore, { windowMs: 1, limit: 1 });
  await expLim.check("k"); await new Promise((r) => setTimeout(r, 5));
  check("distributed: retry allowed after window expiry", (await expLim.check("k")).allowed === true);

  // Fail-closed: when the store throws (unreachable), sensitive path is DENIED by default.
  const throwing: RateLimitStore = { name: "boom", async hit(): Promise<RateLimitDecision> { throw new Error("down"); } };
  check("fail-closed (default): store down → DENIED", (await new SharedRateLimiter(throwing, { windowMs: 1000, limit: 5 }).check("x")).allowed === false);
  check("fail-open (opt-in): store down + failClosed:false → allowed", (await new SharedRateLimiter(throwing, { windowMs: 1000, limit: 5, failClosed: false }).check("x")).allowed === true);

  // UpstashRateLimitStore — mocked pipeline REST response (INCR result). No real network.
  const realFetch = globalThis.fetch;
  let lastAuth = "", lastBody = "";
  globalThis.fetch = (async (_url: any, init: any) => {
    lastAuth = String(init.headers.authorization); lastBody = String(init.body);
    return new Response(JSON.stringify([{ result: 3 }, { result: 1 }]), { status: 200 });
  }) as never;
  const up = new UpstashRateLimitStore("https://example.upstash.io", "tok_secret");
  const upd = await up.hit("kk", 60_000, 5);
  check("upstash: parses INCR count from pipeline; count=3 ≤ 5 → allowed", upd.count === 3 && upd.allowed === true);
  check("upstash: uses Bearer token + INCR/PEXPIRE pipeline", lastAuth === "Bearer tok_secret" && lastBody.includes("INCR") && lastBody.includes("PEXPIRE"));
  // Over-limit path.
  globalThis.fetch = (async () => new Response(JSON.stringify([{ result: 9 }, { result: 1 }]), { status: 200 })) as never;
  check("upstash: count over limit → denied", (await up.hit("kk", 60_000, 5)).allowed === false);
  // Transport error surfaces (SharedRateLimiter converts to fail-closed).
  globalThis.fetch = (async () => new Response("", { status: 500 })) as never;
  check("upstash: non-200 throws → SharedRateLimiter fail-closes", (await new SharedRateLimiter(up, { windowMs: 1000, limit: 5 }).check("z")).allowed === false);
  globalThis.fetch = realFetch;

  // createRateLimitStore — Upstash when configured, else in-memory fallback (truthful).
  check("createRateLimitStore: Upstash when both env vars present", createRateLimitStore({ UPSTASH_REDIS_REST_URL: "u", UPSTASH_REDIS_REST_TOKEN: "t" }).name === "upstash");
  check("createRateLimitStore: in-memory fallback when unconfigured", createRateLimitStore({}).name === "memory");

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — shared-store rate limiting (V1.51B)`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
