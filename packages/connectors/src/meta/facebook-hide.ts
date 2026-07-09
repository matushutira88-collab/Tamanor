import { META_GRAPH_BASE } from "./oauth";

/**
 * Controlled Facebook Page **comment hide** capability. This is the ONLY live
 * platform action in Guardora. Reply and delete remain disabled. Instagram is
 * out of scope. The Graph call is isolated behind a {@link FacebookHideTransport}
 * seam so it is fully testable with a mock and never runs in dry-run mode.
 *
 * Hiding a comment uses: POST /{comment-id}  body: is_hidden=true
 * with a Page access token. The token is passed by reference and NEVER logged.
 */

export interface HideCommentInput {
  pageId: string;
  commentId: string;
  connectedAccountId: string;
  itemId: string;
  /** Page access token — used by the transport, never logged or returned. */
  pageAccessToken: string;
}

export type HideCommentStatus = "dry_run" | "executed" | "failed";

export interface HideCommentResult {
  status: HideCommentStatus;
  /** HTTP-ish response code from the provider, if any. */
  providerResponseCode?: string;
  /** Classified error code (never the token). */
  providerErrorCode?: string;
  /** Sanitized error message (no token, no raw payload). */
  providerErrorMessage?: string;
}

/** Result of the raw transport call. Success is NEVER faked. */
export interface HideTransportResult {
  ok: boolean;
  responseCode?: string;
  errorCode?: string;
  errorMessage?: string;
}

/** The isolated network seam. Implementations must not log the token. */
export interface FacebookHideTransport {
  readonly name: string;
  hide(commentId: string, accessToken: string): Promise<HideTransportResult>;
  /** Unhide (rollback). Dry-run-only in this phase — live unhide is a TODO. */
  unhide(commentId: string, accessToken: string): Promise<HideTransportResult>;
}

/**
 * Mock transport — makes NO network calls. Used for tests and any non-live path.
 * Records invocations so tests can assert the transport was (not) called.
 */
export class MockFacebookHideTransport implements FacebookHideTransport {
  readonly name = "mock";
  readonly calls: { op: "hide" | "unhide"; commentId: string }[] = [];
  constructor(private readonly outcome: HideTransportResult = { ok: true, responseCode: "200" }) {}
  async hide(commentId: string): Promise<HideTransportResult> {
    this.calls.push({ op: "hide", commentId });
    return this.outcome;
  }
  async unhide(commentId: string): Promise<HideTransportResult> {
    this.calls.push({ op: "unhide", commentId });
    return this.outcome;
  }
}

/**
 * Real Graph transport — POSTs is_hidden=true. Only constructed for an explicit,
 * manual, controlled live test. Never used in dry-run. Token never logged.
 */
export class GraphFacebookHideTransport implements FacebookHideTransport {
  readonly name = "graph";
  private async post(commentId: string, accessToken: string, isHidden: boolean): Promise<HideTransportResult> {
    const url = `${META_GRAPH_BASE}/${encodeURIComponent(commentId)}`;
    const body = new URLSearchParams({ is_hidden: String(isHidden), access_token: accessToken });
    try {
      const res = await fetch(url, { method: "POST", body });
      if (res.ok) return { ok: true, responseCode: String(res.status) };
      let code: number | undefined;
      try {
        const j = (await res.json()) as { error?: { code?: number; error_subcode?: number } };
        code = j.error?.code;
      } catch { /* ignore non-JSON */ }
      const rateLimited = res.status === 429 || code === 4 || code === 17 || code === 32 || code === 613;
      return {
        ok: false,
        responseCode: String(res.status),
        errorCode: rateLimited ? "rate_limit" : code === 190 ? "token_expired" : res.status === 403 ? "permission" : "generic",
        errorMessage: `Graph hide failed (HTTP ${res.status}).`, // sanitized — no token/body
      };
    } catch {
      return { ok: false, errorCode: "network", errorMessage: "Graph hide request failed (network)." };
    }
  }
  hide(commentId: string, accessToken: string): Promise<HideTransportResult> {
    return this.post(commentId, accessToken, true);
  }
  unhide(commentId: string, accessToken: string): Promise<HideTransportResult> {
    return this.post(commentId, accessToken, false);
  }
}

/**
 * Execute (or simulate) a Facebook comment hide. In dry-run mode NO transport is
 * called. In live mode the transport runs and its result is reported honestly —
 * failure is never turned into success.
 */
export async function hideComment(
  input: HideCommentInput,
  opts: { dryRun: boolean; transport: FacebookHideTransport },
): Promise<HideCommentResult> {
  if (!input.commentId || !input.pageId) {
    return { status: "failed", providerErrorCode: "invalid_input", providerErrorMessage: "Missing pageId or commentId." };
  }
  if (opts.dryRun) {
    // Simulated path only — never touches the Graph API.
    return { status: "dry_run", providerResponseCode: "dry_run" };
  }
  const r = await opts.transport.hide(input.commentId, input.pageAccessToken);
  if (r.ok) {
    return { status: "executed", providerResponseCode: r.responseCode };
  }
  return { status: "failed", providerResponseCode: r.responseCode, providerErrorCode: r.errorCode, providerErrorMessage: r.errorMessage };
}

/**
 * Rollback seam — unhide (is_hidden=false). In dry-run NO transport is called. In
 * live mode the transport runs (V1.27 rollback). Failure is reported honestly.
 */
export async function unhideComment(
  input: HideCommentInput,
  opts: { dryRun: boolean; transport: FacebookHideTransport },
): Promise<HideCommentResult> {
  if (!input.commentId) {
    return { status: "failed", providerErrorCode: "invalid_input", providerErrorMessage: "Missing commentId." };
  }
  if (opts.dryRun) {
    return { status: "dry_run", providerResponseCode: "unhide_dry_run" };
  }
  const r = await opts.transport.unhide(input.commentId, input.pageAccessToken);
  if (r.ok) {
    return { status: "executed", providerResponseCode: r.responseCode };
  }
  return { status: "failed", providerResponseCode: r.responseCode, providerErrorCode: r.errorCode, providerErrorMessage: r.errorMessage };
}
