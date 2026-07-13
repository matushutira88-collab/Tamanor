/**
 * V1.41 — Google Business Profile launch-readiness guardrails. Behavior tests against the real
 * launch model + production-safety gate + verified-location gate, plus source guardrails for the
 * diagnostic endpoint. NO live provider calls (none are possible here); these prove fail-closed
 * logic, evidence gating, the verified-only rule, and that the diagnostic never returns secrets.
 *
 * Run: pnpm google-launch:test
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getGoogleLaunchStatus,
  googleProductionSafety,
  googleTruthConsistentWithLaunch,
  type GoogleEvidence,
} from "../src/lib/google-launch";
import { isLocationSyncEligible, type GoogleBusinessLocation } from "@guardora/sync";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const web = (p: string) => readFileSync(resolve(process.cwd(), "../web", p), "utf8");

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(overrides)) { saved[k] = process.env[k]; if (overrides[k] === undefined) delete process.env[k]; else process.env[k] = overrides[k]; }
  try { fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

const OAUTH = {
  GOOGLE_BUSINESS_CLIENT_ID: "ZZGID",
  GOOGLE_BUSINESS_CLIENT_SECRET: "ZZGSECRET",
  GOOGLE_BUSINESS_REDIRECT_URI: "https://tamanor.com/api/connectors/google-business/callback",
};
const loc = (v: string): GoogleBusinessLocation => ({ providerLocationName: "locations/L1", providerLocationId: "L1", displayName: "Store", verificationState: v, selected: true } as GoogleBusinessLocation);

function run() {
  // ---------------- Production safety fail-closed (§U 1–3) ----------------
  withEnv({ GOOGLE_BUSINESS_API_ENABLED: "true", GOOGLE_BUSINESS_CLIENT_ID: undefined, GOOGLE_BUSINESS_CLIENT_SECRET: undefined, GOOGLE_BUSINESS_REDIRECT_URI: undefined }, () => {
    check("1) API enabled without OAuth config → fail-closed", googleProductionSafety().issues.includes("api_enabled_without_oauth_config"));
  });
  withEnv({ ...OAUTH, NODE_ENV: "production", TOKEN_ENCRYPTION_MODE: "plaintext", TOKEN_ENCRYPTION_KEY: undefined }, () => {
    check("2) production + plaintext tokens → fail-closed", googleProductionSafety().issues.includes("token_encryption_not_production_safe"));
  });
  withEnv({ ...OAUTH, NODE_ENV: "production", E2E_TEST_MODE: "true", TOKEN_ENCRYPTION_MODE: "aes-gcm", TOKEN_ENCRYPTION_KEY: "k" }, () => {
    check("3) production + E2E_TEST_MODE → fail-closed", googleProductionSafety().issues.includes("e2e_test_mode_enabled_in_production"));
  });
  withEnv({ ...OAUTH, NODE_ENV: "production", TOKEN_ENCRYPTION_MODE: "aes-gcm", TOKEN_ENCRYPTION_KEY: "k", GOOGLE_BUSINESS_API_ENABLED: "false", E2E_TEST_MODE: undefined }, () => {
    check("4) valid production config → safe (no issues)", googleProductionSafety().ok === true);
  });

  // ---------------- Verified-location gate (§U 4–5) ----------------
  check("5) verified-location gate: only 'verified' may sync", isLocationSyncEligible(loc("verified")) === true && isLocationSyncEligible(loc("unverified")) === false && isLocationSyncEligible(loc("unknown")) === false && isLocationSyncEligible(loc("suspended")) === false);

  // ---------------- Launch model: evidence-driven ----------------
  withEnv(OAUTH, () => {
    const empty = getGoogleLaunchStatus(process.env, []);
    check("6) oauth configured detected (no values)", empty.oauthConfigured === true && empty.oauthConfigState === "configured");
    check("7) scope is minimal business.manage", empty.scope === "https://www.googleapis.com/auth/business.manage");
    check("8) no evidence → all capabilities verification_pending, launchReady false", empty.launchReady === false && empty.evidenceCount === 0 && empty.capabilities.every((c) => c.state !== "verified"));
    check("9) consent screen is external (unavailable, never faked verified)", empty.consentScreenState === "unavailable");
  });
  withEnv({ ...OAUTH, GOOGLE_BUSINESS_API_ENABLED: "true" }, () => {
    check("10) API flag set is NOT approval (apiAccessState verification_pending, not verified)", getGoogleLaunchStatus(process.env, []).apiAccessState === "verification_pending");
  });

  withEnv(OAUTH, () => {
    const caps = ["oauth", "account_discovery", "location_discovery", "verified_location", "live_review_sync", "refresh_token", "disconnect", "reconnect", "rate_limit"];
    const evidence: GoogleEvidence[] = caps.map((c) => ({ capability: c, evidenceId: `ev_${c}`, timestamp: "2026-07-13T00:00:00Z", environment: "test-asset" }));
    check("11) launchReady true ONLY after every capability has evidence", getGoogleLaunchStatus(process.env, evidence).launchReady === true);
    check("12) missing one evidence → launchReady false", getGoogleLaunchStatus(process.env, evidence.slice(1)).launchReady === false);

    // No secret leak in diagnostic output.
    const json = JSON.stringify(getGoogleLaunchStatus(process.env, []));
    check("13) launch status output contains NO secret material", !/clientSecret|accessToken|refreshToken|authorization|postgres|bearer |[A-Za-z0-9]{40,}/.test(json) && !json.includes(OAUTH.GOOGLE_BUSINESS_CLIENT_SECRET) && !json.includes(OAUTH.GOOGLE_BUSINESS_CLIENT_ID));
    check("14) provider truth consistent: GBP not public-live while launch pending", googleTruthConsistentWithLaunch(getGoogleLaunchStatus(process.env, [])) === true);
  });

  const route = web("src/app/api/google-business/launch-status/route.ts");
  check("15) diagnostic endpoint auth-gated + returns states only", /getSession\(\)/.test(route) && /Permission\.MemberManage/.test(route) && !/clientSecret|accessToken|process\.env\.(GOOGLE_BUSINESS_CLIENT_SECRET|DATABASE_URL)/.test(route));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Google Business launch readiness (V1.41)`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
