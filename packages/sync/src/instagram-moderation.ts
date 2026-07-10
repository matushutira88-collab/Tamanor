/**
 * V1.32B Instagram moderation — RESEARCH / TEST-GATED hide & unhide.
 *
 * ── Official Meta / Instagram Platform API research (source: developers.facebook.com,
 *    Instagram Platform → Comment Moderation; verify against current docs before enabling):
 *   • Hide a comment:   POST /{ig-comment-id}?hide=true      (Graph API)
 *   • Unhide a comment: POST /{ig-comment-id}?hide=false
 *   • Read hidden state: GET /{ig-comment-id}?fields=hidden  (the IG Comment node exposes `hidden`)
 *   • Required permissions: instagram_basic + instagram_manage_comments
 *       (business login path may surface as instagram_business_manage_comments),
 *       plus pages_show_list / pages_read_engagement for the linked Page.
 *   • Restriction: moderation is only allowed on comments on media OWNED by the
 *     connected IG Business account.
 *   • App Review: instagram_manage_comments requires App Review / Advanced Access
 *     for non-test users.
 *   • Visibility of a hidden IG comment (author/owner) is NOT assumed here — the UI
 *     stays cautious until proven (see H wording).
 *
 * NOTHING here executes without BOTH env gates: INSTAGRAM_HIDE_TEST_ENABLED=true
 * AND INSTAGRAM_HIDE_TEST_CONFIRM=YES. Instagram auto-hide is NEVER wired in V1.32B.
 */
import { mapInstagramSyncError, type NormalizedActionReason, type PlatformActionResult, type PlatformSyncErrorReason } from "@guardora/core";
import { getInstagramActionsConfig } from "@guardora/config";

export type InstagramActionKind = "hide" | "unhide";

export interface InstagramActionInput {
  accountId: string;
  externalCommentId: string;
  externalPostId?: string;
}

/** Minimal shape of a raw Graph response for an IG hide/unhide/verify call. */
export interface InstagramRawActionResponse {
  ok?: boolean;
  hidden?: boolean;
  alreadyHidden?: boolean;
  alreadyVisible?: boolean;
  error?: { code?: string | null; reason?: string | null };
  /** Raw provider fields — Advanced/diagnostics only, never the default UI. */
  providerResponseCode?: string;
  providerErrorCode?: string;
  providerErrorMessage?: string;
}

/** Injected executor performing the real Graph call (kept out of this module so nothing runs by accident). */
export type InstagramExecutor = (kind: InstagramActionKind, input: InstagramActionInput) => Promise<InstagramRawActionResponse>;

/** Map a raw IG action error onto a product-level action reason. No raw text leaks out. */
export function mapInstagramActionError(err: { code?: string | null; reason?: string | null }): NormalizedActionReason {
  const hay = `${(err.code ?? "").toLowerCase()} ${(err.reason ?? "").toLowerCase()}`;
  if (/token|oauth|expired|session|reconnect/.test(hay)) return "token_invalid";
  if (/permission|scope|instagram_manage|instagram_basic|not authorized|app review/.test(hay)) return "missing_permission";
  if (/can_hide|did_not_allow|not allowed|owned media|not owner/.test(hay)) return "platform_did_not_allow";
  if (/no.*instagram|account.*not.*found|no linked/.test(hay)) return "account_not_found";
  if (/media.*not.*found|no media/.test(hay)) return "media_not_found";
  if (/comment.*unavailable|comment.*not.*found|deleted|gone/.test(hay)) return "comment_unavailable";
  if (/rate|throttl|limit/.test(hay)) return "rate_limited";
  return "provider_error";
}

const ACTION_TYPE = { hide: "hide_comment", unhide: "unhide_comment" } as const;

/** Map a raw IG hide/unhide response into a normalized product-level result. */
export function mapInstagramActionResult(kind: InstagramActionKind, raw: InstagramRawActionResponse, input: InstagramActionInput): PlatformActionResult {
  const base = {
    platform: "instagram" as const,
    actionType: ACTION_TYPE[kind],
    externalCommentId: input.externalCommentId,
    externalPostId: input.externalPostId,
    providerResponseCode: raw.providerResponseCode,
    providerErrorCode: raw.providerErrorCode,
    providerErrorMessage: raw.providerErrorMessage,
  };
  if (raw.error) {
    const reason = mapInstagramActionError(raw.error);
    return { ...base, status: reason === "platform_did_not_allow" ? "blocked" : "failed", reason };
  }
  if (kind === "hide") {
    if (raw.alreadyHidden) return { ...base, status: "executed", reason: "already_hidden" };
    if (raw.ok || raw.hidden) return { ...base, status: "executed", reason: "instagram_hide_executed" };
  } else {
    if (raw.alreadyVisible) return { ...base, status: "executed", reason: "already_visible" };
    if (raw.ok || raw.hidden === false) return { ...base, status: "executed", reason: "instagram_unhide_executed" };
  }
  return { ...base, status: "failed", reason: "unknown_error" };
}

/**
 * Attempt an Instagram hide/unhide under the safety gates. Fail-closed:
 *   - gate OFF                 → blocked / blocked_by_safety_gate
 *   - enabled but NOT confirmed → no_action / dry_run (test prepared, nothing sent)
 *   - enabled AND confirmed     → executor runs; result is normalized
 * Auto-hide can never reach here (there is no automation caller and auto-hide env
 * is never honored). A caller that flags `viaAutomation` is refused outright.
 */
export async function runInstagramModerationTest(
  kind: InstagramActionKind,
  input: InstagramActionInput,
  opts: { source?: NodeJS.ProcessEnv; executor?: InstagramExecutor; viaAutomation?: boolean } = {},
): Promise<PlatformActionResult> {
  const base = { platform: "instagram" as const, actionType: ACTION_TYPE[kind], externalCommentId: input.externalCommentId, externalPostId: input.externalPostId };
  // Instagram auto-hide is NEVER permitted in V1.32B.
  if (opts.viaAutomation) return { ...base, status: "blocked", reason: "blocked_by_safety_gate" };
  const gates = getInstagramActionsConfig(opts.source);
  if (!gates.hideTestEnabled) return { ...base, status: "blocked", reason: "blocked_by_safety_gate" };
  if (!gates.hideTestConfirmed) return { ...base, status: "no_action", reason: "dry_run" };
  if (!opts.executor) return { ...base, status: "blocked", reason: "blocked_by_safety_gate" };
  try {
    const raw = await opts.executor(kind, input);
    return mapInstagramActionResult(kind, raw, input);
  } catch (e) {
    return { ...base, status: "failed", reason: mapInstagramActionError({ reason: e instanceof Error ? e.message : String(e) }) };
  }
}

// ---------------------------------------------------------------------------
// Permission diagnostics (B) — product-level, no raw provider text by default.
// ---------------------------------------------------------------------------

export type InstagramModerationStatus =
  | "read_ok"
  | "moderation_permission_missing"
  | "token_invalid"
  | "account_not_found"
  | "app_review_required"
  | "provider_error";

const IG_READ_PERM = "instagram_basic";
const IG_MODERATION_PERMS = ["instagram_manage_comments", "instagram_business_manage_comments"];

/** Product-level moderation-readiness for an IG account, from its granted permissions + connection state. */
export function instagramModerationStatus(input: { grantedPermissions: string[]; tokenValid?: boolean; accountFound?: boolean; appReviewApproved?: boolean }): InstagramModerationStatus {
  if (input.accountFound === false) return "account_not_found";
  if (input.tokenValid === false) return "token_invalid";
  const perms = input.grantedPermissions.map((p) => p.toLowerCase());
  const hasModeration = perms.some((p) => IG_MODERATION_PERMS.includes(p));
  if (!hasModeration) return "moderation_permission_missing";
  if (input.appReviewApproved === false) return "app_review_required";
  return "read_ok";
}

export interface InstagramModerationDiagnostics {
  accountId: string;
  accountName?: string;
  status: InstagramModerationStatus;
  canHideTest: boolean;
  canUnhideTest: boolean;
  gates: ReturnType<typeof getInstagramActionsConfig>;
  hasReadPermission: boolean;
  hasModerationPermission: boolean;
  /** Raw provider error, Advanced-only. */
  providerError?: PlatformSyncErrorReason;
}

/** Build full Instagram moderation diagnostics (Advanced / CLI only — not a user feature). */
export function instagramModerationDiagnostics(input: {
  accountId: string;
  accountName?: string;
  grantedPermissions: string[];
  tokenValid?: boolean;
  accountFound?: boolean;
  appReviewApproved?: boolean;
  source?: NodeJS.ProcessEnv;
  rawError?: { code?: string | null; reason?: string | null };
}): InstagramModerationDiagnostics {
  const perms = input.grantedPermissions.map((p) => p.toLowerCase());
  const status = instagramModerationStatus(input);
  const gates = getInstagramActionsConfig(input.source);
  const ready = status === "read_ok" && gates.canExecuteTest;
  return {
    accountId: input.accountId,
    accountName: input.accountName,
    status,
    canHideTest: ready,
    canUnhideTest: ready,
    gates,
    hasReadPermission: perms.includes(IG_READ_PERM),
    hasModerationPermission: perms.some((p) => IG_MODERATION_PERMS.includes(p)),
    providerError: input.rawError ? mapInstagramSyncError(input.rawError) : undefined,
  };
}
