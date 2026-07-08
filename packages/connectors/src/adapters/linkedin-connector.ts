import { Platform } from "@guardora/core";
import { BasePlaceholderConnector } from "../base-connector";

/**
 * LinkedInConnector — LinkedIn Company Page comments.
 *
 * Real implementation will use the LinkedIn Marketing/Community Management APIs
 * (official OAuth). Note: LinkedIn does not support hiding comments via API, so
 * `hide()` correctly reports `unsupported` (see PLATFORM_META).
 *
 * Placeholder only — no API calls yet.
 */
export class LinkedInConnector extends BasePlaceholderConnector {
  readonly platform = Platform.LinkedInCompany;

  // TODO(real): implement via LinkedIn APIs
  //   - syncComments: socialActions/{urn}/comments
  //   - reply:        POST socialActions/{urn}/comments
  //   - delete:       DELETE socialActions/{urn}/comments/{id}
  //   - hide:         not supported by the API -> unsupported
}
