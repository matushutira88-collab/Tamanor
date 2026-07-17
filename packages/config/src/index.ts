import { z } from "zod";

/**
 * Guardora shared configuration.
 *
 * Env is parsed lazily and validated with zod. Placeholder-friendly:
 * connector secrets are optional so the app boots without any platform
 * credentials during early development.
 */

const boolFromEnv = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().default("postgresql://localhost:5432/guardora"),
  AUTH_SECRET: z.string().default("dev-secret-change-me"),

  // AI Risk Engine
  AI_PROVIDER: z.enum(["placeholder", "anthropic", "openai"]).default("placeholder"),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),

  // Worker
  WORKER_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  // V1.58.7 — sync lease fencing runtime. TTL is the window a sync has before its lease can be taken
  // over; the heartbeat renews it well inside that window (must be safely < TTL — validated by the
  // worker config validator). Shutdown grace is the hard drain deadline on SIGTERM/SIGINT.
  SYNC_LEASE_TTL_MS: z.coerce.number().int().positive().default(300_000),
  SYNC_LEASE_HEARTBEAT_MS: z.coerce.number().int().positive().default(75_000),
  WORKER_SHUTDOWN_GRACE_MS: z.coerce.number().int().positive().default(25_000),
  /**
   * Automatic read-only sync polling. When true, the worker periodically runs a
   * read-only sync for eligible connected accounts (never any platform action).
   * Default OFF; enable per environment. Manual "Run read-only sync" always works.
   */
  AUTO_SYNC_ENABLED: boolFromEnv,
  AUTO_SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  /**
   * Comment translation. When enabled with a real provider, non-workspace-locale
   * comments can be translated. Default OFF — no translation is ever fabricated;
   * the original text is always preserved.
   */
  TRANSLATION_ENABLED: boolFromEnv,
  TRANSLATION_PROVIDER: z.string().default("none"),
  TRANSLATION_TARGET_MODE: z.enum(["workspace_locale", "en"]).default("workspace_locale"),
  /**
   * External AI risk provider (gated hybrid pipeline). Default OFF: Risk Rules V1
   * is used alone. `mock` is dev/test only. No real provider is wired yet.
   */
  AI_RISK_PROVIDER_ENABLED: boolFromEnv,
  AI_RISK_PROVIDER: z.string().default("none"),
  AI_RISK_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),

  /**
   * V1.44 — PAID cloud-AI global fuses. ALL fail closed. `AI_PAID_ENABLED` is the master kill
   * switch (default OFF): with it off, NO paid provider call is ever made regardless of plan/quota.
   * The daily/rate/concurrency caps are process-level backstops on top of the per-tenant reservation
   * budget. `AI_PAID_EMERGENCY_DISABLE=true` hard-disables paid AI immediately.
   */
  AI_PAID_ENABLED: boolFromEnv,
  AI_PAID_EMERGENCY_DISABLE: boolFromEnv,
  AI_PAID_GLOBAL_DAILY_CALL_LIMIT: z.coerce.number().int().nonnegative().default(1_000),
  AI_PAID_GLOBAL_DAILY_COST_LIMIT_MICROS: z.coerce.number().int().nonnegative().default(5_000_000),
  AI_PAID_PROVIDER_DAILY_CALL_LIMIT: z.coerce.number().int().nonnegative().default(1_000),
  AI_PAID_RPM_LIMIT: z.coerce.number().int().positive().default(60),
  AI_PAID_MAX_CONCURRENCY: z.coerce.number().int().positive().default(4),
  AI_PAID_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  AI_PAID_MAX_RETRIES: z.coerce.number().int().nonnegative().max(5).default(1),
  AI_PAID_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  AI_PAID_CIRCUIT_COOLDOWN_MS: z.coerce.number().int().positive().default(60_000),

  /**
   * Live platform actions (controlled Facebook comment hide). ALL fail closed:
   * live execution requires LIVE_ACTIONS_ENABLED=true AND FACEBOOK_HIDE_ENABLED=true
   * AND LIVE_ACTIONS_DRY_RUN=false. Default OFF/dry-run — no live action.
   */
  /**
   * Data mode for real testing. `real` = only real connected accounts sync and
   * only real data is shown (demo/mock hidden). `demo` = seeded demo dataset.
   */
  GUARDORA_DATA_MODE: z.enum(["real", "demo"]).default("demo"),

  LIVE_ACTIONS_ENABLED: boolFromEnv,
  FACEBOOK_HIDE_ENABLED: boolFromEnv,
  // Defaults TRUE (fail-closed): only an explicit "false"/"0" turns dry-run off.
  LIVE_ACTIONS_DRY_RUN: z
    .string()
    .optional()
    .transform((v) => !(v === "false" || v === "0")),
  // Second lock against an accidental live hide: even with all env gates on and
  // dry-run off, a real Graph hide requires an explicit LIVE_HIDE_TEST_CONFIRM=YES.
  LIVE_HIDE_TEST_CONFIRM: z.string().optional().default("NO"),
  // V1.32B Instagram moderation research/test gates. ALL fail-closed: no IG
  // hide/unhide ever executes unless INSTAGRAM_HIDE_TEST_ENABLED=true AND
  // INSTAGRAM_HIDE_TEST_CONFIRM=YES. Instagram auto-hide is NEVER enabled in V1.32B.
  INSTAGRAM_HIDE_TEST_ENABLED: boolFromEnv,
  INSTAGRAM_HIDE_TEST_CONFIRM: z.string().optional().default("NO"),
  INSTAGRAM_AUTO_HIDE_ENABLED: boolFromEnv,
  // V1.27 Production Safe Mode. When enabled, live actions run for REAL under the
  // full brand safety envelope (kill switches, limits, rollback, audit) — not test.
  PRODUCTION_SAFE_MODE_ENABLED: boolFromEnv,
  // Global emergency kill switch. When true, NO live action anywhere. Fail-closed.
  GLOBAL_KILL_SWITCH: boolFromEnv,
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),

  // V1.45C3 — webhook retention (raw provider payloads may contain personal data). These are
  // CONFIGURABLE TECHNICAL DEFAULTS pending product/legal confirmation — NOT legally-approved policy.
  // Bounded + fail-safe: parsing clamps to [min,max]; getWebhookRetentionConfig enforces ROW_TTL >
  // MAX_PAYLOAD_AGE and a bounded batch, falling back to safe defaults (visibly) on a bad combination.
  WEBHOOK_MAX_PAYLOAD_AGE_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  WEBHOOK_ROW_TTL_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  WEBHOOK_PURGE_BATCH: z.coerce.number().int().min(1).max(5000).default(250),

  // V1.46/47 — token lifecycle. Warn/flag a connection this many days BEFORE its OAuth token expires
  // (proactive reconnect prompt). Bounded technical default; MODE B (monitor + reconnect, no renewal —
  // Meta Page tokens cannot be independently refreshed and the User token is not retained).
  TOKEN_EXPIRY_WARN_DAYS: z.coerce.number().int().min(1).max(90).default(7),

  // V1.48P — public-endpoint rate limiting (bounded, fail-closed, per-instance). Public forms
  // (book-demo/contact/lead) get a tight per-IP window; the webhook endpoint gets a generous window
  // (legitimate provider bursts must pass — signature verification stays authoritative).
  PUBLIC_FORM_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(5),
  PUBLIC_FORM_RATE_WINDOW_MS: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),
  WEBHOOK_RATE_LIMIT: z.coerce.number().int().min(10).max(100_000).default(600),
  WEBHOOK_RATE_WINDOW_MS: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),

  // Meta (Facebook Page + Instagram Business) — official OAuth only.
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_REDIRECT_URI: z.string().optional(),
  META_OAUTH_REDIRECT_URI: z.string().optional(), // legacy fallback
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  /** Feature flag: only when true does the Meta connector make live API calls. */
  META_LIVE_SYNC: boolFromEnv,
  /** Feature flag: webhook-driven targeted sync (V1.4 stub, default off). */
  META_WEBHOOK_SYNC: boolFromEnv,
  /**
   * Comma-separated OAuth scopes to request. When unset, a SAFE minimal dev
   * scope is used (public_profile,email) so a first OAuth smoke test works
   * without any Page/Instagram/business permissions or App Review.
   */
  META_OAUTH_SCOPES: z.string().optional(),

  // Token storage. In production, "plaintext" is rejected by @guardora/db.
  TOKEN_ENCRYPTION_MODE: z
    .enum(["plaintext", "aes-gcm", "kms"])
    .default("plaintext"),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),

  // V1.58.9 — session lifetime policy. Idle = server-enforced inactivity logout; absolute = hard
  // ceiling a session can live regardless of activity; remember-me = the longer absolute ceiling for
  // a persistent login; touch interval = how often the activity marker is written (throttled). The
  // INVARIANT idle < absolute ≤ remember is enforced by validateSessionConfig (fail-closed).
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().positive().default(24),
  SESSION_REMEMBER_ME_DAYS: z.coerce.number().int().positive().default(30),
  SESSION_ACTIVITY_TOUCH_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
});

export type GuardoraEnv = z.infer<typeof EnvSchema>;

let cached: GuardoraEnv | undefined;

/** Parse and validate process.env once, then cache. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): GuardoraEnv {
  if (cached) return cached;
  cached = EnvSchema.parse(source);
  return cached;
}

/** Data mode: `real` (real accounts only) or `demo` (seeded dataset). */
export function getDataMode(source: NodeJS.ProcessEnv = process.env): "real" | "demo" {
  return loadEnv(source).GUARDORA_DATA_MODE;
}

/**
 * V1.58.7 — resolved worker runtime timings (lease TTL, heartbeat, shutdown grace, sync interval).
 * Read DIRECTLY from `source` (never the globally-cached loadEnv) so the worker config validator and
 * tests can inject env per-call. Values are already bounded positive integers by the schema; the
 * INVARIANT `heartbeat safely < TTL` is enforced by validateWorkerConfig, not here.
 */
export interface WorkerRuntimeConfig {
  syncIntervalMs: number;
  leaseTtlMs: number;
  heartbeatMs: number;
  shutdownGraceMs: number;
}
const WorkerRuntimeSchema = z.object({
  WORKER_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  SYNC_LEASE_TTL_MS: z.coerce.number().int().positive().default(300_000),
  SYNC_LEASE_HEARTBEAT_MS: z.coerce.number().int().positive().default(75_000),
  WORKER_SHUTDOWN_GRACE_MS: z.coerce.number().int().positive().default(25_000),
});
export function getWorkerRuntimeConfig(source: NodeJS.ProcessEnv = process.env): WorkerRuntimeConfig {
  const env = WorkerRuntimeSchema.parse(source);
  return {
    syncIntervalMs: env.WORKER_SYNC_INTERVAL_MS,
    leaseTtlMs: env.SYNC_LEASE_TTL_MS,
    heartbeatMs: env.SYNC_LEASE_HEARTBEAT_MS,
    shutdownGraceMs: env.WORKER_SHUTDOWN_GRACE_MS,
  };
}

/**
 * V1.58.9 — resolved session lifetime policy (ms). Read DIRECTLY from `source` (never the globally
 * cached loadEnv) so the config validator + tests can inject env per-call. The invariant idle < absolute
 * ≤ remember is enforced by {@link validateSessionConfig}, not here.
 */
export interface SessionConfig {
  idleMs: number;
  absoluteMs: number;
  rememberMs: number;
  touchMs: number;
}
const SessionSchema = z.object({
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().positive().default(24),
  SESSION_REMEMBER_ME_DAYS: z.coerce.number().int().positive().default(30),
  SESSION_ACTIVITY_TOUCH_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
});
export function getSessionConfig(source: NodeJS.ProcessEnv = process.env): SessionConfig {
  const env = SessionSchema.parse(source);
  return {
    idleMs: env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000,
    absoluteMs: env.SESSION_ABSOLUTE_TIMEOUT_HOURS * 3_600_000,
    rememberMs: env.SESSION_REMEMBER_ME_DAYS * 86_400_000,
    touchMs: env.SESSION_ACTIVITY_TOUCH_INTERVAL_SECONDS * 1_000,
  };
}

/**
 * FAIL-CLOSED validation of the session lifetime policy. Errors carry only the variable NAME + reason
 * (never a value). Raw env is parsed directly so a non-positive/garbage value is caught, not silently
 * defaulted. Used by readiness + the auth config test.
 */
export function validateSessionConfig(source: NodeJS.ProcessEnv = process.env): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const posInt = (key: string) => {
    const raw = source[key];
    if (raw === undefined || raw === "") return; // unset ⇒ valid default
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) errors.push(`${key} must be a positive integer.`);
  };
  for (const k of ["SESSION_IDLE_TIMEOUT_MINUTES", "SESSION_ABSOLUTE_TIMEOUT_HOURS", "SESSION_REMEMBER_ME_DAYS", "SESSION_ACTIVITY_TOUCH_INTERVAL_SECONDS"]) posInt(k);
  if (errors.length === 0) {
    const c = getSessionConfig(source);
    if (c.idleMs >= c.absoluteMs) errors.push("SESSION_IDLE_TIMEOUT_MINUTES must be less than SESSION_ABSOLUTE_TIMEOUT_HOURS.");
    if (c.absoluteMs > c.rememberMs) errors.push("SESSION_ABSOLUTE_TIMEOUT_HOURS must be at most SESSION_REMEMBER_ME_DAYS.");
    if (c.touchMs >= c.idleMs) errors.push("SESSION_ACTIVITY_TOUCH_INTERVAL_SECONDS must be less than the idle timeout.");
  }
  return { ok: errors.length === 0, errors };
}

/** Automatic read-only sync configuration for UI + worker. */
export function getAutoSyncConfig(source: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  intervalSeconds: number;
} {
  const env = loadEnv(source);
  return { enabled: env.AUTO_SYNC_ENABLED, intervalSeconds: env.AUTO_SYNC_INTERVAL_SECONDS };
}

/**
 * Live-actions configuration (controlled Facebook hide). Fail-closed: `canExecuteLive`
 * is true only when explicitly enabled AND dry-run is explicitly disabled.
 */
export function getLiveActionsConfig(source: NodeJS.ProcessEnv = process.env): {
  liveEnabled: boolean;
  facebookHideEnabled: boolean;
  dryRun: boolean;
  /** True only when the env explicitly permits a live Graph hide (before confirm). */
  canExecuteLive: boolean;
  /** Second lock: LIVE_HIDE_TEST_CONFIRM=YES. Required IN ADDITION to canExecuteLive. */
  liveConfirmed: boolean;
  /** V1.27 — Production Safe Mode enabled (real live ops under the safety envelope). */
  productionSafeMode: boolean;
  /** V1.27 — global emergency kill switch. When true, NO live action anywhere. */
  globalKillSwitch: boolean;
} {
  const env = loadEnv(source);
  const liveEnabled = env.LIVE_ACTIONS_ENABLED;
  const facebookHideEnabled = env.FACEBOOK_HIDE_ENABLED;
  const dryRun = env.LIVE_ACTIONS_DRY_RUN;
  return {
    liveEnabled,
    facebookHideEnabled,
    dryRun,
    canExecuteLive: liveEnabled && facebookHideEnabled && !dryRun,
    liveConfirmed: env.LIVE_HIDE_TEST_CONFIRM === "YES",
    productionSafeMode: env.PRODUCTION_SAFE_MODE_ENABLED,
    globalKillSwitch: env.GLOBAL_KILL_SWITCH,
  };
}

/**
 * V1.32B Instagram moderation (hide/unhide) test gates. Fail-closed and read
 * DIRECTLY from the source env (not the cached loadEnv) so a test can inject
 * different values. `canExecuteTest` requires BOTH the enable flag and the
 * explicit confirm lock. Instagram auto-hide is captured but NEVER wired to any
 * execution path in V1.32B.
 */
export function getInstagramActionsConfig(source: NodeJS.ProcessEnv = process.env): {
  hideTestEnabled: boolean;
  hideTestConfirmed: boolean;
  autoHideEnabled: boolean;
  /** True only when a live IG hide/unhide TEST is explicitly enabled AND confirmed. */
  canExecuteTest: boolean;
} {
  const isTrue = (v: string | undefined) => v === "true" || v === "1";
  const hideTestEnabled = isTrue(source.INSTAGRAM_HIDE_TEST_ENABLED);
  const hideTestConfirmed = source.INSTAGRAM_HIDE_TEST_CONFIRM === "YES";
  const autoHideEnabled = isTrue(source.INSTAGRAM_AUTO_HIDE_ENABLED);
  return { hideTestEnabled, hideTestConfirmed, autoHideEnabled, canExecuteTest: hideTestEnabled && hideTestConfirmed };
}

/** Google Business Profile requires exactly this OAuth scope — nothing broader. */
export const GOOGLE_BUSINESS_SCOPE = "https://www.googleapis.com/auth/business.manage";

/**
 * V1.36 Google Business Profile connector config. Fail-closed and read DIRECTLY
 * from the source env (never cached) so tests can inject. The client secret is
 * NEVER returned (only `hasSecret`); `apiEnabled` defaults to false. Missing
 * config → `not_configured`; configured but flag off → `api_disabled`.
 */
export function getGoogleBusinessConfig(source: NodeJS.ProcessEnv = process.env): {
  configured: boolean;
  apiEnabled: boolean;
  clientId?: string;
  redirectUri?: string;
  hasSecret: boolean;
  scope: string;
  status: "not_configured" | "api_disabled" | "oauth_ready";
} {
  const clientId = source.GOOGLE_BUSINESS_CLIENT_ID || undefined;
  const clientSecret = source.GOOGLE_BUSINESS_CLIENT_SECRET || undefined;
  const redirectUri = source.GOOGLE_BUSINESS_REDIRECT_URI || source.GOOGLE_BUSINESS_OAUTH_REDIRECT_URI || undefined;
  const apiEnabled = source.GOOGLE_BUSINESS_API_ENABLED === "true" || source.GOOGLE_BUSINESS_API_ENABLED === "1";
  const configured = !!(clientId && clientSecret && redirectUri);
  const status = !configured ? "not_configured" : !apiEnabled ? "api_disabled" : "oauth_ready";
  // clientId + redirectUri are public OAuth params; the secret is intentionally omitted.
  return { configured, apiEnabled, clientId, redirectUri, hasSecret: !!clientSecret, scope: GOOGLE_BUSINESS_SCOPE, status };
}

/** V1.27 Production Safe Mode + global kill switch (env-level). */
export function getProductionSafetyConfig(source: NodeJS.ProcessEnv = process.env): {
  productionSafeMode: boolean;
  globalKillSwitch: boolean;
} {
  const env = loadEnv(source);
  return { productionSafeMode: env.PRODUCTION_SAFE_MODE_ENABLED, globalKillSwitch: env.GLOBAL_KILL_SWITCH };
}

/** Comment translation configuration (provider off by default). */
export function getTranslationConfig(source: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  provider: string;
  targetMode: "workspace_locale" | "en";
} {
  const env = loadEnv(source);
  return {
    enabled: env.TRANSLATION_ENABLED,
    provider: env.TRANSLATION_PROVIDER,
    targetMode: env.TRANSLATION_TARGET_MODE,
  };
}

/** External AI risk provider configuration (off by default). */
export function getAiRiskConfig(source: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  provider: string;
  minConfidence: number;
} {
  const env = loadEnv(source);
  return {
    enabled: env.AI_RISK_PROVIDER_ENABLED,
    provider: env.AI_RISK_PROVIDER,
    minConfidence: env.AI_RISK_MIN_CONFIDENCE,
  };
}

export interface PaidAiFuseConfig {
  enabled: boolean;
  emergencyDisable: boolean;
  globalDailyCallLimit: number;
  globalDailyCostLimitMicros: number;
  providerDailyCallLimit: number;
  rpmLimit: number;
  maxConcurrency: number;
  timeoutMs: number;
  maxRetries: number;
  circuitFailureThreshold: number;
  circuitCooldownMs: number;
}

/**
 * V1.44 — resolved paid-AI fuse configuration. Fail-closed: `effectiveEnabled` is true only when
 * the master switch is on AND emergency disable is off. In production, a nonsensical config (paid
 * enabled but a zero global daily call/cost cap) also fails closed to disabled.
 */
// Parse the paid-AI fields DIRECTLY from `source` (not the globally-cached loadEnv) so tests can
// inject env per-call and production always reflects the live values.
const PaidAiFuseSchema = z.object({
  AI_PAID_ENABLED: boolFromEnv,
  AI_PAID_EMERGENCY_DISABLE: boolFromEnv,
  AI_PAID_GLOBAL_DAILY_CALL_LIMIT: z.coerce.number().int().nonnegative().default(1_000),
  AI_PAID_GLOBAL_DAILY_COST_LIMIT_MICROS: z.coerce.number().int().nonnegative().default(5_000_000),
  AI_PAID_PROVIDER_DAILY_CALL_LIMIT: z.coerce.number().int().nonnegative().default(1_000),
  AI_PAID_RPM_LIMIT: z.coerce.number().int().positive().default(60),
  AI_PAID_MAX_CONCURRENCY: z.coerce.number().int().positive().default(4),
  AI_PAID_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  AI_PAID_MAX_RETRIES: z.coerce.number().int().nonnegative().max(5).default(1),
  AI_PAID_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  AI_PAID_CIRCUIT_COOLDOWN_MS: z.coerce.number().int().positive().default(60_000),
});

export function getPaidAiFuseConfig(source: NodeJS.ProcessEnv = process.env): PaidAiFuseConfig & { effectiveEnabled: boolean } {
  const env = PaidAiFuseSchema.parse(source);
  const base: PaidAiFuseConfig = {
    enabled: env.AI_PAID_ENABLED,
    emergencyDisable: env.AI_PAID_EMERGENCY_DISABLE,
    globalDailyCallLimit: env.AI_PAID_GLOBAL_DAILY_CALL_LIMIT,
    globalDailyCostLimitMicros: env.AI_PAID_GLOBAL_DAILY_COST_LIMIT_MICROS,
    providerDailyCallLimit: env.AI_PAID_PROVIDER_DAILY_CALL_LIMIT,
    rpmLimit: env.AI_PAID_RPM_LIMIT,
    maxConcurrency: env.AI_PAID_MAX_CONCURRENCY,
    timeoutMs: env.AI_PAID_TIMEOUT_MS,
    maxRetries: env.AI_PAID_MAX_RETRIES,
    circuitFailureThreshold: env.AI_PAID_CIRCUIT_FAILURE_THRESHOLD,
    circuitCooldownMs: env.AI_PAID_CIRCUIT_COOLDOWN_MS,
  };
  const configInvalid = base.globalDailyCallLimit <= 0 || base.globalDailyCostLimitMicros <= 0;
  const effectiveEnabled = base.enabled && !base.emergencyDisable && !configInvalid;
  return { ...base, effectiveEnabled };
}

/** Per-platform connector credentials. All optional (placeholder-friendly). */
export interface ConnectorCredentials {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}

export function loadConnectorCredentials(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, ConnectorCredentials> {
  return {
    meta: {
      clientId: source.META_APP_ID,
      clientSecret: source.META_APP_SECRET,
      redirectUri: source.META_OAUTH_REDIRECT_URI,
    },
    youtube: {
      clientId: source.YOUTUBE_CLIENT_ID,
      clientSecret: source.YOUTUBE_CLIENT_SECRET,
      redirectUri: source.YOUTUBE_OAUTH_REDIRECT_URI,
    },
    linkedin: {
      clientId: source.LINKEDIN_CLIENT_ID,
      clientSecret: source.LINKEDIN_CLIENT_SECRET,
      redirectUri: source.LINKEDIN_OAUTH_REDIRECT_URI,
    },
    tiktok: {
      clientId: source.TIKTOK_CLIENT_KEY,
      clientSecret: source.TIKTOK_CLIENT_SECRET,
      redirectUri: source.TIKTOK_OAUTH_REDIRECT_URI,
    },
    googleBusiness: {
      clientId: source.GOOGLE_BUSINESS_CLIENT_ID,
      clientSecret: source.GOOGLE_BUSINESS_CLIENT_SECRET,
      redirectUri: source.GOOGLE_BUSINESS_OAUTH_REDIRECT_URI,
    },
  };
}

export const isProd = (): boolean => loadEnv().NODE_ENV === "production";

/**
 * V1.51 — deployment environment (Vercel-aware). On Vercel, `VERCEL_ENV` is authoritatively
 * "production" | "preview" | "development"; both preview AND production builds set
 * `NODE_ENV=production`, so `NODE_ENV` alone cannot tell a preview apart from production. Off
 * Vercel (self-hosted worker, local), `VERCEL_ENV` is unset and we fall back to `NODE_ENV`.
 */
export type DeploymentEnv = "production" | "preview" | "development";
export function deploymentEnv(source: NodeJS.ProcessEnv = process.env): DeploymentEnv {
  const v = (source.VERCEL_ENV ?? "").trim().toLowerCase();
  if (v === "production" || v === "preview" || v === "development") return v;
  return source.NODE_ENV === "production" ? "production" : "development";
}

/**
 * TRUE only on a Vercel PREVIEW deployment. Used as a defense-in-depth kill-switch so a preview
 * can never fire real side effects (live Stripe charges, real transactional email, ingesting
 * production Meta webhooks) even if a secret was mis-scoped to Preview in the Vercel dashboard.
 * Production (`VERCEL_ENV=production`) and non-Vercel hosts (unset) are unaffected.
 */
export function isPreviewDeployment(source: NodeJS.ProcessEnv = process.env): boolean {
  return (source.VERCEL_ENV ?? "").trim().toLowerCase() === "preview";
}

/** Resolved Meta OAuth configuration + which required vars are missing. */
export interface MetaConfig {
  configured: boolean;
  appId?: string;
  appSecret?: string;
  redirectUri?: string;
  webhookVerifyToken?: string;
  liveSync: boolean;
  webhookSync: boolean;
  /** OAuth scopes that will be requested (safe minimal default in dev). */
  scopes: string[];
  /** Names of required env vars that are absent (empty when configured). */
  missing: string[];
}

/** Safe minimal scopes for a first OAuth smoke test — no Page/IG/business. */
export const META_MINIMAL_DEV_SCOPES: readonly string[] = ["public_profile", "email"];

/** Resolve requested OAuth scopes from env, defaulting to the safe minimal set. */
export function getMetaOAuthScopes(source: NodeJS.ProcessEnv = process.env): string[] {
  const raw = source.META_OAUTH_SCOPES?.trim();
  if (!raw) return [...META_MINIMAL_DEV_SCOPES];
  const scopes = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return scopes.length > 0 ? scopes : [...META_MINIMAL_DEV_SCOPES];
}

/**
 * Resolve Meta OAuth config. `configured` is true only when app id, secret and
 * redirect URI are all present. The webhook verify token is reported separately.
 * NEVER logs secret values.
 */
export function getMetaConfig(source: NodeJS.ProcessEnv = process.env): MetaConfig {
  const appId = source.META_APP_ID?.trim() || undefined;
  const appSecret = source.META_APP_SECRET?.trim() || undefined;
  const redirectUri =
    source.META_REDIRECT_URI?.trim() ||
    source.META_OAUTH_REDIRECT_URI?.trim() ||
    undefined;
  const webhookVerifyToken = source.META_WEBHOOK_VERIFY_TOKEN?.trim() || undefined;
  const liveSync = source.META_LIVE_SYNC === "true" || source.META_LIVE_SYNC === "1";
  const webhookSync =
    source.META_WEBHOOK_SYNC === "true" || source.META_WEBHOOK_SYNC === "1";

  const missing: string[] = [];
  if (!appId) missing.push("META_APP_ID");
  if (!appSecret) missing.push("META_APP_SECRET");
  if (!redirectUri) missing.push("META_REDIRECT_URI");

  return {
    configured: missing.length === 0,
    appId,
    appSecret,
    redirectUri,
    webhookVerifyToken,
    liveSync,
    webhookSync,
    scopes: getMetaOAuthScopes(source),
    missing,
  };
}

export type SetupCheckStatus = "configured" | "missing" | "invalid" | "off" | "on";

export interface MetaSetupCheck {
  key: string;
  label: string;
  status: SetupCheckStatus;
  /** Human note. NEVER contains a secret value. */
  note?: string;
  /** Whether this var is required for OAuth to work. */
  required: boolean;
}

export interface MetaSetupStatus {
  /** True when all REQUIRED checks are satisfied. */
  ready: boolean;
  liveSync: boolean;
  checks: MetaSetupCheck[];
}

const CALLBACK_PATH = "/api/connectors/meta/callback";

/**
 * Validate the Meta setup for the dashboard checklist. Reports each variable as
 * configured / missing / invalid (or on/off for flags) WITHOUT ever exposing a
 * secret value.
 */
export function getMetaSetupStatus(
  source: NodeJS.ProcessEnv = process.env,
): MetaSetupStatus {
  const meta = getMetaConfig(source);
  const appUrl = source.APP_URL?.trim() || "http://localhost:3000";

  const checks: MetaSetupCheck[] = [];

  checks.push({
    key: "META_APP_ID",
    label: "App ID",
    status: meta.appId ? "configured" : "missing",
    required: true,
  });
  checks.push({
    key: "META_APP_SECRET",
    label: "App secret",
    status: meta.appSecret ? "configured" : "missing",
    required: true,
  });

  // Redirect URI: must be a valid URL, correct path, and match APP_URL origin.
  let redirectStatus: SetupCheckStatus = "missing";
  let redirectNote: string | undefined;
  if (meta.redirectUri) {
    try {
      const u = new URL(meta.redirectUri);
      if (u.pathname !== CALLBACK_PATH) {
        redirectStatus = "invalid";
        redirectNote = `Path must be ${CALLBACK_PATH}`;
      } else {
        try {
          const app = new URL(appUrl);
          if (app.origin !== u.origin) {
            redirectStatus = "invalid";
            redirectNote = "Origin must match APP_URL";
          } else {
            redirectStatus = "configured";
          }
        } catch {
          redirectStatus = "configured";
        }
      }
    } catch {
      redirectStatus = "invalid";
      redirectNote = "Not a valid URL";
    }
  }
  checks.push({
    key: "META_REDIRECT_URI",
    label: "Redirect URI",
    status: redirectStatus,
    note: redirectNote,
    required: true,
  });

  // APP_URL
  let appUrlStatus: SetupCheckStatus = "configured";
  try {
    new URL(appUrl);
  } catch {
    appUrlStatus = "invalid";
  }
  checks.push({
    key: "APP_URL",
    label: "App URL",
    status: appUrlStatus,
    note: source.APP_URL ? undefined : "using default localhost:3000",
    required: false,
  });

  checks.push({
    key: "META_WEBHOOK_VERIFY_TOKEN",
    label: "Webhook verify token",
    status: meta.webhookVerifyToken ? "configured" : "missing",
    note: meta.webhookVerifyToken ? undefined : "required for webhooks",
    required: false,
  });

  checks.push({
    key: "META_LIVE_SYNC",
    label: "Live sync",
    status: meta.liveSync ? "on" : "off",
    note: meta.liveSync ? "live Graph reads enabled" : "using placeholder data (no live sync)",
    required: false,
  });

  const usingDevScopes =
    meta.scopes.length === META_MINIMAL_DEV_SCOPES.length &&
    meta.scopes.every((s, i) => s === META_MINIMAL_DEV_SCOPES[i]);
  checks.push({
    key: "META_OAUTH_SCOPES",
    label: "OAuth scopes",
    status: "configured",
    note: usingDevScopes
      ? `minimal dev: ${meta.scopes.join(", ")}`
      : meta.scopes.join(", "),
    required: false,
  });

  const ready = checks
    .filter((c) => c.required)
    .every((c) => c.status === "configured");

  return { ready, liveSync: meta.liveSync, checks };
}

// ---------------------------------------------------------------------------
// V1.45C3 — webhook retention configuration (technical defaults; pending policy confirmation).
// ---------------------------------------------------------------------------
export interface WebhookRetentionConfig {
  /** Raw payload is nulled once processed/signature-invalid, or once older than this (hard cap). */
  maxPayloadAgeDays: number;
  /** The whole metadata row is deleted once older than this. MUST be > maxPayloadAgeDays. */
  rowTtlDays: number;
  /** Bounded batch size per purge/minimize pass (never unbounded). */
  purgeBatch: number;
  /** True when a bad combination forced a fall back to safe defaults (surfaced, never silent). */
  fellBack: boolean;
}

// Safe fallbacks if the operator supplies an inconsistent combination (e.g. TTL <= payload age).
const RETENTION_SAFE_DEFAULTS = { maxPayloadAgeDays: 30, rowTtlDays: 90, purgeBatch: 250 } as const;

/**
 * Resolve webhook retention. Fail-safe: the zod schema already bounds each value to a sane range; this
 * additionally enforces the INVARIANT `rowTtlDays > maxPayloadAgeDays` (deleting a row must never
 * happen before its payload has been minimized) and a bounded batch. A violating combination falls
 * back — VISIBLY (a one-line warning, no secrets) — to the safe defaults rather than acting unsafely.
 */
export function getWebhookRetentionConfig(source: NodeJS.ProcessEnv = process.env): WebhookRetentionConfig {
  const env = loadEnv(source);
  let maxPayloadAgeDays = env.WEBHOOK_MAX_PAYLOAD_AGE_DAYS;
  let rowTtlDays = env.WEBHOOK_ROW_TTL_DAYS;
  let purgeBatch = env.WEBHOOK_PURGE_BATCH;
  let fellBack = false;

  if (!(rowTtlDays > maxPayloadAgeDays) || !(purgeBatch >= 1) || !(maxPayloadAgeDays >= 1)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[config] invalid webhook retention (payloadAge=${maxPayloadAgeDays}d, rowTtl=${rowTtlDays}d, batch=${purgeBatch}); ` +
        `falling back to safe defaults (payloadAge=${RETENTION_SAFE_DEFAULTS.maxPayloadAgeDays}d, rowTtl=${RETENTION_SAFE_DEFAULTS.rowTtlDays}d, batch=${RETENTION_SAFE_DEFAULTS.purgeBatch}).`,
    );
    maxPayloadAgeDays = RETENTION_SAFE_DEFAULTS.maxPayloadAgeDays;
    rowTtlDays = RETENTION_SAFE_DEFAULTS.rowTtlDays;
    purgeBatch = RETENTION_SAFE_DEFAULTS.purgeBatch;
    fellBack = true;
  }
  return { maxPayloadAgeDays, rowTtlDays, purgeBatch, fellBack };
}
