/**
 * V1.31 Platform Connector Foundation.
 *
 * Guardora is a multi-platform-ready Social Account Firewall. Facebook is the
 * first (and, for now, only) real connector. This module separates Facebook-
 * specific facts from *general* platform logic so future connectors can be added
 * without rewriting the product:
 *
 *   - `PlatformKey`         — stable platform identifier (product-level).
 *   - `PlatformCapabilities`— what a platform/account can actually do.
 *   - `PlatformActionResult`— a normalized moderation result (product wording).
 *   - `getPlatformConnector`— a safe registry; unsupported platforms never crash.
 *
 * This is a foundation only: no Instagram/YouTube/TikTok/LinkedIn/Google Business
 * connector is implemented. Reserved keys exist in types so the UI can read
 * capabilities honestly instead of assuming "everything works like Facebook".
 */
import { Platform } from "./platform";

/** Product-level platform identifier. Only `facebook` is implemented in V1.31. */
export type PlatformKey =
  | "facebook"
  | "instagram"
  | "youtube"
  | "tiktok"
  | "linkedin"
  | "google_business";

/** Map the persisted {@link Platform} enum onto a product-level {@link PlatformKey}. */
export function platformKeyFor(platform: Platform | string): PlatformKey {
  switch (platform) {
    case Platform.FacebookPage: return "facebook";
    case Platform.InstagramBusiness: return "instagram";
    case Platform.YouTube: return "youtube";
    case Platform.LinkedInCompany: return "linkedin";
    case Platform.TikTok: return "tiktok";
    case Platform.GoogleBusiness: return "google_business";
    default: return "facebook";
  }
}

/**
 * What a platform/account can actually do. The UI reads this to stay honest —
 * an action a platform cannot perform is never offered.
 */
export interface PlatformCapabilities {
  canReadComments: boolean;
  canReadPostComments: boolean;
  canReadAdComments: boolean;
  canHideComment: boolean;
  canVerifyHiddenState: boolean;
  canFetchAuthor: boolean;
  canFetchPost: boolean;
  canModerateAutomatically: boolean;
  /** The platform exposes a "hidden from the public" state (vs. only flags/marks). */
  supportsPublicHiddenState: boolean;
  /** A publicly-hidden comment may still be visible to its author / page admins. */
  publicHiddenStillVisibleToAuthorOrAdmin: boolean;
  // Actions Guardora deliberately does NOT perform (kept explicit + honest).
  canDeleteComment: boolean;
  canReplyToComment: boolean;
  canLikeComment: boolean;
  canBanAuthor: boolean;
  canReportComment: boolean;
}

/** Everything off — the safe default for unimplemented / unsupported platforms. */
export const UNSUPPORTED_CAPABILITIES: PlatformCapabilities = {
  canReadComments: false,
  canReadPostComments: false,
  canReadAdComments: false,
  canHideComment: false,
  canVerifyHiddenState: false,
  canFetchAuthor: false,
  canFetchPost: false,
  canModerateAutomatically: false,
  supportsPublicHiddenState: false,
  publicHiddenStillVisibleToAuthorOrAdmin: false,
  canDeleteComment: false,
  canReplyToComment: false,
  canLikeComment: false,
  canBanAuthor: false,
  canReportComment: false,
};

/**
 * Facebook Page capabilities — reflects what Guardora ACTUALLY does today.
 * Guardora never deletes/replies/likes/bans/reports, so those stay false even
 * though the Graph API may technically allow some of them.
 */
export const FACEBOOK_CAPABILITIES: PlatformCapabilities = {
  canReadComments: true,
  canReadPostComments: true,
  canReadAdComments: true,
  canHideComment: true,
  canVerifyHiddenState: true,
  canFetchAuthor: true,
  canFetchPost: true,
  canModerateAutomatically: true,
  supportsPublicHiddenState: true,
  publicHiddenStillVisibleToAuthorOrAdmin: true,
  canDeleteComment: false,
  canReplyToComment: false,
  canLikeComment: false,
  canBanAuthor: false,
  canReportComment: false,
};

const CAPABILITIES: Record<PlatformKey, PlatformCapabilities> = {
  facebook: FACEBOOK_CAPABILITIES,
  instagram: UNSUPPORTED_CAPABILITIES,
  youtube: UNSUPPORTED_CAPABILITIES,
  tiktok: UNSUPPORTED_CAPABILITIES,
  linkedin: UNSUPPORTED_CAPABILITIES,
  google_business: UNSUPPORTED_CAPABILITIES,
};

export function getCapabilities(platform: PlatformKey): PlatformCapabilities {
  return CAPABILITIES[platform] ?? UNSUPPORTED_CAPABILITIES;
}

// ---------------------------------------------------------------------------
// Normalized action result — product-level, provider-agnostic.
// ---------------------------------------------------------------------------

export type NormalizedActionStatus = "executed" | "blocked" | "failed" | "no_action";

export type NormalizedActionReason =
  | "live_hide_executed"
  | "already_hidden"
  | "comment_deleted_or_unavailable"
  | "platform_did_not_allow"
  | "missing_capability"
  | "token_invalid"
  | "rate_limited"
  | "dry_run"
  | "unknown_error";

export interface PlatformActionResult {
  platform: PlatformKey;
  actionType: "hide_comment";
  status: NormalizedActionStatus;
  reason: NormalizedActionReason;
  externalCommentId?: string;
  externalPostId?: string;
  // Provider internals — ONLY for Advanced/diagnostics, never the default UI.
  providerResponseCode?: string;
  providerErrorCode?: string;
  providerErrorMessage?: string;
}

/** Reasons that mean "the comment is hidden from the public" (resolved). */
export const HIDDEN_FROM_PUBLIC_REASONS: readonly NormalizedActionReason[] = ["live_hide_executed", "already_hidden"];

/**
 * Map a stored Facebook execution `reason` (+ optional `status`) onto a
 * normalized, product-level reason. Pure and deterministic.
 */
export function normalizeFacebookReason(reason: string | null | undefined, status?: string | null): NormalizedActionReason {
  if (status === "dry_run") return "dry_run";
  switch (reason) {
    case "live_hide_executed": return "live_hide_executed";
    case "already_hidden": return "already_hidden";
    case "comment_deleted":
    case "comment_deleted_or_unavailable":
    case "comment_unavailable": return "comment_deleted_or_unavailable";
    case "facebook_can_hide_false":
    case "platform_did_not_allow": return "platform_did_not_allow";
    case "token_expired":
    case "token_invalid":
    case "reconnect_required": return "token_invalid";
    case "permission_missing":
    case "missing_capability": return "missing_capability";
    case "rate_limited": return "rate_limited";
    case "dry_run": return "dry_run";
    default: return "unknown_error";
  }
}

/** Map a raw Facebook/provider error onto a normalized reason. No raw text leaks out. */
export function mapFacebookError(raw: { code?: string | null; reason?: string | null }): NormalizedActionReason {
  const code = (raw.code ?? "").toLowerCase();
  const reason = (raw.reason ?? "").toLowerCase();
  const hay = `${code} ${reason}`;
  if (/token|oauth|expired|session|reconnect/.test(hay)) return "token_invalid";
  if (/permission|scope|missing_capab/.test(hay)) return "missing_capability";
  if (/can_hide|did_not_allow|not allowed/.test(hay)) return "platform_did_not_allow";
  if (/deleted|unavailable|not\s*found|gone/.test(hay)) return "comment_deleted_or_unavailable";
  if (/rate|throttl|limit/.test(hay)) return "rate_limited";
  return "unknown_error";
}

/**
 * Semantic wording key for an actioned/hidden comment, chosen from capabilities
 * (NOT hardcoded per platform):
 *   - platform exposes a public-hidden state → "hiddenFromPublic"
 *   - platform can only mark/flag internally  → "flagged"
 *   - platform supports no moderation action  → "manualReview"
 */
export function hiddenStateWordingKey(caps: PlatformCapabilities): "hiddenFromPublic" | "flagged" | "manualReview" {
  if (caps.supportsPublicHiddenState) return "hiddenFromPublic";
  if (caps.canHideComment || caps.canModerateAutomatically) return "flagged";
  return "manualReview";
}

// ---------------------------------------------------------------------------
// Connector registry — safe for the UI (unsupported platforms never crash).
// ---------------------------------------------------------------------------

export interface PlatformConnectorInfo {
  platform: PlatformKey;
  /** True only for platforms with a real, implemented connector (Facebook today). */
  supported: boolean;
  capabilities: PlatformCapabilities;
  normalizeReason(reason: string | null | undefined, status?: string | null): NormalizedActionReason;
  mapError(raw: { code?: string | null; reason?: string | null }): NormalizedActionReason;
  hiddenStateKey(): "hiddenFromPublic" | "flagged" | "manualReview";
}

const IMPLEMENTED: Set<PlatformKey> = new Set(["facebook"]);

export function isPlatformSupported(platform: PlatformKey): boolean {
  return IMPLEMENTED.has(platform);
}

/**
 * Return the connector info for a platform. Never throws: an unimplemented
 * platform yields a safe "unsupported" connector (connected=false, all
 * capabilities off, every action normalized to `missing_capability`) so the UI
 * can render an honest message instead of crashing.
 */
export function getPlatformConnector(platform: PlatformKey): PlatformConnectorInfo {
  const supported = isPlatformSupported(platform);
  const capabilities = getCapabilities(platform);
  return {
    platform,
    supported,
    capabilities,
    normalizeReason: (reason, status) => (supported ? normalizeFacebookReason(reason, status) : "missing_capability"),
    mapError: (rawErr) => (supported ? mapFacebookError(rawErr) : "missing_capability"),
    hiddenStateKey: () => hiddenStateWordingKey(capabilities),
  };
}
