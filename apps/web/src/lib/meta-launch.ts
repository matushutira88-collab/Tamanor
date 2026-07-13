/**
 * V1.40 — the ONE Meta launch-verification truth model. It reports, with NO secrets, how
 * far the Meta connector is toward launch. It is evidence-driven: a capability is only
 * "verified" when a real evidence entry proves it. Mock/test transport NEVER counts as live
 * verification, and "implemented" is never reported as "verified".
 *
 * Read verification and write verification are separate. Facebook and Instagram are separate.
 */
import { getMetaConfig } from "@guardora/config";
import { tokenStorageStatus } from "@guardora/db";
import { PROVIDERS } from "./provider-status";

export type MetaVerificationState =
  | "not_configured"
  | "configured"
  | "implementation_ready" // code + mock-verified tests exist; live proof pending
  | "verification_pending" // requires a live provider step not yet performed
  | "verified" // proven against the real provider (needs an evidence entry)
  | "failed"
  | "unavailable"; // requires an external system (Meta dashboard) we cannot read here

/** A single live-evidence record (populated only from a real verification run). */
export interface MetaEvidence {
  capability: string;
  platform?: "facebook" | "instagram";
  evidenceId: string; // audit id / SyncRun id / execution id (no PII, no token)
  timestamp: string;
  environment: string;
}

export interface MetaLaunchCapability {
  key: string;
  label: string;
  facebook: MetaVerificationState;
  instagram: MetaVerificationState;
}

export interface MetaLaunchStatus {
  /** Whether Meta OAuth is fully configured (App ID + secret + redirect present). No values. */
  oauthConfigured: boolean;
  oauthConfigState: MetaVerificationState;
  graphVersion: string;
  /** External states we cannot read here — always pending until confirmed on the Meta dashboard. */
  appReviewState: MetaVerificationState;
  businessVerificationState: MetaVerificationState;
  /** Runtime flags (booleans only). */
  flags: {
    liveSync: boolean;
    webhookSync: boolean;
    connectorHealth: boolean;
    facebookHide: boolean;
    instagramAutoHide: boolean;
  };
  tokenEncryptionSafe: boolean;
  capabilities: MetaLaunchCapability[];
  /** Only true when EVERY required capability is `verified` from real evidence. */
  launchReady: boolean;
  /** Count of live-evidence records supplied (0 until a real verification run). */
  evidenceCount: number;
}

const GRAPH_VERSION = "v21.0";

/** The launch capabilities that must be live-verified before COMPLETE. */
const CAPABILITY_DEFS: Array<{ key: string; label: string; needFb: boolean; needIg: boolean; live: boolean }> = [
  { key: "page_discovery", label: "Page/account discovery", needFb: true, needIg: true, live: true },
  { key: "read_sync", label: "Comment read sync", needFb: true, needIg: true, live: true },
  { key: "webhook", label: "Webhook delivery", needFb: true, needIg: true, live: true },
  { key: "hide_write", label: "Comment hide (write)", needFb: true, needIg: false, live: true },
  { key: "permission_revoke", label: "Permission revoke handling", needFb: true, needIg: true, live: true },
  { key: "token_expiry", label: "Token expiry / reconnect", needFb: true, needIg: true, live: true },
  { key: "disconnect_reconnect", label: "Disconnect / reconnect", needFb: true, needIg: true, live: true },
];

/**
 * Compute the launch status. Pure + DB-free (safe for a diagnostic). `evidence` is the set of
 * proven live checks — EMPTY until a real verification run supplies it, so all live states stay
 * `verification_pending` and `launchReady` stays false. No secret is ever read or returned.
 */
export function getMetaLaunchStatus(
  env: NodeJS.ProcessEnv = process.env,
  evidence: MetaEvidence[] = [],
): MetaLaunchStatus {
  const meta = getMetaConfig(env);
  const oauthConfigured = Boolean(meta.appId && meta.appSecret && meta.redirectUri);
  const tok = tokenStorageStatus();

  const has = (cap: string, platform: "facebook" | "instagram") =>
    evidence.some((e) => e.capability === cap && (e.platform === platform || e.platform === undefined));

  const stateFor = (cap: string, needed: boolean, platform: "facebook" | "instagram"): MetaVerificationState => {
    if (!needed) return "unavailable";
    if (has(cap, platform)) return "verified";
    // Configured + implemented, but no live proof yet.
    return oauthConfigured ? "verification_pending" : "not_configured";
  };

  const capabilities: MetaLaunchCapability[] = CAPABILITY_DEFS.map((c) => ({
    key: c.key,
    label: c.label,
    facebook: stateFor(c.key, c.needFb, "facebook"),
    instagram: stateFor(c.key, c.needIg, "instagram"),
  }));

  const requiredStates = capabilities.flatMap((c) => [c.facebook, c.instagram]).filter((s) => s !== "unavailable");
  const launchReady = requiredStates.length > 0 && requiredStates.every((s) => s === "verified");

  return {
    oauthConfigured,
    oauthConfigState: oauthConfigured ? "configured" : "not_configured",
    graphVersion: GRAPH_VERSION,
    // These require the Meta dashboard — we cannot read them here, so never claim them verified.
    appReviewState: "unavailable",
    businessVerificationState: "unavailable",
    flags: {
      liveSync: meta.liveSync,
      webhookSync: meta.webhookSync,
      connectorHealth: (env.META_CONNECTOR_HEALTH ?? "").trim() === "true",
      facebookHide: (env.FACEBOOK_HIDE_ENABLED ?? "").trim() === "true",
      instagramAutoHide: (env.INSTAGRAM_AUTO_HIDE_ENABLED ?? "").trim() === "true",
    },
    tokenEncryptionSafe: tok.productionSafe,
    capabilities,
    launchReady,
    evidenceCount: evidence.length,
  };
}

/**
 * V1.40 (§O) — consolidated Meta production-safety gate. Returns safe issue CODES only (no
 * values). Production must fail-closed / keep live features disabled when any issue is present.
 */
export function metaProductionSafety(env: NodeJS.ProcessEnv = process.env): { ok: boolean; issues: string[] } {
  const meta = getMetaConfig(env);
  const tok = tokenStorageStatus();
  const isProd = env.NODE_ENV === "production";
  const oauthConfigured = Boolean(meta.appId && meta.appSecret && meta.redirectUri);
  const issues: string[] = [];

  if (isProd && env.E2E_TEST_MODE === "true") issues.push("e2e_test_mode_enabled_in_production");
  if (isProd && !tok.productionSafe) issues.push("token_encryption_not_production_safe");
  if (meta.liveSync && !oauthConfigured) issues.push("live_sync_without_oauth_config");
  if (meta.webhookSync && !meta.appSecret) issues.push("webhook_sync_without_app_secret");
  if (isProd && (env.FACEBOOK_HIDE_ENABLED ?? "").trim() === "true" && !tok.productionSafe) issues.push("hide_enabled_without_safe_tokens");

  return { ok: issues.length === 0, issues };
}

/** Keep the public provider-truth model consistent: no provider is launch-live without evidence. */
export function providerTruthConsistentWithLaunch(status: MetaLaunchStatus): boolean {
  // Instagram must never be public-live while its read_sync/webhook are unverified.
  const ig = PROVIDERS.find((p) => p.key === "instagram");
  return ig ? ig.live === false && status.launchReady === false : true;
}
