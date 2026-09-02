/**
 * App-shell and dashboard reads.
 *
 * Thin wrappers over the M2 client, so bearer injection, timeouts and bounded
 * error mapping are shared with authentication rather than reimplemented.
 */

import { apiRequest, type ClientConfig } from "./client";
import type { ApiResult, BootstrapResponse, DashboardResponse, Timeframe } from "./types";

export const SHELL_ROUTES = {
  bootstrap: "/api/mobile/bootstrap",
  dashboard: "/api/mobile/dashboard",
} as const;

/** Server-authoritative app-shell context: identity, access state, counters, nav. */
export function fetchBootstrap(
  token: string,
  options?: { signal?: AbortSignal },
  config?: ClientConfig,
): Promise<ApiResult<BootstrapResponse>> {
  return apiRequest<BootstrapResponse>(
    SHELL_ROUTES.bootstrap,
    { method: "GET", token, signal: options?.signal },
    config,
  );
}

/**
 * Business dashboard data for one timeframe. The timeframe is the only parameter
 * the client controls, and the server normalizes it regardless.
 */
export function fetchDashboard(
  token: string,
  timeframe: Timeframe,
  options?: { signal?: AbortSignal },
  config?: ClientConfig,
): Promise<ApiResult<DashboardResponse>> {
  return apiRequest<DashboardResponse>(
    `${SHELL_ROUTES.dashboard}?timeframe=${timeframe}`,
    { method: "GET", token, signal: options?.signal },
    config,
  );
}
