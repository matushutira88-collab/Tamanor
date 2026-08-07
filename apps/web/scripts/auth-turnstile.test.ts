/**
 * V1.58.9 — Cloudflare Turnstile server verification + fail-closed config + adaptive decision. Pure
 * (mocked siteverify). Run: pnpm auth-turnstile:test
 */
import {
  verifyTurnstile, turnstileConfigInvalid, loginChallengeRequired, getTurnstileConfig,
  canonicalTurnstileErrorReason,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const okFetch = (success: boolean, hostname?: string) => (async () => ({ ok: true, json: async () => ({ success, hostname }) })) as never;
/** siteverify 200 with an explicit `error-codes` array, exactly as Cloudflare returns it. */
const codeFetch = (...codes: unknown[]) =>
  (async () => ({ ok: true, json: async () => ({ success: false, "error-codes": codes }) })) as never;
const reasonFor = async (...codes: unknown[]) =>
  (await verifyTurnstile({ token: "t", secret: "s", fetchImpl: codeFetch(...codes) })).reason;

async function run() {
  // Verification.
  check("valid token → ok", (await verifyTurnstile({ token: "t", secret: "s", fetchImpl: okFetch(true) })).ok === true);
  check("provider says fail → not ok", (await verifyTurnstile({ token: "t", secret: "s", fetchImpl: okFetch(false) })).ok === false);
  check("missing token → not ok (presence not enough)", (await verifyTurnstile({ token: "", secret: "s", fetchImpl: okFetch(true) })).ok === false);
  check("missing secret → config_missing", (await verifyTurnstile({ token: "t", secret: undefined, fetchImpl: okFetch(true) })).reason === "config_missing");
  check("hostname mismatch → rejected", (await verifyTurnstile({ token: "t", secret: "s", expectedHostname: "tamanor.com", fetchImpl: okFetch(true, "evil.com") })).ok === false);
  check("network error → timeout (not ok)", (await verifyTurnstile({ token: "t", secret: "s", fetchImpl: (async () => { throw new Error("x"); }) as never })).ok === false);

  // ---- Provider error-code observability (the previously discarded `error-codes`) ----
  // Every documented Cloudflare code maps to its own bounded reason.
  for (const code of [
    "missing-input-secret", "invalid-input-secret", "bad-request",
    "missing-input-response", "timeout-or-duplicate", "invalid-input-response", "internal-error",
  ]) {
    check(`provider code ${code} → bounded reason`, (await reasonFor(code)) === code);
  }
  // Every one of them still FAILS CLOSED — richer labelling never changes the verdict.
  for (const code of ["timeout-or-duplicate", "invalid-input-response", "internal-error", "bad-request"]) {
    check(`provider code ${code} still fails closed`,
      (await verifyTurnstile({ token: "t", secret: "s", fetchImpl: codeFetch(code) })).ok === false);
  }
  // Unrecognised / malformed provider values never reach telemetry verbatim.
  check("unrecognised code → unknown_provider_error", (await reasonFor("some-new-code")) === "unknown_provider_error");
  check("empty error-codes → unknown_provider_error", (await reasonFor()) === "unknown_provider_error");
  check("absent error-codes → unknown_provider_error",
    (await verifyTurnstile({ token: "t", secret: "s", fetchImpl: okFetch(false) })).reason === "unknown_provider_error");
  check("non-string codes ignored → unknown_provider_error", (await reasonFor(1, null, {}, [])) === "unknown_provider_error");
  check("free-form provider text is never echoed",
    (await reasonFor("<script>alert(1)</script>")) === "unknown_provider_error");

  // Multiple codes → ONE deterministic canonical reason, by documented precedence.
  check("multi-code: secret fault outranks token fault",
    (await reasonFor("timeout-or-duplicate", "missing-input-secret")) === "missing-input-secret");
  check("multi-code: invalid-secret outranks bad-request",
    (await reasonFor("bad-request", "invalid-input-secret")) === "invalid-input-secret");
  check("multi-code: missing-response outranks timeout-or-duplicate",
    (await reasonFor("timeout-or-duplicate", "missing-input-response")) === "missing-input-response");
  check("multi-code: timeout-or-duplicate outranks invalid-input-response",
    (await reasonFor("invalid-input-response", "timeout-or-duplicate")) === "timeout-or-duplicate");
  check("multi-code: internal-error ranks last",
    (await reasonFor("internal-error", "invalid-input-response")) === "invalid-input-response");
  check("multi-code: order in the array does not matter (deterministic)",
    (await reasonFor("internal-error", "bad-request")) === (await reasonFor("bad-request", "internal-error")));
  check("multi-code: an unknown code alongside a known one keeps the known one",
    (await reasonFor("brand-new-code", "timeout-or-duplicate")) === "timeout-or-duplicate");

  // The pure mapper is directly deterministic and total.
  check("mapper is pure/total on junk input", canonicalTurnstileErrorReason(undefined) === "unknown_provider_error"
    && canonicalTurnstileErrorReason("not-an-array") === "unknown_provider_error"
    && canonicalTurnstileErrorReason(null) === "unknown_provider_error");
  check("mapper is idempotent", canonicalTurnstileErrorReason(["bad-request"]) === canonicalTurnstileErrorReason(["bad-request"]));

  // Non-2xx siteverify has no parsable body — retains the flat local classification.
  check("HTTP non-2xx → invalid (no body to classify)",
    (await verifyTurnstile({ token: "t", secret: "s", fetchImpl: (async () => ({ ok: false, json: async () => ({}) })) as never })).reason === "invalid");

  // No secret/token/raw payload may appear in the returned classification.
  {
    const leaked = await verifyTurnstile({
      token: "TOKEN-SHOULD-NEVER-APPEAR", secret: "SECRET-SHOULD-NEVER-APPEAR",
      remoteip: "203.0.113.9",
      fetchImpl: (async () => ({ ok: true, json: async () => ({ success: false, "error-codes": ["invalid-input-response"], hostname: "evil.example", messages: ["raw provider text"] }) })) as never,
    });
    const serialized = JSON.stringify(leaked);
    check("result leaks no token/secret/ip/hostname/raw body",
      !serialized.includes("TOKEN-SHOULD-NEVER-APPEAR") && !serialized.includes("SECRET-SHOULD-NEVER-APPEAR")
      && !serialized.includes("203.0.113.9") && !serialized.includes("evil.example") && !serialized.includes("raw provider text"),
      serialized);
    check("…and still fails closed with the canonical reason", leaked.ok === false && leaked.reason === "invalid-input-response");
  }

  // Local (pre-network) classifications are unchanged.
  check("local: missing token still missing_token", (await verifyTurnstile({ token: "", secret: "s", fetchImpl: okFetch(true) })).reason === "missing_token");
  check("local: missing secret still config_missing", (await verifyTurnstile({ token: "t", secret: undefined, fetchImpl: okFetch(true) })).reason === "config_missing");
  check("local: network throw still timeout", (await verifyTurnstile({ token: "t", secret: "s", fetchImpl: (async () => { throw new Error("x"); }) as never })).reason === "timeout");
  check("success still reports success", (await verifyTurnstile({ token: "t", secret: "s", fetchImpl: okFetch(true) })).reason === "success");

  // Fail-closed config invariant: prod + enabled + missing secret/site key → invalid.
  check("prod enabled without secret → config invalid (fail-closed)", turnstileConfigInvalid({ NODE_ENV: "production", TURNSTILE_ENABLED: "true", TURNSTILE_SITE_KEY: "sk" } as never) === true);
  check("prod enabled without site key → config invalid", turnstileConfigInvalid({ NODE_ENV: "production", TURNSTILE_ENABLED: "true", TURNSTILE_SECRET_KEY: "s" } as never) === true);
  check("prod enabled with both → valid", turnstileConfigInvalid({ NODE_ENV: "production", TURNSTILE_ENABLED: "true", TURNSTILE_SITE_KEY: "sk", TURNSTILE_SECRET_KEY: "s" } as never) === false);
  check("disabled → never invalid", turnstileConfigInvalid({ NODE_ENV: "production", TURNSTILE_ENABLED: "false" } as never) === false);
  check("config: enabled reads env", getTurnstileConfig({ TURNSTILE_ENABLED: "1", TURNSTILE_SITE_KEY: "pub" } as never).enabled === true);

  // Adaptive login decision (server-owned).
  check("challenge NOT required below threshold", loginChallengeRequired(2, 3) === false);
  check("challenge required at/above threshold", loginChallengeRequired(3, 3) === true && loginChallengeRequired(9, 3) === true);

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — Turnstile verify + provider error codes + adaptive: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
