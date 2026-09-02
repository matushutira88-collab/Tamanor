/**
 * API base URL resolution.
 *
 * The base URL is NON-SECRET configuration, so it travels as `EXPO_PUBLIC_*` and is
 * inlined into the bundle at build time. Nothing secret may ever live in an
 * `EXPO_PUBLIC_` variable — no database URL, server secret, OAuth client secret,
 * encryption key, Turnstile secret or session secret. The app holds none of those.
 *
 * This is why `app.config.ts` was NOT introduced: Expo already inlines
 * `EXPO_PUBLIC_*` from the environment and `.env`, so a dynamic config would add a
 * moving part without enabling anything.
 */

export const API_URL_ENV_VAR = "EXPO_PUBLIC_TAMANOR_API_URL";

export type ApiUrlRejection = "missing" | "malformed" | "insecure";

export type ApiUrlResolution =
  | { ok: true; baseUrl: string }
  | { ok: false; reason: ApiUrlRejection };

/**
 * Validate and normalize a configured API base URL. Pure, so it is directly
 * testable and has no dependency on the bundler's env inlining.
 *
 * Rules:
 *   - must be present and parseable
 *   - must be http or https
 *   - must be HTTPS unless this is a development build, where plain http to a
 *     loopback / private-range dev server is the normal case
 *   - a trailing slash is trimmed so callers can always join with a leading slash
 */
export function resolveApiBaseUrl(raw: string | undefined, opts: { dev: boolean }): ApiUrlResolution {
  const value = raw?.trim();
  if (!value) return { ok: false, reason: "missing" };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "malformed" };
  if (url.protocol === "http:" && !(opts.dev && isLocalHost(url.hostname))) {
    return { ok: false, reason: "insecure" };
  }

  return { ok: true, baseUrl: value.replace(/\/+$/, "") };
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
 * The configured base URL for this build, or a rejection.
 *
 * `process.env.EXPO_PUBLIC_TAMANOR_API_URL` must be referenced as a full static
 * member expression — Expo's bundler rewrites that exact text at build time and
 * cannot see a dynamic lookup.
 */
export function apiBaseUrl(): ApiUrlResolution {
  return resolveApiBaseUrl(process.env.EXPO_PUBLIC_TAMANOR_API_URL, {
    dev: typeof __DEV__ !== "undefined" && __DEV__,
  });
}

/** A human-readable, non-technical explanation for a misconfigured build. */
export function describeApiUrlRejection(reason: ApiUrlRejection): string {
  switch (reason) {
    case "missing":
      return `Tamanor is not configured: ${API_URL_ENV_VAR} is not set.`;
    case "malformed":
      return `Tamanor is not configured: ${API_URL_ENV_VAR} is not a valid URL.`;
    case "insecure":
      return `Tamanor is not configured: ${API_URL_ENV_VAR} must use HTTPS.`;
  }
}
