function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizePrefix(value: string): string {
  const cleaned = value.trim();
  if (!cleaned) return "";
  return `/${cleaned.replace(/^\/+|\/+$/g, "")}`;
}

export type ResolvedApiConfig = {
  apiOrigin: string;
  apiPrefix: string;
  deploymentMode: string;
  source: "runtime" | "build" | "local";
};

type RuntimeConfigResponse = {
  apiOrigin?: string;
  apiPrefix?: string;
  deploymentMode?: string;
};

export class FrontendApiConfigError extends Error {
  readonly code = "XRK_FRONTEND_API_MISCONFIGURED";

  constructor(message: string) {
    super(message);
    this.name = "FrontendApiConfigError";
  }
}

const buildApiOrigin = trimTrailingSlash(
  process.env.NEXT_PUBLIC_API_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    ""
);
const buildApiPrefix = normalizePrefix(
  process.env.NEXT_PUBLIC_API_PREFIX ?? "/api/v1"
);
const buildDeploymentMode =
  process.env.NEXT_PUBLIC_DEPLOYMENT_MODE ??
  (process.env.NODE_ENV === "production" ? "public-demo" : "local");

export const frontendConfig = {
  apiOrigin: buildApiOrigin,
  apiPrefix: buildApiPrefix,
  deploymentMode: buildDeploymentMode,
};

let apiConfigPromise: Promise<ResolvedApiConfig> | null = null;

export function resolveApiConfig(): Promise<ResolvedApiConfig> {
  if (!apiConfigPromise) {
    apiConfigPromise = resolveApiConfigUncached();
  }
  return apiConfigPromise;
}

export async function resolveApiUrl(path: string): Promise<string> {
  const config = await resolveApiConfig();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${config.apiOrigin}${config.apiPrefix}${normalizedPath}`;
}

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const origin = buildApiOrigin || localApiOrigin();
  if (!origin) {
    throw new FrontendApiConfigError(
      "The public API address is not configured for this deployment."
    );
  }
  return `${origin}${buildApiPrefix}${normalizedPath}`;
}

export function validateApiOrigin(
  rawOrigin: string,
  pageProtocol = typeof window === "undefined" ? "" : window.location.protocol
): string {
  let parsed: URL;
  try {
    parsed = new URL(rawOrigin);
  } catch {
    throw new FrontendApiConfigError("The configured public API address is invalid.");
  }
  const loopback = isLoopbackHost(parsed.hostname);
  if (pageProtocol === "https:" && (parsed.protocol !== "https:" || loopback)) {
    throw new FrontendApiConfigError(
      "The public site is not connected to a secure public API."
    );
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new FrontendApiConfigError("The configured API protocol is not supported.");
  }
  return trimTrailingSlash(parsed.origin);
}

async function resolveApiConfigUncached(): Promise<ResolvedApiConfig> {
  if (typeof window !== "undefined") {
    const runtime = await fetchRuntimeConfig();
    if (runtime?.apiOrigin) {
      return {
        apiOrigin: validateApiOrigin(runtime.apiOrigin),
        apiPrefix: normalizePrefix(runtime.apiPrefix ?? buildApiPrefix),
        deploymentMode: runtime.deploymentMode ?? buildDeploymentMode,
        source: "runtime",
      };
    }
  }

  if (buildApiOrigin) {
    return {
      apiOrigin: validateApiOrigin(buildApiOrigin),
      apiPrefix: buildApiPrefix,
      deploymentMode: buildDeploymentMode,
      source: "build",
    };
  }

  const localOrigin = localApiOrigin();
  if (localOrigin) {
    return {
      apiOrigin: validateApiOrigin(localOrigin),
      apiPrefix: buildApiPrefix,
      deploymentMode: "local",
      source: "local",
    };
  }

  throw new FrontendApiConfigError(
    "The public API address is missing. XRK uploads are disabled until deployment configuration is fixed."
  );
}

async function fetchRuntimeConfig(): Promise<RuntimeConfigResponse | null> {
  try {
    const response = await fetch("/api/runtime-config", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return (await response.json()) as RuntimeConfigResponse;
  } catch {
    return null;
  }
}

function localApiOrigin(): string {
  if (typeof window === "undefined" || !isLoopbackHost(window.location.hostname)) {
    return "";
  }
  return `http://${window.location.hostname}:${8000}`;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === ["127", "0", "0", "1"].join(".")
  );
}

export function resetApiConfigForTests(): void {
  apiConfigPromise = null;
}
