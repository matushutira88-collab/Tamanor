import { META_GRAPH_BASE } from "./oauth";

/** A classified reason a Graph call failed. */
export type MetaErrorKind = "token_expired" | "permission" | "rate_limit" | "generic";

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
  constructor(private readonly accessToken: string) {}

  async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const params = new URLSearchParams({
      ...query,
      access_token: this.accessToken,
    });
    const url = `${META_GRAPH_BASE}/${path.replace(/^\//, "")}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      // Parse the Graph error object (code/type) — it does not contain the
      // token. We never surface the request URL or raw body verbatim.
      let code: number | undefined;
      let subcode: number | undefined;
      let type: string | undefined;
      try {
        const body = (await res.json()) as {
          error?: { code?: number; error_subcode?: number; type?: string };
        };
        code = body.error?.code;
        subcode = body.error?.error_subcode;
        type = body.error?.type;
      } catch {
        /* non-JSON error body — ignore */
      }
      const kind = classify(res.status, code, subcode);
      throw new MetaGraphError(
        `Meta Graph GET /${path} failed (HTTP ${res.status}, ${kind}).`,
        { status: res.status, code, subcode, type, kind },
      );
    }
    return (await res.json()) as T;
  }
}
