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
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),

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
});

export type GuardoraEnv = z.infer<typeof EnvSchema>;

let cached: GuardoraEnv | undefined;

/** Parse and validate process.env once, then cache. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): GuardoraEnv {
  if (cached) return cached;
  cached = EnvSchema.parse(source);
  return cached;
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
    note: meta.liveSync ? "live Graph reads enabled" : "using MOCK fallback",
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
