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
};

export default nextConfig;
