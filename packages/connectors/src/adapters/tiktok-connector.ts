import { Platform } from "@guardora/core";
import { BasePlaceholderConnector } from "../base-connector";

/**
 * TikTokConnector — TikTok video comments.
 *
 * Real implementation will use the TikTok Business/Display APIs (official
 * OAuth). Placeholder only — no API calls yet.
 */
export class TikTokConnector extends BasePlaceholderConnector {
  readonly platform = Platform.TikTok;

  // TODO(real): implement via TikTok APIs
  //   - syncComments: /v2/video/comment/list/
  //   - reply:        /v2/video/comment/reply/create/
  //   - hide:         comment hide endpoint
  //   - delete:       comment delete endpoint
}
