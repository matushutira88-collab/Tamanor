/**
 * V1.58.8 — internal Cron endpoint auth (security group). Pure: builds synthetic Requests, injects the
 * secret. Proves fail-closed behaviour — no secret configured denies everything; a wrong/absent Bearer
 * is unauthorized; only the exact Bearer passes. No secret value is ever printed.
 *
 * Run: pnpm cron-auth:test
 */
import { assertCronAuth, cronUnauthorized } from "../src/lib/cron-auth";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const req = (auth?: string) => new Request("https://tamanor.com/api/internal/jobs/x", { headers: auth ? { authorization: auth } : {} });
const SECRET = "s3cr3t-cron-value-should-never-leak";

function run() {
  // Security S-unauthorized) no Authorization header → denied.
  check("S) no Authorization header → unauthorized", assertCronAuth(req(), SECRET).ok === false);

  // S-invalid) wrong secret → denied.
  check("S) invalid cron secret → unauthorized", assertCronAuth(req("Bearer wrong-value-wrong-value-wrong"), SECRET).ok === false);

  // S) malformed scheme → denied.
  check("S) malformed Authorization (no Bearer) → unauthorized", assertCronAuth(req(SECRET), SECRET).ok === false);

  // S) exact Bearer → allowed.
  check("S) exact Bearer secret → authorized", assertCronAuth(req(`Bearer ${SECRET}`), SECRET).ok === true);

  // S-fail-closed) CRON_SECRET unset → deny EVERYTHING (never open).
  check("S) CRON_SECRET unset → fail-closed deny (even with a Bearer)", assertCronAuth(req("Bearer anything"), "").ok === false);
  check("S) CRON_SECRET unset reason=cron_secret_unset", assertCronAuth(req(), undefined).reason === "cron_secret_unset");

  // S) the 401 helper returns HTTP 401.
  const resp = cronUnauthorized("unauthorized");
  check("S) cronUnauthorized() → HTTP 401", resp.status === 401);

  // S) secret never leaks through the result object.
  const r = assertCronAuth(req(`Bearer ${SECRET}`), SECRET);
  check("S) result carries no secret value", !JSON.stringify(r).includes(SECRET));

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — internal Cron endpoint auth (V1.58.8): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
