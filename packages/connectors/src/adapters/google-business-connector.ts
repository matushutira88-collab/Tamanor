import { Platform } from "@guardora/core";
import { BasePlaceholderConnector } from "../base-connector";

/**
 * GoogleBusinessConnector — Google Business Profile reviews.
 *
 * Real implementation will use the Google Business Profile API (official OAuth).
 * Reviews cannot be hidden via API (only replied to or reported), so `hide()`
 * reports `unsupported` (see PLATFORM_META).
 *
 * Placeholder only — no API calls yet.
 */
export class GoogleBusinessConnector extends BasePlaceholderConnector {
  readonly platform = Platform.GoogleBusiness;

  // TODO(real): implement via Google Business Profile API
  //   - syncReviews:  accounts.locations.reviews.list
  //   - reply:        accounts.locations.reviews.updateReply
  //   - delete:       accounts.locations.reviews.deleteReply (reply only)
  //   - hide:         not supported by the API -> unsupported
}
