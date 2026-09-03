/**
 * Safe hand-off to the Tamanor web connection manager.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS INSTEAD OF NATIVE OAUTH.
 *
 * The web Meta and Google Business OAuth flows are BROWSER-COOKIE based: their
 * connector `start` routes call `getSession()` (a cookie read) and stash the
 * CSRF `state` in an httpOnly cookie that the matching `/callback` route verifies.
 * A mobile bearer cannot participate in that: the phone holds an opaque session
 * token, not a cookie, and the only ways to bridge it — putting the bearer in the
 * URL, in the OAuth `state`, or behind a special mobile header — are all exactly
 * the credential-leak shapes M6 forbids.
 *
 * So M6 does NOT fake a native handshake. It opens the Tamanor web account manager
 * in the system browser, where the user authenticates normally. That may mean
 * logging in again; that is truthful and is what the UI says.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * SECURITY RULES ENFORCED HERE:
 *   - the origin is derived from the CONFIGURED API base URL — never from an API
 *     response, a deep link, or anything the server could later be tricked into
 *     returning
 *   - only a fixed allowlist of internal Tamanor paths may be opened
 *   - production must be HTTPS; plain http is permitted only for a dev-mode
 *     loopback/private-range host, matching `resolveApiBaseUrl`
 *   - NOTHING is ever appended: no bearer, no session token, no user id, no tenant
 *     id, no provider token, no secret, no query string at all
 *
 * This module is pure URL construction. Opening is a separate, explicitly-checked
 * step so the whole rule set is testable without a device.
 */

// Relative, not aliased: this module is exercised directly by the test harness,
// which runs plain `tsx` without the bundler's path aliases.
import { apiBaseUrl } from "../api/config";

/**
 * The only destinations mobile may open.
 *
 * `connect` is the accounts manager where a new connection is started; `manage` is
 * one account's page, where a reconnect is performed. Both are ordinary Tamanor
 * dashboard routes — neither is an OAuth endpoint, so no provider URL is ever
 * constructed on the device.
 */
export const HANDOFF_TARGETS = ["connect", "manage"] as const;
export type HandoffTarget = (typeof HANDOFF_TARGETS)[number];

/** Fixed internal paths. There is no template that could accept arbitrary input. */
const ACCOUNTS_PATH = "/dashboard/accounts";

export type HandoffRejection = "config" | "insecure" | "invalid_target" | "invalid_account";

export type HandoffResolution =
  | { ok: true; url: string }
  | { ok: false; reason: HandoffRejection };

/** An account id must be a plain opaque identifier before it can join a path. */
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Build the web-handoff URL for a target.
 *
 * Pure and injectable: `baseUrl` defaults to the configured API base so production
 * callers cannot pass an arbitrary origin, while tests can drive every branch.
 */
export function resolveHandoffUrl(
  target: HandoffTarget,
  accountId?: string | null,
  options?: { baseUrl?: string; dev?: boolean },
): HandoffResolution {
  if (!(HANDOFF_TARGETS as readonly string[]).includes(target)) {
    return { ok: false, reason: "invalid_target" };
  }

  let base = options?.baseUrl;
  if (base === undefined) {
    const resolved = apiBaseUrl();
    if (!resolved.ok) return { ok: false, reason: "config" };
    base = resolved.baseUrl;
  }

  let origin: URL;
  try {
    origin = new URL(base);
  } catch {
    return { ok: false, reason: "config" };
  }

  const dev = options?.dev ?? (typeof __DEV__ !== "undefined" && __DEV__);
  if (origin.protocol !== "https:" && origin.protocol !== "http:") {
    return { ok: false, reason: "config" };
  }
  // Production MUST be HTTPS. The one exception mirrors `resolveApiBaseUrl`: a dev
  // build talking to a loopback / private-range dev server.
  if (origin.protocol === "http:" && !(dev && isLocalHost(origin.hostname))) {
    return { ok: false, reason: "insecure" };
  }

  let path = ACCOUNTS_PATH;
  if (target === "manage") {
    const id = accountId?.trim();
    // A id that is not a plain opaque token cannot be pasted into a path — this is
    // what stops a crafted value from becoming a second path segment or a query.
    if (!id || !ACCOUNT_ID_PATTERN.test(id)) return { ok: false, reason: "invalid_account" };
    path = `${ACCOUNTS_PATH}/${id}`;
  }

  // Built from origin + a fixed path ONLY. No search params, no fragment, nothing
  // carried over from the API base's own path or query.
  const url = new URL(path, `${origin.protocol}//${origin.host}`);
  return { ok: true, url: url.toString() };
}

/** Loopback or RFC1918 private ranges — the only hosts allowed to be plain http. */
function isLocalHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]") return true;
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  return false;
}

/**
 * Final guard applied immediately before opening, so a URL can never be opened
 * without having passed the same checks a second time.
 *
 * Deliberately strict: it re-parses the string, re-checks the scheme, and rejects
 * anything carrying a query or fragment — the two places a credential could hide.
 */
export function isOpenableHandoffUrl(url: string, options?: { dev?: boolean }): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const dev = options?.dev ?? (typeof __DEV__ !== "undefined" && __DEV__);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (parsed.protocol === "http:" && !(dev && isLocalHost(parsed.hostname))) return false;
  // No credential may travel, and a query string is the classic place one would.
  if (parsed.search !== "" || parsed.hash !== "") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  return parsed.pathname === ACCOUNTS_PATH || parsed.pathname.startsWith(`${ACCOUNTS_PATH}/`);
}
