/**
 * V1.74 (Sprint C9) — the typed Google Business Profile READ client that fills the
 * {@link GoogleReviewExecutor} seam with a REAL, resilient HTTP transport.
 *
 * READ-ONLY by design: accounts.list, locations.list, reviews.list only. There is NO
 * reply / delete / report path here — the Google connector is deliberately read-only
 * (see google-business-connector.ts, `No write action exists`). Adding review-reply
 * writes is a separate product decision that ALSO requires approved Google API access;
 * it is intentionally NOT implemented in this foundation.
 *
 * Resilience lives HERE and is pure + unit-testable via an injectable transport:
 *   • per-attempt timeout (transport aborts; a hung upstream can never stall a sync)
 *   • exactly ONE 401 → refresh-access-token → retry (when a refresh fn is injected)
 *   • bounded 429 / 5xx backoff with jitter, honoring a (capped) Retry-After
 *   • 403 → access_denied, 404 → not_found, both terminal (never retried)
 *   • pagination pass-through (pageToken ⇄ nextPageToken)
 *   • REDACTED errors — never a token, URL, Authorization header, or raw provider body
 *
 * Fail-closed by construction: {@link createLiveGoogleReviewExecutor} returns `null`
 * unless config is present AND the API is enabled AND Google access is APPROVED AND an
 * access token exists. Production therefore cannot issue a live call while approval is
 * pending, and never fabricates mock review data.
 */
import { getGoogleBusinessConfig } from "@guardora/config";
import type { GoogleReviewExecutor, ListReviewsInput, RawReviewPage, RawGoogleReview } from "./google-business-connector";

// ---------------------------------------------------------------------------
// Network seam — the ONLY place real HTTP happens. Tests inject a mock; the
// production transport ({@link createGoogleFetchTransport}) is only ever built
// behind the approval gate below.
// ---------------------------------------------------------------------------

/** Which Google Business Profile API host serves a given call. */
export type GoogleBusinessService =
  | "accountManagement" // mybusinessaccountmanagement.googleapis.com (v1) — accounts
  | "businessInformation" // mybusinessbusinessinformation.googleapis.com (v1) — locations
  | "reviews"; // mybusiness.googleapis.com (v4) — reviews (only the legacy v4 API exposes reviews)

export interface GoogleHttpRequest {
  readonly method: "GET";
  readonly service: GoogleBusinessService;
  /** Path WITHOUT host or leading slash, e.g. `v1/accounts` or `v4/accounts/A/locations/L/reviews`. */
  readonly path: string;
  readonly query?: Record<string, string>;
  /** Bearer token — the transport sets `Authorization: Bearer …` and MUST NOT log it. */
  readonly accessToken: string;
  /** Per-attempt timeout budget. */
  readonly timeoutMs?: number;
}

export interface GoogleHttpResponse {
  readonly status: number;
  /** Parsed, bounded Retry-After in ms (0 when absent). */
  readonly retryAfterMs?: number;
  /** Parse the JSON body. May throw (non-JSON / empty) — the client classifies that safely. */
  json(): Promise<unknown>;
}

export interface GoogleBusinessTransport {
  readonly name: string;
  /** Perform one request. Throw {@link GoogleBusinessApiError} (timeout/network) on a transport-level failure. */
  send(req: GoogleHttpRequest): Promise<GoogleHttpResponse>;
}

// ---------------------------------------------------------------------------
// Classified, redacted error.
// ---------------------------------------------------------------------------
export type GoogleApiErrorKind =
  | "token_expired" // 401 (after any refresh attempt)
  | "access_denied" // 403
  | "rate_limit" // 429
  | "not_found" // 404
  | "timeout"
  | "network"
  | "server_error" // 5xx
  | "invalid_response"
  | "generic";

/** Transport/transient kinds that are SAFE to retry (never auth/permission/not-found). */
export function isRetryableGoogleKind(kind: GoogleApiErrorKind): boolean {
  return kind === "rate_limit" || kind === "server_error" || kind === "timeout" || kind === "network";
}

/**
 * A Google Business API failure. The message is generic and carries the HTTP status +
 * classified kind ONLY — never a token, URL, Authorization header, or raw provider body.
 */
export class GoogleBusinessApiError extends Error {
  constructor(readonly detail: { status: number; kind: GoogleApiErrorKind; retryable: boolean }) {
    super(`google_business_api_${detail.kind} (HTTP ${detail.status})`);
    this.name = "GoogleBusinessApiError";
  }
}

// ---------------------------------------------------------------------------
// Client.
// ---------------------------------------------------------------------------
export interface GoogleBusinessApiClientOpts {
  transport: GoogleBusinessTransport;
  accessToken: string;
  /**
   * Called on a 401 to obtain a fresh access token. When present, the client retries
   * the request EXACTLY ONCE with the new token. Absent → a 401 is terminal
   * (`token_expired`). The real Google token-refresh exchange is wired only once API
   * access is approved; until then callers inject it (or omit it).
   */
  refreshAccessToken?: () => Promise<string>;
  /** Total attempts for a retryable (429/5xx/transport) failure, including the first. Default 3. */
  maxAttempts?: number;
  /** Hard overall budget across all attempts + backoff. Default 30s. */
  maxTotalMs?: number;
  /** Per-attempt timeout. Default 10s. */
  timeoutMs?: number;
  /** Injectable for tests — never real waiting in unit tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock (ms). */
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MAX_RETRY_AFTER_MS = 10_000;
/** Cheap, non-crypto backoff with ≤25% jitter (no Math.random in the resume-safe path). */
function backoffMs(attempt: number, now: () => number): number {
  const base = Math.min(4_000, 400 * 2 ** (attempt - 1));
  const jitter = base * 0.25 * ((now() % 97) / 97);
  return Math.round(base + jitter);
}

interface GoogleListEnvelope {
  accounts?: unknown[];
  locations?: unknown[];
  reviews?: RawGoogleReview[];
  nextPageToken?: string;
}

export class GoogleBusinessApiClient {
  private readonly transport: GoogleBusinessTransport;
  private token: string;
  private readonly refresh?: () => Promise<string>;
  private readonly maxAttempts: number;
  private readonly maxTotalMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(opts: GoogleBusinessApiClientOpts) {
    this.transport = opts.transport;
    this.token = opts.accessToken;
    this.refresh = opts.refreshAccessToken;
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
    this.maxTotalMs = opts.maxTotalMs ?? 30_000;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.sleep = opts.sleep ?? realSleep;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Execute one logical request with timeout + bounded retry + a single 401-refresh.
   * Returns the parsed JSON body; throws a classified {@link GoogleBusinessApiError}.
   */
  private async execute(req: Omit<GoogleHttpRequest, "accessToken" | "timeoutMs">): Promise<GoogleListEnvelope> {
    const started = this.now();
    const timeLeft = () => this.maxTotalMs - (this.now() - started);
    let refreshed = false;
    let attempt = 0;

    while (true) {
      attempt++;
      if (timeLeft() <= 0) throw new GoogleBusinessApiError({ status: 0, kind: "timeout", retryable: true });

      let res: GoogleHttpResponse;
      try {
        res = await this.transport.send({
          ...req,
          accessToken: this.token,
          timeoutMs: Math.min(this.timeoutMs, Math.max(1, timeLeft())),
        });
      } catch (e) {
        const err = e instanceof GoogleBusinessApiError ? e : new GoogleBusinessApiError({ status: 0, kind: "network", retryable: true });
        if (err.detail.retryable && attempt < this.maxAttempts && timeLeft() > 0) {
          await this.sleep(Math.min(backoffMs(attempt, this.now), Math.max(0, timeLeft())));
          continue;
        }
        throw err;
      }

      // 401 → refresh the token and retry ONCE (a refresh does not consume the attempt budget).
      if (res.status === 401) {
        if (this.refresh && !refreshed) {
          this.token = await this.refresh();
          refreshed = true;
          attempt--; // the refreshed retry is not a "failure" attempt
          continue;
        }
        throw new GoogleBusinessApiError({ status: 401, kind: "token_expired", retryable: false });
      }
      if (res.status === 403) throw new GoogleBusinessApiError({ status: 403, kind: "access_denied", retryable: false });
      if (res.status === 404) throw new GoogleBusinessApiError({ status: 404, kind: "not_found", retryable: false });

      if (res.status === 429 || res.status >= 500) {
        const kind: GoogleApiErrorKind = res.status === 429 ? "rate_limit" : "server_error";
        if (attempt < this.maxAttempts && timeLeft() > 0) {
          const ra = Math.min(res.retryAfterMs ?? 0, MAX_RETRY_AFTER_MS);
          await this.sleep(Math.min(Math.max(ra, backoffMs(attempt, this.now)), Math.max(0, timeLeft())));
          continue;
        }
        throw new GoogleBusinessApiError({ status: res.status, kind, retryable: true });
      }
      if (res.status >= 400) throw new GoogleBusinessApiError({ status: res.status, kind: "generic", retryable: false });

      try {
        return (await res.json()) as GoogleListEnvelope;
      } catch {
        throw new GoogleBusinessApiError({ status: res.status, kind: "invalid_response", retryable: false });
      }
    }
  }

  /** List Business Profile accounts (one page). Raw nodes for {@link normalizeGoogleAccount}. */
  async listAccounts(pageToken?: string): Promise<{ accounts: unknown[]; nextPageToken?: string }> {
    const query: Record<string, string> = { pageSize: "20" };
    if (pageToken) query.pageToken = pageToken;
    const body = await this.execute({ method: "GET", service: "accountManagement", path: "v1/accounts", query });
    return { accounts: body.accounts ?? [], nextPageToken: body.nextPageToken };
  }

  /** List locations under an account resource name (one page). Raw nodes for {@link normalizeGoogleLocation}. */
  async listLocations(accountResourceName: string, pageToken?: string): Promise<{ locations: unknown[]; nextPageToken?: string }> {
    const query: Record<string, string> = {
      pageSize: "100",
      // Only the fields the location normalizer reads — no over-broad payloads.
      readMask: "name,title,storeCode,storefrontAddress,metadata",
    };
    if (pageToken) query.pageToken = pageToken;
    const body = await this.execute({
      method: "GET",
      service: "businessInformation",
      path: `v1/${stripResourcePrefix(accountResourceName)}/locations`,
      query,
    });
    return { locations: body.locations ?? [], nextPageToken: body.nextPageToken };
  }

  /**
   * List reviews for one location (one page). Returns a {@link RawReviewPage} directly
   * compatible with the {@link GoogleReviewExecutor} seam that
   * {@link listGoogleBusinessReviews} already consumes.
   */
  async listReviews(input: ListReviewsInput): Promise<RawReviewPage> {
    const query: Record<string, string> = { pageSize: String(input.pageSize ?? 50) };
    if (input.pageToken) query.pageToken = input.pageToken;
    if (input.orderBy) query.orderBy = input.orderBy;
    const body = await this.execute({
      method: "GET",
      service: "reviews",
      path: `v4/accounts/${input.accountId}/locations/${input.location.providerLocationId}/reviews`,
      query,
    });
    return { reviews: body.reviews ?? [], nextPageToken: body.nextPageToken };
  }
}

/** `accounts/123` → `accounts/123`; `123` → `accounts/123` (tolerate id-only inputs). */
function stripResourcePrefix(account: string): string {
  return account.includes("/") ? account : `accounts/${account}`;
}

// ---------------------------------------------------------------------------
// Executor adapter — plug the client into the existing listGoogleBusinessReviews seam.
// ---------------------------------------------------------------------------

/**
 * Wrap a client as a {@link GoogleReviewExecutor}. On a {@link GoogleBusinessApiError}
 * it returns a normalized `error` object (status + kind) that
 * {@link mapGoogleBusinessError} turns into a product reason — no raw payload escapes.
 */
export function toReviewExecutor(client: GoogleBusinessApiClient): GoogleReviewExecutor {
  return async (input) => {
    try {
      return await client.listReviews(input);
    } catch (e) {
      if (e instanceof GoogleBusinessApiError) {
        return { error: { code: e.detail.status, status: e.detail.kind, message: e.detail.kind } };
      }
      // Unknown throw — surface a generic, redacted reason (never the raw message shape).
      return { error: { code: 0, status: "generic", message: "review_sync_failed" } };
    }
  };
}

/**
 * Build a LIVE review executor — or return `null`, fail-closed. The executor exists ONLY
 * when config is present, the API is enabled, Google access is APPROVED, and an access
 * token is available. This is the single gate that prevents any live Google call (and any
 * mock/fake review data) while API approval is still pending.
 */
export function createLiveGoogleReviewExecutor(opts: {
  transport: GoogleBusinessTransport;
  accessToken: string | null | undefined;
  refreshAccessToken?: () => Promise<string>;
  source?: NodeJS.ProcessEnv;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): GoogleReviewExecutor | null {
  const cfg = getGoogleBusinessConfig(opts.source);
  if (!cfg.configured || !cfg.apiEnabled || !cfg.apiApproved) return null;
  if (!opts.accessToken) return null;
  const client = new GoogleBusinessApiClient({
    transport: opts.transport,
    accessToken: opts.accessToken,
    refreshAccessToken: opts.refreshAccessToken,
    sleep: opts.sleep,
    now: opts.now,
  });
  return toReviewExecutor(client);
}

// ---------------------------------------------------------------------------
// Production transport (real fetch). Only ever constructed behind the approval gate.
// ---------------------------------------------------------------------------
const SERVICE_HOST: Record<GoogleBusinessService, string> = {
  accountManagement: "https://mybusinessaccountmanagement.googleapis.com",
  businessInformation: "https://mybusinessbusinessinformation.googleapis.com",
  reviews: "https://mybusiness.googleapis.com",
};

/**
 * The real HTTP transport: a single GET with an explicit per-attempt abort timeout.
 * Sends the token ONLY as an `Authorization: Bearer` header (never a query param, never
 * logged). Transport-level failures become a classified {@link GoogleBusinessApiError};
 * HTTP status handling belongs to the client.
 */
export function createGoogleFetchTransport(): GoogleBusinessTransport {
  return {
    name: "fetch",
    async send(req: GoogleHttpRequest): Promise<GoogleHttpResponse> {
      const params = new URLSearchParams(req.query ?? {});
      const qs = params.toString();
      const url = `${SERVICE_HOST[req.service]}/${req.path}${qs ? `?${qs}` : ""}`;
      let res: Response;
      try {
        res = await fetch(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${req.accessToken}`, Accept: "application/json" },
          signal: AbortSignal.timeout(Math.max(1, req.timeoutMs ?? 10_000)),
        });
      } catch (err) {
        const isAbort = (err as { name?: string })?.name === "TimeoutError" || (err as { name?: string })?.name === "AbortError";
        throw new GoogleBusinessApiError({ status: 0, kind: isAbort ? "timeout" : "network", retryable: true });
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      return {
        status: res.status,
        retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0,
        json: () => res.json() as Promise<unknown>,
      };
    },
  };
}
