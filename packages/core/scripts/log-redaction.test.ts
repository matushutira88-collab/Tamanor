/**
 * PRIVACY-SAFE STRUCTURED LOGGER — adversarial redaction tests for `redactDeep` + `emitSafeLog`.
 * Covers: bearer token, cookie, Authorization, DB URL, api/encryption keys, email, phone, IPv4, nested arrays,
 * deeply-nested secret, circular object, long string, Error/stack, depth/breadth limits, and the emitSafeLog
 * allow-listed line shape (never a raw body / secret).
 */
import { redactDeep, emitSafeLog, redact } from "../src/observability";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const R = (v: unknown, o?: object) => redactDeep(v, o);
const J = (v: unknown) => JSON.stringify(R(v));

// secret-shaped KEYS → redacted regardless of value
check("key: token", (R({ token: "abc" }) as any).token === "[redacted]");
check("key: cookie", (R({ cookie: "x=y" }) as any).cookie === "[redacted]");
check("key: authorization", (R({ authorization: "whatever" }) as any).authorization === "[redacted]");
check("key: password", (R({ password: "hunter2" }) as any).password === "[redacted]");
check("key: api_key", (R({ api_key: "k" }) as any).api_key === "[redacted]");
check("key: encryption_key", (R({ encryption_key: "k" }) as any).encryption_key === "[redacted]");
check("key: database_url", (R({ database_url: "x" }) as any).database_url === "[redacted]");
check("key: payload", (R({ payload: { deep: 1 } }) as any).payload === "[redacted]");
check("key: email", (R({ email: "a@b.com" }) as any).email === "[redacted]");

// secret-shaped VALUES → redacted
check("val: bearer", (R({ h: "Bearer abc.def.ghi" }) as any).h === "[redacted]");
check("val: postgres url", (R({ u: "postgresql://user:pw@host/db" }) as any).u === "[redacted]");
check("val: jwt", (R({ t: "eyJhbGciOi.payloadpart.sig" }) as any).t === "[redacted]");
check("val: email in text", (R({ note: "contact me at joe@example.com please" }) as any).note === "[redacted]");
check("val: phone", (R({ c: "+421 903 123 456" }) as any).c === "[redacted]");
check("val: ipv4", (R({ ip: "192.168.1.100" }) as any).ip === "[redacted]");
check("val: plaintext ciphertext prefix", (R({ x: "plain:v1:abcd" }) as any).x === "[redacted]");

// safe values pass through
check("safe: plain label kept", (R({ status: "healthy", count: 3, ok: true }) as any).status === "healthy");
check("safe: number kept", (R({ n: 42 }) as any).n === 42);
check("safe: 40-char hex SHA kept (not phone/secret)", (R({ sha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2" }) as any).sha === "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");

// nested arrays + deep secret → recursively redacted (the single-level `redact` would MISS these)
{
  const deep = { a: { b: [{ token: "leak" }, { ok: 1 }] } };
  const out = R(deep) as any;
  check("nested: deep token redacted", out.a.b[0].token === "[redacted]");
  check("nested: deep safe kept", out.a.b[1].ok === 1);
  check("contrast: single-level redact collapses nested to [object]", (redact({ a: { token: "leak" } }) as any).a === "[object]");
}

// circular → no throw, marked
{
  const c: any = { name: "root" }; c.self = c;
  let threw = false; let out: any;
  try { out = R(c); } catch { threw = true; }
  check("circular: no throw", threw === false);
  check("circular: marked", out.self === "[circular]");
}

// long string → truncated
{
  const long = "x".repeat(5000);
  const out = R({ big: long }, { maxString: 100 }) as any;
  check("long: truncated", typeof out.big === "string" && out.big.length < 200 && /…\[truncated\]/.test(out.big));
}

// Error → {name, message}, no stack
{
  const e = new Error("db postgres://u:p@h/db failed");
  const out = R({ err: e }) as any;
  check("error: has name", out.err.name === "Error");
  check("error: message redacted (contained secret url)", out.err.message === "[redacted]");
  check("error: no stack field", !("stack" in out.err));
}

// depth + breadth limits
{
  const d: any = {}; let cur = d; for (let i = 0; i < 20; i++) { cur.n = {}; cur = cur.n; }
  check("depth: bounded (no infinite walk)", JSON.stringify(R(d, { maxDepth: 3 })).includes("[depth-limited]"));
  const arr = Array.from({ length: 500 }, (_, i) => i);
  const outA = R({ arr }, { maxArray: 10 }) as any;
  check("breadth: array capped", outA.arr.length === 11 && /more/.test(outA.arr[10]));
}

// emitSafeLog: allow-listed shape, never a raw secret / body
{
  let captured = "";
  const orig = console.log;
  // eslint-disable-next-line no-console
  console.log = (s?: unknown) => { captured += String(s); };
  try {
    emitSafeLog({ event: "release.provenance.invalid", severity: "error", releaseSha: "a".repeat(40), routeTemplate: "/api/platform/release", outcome: "refused", detail: { token: "Bearer secret.jwt.x", errors: ["sha_missing"] } });
  } finally { console.log = orig; }
  check("emitSafeLog: emitted one JSON line", captured.startsWith("{") && captured.endsWith("}"));
  check("emitSafeLog: no secret leaked", !/Bearer secret|secret\.jwt/.test(captured));
  check("emitSafeLog: detail.token redacted", /"token":"\[redacted\]"/.test(captured));
  check("emitSafeLog: keeps event + sha + outcome", /release\.provenance\.invalid/.test(captured) && /"outcome":"refused"/.test(captured) && /"releaseSha":"a{40}"/.test(captured));
  check("emitSafeLog: fail-safe (never throws)", (() => { try { emitSafeLog({ event: "x", detail: (() => { const o: any = {}; o.s = o; return o; })() }); return true; } catch { return false; } })());
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — privacy-safe structured logger (redactDeep + emitSafeLog)`);
process.exit(failures === 0 ? 0 : 1);
