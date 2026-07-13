/**
 * V1.40 — Meta launch-readiness guardrails. Behavior tests against the real launch model +
 * production-safety gate, plus source guardrails for the diagnostic endpoint. NO live provider
 * calls (none are possible here); these prove the fail-closed logic, evidence gating, and that
 * the diagnostic never returns secrets.
 *
 * Run: pnpm meta-launch:test
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getMetaLaunchStatus,
  metaProductionSafety,
  providerTruthConsistentWithLaunch,
  type MetaEvidence,
} from "../src/lib/meta-launch";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const web = (p: string) => readFileSync(resolve(process.cwd(), "../web", p), "utf8");

/** Run fn with process.env temporarily overridden, then restore. */
function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(overrides)) { saved[k] = process.env[k]; if (overrides[k] === undefined) delete process.env[k]; else process.env[k] = overrides[k]; }
  try { fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

const OAUTH = { META_APP_ID: "ZZAPPIDZZ", META_APP_SECRET: "ZZSECRETZZ", META_REDIRECT_URI: "https://tamanor.com/api/connectors/meta/callback" };

function run() {
  // ---------------- Production safety fail-closed (§S 1–4) ----------------
  withEnv({ ...OAUTH, META_LIVE_SYNC: "true", META_APP_ID: undefined, META_APP_SECRET: undefined, META_REDIRECT_URI: undefined }, () => {
    check("1) live sync without OAuth config → fail-closed", metaProductionSafety().issues.includes("live_sync_without_oauth_config"));
  });
  withEnv({ ...OAUTH, META_WEBHOOK_SYNC: "true", META_APP_SECRET: undefined }, () => {
    check("2) webhook sync without app secret → fail-closed", metaProductionSafety().issues.includes("webhook_sync_without_app_secret"));
  });
  withEnv({ ...OAUTH, NODE_ENV: "production", E2E_TEST_MODE: "true", TOKEN_ENCRYPTION_MODE: "aes-gcm", TOKEN_ENCRYPTION_KEY: "k" }, () => {
    check("3) production + E2E_TEST_MODE → fail-closed", metaProductionSafety().issues.includes("e2e_test_mode_enabled_in_production"));
  });
  withEnv({ ...OAUTH, NODE_ENV: "production", TOKEN_ENCRYPTION_MODE: "plaintext", TOKEN_ENCRYPTION_KEY: undefined, FACEBOOK_HIDE_ENABLED: "true" }, () => {
    const s = metaProductionSafety();
    check("4) production + plaintext tokens → fail-closed (encryption + hide)", s.issues.includes("token_encryption_not_production_safe") && s.issues.includes("hide_enabled_without_safe_tokens"));
  });
  withEnv({ ...OAUTH, NODE_ENV: "production", TOKEN_ENCRYPTION_MODE: "aes-gcm", TOKEN_ENCRYPTION_KEY: "k", META_LIVE_SYNC: "false", META_WEBHOOK_SYNC: "false", E2E_TEST_MODE: undefined, FACEBOOK_HIDE_ENABLED: "false" }, () => {
    check("5) valid production config → safe (no issues)", metaProductionSafety().ok === true);
  });

  // ---------------- Launch model: evidence-driven, nothing verified without proof ----------------
  withEnv(OAUTH, () => {
    const empty = getMetaLaunchStatus(process.env, []);
    check("6) oauth configured detected (no values)", empty.oauthConfigured === true && empty.oauthConfigState === "configured");
    check("7) no evidence → all live capabilities verification_pending, launchReady false", empty.launchReady === false && empty.evidenceCount === 0 && empty.capabilities.every((c) => c.facebook !== "verified" && c.instagram !== "verified"));
    check("8) App Review + business verification are external (unavailable, never faked verified)", empty.appReviewState === "unavailable" && empty.businessVerificationState === "unavailable");
    check("9) read and write are separate; Instagram hide is not a launch write capability", empty.capabilities.find((c) => c.key === "read_sync")!.facebook === "verification_pending" && empty.capabilities.find((c) => c.key === "hide_write")!.instagram === "unavailable");

    // Supply full live evidence → launchReady becomes true (proves the gate opens only with proof).
    const caps = ["page_discovery", "read_sync", "webhook", "hide_write", "permission_revoke", "token_expiry", "disconnect_reconnect"];
    const evidence: MetaEvidence[] = caps.map((c) => ({ capability: c, evidenceId: `ev_${c}`, timestamp: "2026-07-13T00:00:00Z", environment: "test-assets" }));
    const full = getMetaLaunchStatus(process.env, evidence);
    check("10) launchReady true ONLY after every required capability has evidence", full.launchReady === true && full.evidenceCount === 7);
    // Remove one evidence → not ready again.
    const partial = getMetaLaunchStatus(process.env, evidence.slice(1));
    check("11) missing one evidence → launchReady false again", partial.launchReady === false);
  });

  // ---------------- Diagnostic never leaks secrets ----------------
  withEnv(OAUTH, () => {
    const json = JSON.stringify(getMetaLaunchStatus(process.env, []));
    check("12) launch status output contains NO secret material", !/appSecret|accessToken|refreshToken|verifyToken|pageToken|postgres|bearer |[A-Za-z0-9]{40,}/.test(json) && !json.includes(OAUTH.META_APP_SECRET) && !json.includes(OAUTH.META_APP_ID));
  });
  const route = web("src/app/api/meta/launch-status/route.ts");
  check("13) diagnostic endpoint is auth-gated + returns states only", /getSession\(\)/.test(route) && /Permission\.MemberManage/.test(route) && !/appSecret|accessToken|process\.env\.(META_APP_SECRET|DATABASE_URL)/.test(route));

  // ---------------- Provider truth stays consistent ----------------
  withEnv(OAUTH, () => {
    check("14) provider truth consistent: Instagram not public-live while launch pending", providerTruthConsistentWithLaunch(getMetaLaunchStatus(process.env, [])) === true);
  });

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Meta launch readiness (V1.40)`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
