import { createHmac } from "node:crypto";
import { META_GRAPH_BASE } from "./oauth";
import { metaFetch, MetaHttpError } from "./http";

/**
 * V1.58.3 — `appsecret_proof` for server-side Graph calls. Meta's "Require App Secret"
 * setting rejects any server API call made with a user/page access token unless it also
 * carries `appsecret_proof = HMAC-SHA256(access_token) keyed by the app secret` (hex).
 * Pure and single-sourced. The RESULT is a secret and must NEVER be logged, stored,
 * returned to the browser, or placed in an error message.
 */
export function appsecretProof(accessToken: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(accessToken).digest("hex");
}

/** A classified reason a Graph call failed. */
export type MetaErrorKind =
  | "token_expired" | "permission" | "rate_limit" | "generic"
  | "timeout" | "network" | "server_error" | "invalid_response";

/** Whether a given failure kind is SAFE to retry (transport/transient only, never auth/permission). */
export function isRetryableMetaKind(kind: MetaErrorKind): boolean {
  return kind === "rate_limit" || kind === "timeout" || kind === "network" || kind === "server_error";
}

/**
 * Typed Graph API error. Carries the platform error code/type/status so callers
 * can classify (token expired vs. missing permission) WITHOUT parsing strings.
 * The message is generic and never contains the access token.
 */
export class MetaGraphError extends Error {
  constructor(
    message: string,
    readonly detail: {
      status: number;
      code?: number;
      subcode?: number;
      type?: string;
      kind: MetaErrorKind;
      /** Whether this failure is safe to retry (transport/transient). */
      retryable: boolean;
      /** Meta's human-readable error message (safe: never contains the token). */
      metaMessage?: string;
      /** Meta support trace id — the key diagnostic to hand to Meta / read in logs. */
      fbtraceId?: string;
    },
  ) {
    super(message);
    this.name = "MetaGraphError";
  }
}

/** Meta OAuth error code 190 = access token expired/invalid. */
function classify(status: number, code?: number, subcode?: number): MetaErrorKind {
  if (code === 190 || subcode === 463 || subcode === 467) return "token_expired";
  if (code === 10 || code === 200 || code === 803 || code === 3 || status === 403) {
    return "permission";
  }
  if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429) {
    return "rate_limit";
  }
  return "generic";
}

/**
 * Minimal Graph API client. Read-only GET helper only — no POST/DELETE (no
 * publishing, hiding, or deleting). The access token is sent as a query param
 * to the Graph API and is NEVER logged.
 */
export class MetaGraphClient {
  /** Precomputed appsecret_proof (secret) — never logged/returned. Undefined only if no secret. */
  private readonly proof?: string;

  /**
   * @param accessToken user or page access token.
   * @param appSecret   the Meta app secret; defaults to META_APP_SECRET (server-only). Callers may
   *   pass it explicitly (e.g. the OAuth callback) for clarity/testability. When present, every GET
   *   automatically carries `appsecret_proof` — no per-call duplication.
   */
  constructor(
    private readonly accessToken: string,
    appSecret: string | undefined = process.env.META_APP_SECRET?.trim() || undefined,
  ) {
    this.proof = appSecret ? appsecretProof(accessToken, appSecret) : undefined;
  }

  async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const params = new URLSearchParams({
      ...query,
      access_token: this.accessToken,
    });
    // Required by Meta "Require App Secret" for any server call with a user/page token.
    if (this.proof) params.set("appsecret_proof", this.proof);
    const url = `${META_GRAPH_BASE}/${path.replace(/^\//, "")}?${params.toString()}`;

    // Central resilient transport: explicit timeout + bounded retry/backoff for transient failures.
    let res: Response;
    try {
      res = await metaFetch(url, { category: "graph_read", retryable: true });
    } catch (err) {
      if (err instanceof MetaHttpError) {
        const kind: MetaErrorKind = err.kind === "rate_limit" ? "rate_limit"
          : err.kind === "server_error" ? "server_error" : err.kind === "timeout" ? "timeout" : "network";
        throw new MetaGraphError(`Meta Graph GET /${path} failed (${kind}).`, { status: err.status ?? 0, kind, retryable: true });
      }
      throw err;
    }

    if (!res.ok) {
      // Parse the Graph error object (code/type) — it does not contain the token. We never surface
      // the request URL or raw body verbatim. A non-JSON/HTML error body is tolerated.
      let code: number | undefined, subcode: number | undefined, type: string | undefined;
      let metaMessage: string | undefined, fbtraceId: string | undefined;
      try {
        const body = (await res.json()) as { error?: { code?: number; error_subcode?: number; type?: string; message?: string; fbtrace_id?: string } };
        code = body.error?.code; subcode = body.error?.error_subcode; type = body.error?.type;
        metaMessage = body.error?.message; fbtraceId = body.error?.fbtrace_id;
      } catch { /* non-JSON error body — ignore */ }
      const kind = res.status >= 500 ? "server_error" : classify(res.status, code, subcode);
      throw new MetaGraphError(
        `Meta Graph GET /${path} failed (HTTP ${res.status}, ${kind}).`,
        { status: res.status, code, subcode, type, kind, retryable: isRetryableMetaKind(kind), metaMessage, fbtraceId },
      );
    }
    try {
      return (await res.json()) as T;
    } catch {
      // Empty / invalid / HTML success body — classify safely instead of leaking a parser error.
      throw new MetaGraphError(`Meta Graph GET /${path} returned an invalid response.`, { status: res.status, kind: "invalid_response", retryable: false });
    }
  }
}
