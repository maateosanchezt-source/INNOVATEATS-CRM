import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    "@innovateats/auth",
    "@innovateats/config",
    "@innovateats/db",
    "@innovateats/feature-flags",
    "@innovateats/shared"
  ],
  experimental: {
    typedEnv: true
  }
};

export default nextConfig;
