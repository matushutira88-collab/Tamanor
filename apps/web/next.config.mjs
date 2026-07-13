/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
};

export default nextConfig;
