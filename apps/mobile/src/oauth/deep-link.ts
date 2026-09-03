/**
 * The OAuth completion deep link — parsed, and then deliberately distrusted.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS IS A DOORBELL, NOT A VERDICT.
 *
 * Any app on the device can send `tamanor://oauth/callback?...`. So this module
 * extracts exactly ONE thing — a correlation id — and provides no way to express
 * an outcome. There is no `success` field to read, no status, no account id and no
 * error, because a parser that could return them would eventually be trusted.
 *
 * The only legitimate use of the result is: "ask the authenticated status endpoint
 * about this flow id, and believe only that."
 *
 * The flow id itself is not a capability either: the status endpoint checks that
 * the flow belongs to the current user, tenant AND login session, so a guessed or
 * stolen id returns `not_found`.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The app's scheme, matching `expo.scheme` in app.json and the server's redirect. */
export const OAUTH_SCHEME = "tamanor";
/** The one path that means "an OAuth browser session returned". */
export const OAUTH_CALLBACK_PATH = "oauth/callback";

/** A flow id is a cuid — a plain opaque token, never a URL or a path. */
const FLOW_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type DeepLinkParse =
  /** A well-formed callback. `flowId` is a CORRELATION ID — not proof of anything. */
  | { kind: "oauth_callback"; flowId: string }
  /** Not our callback, or malformed. The app must do nothing. */
  | { kind: "ignored" };

/**
 * Parse an incoming deep link.
 *
 * Everything except the scheme, the exact path and a well-formed `flow` is ignored.
 * Note what is NOT returned even when present in the URL: any `success`, `status`,
 * `error`, `code`, `state`, `token` or account parameter is dropped on the floor —
 * a spoofed link therefore cannot carry a claim into the app at all.
 */
export function parseOAuthDeepLink(url: string | null | undefined): DeepLinkParse {
  if (!url) return { kind: "ignored" };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "ignored" };
  }

  // `new URL("tamanor://oauth/callback?flow=x")` puts `oauth` in `host` and
  // `/callback` in `pathname`, so both halves are normalized before comparison.
  if (parsed.protocol !== `${OAUTH_SCHEME}:`) return { kind: "ignored" };
  const path = `${parsed.host}${parsed.pathname}`.replace(/^\/+|\/+$/g, "");
  if (path !== OAUTH_CALLBACK_PATH) return { kind: "ignored" };

  const flowId = parsed.searchParams.get("flow")?.trim() ?? "";
  if (!FLOW_ID_PATTERN.test(flowId)) return { kind: "ignored" };

  // ONLY the id. Any other parameter is discarded, by construction.
  return { kind: "oauth_callback", flowId };
}
