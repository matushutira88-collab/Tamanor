/**
 * CSP POLICY V1 — a typed, canonical Content-Security-Policy builder. It is the single source of truth for the
 * directive set and the allow-listed third-party hosts (Google Analytics/Tag Manager, Meta Pixel, Cloudflare
 * Turnstile). Two modes:
 *   - "enforce": the CURRENTLY-ENFORCED production policy (parity with apps/web/next.config.mjs). It still uses
 *     `'unsafe-inline'` in script-src (Next hydration bootstrap) — this is NOT closed, and is stated honestly.
 *   - "strict-report": a STRICTER candidate for a Report-Only rollout — `'nonce-…' 'strict-dynamic'`, NO
 *     `'unsafe-inline'`, NO `'unsafe-eval'`. Enforcing it requires threading a per-request nonce via middleware
 *     to the inline <Script> components (documented rollout).
 *
 * In BOTH modes production forbids `'unsafe-eval'`, sets `object-src 'none'`, and locks `base-uri`/`form-action`
 * to 'self' and `frame-ancestors` to 'none'. Hosts are EXPLICIT; the only wildcards permitted are the known
 * Google-Analytics measurement subdomains (guarded by a drift test).
 */

export interface CspHosts {
  /** Hosts allowed in script-src (external analytics loaders). */
  analyticsScript: readonly string[];
  /** Hosts allowed in connect-src (analytics beacons/XHR). */
  analyticsConnect: readonly string[];
  /** Cloudflare Turnstile origin (script-src + frame-src). */
  turnstile: readonly string[];
}

export const TAMANOR_CSP_HOSTS: CspHosts = {
  analyticsScript: ["https://www.googletagmanager.com", "https://connect.facebook.net"],
  analyticsConnect: [
    "https://www.googletagmanager.com", "https://www.google-analytics.com",
    "https://*.google-analytics.com", "https://*.analytics.google.com",
    "https://www.facebook.com", "https://connect.facebook.net",
  ],
  turnstile: ["https://challenges.cloudflare.com"],
};

/** The ONLY wildcard hosts allowed anywhere in the policy (Google Analytics measurement subdomains). */
export const ALLOWED_WILDCARD_HOSTS: readonly string[] = [
  "https://*.google-analytics.com", "https://*.analytics.google.com",
];

export interface BuildCspOptions {
  isProd: boolean;
  mode: "enforce" | "strict-report";
  /** Required for "strict-report" — a per-request base64/hex nonce (no quotes/whitespace). */
  nonce?: string;
  hosts?: CspHosts;
}

const NONCE_OK = /^[A-Za-z0-9+/_=-]{8,256}$/;

/** Build the CSP header value for the given mode. Deterministic; never emits `'unsafe-eval'` in production. */
export function buildCsp(opts: BuildCspOptions): string {
  const hosts = opts.hosts ?? TAMANOR_CSP_HOSTS;
  const script = hosts.analyticsScript.join(" ");
  const connect = hosts.analyticsConnect.join(" ");
  const turnstile = hosts.turnstile.join(" ");

  let scriptSrc: string;
  if (opts.mode === "strict-report") {
    if (!opts.nonce || !NONCE_OK.test(opts.nonce)) throw new Error("strict-report mode requires a valid nonce");
    // strict-dynamic: trust scripts loaded by a nonce'd script; keep hosts for non-strict-dynamic browsers.
    scriptSrc = `script-src 'self' 'nonce-${opts.nonce}' 'strict-dynamic' ${script} ${turnstile}`;
  } else {
    scriptSrc = opts.isProd
      ? `script-src 'self' 'unsafe-inline' ${script} ${turnstile}`
      : `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${script} ${turnstile}`;
  }

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    scriptSrc,
    `connect-src 'self' ${connect}`,
    `frame-src 'self' ${turnstile}`,
    ...(opts.isProd ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

/** Parse a CSP string into a directive→value map (for drift/parity tests). */
export function parseCsp(csp: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of csp.split(";").map((p) => p.trim()).filter(Boolean)) {
    const sp = part.indexOf(" ");
    if (sp === -1) out[part] = "";
    else out[part.slice(0, sp)] = part.slice(sp + 1).trim();
  }
  return out;
}

/** Every wildcard (`*`) host referenced anywhere in the policy — used to guard against wildcard drift. */
export function wildcardHosts(csp: string): string[] {
  return (csp.match(/https?:\/\/\*[^\s;]*/g) ?? []).sort();
}
