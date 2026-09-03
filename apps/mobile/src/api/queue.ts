/**
 * Action Queue reads and INTERNAL decisions.
 *
 * Thin wrappers over the M2 client. The client sends only a tab, an opaque cursor,
 * an item id and a decision key — never a tenant, user, role or permission flag.
 *
 * PROVIDER-WRITE BOUNDARY: `QueueDecision` is `approve | reject | resolve`. There is
 * no hide, delete, reply, retry or rollback member, so this module physically cannot
 * express a provider action.
 */

import { apiRequest, type ClientConfig } from "./client";
import type {
  ApiResult, QueueDecision, QueueDecisionResponse, QueueDetailResponse,
  QueueListResponse, QueueTab,
} from "./types";

export const QUEUE_ROUTES = {
  list: "/api/mobile/action-queue",
  item: (id: string) => `/api/mobile/action-queue/${encodeURIComponent(id)}`,
  decision: (id: string) => `/api/mobile/action-queue/${encodeURIComponent(id)}/decision`,
} as const;

export function queueQueryString(tab: QueueTab, cursor: string | null): string {
  const params = [`tab=${encodeURIComponent(tab)}`];
  // The cursor is opaque: forwarded exactly as the server issued it.
  if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);
  return params.join("&");
}

export function fetchQueue(
  token: string,
  tab: QueueTab,
  cursor: string | null,
  options?: { signal?: AbortSignal },
  config?: ClientConfig,
): Promise<ApiResult<QueueListResponse>> {
  return apiRequest<QueueListResponse>(
    `${QUEUE_ROUTES.list}?${queueQueryString(tab, cursor)}`,
    { method: "GET", token, signal: options?.signal },
    config,
  );
}

export function fetchQueueItem(
  token: string,
  itemId: string,
  options?: { signal?: AbortSignal },
  config?: ClientConfig,
): Promise<ApiResult<QueueDetailResponse>> {
  return apiRequest<QueueDetailResponse>(
    QUEUE_ROUTES.item(itemId),
    { method: "GET", token, signal: options?.signal },
    config,
  );
}

/**
 * Record one INTERNAL Tamanor decision.
 *
 * A 409 means another operator decided first; the server returns the canonical
 * current state in the body so the caller can resync rather than retrying blindly.
 */
export function submitQueueDecision(
  token: string,
  itemId: string,
  decision: QueueDecision,
  config?: ClientConfig,
): Promise<ApiResult<QueueDecisionResponse>> {
  return apiRequest<QueueDecisionResponse>(
    QUEUE_ROUTES.decision(itemId),
    { method: "POST", token, body: { decision } },
    config,
  );
}
