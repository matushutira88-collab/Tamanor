/**
 * V1.58.9 — auth audit PRIVACY: the observability redactor must strip any password / session token /
 * reset token / Turnstile token / cookie / secret that a careless caller might attach to an auth event.
 * Pure. Run: pnpm auth-audit:test
 */
import { redact } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

function run() {
  const out = redact({
    operation: "login",
    result: "ok",
    reason: "invalid_credentials",
    password: "hunter2",
    passwordHash: "$argon2id$abc",
    token: "sess_abc123",
    session_token: "sess_xyz",
    reset_token: "rst_123",
    verification_token: "vrf_1",
    cookie: "tamanor_session=abc",
    authorization: "Bearer secret",
    turnstileToken: "cf-xyz",
    api_key: "sk_live_x",
    database_url: "postgresql://u:p@h/db",
  });
  const blob = JSON.stringify(out);
  check("password redacted", out.password === "[redacted]");
  check("password hash redacted", out.passwordHash === "[redacted]");
  check("session token redacted", out.token === "[redacted]" && out.session_token === "[redacted]");
  check("reset/verification token redacted", out.reset_token === "[redacted]" && out.verification_token === "[redacted]");
  check("cookie redacted", out.cookie === "[redacted]");
  check("authorization redacted", out.authorization === "[redacted]");
  check("api key + database url redacted", out.api_key === "[redacted]" && out.database_url === "[redacted]");
  check("safe fields preserved", out.operation === "login" && out.result === "ok" && out.reason === "invalid_credentials");
  check("no secret value survives in serialized output", !blob.includes("hunter2") && !blob.includes("sess_abc123") && !blob.includes("Bearer secret") && !blob.includes("sk_live_x") && !blob.includes("postgresql://"));

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — auth audit privacy (V1.58.9): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
