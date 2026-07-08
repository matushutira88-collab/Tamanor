/**
 * Meta (Facebook/Instagram) OAuth helpers — official Login flow only.
 *
 * No client passwords, no scraping. `buildMetaAuthUrl` is pure (safe to call
 * anytime). `exchangeMetaCode` performs a real network call and is only usable
 * when full credentials are present; callers must guard on configuration.
 */

const GRAPH_VERSION = "v21.0";
const DIALOG_BASE = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Full read-only scope set for Page + Instagram comment reads. These require
 * granted permissions / App Review on the Meta app before they are valid — an
 * app without them will fail OAuth with "Invalid Scopes".
 *
 * This is NOT the default. The requested scopes are chosen per-environment via
 * `META_OAUTH_SCOPES` (config), which defaults to a safe minimal dev set
 * (`public_profile,email`). Callers pass the resolved scopes to
 * `buildMetaAuthUrl`.
 */
export const META_READ_ONLY_SCOPES: readonly string[] = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_manage_comments",
  "business_management",
];

export interface MetaOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

/** Build the Meta OAuth dialog URL. Pure — no network, no secrets leaked. */
export function buildMetaAuthUrl(
  config: Pick<MetaOAuthConfig, "appId" | "redirectUri">,
  opts: { state: string; scopes?: readonly string[] },
): string {
  const params = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    state: opts.state,
    response_type: "code",
    scope: (opts.scopes ?? META_READ_ONLY_SCOPES).join(","),
  });
  return `${DIALOG_BASE}?${params.toString()}`;
}

export interface MetaTokenResult {
  accessToken: string;
  tokenType: string;
  /** Seconds until expiry, if returned. */
  expiresInSeconds?: number;
}

/**
 * Exchange an authorization code for a (short-lived) access token. Performs a
 * real HTTP request to the Graph API. Throws on any non-OK response with a
 * message that NEVER includes the app secret or the token.
 */
export async function exchangeMetaCode(
  config: MetaOAuthConfig,
  code: string,
): Promise<MetaTokenResult> {
  const params = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    redirect_uri: config.redirectUri,
    code,
  });
  const res = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  if (!res.ok) {
    // Do not surface the response body verbatim (may echo params). Keep generic.
    throw new Error(`Meta token exchange failed (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
  };
  if (!data.access_token) {
    throw new Error("Meta token exchange returned no access token.");
  }
  return {
    accessToken: data.access_token,
    tokenType: data.token_type ?? "bearer",
    expiresInSeconds: data.expires_in,
  };
}

/**
 * Exchange a short-lived token for a long-lived one (~60 days). Real network
 * call; guard on configuration before use.
 */
export async function exchangeForLongLivedToken(
  config: MetaOAuthConfig,
  shortLivedToken: string,
): Promise<MetaTokenResult> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: config.appId,
    client_secret: config.appSecret,
    fb_exchange_token: shortLivedToken,
  });
  const res = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Meta long-lived token exchange failed (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
  };
  if (!data.access_token) {
    throw new Error("Meta long-lived exchange returned no access token.");
  }
  return {
    accessToken: data.access_token,
    tokenType: data.token_type ?? "bearer",
    expiresInSeconds: data.expires_in,
  };
}

export { GRAPH_BASE as META_GRAPH_BASE, GRAPH_VERSION as META_GRAPH_VERSION };
