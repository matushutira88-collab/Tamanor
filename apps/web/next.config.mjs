/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // V1.42B — allow an isolated build dir (default `.next`). The E2E gate builds/serves into
  // `.next-e2e` so a concurrent `next dev` server (which writes DEV manifests into `.next`)
  // can never corrupt the production browser build. No effect on normal dev/build/deploy.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: [
    "@guardora/core",
    "@guardora/ai",
    "@guardora/config",
    "@guardora/connectors",
    "@guardora/db",
    "@guardora/sync",
  ],
  serverExternalPackages: ["@prisma/client", ".prisma/client", "@node-rs/argon2"],
  // V1.50A — @node-rs/argon2 is a native (.node) addon reached through the transpiled
  // @guardora/db package, so `serverExternalPackages` alone doesn't externalize it.
  // Keep it OUT of the webpack bundle on the server (required at runtime by Node); it is
  // never in the client graph (password hashing is server-only).
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals ?? []), { "@node-rs/argon2": "commonjs @node-rs/argon2" }];
    }
    return config;
  },
  // V1.38.2 / V1.48P — baseline security headers + production Content-Security-Policy.
  async headers() {
    // V1.48P — production CSP. Materially restrictive (no object/eval, framing denied, base-uri &
    // form-action locked to self, mixed content upgraded), while remaining FUNCTIONAL for Next.js:
    // 'unsafe-inline' is required for Next's hydration bootstrap + styled inline until a nonce-based
    // strict-dynamic policy (via middleware) is adopted — that is the documented follow-up hardening.
    // NO 'unsafe-eval'. `connect-src` is 'self' (the app only calls its own same-origin API).
    //
    // DEV EXCEPTION: `upgrade-insecure-requests` and HSTS are PRODUCTION-ONLY. On http://localhost
    // they force browsers (Safari especially — it has no localhost exemption) to fetch all
    // /_next/* assets over https://localhost, where no TLS exists → every stylesheet and script
    // fails with a TLS error and the page renders unstyled. Dev additionally needs 'unsafe-eval'
    // for React Refresh / HMR eval'd source maps.
    const isProd = process.env.NODE_ENV === "production";
    // V1.53 — analytics provider origins. Consent-gated + env-gated at runtime (nothing loads until
    // an id is configured in production and the visitor consents), but the static CSP must allowlist
    // the script/connect hosts so GA4 (googletagmanager + google-analytics), Google Ads (same gtag.js)
    // and the Meta Pixel (connect.facebook.net + facebook.com) can load when enabled. Image beacons
    // are already covered by `img-src https:`. No third-party frames or eval are permitted.
    const analyticsScript = "https://www.googletagmanager.com https://connect.facebook.net";
    const analyticsConnect =
      "https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.facebook.com https://connect.facebook.net";
    // V1.58.9 — Cloudflare Turnstile (bot verification). Its api.js loads from this origin AND the
    // challenge renders in an iframe served from it, so the origin MUST be allowlisted in BOTH
    // `script-src` and `frame-src` — otherwise the CSP blocks the widget, no token is produced, and
    // every login/registration is rejected server-side as a failed bot challenge.
    // Ref: https://developers.cloudflare.com/turnstile/reference/content-security-policy/
    const turnstile = "https://challenges.cloudflare.com";
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      isProd
        ? `script-src 'self' 'unsafe-inline' ${analyticsScript} ${turnstile}`
        : `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${analyticsScript} ${turnstile}`,
      `connect-src 'self' ${analyticsConnect}`,
      `frame-src 'self' ${turnstile}`,
      ...(isProd ? ["upgrade-insecure-requests"] : []),
    ].join("; ");
    const security = [
      { key: "Content-Security-Policy", value: csp },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // V1.51 — align legacy XFO with CSP `frame-ancestors 'none'` (the app never frames itself).
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-DNS-Prefetch-Control", value: "on" },
      // HSTS only in production — sending it on localhost poisons the browser's HSTS cache
      // and forces https://localhost even after the header is removed.
      ...(isProd
        ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
        : []),
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    return [{ source: "/:path*", headers: security }];
  },
  // V1.38.3 — canonical-host redirects. Path-preserving, permanent. These fire ONLY when
  // the named host actually routes to this deployment, so they are safe no-ops otherwise
  // and cannot create a loop (source host always differs from the apex destination host).
  async redirects() {
    const toApex = (host) => ({
      source: "/:path*",
      has: [{ type: "host", value: host }],
      destination: "https://tamanor.com/:path*",
      permanent: true,
    });
    return [
      toApex("www.tamanor.com"),
      // Legacy brand domain → Tamanor, preserving path (only if guardora.ai points here).
      toApex("guardora.ai"),
      toApex("www.guardora.ai"),
    ];
  },
};

export default nextConfig;
