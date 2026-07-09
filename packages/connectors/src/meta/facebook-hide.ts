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

/**
 * V1.27C — result of reading a comment's hide-ability. `ok:false` means the token
 * itself failed (reconnect needed); `ok:true` carries can_hide/is_hidden.
 */
export type CommentState =
  | { ok: true; canHide: boolean; isHidden: boolean }
  | { ok: false; errorCode: string };

/** V1.27C — result of validating a Page token via GET /{pageId}?fields=id,name. */
export type PageTokenState =
  | { ok: true; pageId: string; pageName?: string }
  | { ok: false; errorCode: string };

/** The isolated network seam. Implementations must not log the token. */
export interface FacebookHideTransport {
  readonly name: string;
  hide(commentId: string, accessToken: string): Promise<HideTransportResult>;
  /** Unhide (rollback). Dry-run-only in this phase — live unhide is a TODO. */
  unhide(commentId: string, accessToken: string): Promise<HideTransportResult>;
  /** V1.27C — read can_hide/is_hidden for a comment (also validates the token). */
  getCommentState?(commentId: string, accessToken: string): Promise<CommentState>;
  /** V1.27C — validate a Page token via GET /{pageId}?fields=id,name. */
  getPageTokenState?(pageId: string, accessToken: string): Promise<PageTokenState>;
}

/**
 * Mock transport — makes NO network calls. Used for tests and any non-live path.
 * Records invocations so tests can assert the transport was (not) called.
 */
export class MockFacebookHideTransport implements FacebookHideTransport {
  readonly name = "mock";
  readonly calls: { op: "hide" | "unhide"; commentId: string }[] = [];
  // V1.27C — configurable comment/page state (does NOT count as a hide/unhide call).
  private readonly commentState: CommentState;
  private readonly pageTokenState: PageTokenState;
  constructor(
    private readonly outcome: HideTransportResult = { ok: true, responseCode: "200" },
    state?: { comment?: CommentState; pageToken?: PageTokenState },
  ) {
    this.commentState = state?.comment ?? { ok: true, canHide: true, isHidden: false };
    this.pageTokenState = state?.pageToken ?? { ok: true, pageId: "P1", pageName: "Mock Page" };
  }
  // Stateful (V1.28A): a successful hide flips is_hidden=true — mirrors real Graph
  // behavior so the post-hide verification GET sees the effect of the POST.
  private hiddenByPost = false;
  async hide(commentId: string): Promise<HideTransportResult> {
    this.calls.push({ op: "hide", commentId });
    if (this.outcome.ok) this.hiddenByPost = true;
    return this.outcome;
  }
  async unhide(commentId: string): Promise<HideTransportResult> {
    this.calls.push({ op: "unhide", commentId });
    if (this.outcome.ok) this.hiddenByPost = false;
    return this.outcome;
  }
  async getCommentState(): Promise<CommentState> {
    if (this.commentState.ok && this.hiddenByPost) return { ...this.commentState, isHidden: true };
    return this.commentState;
  }
  async getPageTokenState(): Promise<PageTokenState> {
    return this.pageTokenState;
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
  private classifyErr(status: number, code?: number): string {
    // Conservative (V1.27D): only a genuine OAuth error kills the token. An
    // ambiguous 400 without an OAuth code is "generic" — never a false token death.
    if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613) return "rate_limit";
    if (code === 190) return "token_expired";
    if (code === 467) return "revoked";
    // V1.27E — a deleted/unavailable object (comment removed on Facebook). Graph
    // returns code 100 (often subcode 33) or HTTP 404. NOT a token/permission error.
    if (code === 100 || status === 404) return "not_found";
    if (code === 10 || code === 200 || code === 803) return "permission";
    if (status === 403) return "permission";
    return "generic";
  }
  async getCommentState(commentId: string, accessToken: string): Promise<CommentState> {
    const url = `${META_GRAPH_BASE}/${encodeURIComponent(commentId)}?fields=can_hide,is_hidden`;
    try {
      const res = await fetch(`${url}&access_token=${encodeURIComponent(accessToken)}`);
      if (res.ok) {
        const j = (await res.json()) as { can_hide?: boolean; is_hidden?: boolean };
        return { ok: true, canHide: j.can_hide === true, isHidden: j.is_hidden === true };
      }
      let code: number | undefined;
      try { code = ((await res.json()) as { error?: { code?: number } }).error?.code; } catch { /* non-JSON */ }
      return { ok: false, errorCode: this.classifyErr(res.status, code) };
    } catch {
      return { ok: false, errorCode: "network" };
    }
  }
  async getPageTokenState(pageId: string, accessToken: string): Promise<PageTokenState> {
    const url = `${META_GRAPH_BASE}/${encodeURIComponent(pageId)}?fields=id,name`;
    try {
      const res = await fetch(`${url}&access_token=${encodeURIComponent(accessToken)}`);
      if (res.ok) {
        const j = (await res.json()) as { id?: string; name?: string };
        return { ok: true, pageId: j.id ?? pageId, pageName: j.name };
      }
      let code: number | undefined;
      try { code = ((await res.json()) as { error?: { code?: number } }).error?.code; } catch { /* non-JSON */ }
      return { ok: false, errorCode: this.classifyErr(res.status, code) };
    } catch {
      return { ok: false, errorCode: "network" };
    }
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
