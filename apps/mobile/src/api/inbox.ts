/**
 * Inbox reads and internal write actions.
 *
 * Thin wrappers over the M2 client, so bearer injection, timeouts, cancellation and
 * bounded error mapping are shared rather than reimplemented.
 *
 * The client sends only filter values, a cursor and an item id. It never sends a
 * tenant, user, role or write flag — the server derives all of those from the
 * session and re-checks them on every call.
 */

import { apiRequest, type ClientConfig } from "./client";
import type {
  ApiResult, InboxActionKey, InboxActionResponse, InboxDetailResponse, InboxFilters,
  InboxListResponse, InboxOptionsResponse, InboxPriority, InboxWorkflow,
} from "./types";

export const INBOX_ROUTES = {
  list: "/api/mobile/inbox",
  options: "/api/mobile/inbox/options",
  item: (id: string) => `/api/mobile/inbox/${encodeURIComponent(id)}`,
  action: (id: string) => `/api/mobile/inbox/${encodeURIComponent(id)}/action`,
} as const;

/**
 * Build the list query. Only non-null filters are sent, so the URL stays short and
 * the server's "not applied" default is expressed by absence rather than a sentinel.
 */
export function inboxQueryString(filters: InboxFilters, cursor: string | null): string {
  const params: string[] = [`view=${encodeURIComponent(filters.view)}`, `range=${encodeURIComponent(filters.range)}`];
  const optional: [string, string | null][] = [
    ["type", filters.type], ["sentiment", filters.sentiment], ["workflow", filters.workflow],
    ["priority", filters.priority], ["risk", filters.risk], ["provider", filters.provider],
    ["label", filters.label], ["assignee", filters.assignee], ["q", filters.q],
    // The cursor is opaque: forwarded exactly as the server issued it.
    ["cursor", cursor],
  ];
  for (const [key, value] of optional) {
    if (value !== null && value !== "") params.push(`${key}=${encodeURIComponent(value)}`);
  }
  return params.join("&");
}

export function fetchInbox(
  token: string,
  filters: InboxFilters,
  cursor: string | null,
  options?: { signal?: AbortSignal },
  config?: ClientConfig,
): Promise<ApiResult<InboxListResponse>> {
  return apiRequest<InboxListResponse>(
    `${INBOX_ROUTES.list}?${inboxQueryString(filters, cursor)}`,
    { method: "GET", token, signal: options?.signal },
    config,
  );
}

export function fetchInboxItem(
  token: string,
  itemId: string,
  options?: { signal?: AbortSignal },
  config?: ClientConfig,
): Promise<ApiResult<InboxDetailResponse>> {
  return apiRequest<InboxDetailResponse>(
    INBOX_ROUTES.item(itemId),
    { method: "GET", token, signal: options?.signal },
    config,
  );
}

export function fetchInboxOptions(
  token: string,
  options?: { signal?: AbortSignal },
  config?: ClientConfig,
): Promise<ApiResult<InboxOptionsResponse>> {
  return apiRequest<InboxOptionsResponse>(
    INBOX_ROUTES.options,
    { method: "GET", token, signal: options?.signal },
    config,
  );
}

/**
 * Perform one INTERNAL Tamanor action. Provider writes are not expressible here —
 * `InboxActionKey` has no hide/delete/reply/ban member.
 */
export function performInboxAction(
  token: string,
  itemId: string,
  action: InboxActionKey,
  value?: InboxPriority | InboxWorkflow,
  config?: ClientConfig,
): Promise<ApiResult<InboxActionResponse>> {
  return apiRequest<InboxActionResponse>(
    INBOX_ROUTES.action(itemId),
    { method: "POST", token, body: value === undefined ? { action } : { action, value } },
    config,
  );
}
