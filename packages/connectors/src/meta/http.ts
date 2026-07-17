import { emitOpsEvent } from "@guardora/core";

/**
 * V1.58.6 — the SINGLE server-side HTTP layer for every Meta Graph request. Guarantees an explicit
 * per-attempt timeout (no hung socket can stall an OAuth callback or the whole sync queue), bounded
 * retries with exponential backoff + jitter for SAFELY-retryable failures only, and a stable error
 * classification. NEVER logs a token, app secret, appsecret_proof, request body, response payload, or a
 * full URL carrying a token — only the endpoint CATEGORY + safe classification.
 */

export type MetaFetchCategory = "graph_read" | "oauth_token" | "side_effect";
export type MetaHttpKind =
  | "timeout" | "network" | "rate_limit" | "server_error" | "canceled" | "invalid_response";

/** A transport-level failure (before/around the HTTP response). Graph 4xx bodies are handled by callers. */
export class MetaHttpError extends Error {
  constructor(readonly kind: MetaHttpKind, readonly category: MetaFetchCategory, readonly status?: number) {
    super(`meta_http_${kind} (${category}${status ? `, HTTP ${status}` : ""})`); // no token/URL/payload
    this.name = "MetaHttpError";
  }
}

export interface MetaFetchOpts {
  method?: "GET" | "POST";
  body?: URLSearchParams | string;
  headers?: Record<string, string>;
  /** Per-attempt timeout. Safe defaults per category if omitted. */
  timeoutMs?: number;
  /** Total attempts INCLUDING the first (default 3). Retryable failures only. */
  maxAttempts?: number;
  /** Hard overall budget across all attempts+backoff (default 30s). */
  maxTotalMs?: number;
  /** Endpoint category — drives safe defaults + observability. */
  category: MetaFetchCategory;
  /** Whether retry is permitted at all. Side-effects: only when the operation is idempotent. */
  retryable?: boolean;
  /** Injectable for tests — never real waiting in unit tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock (ms). */
  now?: () => number;
}

const DEFAULT_TIMEOUT: Record<MetaFetchCategory, number> = {
  graph_read: 10_000,   // 10s — Graph GET
  oauth_token: 12_000,  // 12s — token exchange
  side_effect: 10_000,  // 10s — hide/unhide/verify
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Cap Retry-After to a sane bound so a hostile/huge value can't stall us. */
const MAX_RETRY_AFTER_MS = 10_000;
/** Deterministic-ish jitter without Math.random dependence in the hot path (index-seeded). */
function backoffMs(attempt: number): number {
  const base = Math.min(4_000, 400 * 2 ** (attempt - 1)); // 400,800,1600,… capped 4s
  const jitter = (base * 0.25) * ((Date.now() % 97) / 97); // ≤25% jitter, cheap + non-crypto
  return Math.round(base + jitter);
}

/**
 * Perform a Meta Graph request with timeout + bounded retry. Returns the final Response (a
 * non-retryable 4xx or a success — the CALLER parses/classifies Graph error bodies). Throws
 * {@link MetaHttpError} on a transport failure that survived all attempts. A 429/5xx is retried
 * (respecting a bounded Retry-After); an auth/permission/4xx response is returned immediately.
 */
export async function metaFetch(url: string, opts: MetaFetchOpts): Promise<Response> {
  const category = opts.category;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT[category];
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const maxTotalMs = opts.maxTotalMs ?? 30_000;
  const retryable = opts.retryable ?? true;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? (() => Date.now());
  const started = now();
  const timeLeft = () => maxTotalMs - (now() - started);

  let lastKind: MetaHttpKind = "network";
  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (timeLeft() <= 0) break;
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? "GET",
        body: opts.body,
        headers: opts.headers,
        // Per-attempt abort — a hung upstream can never hold the request open past timeoutMs.
        signal: AbortSignal.timeout(Math.min(timeoutMs, Math.max(1, timeLeft()))),
      });
    } catch (err) {
      const isAbort = (err as { name?: string })?.name === "TimeoutError" || (err as { name?: string })?.name === "AbortError";
      lastKind = isAbort ? "timeout" : "network";
      if (isAbort) emitOpsEvent("meta.request_timeout", { category, attempt });
      // Transport error: retry if allowed + attempts + budget remain.
      if (retryable && attempt < maxAttempts && timeLeft() > 0) {
        const delay = Math.min(backoffMs(attempt), Math.max(0, timeLeft()));
        emitOpsEvent("meta.request_retry", { category, attempt, kind: lastKind, delayMs: delay });
        await sleep(delay);
        continue;
      }
      throw new MetaHttpError(lastKind, category);
    }

    // A 429 or 5xx is safely retryable; everything else (2xx success, 4xx permanent) is returned.
    if (res.status === 429 || res.status >= 500) {
      lastKind = res.status === 429 ? "rate_limit" : "server_error";
      lastStatus = res.status;
      if (res.status === 429) emitOpsEvent("meta.rate_limited", { category, attempt });
      if (retryable && attempt < maxAttempts && timeLeft() > 0) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const raMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS) : 0;
        const delay = Math.min(Math.max(raMs, backoffMs(attempt)), Math.max(0, timeLeft()));
        emitOpsEvent("meta.request_retry", { category, attempt, kind: lastKind, delayMs: delay });
        await sleep(delay);
        continue;
      }
      // Out of retries — return the response so the caller can classify (still non-2xx).
      return res;
    }
    if (res.status === 401 || res.status === 403) emitOpsEvent("meta.auth_error", { category, status: res.status });
    return res;
  }
  throw new MetaHttpError(lastKind, category, lastStatus);
}
