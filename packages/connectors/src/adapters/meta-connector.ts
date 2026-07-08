import { Platform } from "@guardora/core";
import { BasePlaceholderConnector } from "../base-connector";

/**
 * MetaConnector — Facebook Page + Instagram Business.
 *
 * Real implementation will use the Meta Graph API (official OAuth). One adapter
 * instance is bound to a single connected account (page or IG business account).
 *
 * Placeholder only — no Graph API calls yet.
 */
export class MetaConnector extends BasePlaceholderConnector {
  readonly platform: Platform;

  constructor(platform: Platform = Platform.FacebookPage) {
    super();
    this.platform = platform;
  }

  // TODO(real): implement via Graph API
  //   - syncComments: GET /{page-id}/feed + /{object-id}/comments
  //   - syncReviews:  GET /{page-id}/ratings (Facebook only)
  //   - reply:        POST /{comment-id}/comments
  //   - hide:         POST /{comment-id} { is_hidden: true }
  //   - delete:       DELETE /{comment-id}
}
