/**
 * The Tamanor mobile HTTP client.
 *
 * Deliberately small: native `fetch` plus a timeout, JSON handling, bearer
 * injection and bounded error mapping. No Axios — nothing here needs it.
 *
 * PRIVACY RULES enforced by this module:
 *   - the `Authorization` header is never logged, echoed or included in an error
 *   - request bodies (which carry passwords on login) are never logged
 *   - server response bodies are never logged or surfaced verbatim; only a code
 *     from the bounded {@link ApiErrorCode} vocabulary escapes
 */

import { apiBaseUrl } from "./config";
import type { ApiErrorCode, ApiResult } from "./types";

/** Server codes we understand. Anything else becomes `server_error`. */
const KNOWN_SERVER_CODES = new Set<ApiErrorCode>([
  "invalid_request",
  "invalid_credentials",
  "rate_limited",
  "challenge_required",
  "unauthenticated",
  "session_expired",
  "session_revoked",
  "server_error",
]);

const DEFAULT_TIMEOUT_MS = 15_000;

export interface RequestOptions {
  method?: "GET" | "POST";
  /** JSON-serializable payload. Never logged. */
  body?: unknown;
  /** Opaque session token. Sent as `Authorization: Bearer`; never logged. */
  token?: string | null;
  timeoutMs?: number;
  /** Caller-owned cancellation, composed with the timeout. */
  signal?: AbortSignal;
}

/** Injectable seam so the client is testable without a network. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ClientConfig {
  fetchImpl?: FetchLike;
  /** Overrides the resolved base URL. Tests only. */
  baseUrl?: string;
}

/**
 * Perform a request against the Tamanor API.
 *
 * Never throws for an expected condition — a missing configuration, a timeout, a
 * dropped connection and every server rejection all arrive as `{ ok: false }` with
 * a bounded code, so callers cannot accidentally treat a failure as success.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
  config: ClientConfig = {},
): Promise<ApiResult<T>> {
  let base = config.baseUrl;
  if (base === undefined) {
    const resolved = apiBaseUrl();
    if (!resolved.ok) return { ok: false, error: "config" };
    base = resolved.baseUrl;
  }

  const doFetch: FetchLike = config.fetchImpl ?? ((u, i) => fetch(u, i));
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Compose the caller's cancellation with our timeout.
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await doFetch(`${base}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch {
    // An abort and a transport failure are indistinguishable here by design; we
    // report the timeout only when our own timer fired.
    return { ok: false, error: controller.signal.aborted && !options.signal?.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }

  // Parse defensively — a proxy or captive portal can return non-JSON with any status.
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) return { ok: false, error: mapErrorPayload(response.status, payload) };
  if (payload === null || typeof payload !== "object") return { ok: false, error: "server_error" };

  return { ok: true, data: payload as T };
}

/**
 * Map a failed response to exactly one bounded code. The server's `error` field is
 * trusted only as a lookup key against the allowlist — never rendered, never
 * concatenated into a message.
 */
export function mapErrorPayload(status: number, payload: unknown): ApiErrorCode {
  const raw =
    typeof payload === "object" && payload !== null && typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : null;

  if (raw && KNOWN_SERVER_CODES.has(raw as ApiErrorCode)) return raw as ApiErrorCode;

  // No usable code — fall back to the status class alone.
  if (status === 401) return "unauthenticated";
  if (status === 429) return "rate_limited";
  if (status === 400) return "invalid_request";
  return "server_error";
}

/** True when a code means "this session is no longer usable". */
export function isSessionInvalid(error: ApiErrorCode): boolean {
  return error === "unauthenticated" || error === "session_expired" || error === "session_revoked";
}
