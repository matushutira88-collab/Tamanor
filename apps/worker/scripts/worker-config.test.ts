/**
 * V1.58.7 — FAIL-CLOSED worker config validator tests (group A, 13). Pure: no DB, no network, no real
 * env — every case injects a synthetic env record. Also asserts an error NEVER echoes a secret value.
 *
 * Run: pnpm worker-config:test
 */
import { validateWorkerConfig } from "../src/config-validator";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

/** A fully-valid PRODUCTION env; each test overrides one field to prove that field's rule fails closed. */
const PROD_OK: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://postgres:SECRETpw@db:5432/app",
  APP_DATABASE_URL: "postgresql://tamanor_app:APPSECRETpw@db:5432/app",
  TOKEN_ENCRYPTION_MODE: "aes-gcm",
  TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  GUARDORA_DATA_MODE: "real",
  AUTO_SYNC_ENABLED: "true",
  META_LIVE_SYNC: "true",
  META_APP_ID: "123456789",
  META_APP_SECRET: "META_APP_SECRET_VALUE_should_never_leak",
  WORKER_SYNC_INTERVAL_MS: "60000",
  SYNC_LEASE_TTL_MS: "300000",
  SYNC_LEASE_HEARTBEAT_MS: "75000",
  WORKER_SHUTDOWN_GRACE_MS: "25000",
};
const withEnv = (over: Record<string, string | undefined>): NodeJS.ProcessEnv => {
  const e = { ...PROD_OK, ...over };
  for (const [k, v] of Object.entries(over)) if (v === undefined) delete (e as Record<string, unknown>)[k];
  return e;
};
const failsWith = (env: NodeJS.ProcessEnv, needle: string) => {
  const r = validateWorkerConfig(env);
  return !r.ok && r.errors.some((e) => e.includes(needle));
};

function run() {
  // A1) production without APP_DATABASE_URL fails.
  check("A1) prod without APP_DATABASE_URL fails", failsWith(withEnv({ APP_DATABASE_URL: undefined }), "APP_DATABASE_URL"));

  // A2) production without the owner DB URL fails.
  check("A2) prod without DATABASE_URL fails", failsWith(withEnv({ DATABASE_URL: undefined }), "DATABASE_URL"));

  // A3) production without a token encryption key (for aes-gcm) fails.
  check("A3) prod aes-gcm without TOKEN_ENCRYPTION_KEY fails", failsWith(withEnv({ TOKEN_ENCRYPTION_KEY: undefined }), "TOKEN_ENCRYPTION_KEY"));

  // A4) an invalid encryption mode fails.
  check("A4) prod invalid TOKEN_ENCRYPTION_MODE fails", failsWith(withEnv({ TOKEN_ENCRYPTION_MODE: "rot13" }), "TOKEN_ENCRYPTION_MODE"));

  // A5) plaintext (demo-grade) token mode in production fails.
  check("A5) prod TOKEN_ENCRYPTION_MODE=plaintext fails", failsWith(withEnv({ TOKEN_ENCRYPTION_MODE: "plaintext" }), "plaintext"));

  // A5b) GUARDORA_DATA_MODE unset in production fails (must not silently default to demo).
  check("A5b) prod GUARDORA_DATA_MODE unset fails (no silent demo)", failsWith(withEnv({ GUARDORA_DATA_MODE: undefined }), "GUARDORA_DATA_MODE"));

  // A6) sync enabled for real data but no Meta config fails.
  check("A6) prod real+autosync without Meta config fails", failsWith(withEnv({ META_APP_ID: undefined, META_APP_SECRET: undefined }), "META_APP_ID"));
  check("A6b) prod real+autosync with META_LIVE_SYNC off fails (silent no-op)", failsWith(withEnv({ META_LIVE_SYNC: "false" }), "META_LIVE_SYNC"));

  // A7) an invalid worker interval fails.
  check("A7) invalid WORKER_SYNC_INTERVAL_MS fails", failsWith(withEnv({ WORKER_SYNC_INTERVAL_MS: "0" }), "WORKER_SYNC_INTERVAL_MS"));

  // A8) an invalid lease TTL fails.
  check("A8) invalid SYNC_LEASE_TTL_MS fails", failsWith(withEnv({ SYNC_LEASE_TTL_MS: "-5" }), "SYNC_LEASE_TTL_MS"));

  // A9) heartbeat >= TTL fails (no safe renew reserve).
  check("A9) heartbeat >= TTL fails", failsWith(withEnv({ SYNC_LEASE_HEARTBEAT_MS: "300000", SYNC_LEASE_TTL_MS: "300000" }), "half of SYNC_LEASE_TTL_MS"));

  // A10) heartbeat without a safe reserve (more than half of TTL) fails.
  check("A10) heartbeat without safe reserve (>TTL/2) fails", failsWith(withEnv({ SYNC_LEASE_HEARTBEAT_MS: "200000", SYNC_LEASE_TTL_MS: "300000" }), "half of SYNC_LEASE_TTL_MS"));

  // A11) shutdown timeout <= 0 fails.
  check("A11) invalid WORKER_SHUTDOWN_GRACE_MS fails", failsWith(withEnv({ WORKER_SHUTDOWN_GRACE_MS: "0" }), "WORKER_SHUTDOWN_GRACE_MS"));

  // A12) NO error ever contains a secret value (DB URL, app secret, or encryption key).
  const leaky = validateWorkerConfig(withEnv({ APP_DATABASE_URL: undefined, TOKEN_ENCRYPTION_MODE: "plaintext", WORKER_SYNC_INTERVAL_MS: "0" }));
  const blob = leaky.errors.join(" | ");
  check("A12) errors carry NO secret value", !leaky.ok
    && !blob.includes("SECRETpw") && !blob.includes("APPSECRETpw")
    && !blob.includes("META_APP_SECRET_VALUE_should_never_leak") && !blob.includes("0123456789abcdef"), blob);

  // A13) a valid production config passes.
  const okv = validateWorkerConfig(PROD_OK);
  check("A13) valid production config passes", okv.ok && okv.errors.length === 0, okv.errors.join("; "));

  // Bonus) dev is milder for secrets but STILL enforces numeric invariants (production invariants intact).
  check("dev) missing secrets OK in dev but heartbeat>=TTL still fails",
    validateWorkerConfig({ NODE_ENV: "development" }).ok === true
    && failsWith({ NODE_ENV: "development", SYNC_LEASE_HEARTBEAT_MS: "300000", SYNC_LEASE_TTL_MS: "300000" }, "half of SYNC_LEASE_TTL_MS"));

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — worker config validator (V1.58.7): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
