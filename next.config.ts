import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output is fine for self-hosting; Vercel ignores this and uses its
  // own builder. Keep it on so the same build works in both environments.
  output: "standalone",
  typescript: {
    // We run tsc --noEmit + lint in CI; do NOT silently ignore build errors.
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
