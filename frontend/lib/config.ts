function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizePrefix(value: string): string {
  const cleaned = value.trim();
  if (!cleaned) return "";
  return `/${cleaned.replace(/^\/+|\/+$/g, "")}`;
}

export const frontendConfig = {
  apiOrigin: trimTrailingSlash(
    process.env.NEXT_PUBLIC_API_URL ??
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      "http://127.0.0.1:8000"
  ),
  apiPrefix: normalizePrefix(process.env.NEXT_PUBLIC_API_PREFIX ?? "/api/v1"),
  deploymentMode:
    process.env.NEXT_PUBLIC_DEPLOYMENT_MODE ??
    (process.env.NODE_ENV === "production" ? "public-demo" : "local"),
};

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${frontendConfig.apiOrigin}${frontendConfig.apiPrefix}${normalizedPath}`;
}
