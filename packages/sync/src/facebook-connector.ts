/**
 * V1.31 Facebook connector adapter.
 *
 * A thin seam that isolates Facebook-specific action logic behind the shared
 * capability model. It WRAPS the existing, working functions (predictHideOutcome,
 * getCommentLifecycle, checkAccountToken) — it does NOT reimplement them — so
 * manual and autonomous hide behave exactly as before. Future connectors provide
 * the same shape without touching the product pages.
 */
import {
  FACEBOOK_CAPABILITIES, normalizeFacebookReason, mapFacebookError,
  type PlatformCapabilities, type PlatformKey, type NormalizedActionReason,
} from "@guardora/core";
import { predictHideOutcome, getCommentLifecycle, resolvePrimaryAction } from "./live-actions";
import { checkAccountToken } from "./connection-manager";

export interface PlatformActionAdapter {
  readonly platform: PlatformKey;
  readonly capabilities: PlatformCapabilities;
  /** Predict a hide outcome without executing (existing safety preview). */
  readonly predictHide: typeof predictHideOutcome;
  /** Read a comment's live lifecycle (deleted / hidden / cannot_hide). */
  readonly verifyCommentState: typeof getCommentLifecycle;
  /** Validate the account's OAuth token / connection health. */
  readonly validateConnection: typeof checkAccountToken;
  /** Resolve the primary action for an item (existing decision logic). */
  readonly resolvePrimaryAction: typeof resolvePrimaryAction;
  /** Normalize a stored execution reason into a product-level reason. */
  normalizeReason(reason: string | null | undefined, status?: string | null): NormalizedActionReason;
  /** Normalize a raw provider error into a product-level reason. */
  mapError(raw: { code?: string | null; reason?: string | null }): NormalizedActionReason;
}

/** The Facebook Page connector — capabilities + wrapped Graph action functions. */
export const facebookConnector: PlatformActionAdapter = {
  platform: "facebook",
  capabilities: FACEBOOK_CAPABILITIES,
  predictHide: predictHideOutcome,
  verifyCommentState: getCommentLifecycle,
  validateConnection: checkAccountToken,
  resolvePrimaryAction,
  normalizeReason: normalizeFacebookReason,
  mapError: mapFacebookError,
};

/** Action-level connector registry. Only Facebook is implemented in V1.31. */
export function getPlatformActionAdapter(platform: PlatformKey): PlatformActionAdapter | null {
  return platform === "facebook" ? facebookConnector : null;
}
