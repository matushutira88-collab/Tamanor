/**
 * V1.41 — the ONE Google Business Profile launch-verification truth model. Reports, with NO
 * secrets, how far the GBP connector is toward launch. Evidence-driven: a capability is only
 * "verified" when a real evidence entry proves it. Injected/mock executors NEVER count as live
 * verification. OAuth success is not API-access approval; a selected location is not a verified
 * location; "implemented" is never "verified".
 */
import { getGoogleBusinessConfig } from "@guardora/config";
import { tokenStorageStatus } from "@guardora/db";
import { PROVIDERS } from "./provider-status";

export type GoogleVerificationState =
  | "not_configured"
  | "configured"
  | "implementation_ready"
  | "verification_pending"
  | "verified"
  | "failed"
  | "unavailable"; // external system (Google console / GBP approval) we cannot read here

export interface GoogleEvidence {
  capability: string;
  evidenceId: string; // audit / SyncRun / ConnectedAccount / ContentItem id — no PII, no token
  timestamp: string;
  environment: string;
}

export interface GoogleLaunchCapability {
  key: string;
  label: string;
  state: GoogleVerificationState;
}

export interface GoogleLaunchStatus {
  oauthConfigured: boolean;
  oauthConfigState: GoogleVerificationState;
  scope: string;
  /** GOOGLE_BUSINESS_API_ENABLED flag — a flag is NOT provider approval. */
  apiFlagEnabled: boolean;
  apiAccessState: GoogleVerificationState; // "unavailable" until real approval evidence
  consentScreenState: GoogleVerificationState; // external (Google console)
  tokenEncryptionSafe: boolean;
  capabilities: GoogleLaunchCapability[];
  launchReady: boolean;
  evidenceCount: number;
}

/** Launch capabilities that must be live-verified before COMPLETE. */
const CAPABILITY_DEFS: Array<{ key: string; label: string }> = [
  { key: "oauth", label: "Live OAuth" },
  { key: "account_discovery", label: "Account discovery" },
  { key: "location_discovery", label: "Location discovery" },
  { key: "verified_location", label: "Verified-location gate" },
  { key: "live_review_sync", label: "Live review sync" },
  { key: "refresh_token", label: "Token refresh / expiry" },
  { key: "disconnect", label: "Disconnect" },
  { key: "reconnect", label: "Reconnect" },
  { key: "rate_limit", label: "Rate-limit / error behavior" },
];

/**
 * Compute the launch status. Pure + DB-free. `evidence` is EMPTY until a real verification run
 * supplies it, so all live states stay `verification_pending` and `launchReady` stays false.
 * No secret is ever read or returned.
 */
export function getGoogleLaunchStatus(
  env: NodeJS.ProcessEnv = process.env,
  evidence: GoogleEvidence[] = [],
): GoogleLaunchStatus {
  const cfg = getGoogleBusinessConfig(env);
  const oauthConfigured = cfg.configured;
  const tok = tokenStorageStatus();

  const has = (cap: string) => evidence.some((e) => e.capability === cap);
  const stateFor = (cap: string): GoogleVerificationState => {
    if (has(cap)) return "verified";
    return oauthConfigured ? "verification_pending" : "not_configured";
  };

  const capabilities: GoogleLaunchCapability[] = CAPABILITY_DEFS.map((c) => ({ key: c.key, label: c.label, state: stateFor(c.key) }));
  const launchReady = capabilities.every((c) => c.state === "verified");

  return {
    oauthConfigured,
    oauthConfigState: oauthConfigured ? "configured" : "not_configured",
    scope: cfg.scope, // "https://www.googleapis.com/auth/business.manage" — minimal, non-secret
    apiFlagEnabled: cfg.apiEnabled,
    // A flag being set is NOT approval; approval requires a real GBP access grant we cannot read here.
    apiAccessState: !cfg.apiEnabled ? "not_configured" : has("api_access") ? "verified" : "verification_pending",
    consentScreenState: "unavailable",
    tokenEncryptionSafe: tok.productionSafe,
    capabilities,
    launchReady,
    evidenceCount: evidence.length,
  };
}

/**
 * V1.41 (§T) — consolidated GBP production-safety gate. Safe issue CODES only. Production must
 * fail-closed / keep live review sync disabled when any issue is present.
 */
export function googleProductionSafety(env: NodeJS.ProcessEnv = process.env): { ok: boolean; issues: string[] } {
  const cfg = getGoogleBusinessConfig(env);
  const tok = tokenStorageStatus();
  const isProd = env.NODE_ENV === "production";
  const issues: string[] = [];

  if (isProd && env.E2E_TEST_MODE === "true") issues.push("e2e_test_mode_enabled_in_production");
  if (isProd && !tok.productionSafe) issues.push("token_encryption_not_production_safe");
  if (cfg.apiEnabled && !cfg.configured) issues.push("api_enabled_without_oauth_config");

  return { ok: issues.length === 0, issues };
}

/** Keep public provider-truth consistent: GBP is never public-live without evidence. */
export function googleTruthConsistentWithLaunch(status: GoogleLaunchStatus): boolean {
  const gbp = PROVIDERS.find((p) => p.key === "google_business");
  return gbp ? gbp.live === false && status.launchReady === false : true;
}
