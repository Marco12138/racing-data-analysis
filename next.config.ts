import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
