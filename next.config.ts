import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.LOCAL_NEXT_DIST_DIR ?? ".next",
  output: "standalone",
  poweredByHeader: false,
  typescript: {
    tsconfigPath:
      process.env.DEPLOY_TARGET === "vercel" || process.env.VERCEL
        ? "./tsconfig.vercel.json"
        : "./tsconfig.json",
  },
};

export default nextConfig;
