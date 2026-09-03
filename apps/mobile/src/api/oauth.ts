/**
 * Native connector OAuth: start, status, options, select, cancel.
 *
 * Thin wrappers over the M2 client. Every call carries the SAME bearer
 * `UserSession` the rest of the app uses — there is no second credential and no
 * second account system.
 *
 * NOTHING HERE BUILDS A PROVIDER URL. The authorization URL is produced by the
 * server and merely handed to the system browser, so the app holds no client id,
 * no redirect URI, no scopes and — above all — no client secret.
 */

import { apiRequest, type ClientConfig } from "./client";
import type {
  ApiResult, OAuthFlow, OAuthIntent, OAuthOptionsResponse, OAuthProvider,
  OAuthProvidersResponse, OAuthSelectResponse, OAuthStartResponse,
} from "./types";

export const OAUTH_ROUTES = {
  providers: "/api/mobile/oauth/providers",
  start: "/api/mobile/oauth/start",
  flow: (id: string) => `/api/mobile/oauth/flows/${encodeURIComponent(id)}`,
  options: (id: string) => `/api/mobile/oauth/flows/${encodeURIComponent(id)}/options`,
  select: (id: string) => `/api/mobile/oauth/flows/${encodeURIComponent(id)}/select`,
  cancel: (id: string) => `/api/mobile/oauth/flows/${encodeURIComponent(id)}/cancel`,
} as const;

export function fetchOAuthProviders(
  token: string,
  options?: { signal?: AbortSignal },
  config?: ClientConfig,
): Promise<ApiResult<OAuthProvidersResponse>> {
  return apiRequest<OAuthProvidersResponse>(
    OAUTH_ROUTES.providers,
    { method: "GET", token, signal: options?.signal },
    config,
  );
}

/**
 * Begin an authorization.
 *
 * The body carries a provider, an intent and ONE target id. Tenant, user, role and
 * session are all derived server-side from the bearer, and the target is
 * re-validated there — a client-supplied brand is a hint, never authority.
 */
export function startOAuthFlow(
  token: string,
  input: { provider: OAuthProvider; intent: OAuthIntent; brandId?: string; accountId?: string },
  config?: ClientConfig,
): Promise<ApiResult<OAuthStartResponse>> {
  return apiRequest<OAuthStartResponse>(
    OAUTH_ROUTES.start,
    {
      method: "POST",
      token,
      body: {
        provider: input.provider,
        intent: input.intent,
        ...(input.brandId ? { brandId: input.brandId } : null),
        ...(input.accountId ? { accountId: input.accountId } : null),
      },
    },
    config,
  );
}

/**
 * THE authoritative answer.
 *
 * The deep link that woke the app is only a signal; this is the only thing that may
 * be believed about whether an account was connected.
 */
export function fetchOAuthFlow(
  token: string,
  flowId: string,
  options?: { signal?: AbortSignal },
  config?: ClientConfig,
): Promise<ApiResult<OAuthFlow>> {
  return apiRequest<OAuthFlow>(
    OAUTH_ROUTES.flow(flowId),
    { method: "GET", token, signal: options?.signal },
    config,
  );
}

/** The Pages or locations to choose from, for a flow awaiting a selection. */
export function fetchOAuthOptions(
  token: string,
  flowId: string,
  options?: { signal?: AbortSignal },
  config?: ClientConfig,
): Promise<ApiResult<OAuthOptionsResponse>> {
  return apiRequest<OAuthOptionsResponse>(
    OAUTH_ROUTES.options(flowId),
    { method: "GET", token, signal: options?.signal },
    config,
  );
}

/**
 * Apply the selection.
 *
 * Only the canonical option ids the server itself offered are sent. The server
 * re-validates every one against its own discovery, so a forged id matches nothing.
 */
export function submitOAuthSelection(
  token: string,
  flowId: string,
  selected: readonly string[],
  config?: ClientConfig,
): Promise<ApiResult<OAuthSelectResponse>> {
  return apiRequest<OAuthSelectResponse>(
    OAUTH_ROUTES.select(flowId),
    { method: "POST", token, body: { selected: [...selected] } },
    config,
  );
}

/**
 * Record that the user dismissed the auth browser.
 *
 * The server owns the transition; the reply is the resulting canonical state, which
 * may legitimately be `completed` if the provider callback landed first.
 */
export function cancelOAuthFlow(
  token: string,
  flowId: string,
  config?: ClientConfig,
): Promise<ApiResult<OAuthFlow>> {
  return apiRequest<OAuthFlow>(
    OAUTH_ROUTES.cancel(flowId),
    { method: "POST", token },
    config,
  );
}
