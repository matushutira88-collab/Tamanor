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
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  // V1.38.2 — baseline security headers (additive; no behavior change for crawlers).
  async headers() {
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "X-DNS-Prefetch-Control", value: "on" },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
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
