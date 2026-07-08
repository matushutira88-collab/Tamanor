import { Platform } from "@guardora/core";
import { BasePlaceholderConnector } from "../base-connector";

/**
 * YouTubeConnector — YouTube channel comments.
 *
 * Real implementation will use the YouTube Data API v3 (official OAuth).
 * Placeholder only — no API calls yet.
 */
export class YouTubeConnector extends BasePlaceholderConnector {
  readonly platform = Platform.YouTube;

  // TODO(real): implement via YouTube Data API v3
  //   - syncComments: commentThreads.list / comments.list
  //   - reply:        comments.insert (parentId)
  //   - hide:         comments.setModerationStatus (heldForReview / rejected)
  //   - delete:       comments.delete
}
