import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const target = process.argv[2];
if (!new Set(["sites", "vercel"]).has(target)) {
  console.error("Usage: node scripts/run-public-build.mjs <sites|vercel>");
  process.exit(2);
}

const railwayOrigin =
  "https://racing-ai-platform-api-production.up.railway.app";
const env = {
  ...process.env,
  NEXT_PUBLIC_API_URL:
    process.env.NEXT_PUBLIC_API_URL || railwayOrigin,
  NEXT_PUBLIC_XRK_UPLOAD_URL:
    process.env.NEXT_PUBLIC_XRK_UPLOAD_URL ||
    `${railwayOrigin}/api/v1/xrk/inspect`,
  NEXT_PUBLIC_API_PREFIX:
    process.env.NEXT_PUBLIC_API_PREFIX || "/api/v1",
  NEXT_PUBLIC_DEPLOYMENT_MODE:
    process.env.NEXT_PUBLIC_DEPLOYMENT_MODE || "public-demo",
  WRANGLER_LOG_PATH:
    process.env.WRANGLER_LOG_PATH || ".wrangler/wrangler.log",
};

if (target === "vercel") env.DEPLOY_TARGET = "vercel";

const executable = resolve(
  "node_modules",
  ".bin",
  target === "vercel" ? "next" : "vinext",
);
const result = spawnSync(executable, ["build"], {
  env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`Public ${target} build failed: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
