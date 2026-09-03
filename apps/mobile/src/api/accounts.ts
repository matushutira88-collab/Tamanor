/**
 * Connected-account reads and the three M6 mutations.
 *
 * Thin wrappers over the M2 client. The client sends an account id and, for the
 * monitoring toggle, one boolean — never a tenant, workspace, user, role, permission
 * flag or capacity number. Every one of those is derived server-side.
 *
 * PROVIDER-WRITE BOUNDARY: the only provider operation expressible here is a
 * READ-ONLY sync. There is no hide, delete, reply, moderation or kill-switch call,
 * and no OAuth URL is ever constructed here — provider authorization lives in
 * `@/api/oauth`, where the URL is issued by the server.
 */

import { apiRequest, type ClientConfig } from "./client";
import type {
  AccountDetailResponse, AccountDisconnectResponse, AccountSyncResponse, ApiResult,
  AccountsListResponse, MonitoringResponse,
} from "./types";

export const ACCOUNT_ROUTES = {
  list: "/api/mobile/accounts",
  item: (id: string) => `/api/mobile/accounts/${encodeURIComponent(id)}`,
  monitoring: (id: string) => `/api/mobile/accounts/${encodeURIComponent(id)}/monitoring`,
  sync: (id: string) => `/api/mobile/accounts/${encodeURIComponent(id)}/sync`,
  disconnect: (id: string) => `/api/mobile/accounts/${encodeURIComponent(id)}/disconnect`,
} as const;

export function fetchAccounts(
  token: string,
  options?: { signal?: AbortSignal },
  config?: ClientConfig,
): Promise<ApiResult<AccountsListResponse>> {
  return apiRequest<AccountsListResponse>(
    ACCOUNT_ROUTES.list,
    { method: "GET", token, signal: options?.signal },
    config,
  );
}

export function fetchAccount(
  token: string,
  accountId: string,
  options?: { signal?: AbortSignal },
  config?: ClientConfig,
): Promise<ApiResult<AccountDetailResponse>> {
  return apiRequest<AccountDetailResponse>(
    ACCOUNT_ROUTES.item(accountId),
    { method: "GET", token, signal: options?.signal },
    config,
  );
}

/**
 * Turn monitoring on or off.
 *
 * `enabled` is the ONLY field sent. Enabling is decided by the server's atomic
 * monitored-account limit, so the client cannot over-allocate a plan by believing
 * its own `monitoringCanBeEnabled` hint.
 */
export function setAccountMonitoring(
  token: string,
  accountId: string,
  enabled: boolean,
  config?: ClientConfig,
): Promise<ApiResult<MonitoringResponse>> {
  return apiRequest<MonitoringResponse>(
    ACCOUNT_ROUTES.monitoring(accountId),
    { method: "POST", token, body: { enabled } },
    config,
  );
}

/**
 * Start a manual READ-ONLY sync.
 *
 * The server answers immediately with a bounded key and schedules the provider work
 * afterwards, so a `started` result means exactly that — started, never finished.
 */
export function startAccountSync(
  token: string,
  accountId: string,
  config?: ClientConfig,
): Promise<ApiResult<AccountSyncResponse>> {
  return apiRequest<AccountSyncResponse>(
    ACCOUNT_ROUTES.sync(accountId),
    { method: "POST", token },
    config,
  );
}

/**
 * Disconnect an account through the canonical server service.
 *
 * The reply describes what actually happened: how many local accounts shared the
 * credentials, whether the provider supported revocation, and whether the user
 * should still remove Tamanor manually at the provider.
 */
export function disconnectAccount(
  token: string,
  accountId: string,
  config?: ClientConfig,
): Promise<ApiResult<AccountDisconnectResponse>> {
  return apiRequest<AccountDisconnectResponse>(
    ACCOUNT_ROUTES.disconnect(accountId),
    { method: "POST", token },
    config,
  );
}
