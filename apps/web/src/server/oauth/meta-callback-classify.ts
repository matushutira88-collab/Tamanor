/**
 * V1.58.3 — pure classification of a Meta connect failure into a user-facing reason. Extracted from
 * the callback route so it is unit-testable. NEVER claims a missing permission unless `/me/permissions`
 * SUCCEEDED and actually shows `pages_show_list` as not-granted — a generic Graph API error (e.g. the
 * "requires appsecret_proof" GraphMethodException, code 100) must surface as `meta_api_error`, not as a
 * false "you declined the Pages permission".
 */
export type MetaConnectReason =
  | "missing_permission"
  | "meta_api_error"
  | "token_exchange_failed"
  | "no_pages";

/** Whether `/me/permissions` succeeded AND `pages_show_list` is confirmed not granted. */
function confirmedMissingPagesShowList(permsOk: boolean, hasPagesShowList: boolean): boolean {
  return permsOk && !hasPagesShowList;
}

/**
 * Reason when `/me/accounts` THREW a Graph error (classified `kind` from MetaGraphError).
 * - `permission`  → Graph explicitly denied access → missing_permission.
 * - `token_expired` → the user token is invalid → token_exchange_failed.
 * - otherwise → missing_permission ONLY if /me/permissions confirms pages_show_list is missing;
 *   every other error (incl. the appsecret_proof GraphMethodException) → meta_api_error.
 */
export function classifyMetaDiscoveryError(
  kind: string,
  permsOk: boolean,
  hasPagesShowList: boolean,
): MetaConnectReason {
  if (kind === "permission") return "missing_permission";
  if (kind === "token_expired") return "token_exchange_failed";
  if (confirmedMissingPagesShowList(permsOk, hasPagesShowList)) return "missing_permission";
  return "meta_api_error";
}

/**
 * Reason when `/me/accounts` returned an EMPTY list (HTTP 200). An empty result is a genuine
 * "no Pages" unless `/me/permissions` confirms `pages_show_list` was declined/absent.
 */
export function classifyMetaEmptyPages(permsOk: boolean, hasPagesShowList: boolean): MetaConnectReason {
  return confirmedMissingPagesShowList(permsOk, hasPagesShowList) ? "missing_permission" : "no_pages";
}
