import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    "@innovateats/auth",
    "@innovateats/config",
    "@innovateats/db",
    "@innovateats/evals",
    "@innovateats/feature-flags",
    "@innovateats/integrations",
    "@innovateats/shared",
    "@innovateats/workflows"
  ],
  experimental: {
    typedEnv: true
  }
};

export default nextConfig;
