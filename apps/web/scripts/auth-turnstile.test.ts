/**
 * V1.58.9 — Cloudflare Turnstile server verification + fail-closed config + adaptive decision. Pure
 * (mocked siteverify). Run: pnpm auth-turnstile:test
 */
import { verifyTurnstile, turnstileConfigInvalid, loginChallengeRequired, getTurnstileConfig } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const okFetch = (success: boolean, hostname?: string) => (async () => ({ ok: true, json: async () => ({ success, hostname }) })) as never;

async function run() {
  // Verification.
  check("valid token → ok", (await verifyTurnstile({ token: "t", secret: "s", fetchImpl: okFetch(true) })).ok === true);
  check("provider says fail → not ok", (await verifyTurnstile({ token: "t", secret: "s", fetchImpl: okFetch(false) })).ok === false);
  check("missing token → not ok (presence not enough)", (await verifyTurnstile({ token: "", secret: "s", fetchImpl: okFetch(true) })).ok === false);
  check("missing secret → config_missing", (await verifyTurnstile({ token: "t", secret: undefined, fetchImpl: okFetch(true) })).reason === "config_missing");
  check("hostname mismatch → rejected", (await verifyTurnstile({ token: "t", secret: "s", expectedHostname: "tamanor.com", fetchImpl: okFetch(true, "evil.com") })).ok === false);
  check("network error → timeout (not ok)", (await verifyTurnstile({ token: "t", secret: "s", fetchImpl: (async () => { throw new Error("x"); }) as never })).ok === false);

  // Fail-closed config invariant: prod + enabled + missing secret/site key → invalid.
  check("prod enabled without secret → config invalid (fail-closed)", turnstileConfigInvalid({ NODE_ENV: "production", TURNSTILE_ENABLED: "true", TURNSTILE_SITE_KEY: "sk" } as never) === true);
  check("prod enabled without site key → config invalid", turnstileConfigInvalid({ NODE_ENV: "production", TURNSTILE_ENABLED: "true", TURNSTILE_SECRET_KEY: "s" } as never) === true);
  check("prod enabled with both → valid", turnstileConfigInvalid({ NODE_ENV: "production", TURNSTILE_ENABLED: "true", TURNSTILE_SITE_KEY: "sk", TURNSTILE_SECRET_KEY: "s" } as never) === false);
  check("disabled → never invalid", turnstileConfigInvalid({ NODE_ENV: "production", TURNSTILE_ENABLED: "false" } as never) === false);
  check("config: enabled reads env", getTurnstileConfig({ TURNSTILE_ENABLED: "1", TURNSTILE_SITE_KEY: "pub" } as never).enabled === true);

  // Adaptive login decision (server-owned).
  check("challenge NOT required below threshold", loginChallengeRequired(2, 3) === false);
  check("challenge required at/above threshold", loginChallengeRequired(3, 3) === true && loginChallengeRequired(9, 3) === true);

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — Turnstile verify + adaptive (V1.58.9): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
