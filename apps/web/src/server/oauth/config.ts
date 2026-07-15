import "server-only";
import type { OAuthProvider } from "@guardora/db";

/**
 * V1.50B — USER-login OAuth configuration, read from environment ONLY (never hardcoded,
 * never committed). Returns null when a provider is not yet configured so the flow can
 * degrade truthfully (no fake success). The moment the env vars are set (e.g. in Vercel),
 * the provider becomes fully functional — no code change required.
 *
 * These are DEDICATED user-login apps, entirely separate from the Meta Page connector
 * (META_APP_* / GOOGLE_BUSINESS_*). Never reuse those credentials, scopes, or routes here.
 */
export type ProviderEndpoints = {
  provider: OAuthProvider;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string;
  usePkce: boolean;
  /** Optional explicit redirect URI; otherwise derived per-request from the origin. */
  redirectUriOverride: string | null;
};

function trimEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function getGoogleConfig(): ProviderEndpoints | null {
  const clientId = trimEnv("GOOGLE_AUTH_CLIENT_ID");
  const clientSecret = trimEnv("GOOGLE_AUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  return {
    provider: "google",
    clientId,
    clientSecret,
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
    usePkce: true,
    redirectUriOverride: trimEnv("GOOGLE_AUTH_REDIRECT_URI") ?? null,
  };
}

export function getFacebookConfig(): ProviderEndpoints | null {
  // Dedicated Facebook LOGIN app — NOT META_APP_* (that is the Page/Business connector).
  const clientId = trimEnv("FACEBOOK_AUTH_CLIENT_ID");
  const clientSecret = trimEnv("FACEBOOK_AUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  return {
    provider: "facebook",
    clientId,
    clientSecret,
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    userInfoUrl: "https://graph.facebook.com/v21.0/me",
    // USER-login scopes ONLY. Never request Page/business scopes here.
    scope: "public_profile,email",
    usePkce: true,
    redirectUriOverride: trimEnv("FACEBOOK_AUTH_REDIRECT_URI") ?? null,
  };
}

export function getProviderConfig(provider: OAuthProvider): ProviderEndpoints | null {
  return provider === "google" ? getGoogleConfig() : provider === "facebook" ? getFacebookConfig() : null;
}

/** Absolute redirect URI: explicit env override, else derived from the request origin. */
export function resolveRedirectUri(cfg: ProviderEndpoints, origin: string): string {
  return cfg.redirectUriOverride ?? `${origin}/api/auth/${cfg.provider}/callback`;
}
