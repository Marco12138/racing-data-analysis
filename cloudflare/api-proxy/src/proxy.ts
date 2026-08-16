const API_PREFIX = "/api/v1";
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "DELETE", "OPTIONS"]);
const ALLOWED_REQUEST_HEADERS = "Authorization, Content-Type, X-Request-ID";
const EXPOSED_RESPONSE_HEADERS = "Content-Disposition, X-Request-ID";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function parseOrigins(value: string): Set<string> {
  return new Set(
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function parseOriginHostPatterns(value = ""): string[] {
  return value
    .split(",")
    .map((pattern) => pattern.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedOrigin(
  origin: string,
  exactOrigins: Set<string>,
  hostPatterns: string[],
): boolean {
  if (exactOrigins.has(origin)) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  return hostPatterns.some((pattern) => {
    const wildcard = pattern.indexOf("*");
    if (wildcard < 0) return hostname === pattern;
    if (pattern.indexOf("*", wildcard + 1) >= 0) return false;
    const prefix = pattern.slice(0, wildcard);
    const suffix = pattern.slice(wildcard + 1);
    return hostname.length > prefix.length + suffix.length
      && hostname.startsWith(prefix)
      && hostname.endsWith(suffix);
  });
}

export function isApiPath(pathname: string): boolean {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

export function buildUpstreamUrl(requestUrl: string, upstreamOrigin: string): URL {
  const incoming = new URL(requestUrl);
  const upstream = new URL(upstreamOrigin);
  upstream.pathname = incoming.pathname;
  upstream.search = incoming.search;
  upstream.hash = "";
  return upstream;
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers": ALLOWED_REQUEST_HEADERS,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": EXPOSED_RESPONSE_HEADERS,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function jsonError(
  status: number,
  errorCode: string,
  message: string,
  requestId: string,
  origin: string | null,
): Response {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Request-ID", requestId);
  return new Response(JSON.stringify({ status: "error", error_code: errorCode, message, request_id: requestId }), {
    status,
    headers,
  });
}

function logRequest(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ service: "racing-telemetry-api-proxy", ...fields }));
}

export async function handleRequest(
  request: Request,
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<Response> {
  const startedAt = Date.now();
  const requestId = request.headers.get("X-Request-ID") || crypto.randomUUID();
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const allowedOrigins = parseOrigins(env.ALLOWED_ORIGINS);
  const allowedHostPatterns = parseOriginHostPatterns(env.ALLOWED_ORIGIN_HOST_PATTERNS);

  if (!isApiPath(url.pathname)) {
    return jsonError(404, "PROXY_ROUTE_NOT_FOUND", "The requested proxy route does not exist.", requestId, null);
  }
  if (!ALLOWED_METHODS.has(request.method)) {
    return jsonError(405, "PROXY_METHOD_NOT_ALLOWED", "The request method is not allowed.", requestId, null);
  }
  if (origin && !isAllowedOrigin(origin, allowedOrigins, allowedHostPatterns)) {
    return jsonError(403, "PROXY_ORIGIN_NOT_ALLOWED", "The request origin is not allowed.", requestId, null);
  }

  if (request.method === "OPTIONS") {
    if (!origin) {
      return jsonError(400, "PROXY_ORIGIN_REQUIRED", "An Origin header is required for preflight requests.", requestId, null);
    }
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  const maxRequestBytes = Number(env.MAX_REQUEST_BYTES);
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    return jsonError(413, "PROXY_REQUEST_TOO_LARGE", "The request exceeds the proxy upload limit.", requestId, origin);
  }

  const upstreamHeaders = new Headers(request.headers);
  upstreamHeaders.delete("Host");
  upstreamHeaders.delete("Origin");
  upstreamHeaders.delete("Referer");
  upstreamHeaders.set("X-Request-ID", requestId);
  upstreamHeaders.set("X-Forwarded-Proto", "https");

  try {
    const upstreamResponse = await fetcher(buildUpstreamUrl(request.url, env.UPSTREAM_ORIGIN), {
      method: request.method,
      headers: upstreamHeaders,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });
    const responseHeaders = new Headers(upstreamResponse.headers);
    const corsHeaderNames: string[] = [];
    responseHeaders.forEach((_value, name) => {
      if (name.toLowerCase().startsWith("access-control-")) corsHeaderNames.push(name);
    });
    corsHeaderNames.forEach((name) => responseHeaders.delete(name));
    corsHeaders(origin).forEach((value, name) => responseHeaders.set(name, value));
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    responseHeaders.set("X-Request-ID", requestId);

    logRequest({
      request_id: requestId,
      method: request.method,
      path: url.pathname,
      status: upstreamResponse.status,
      duration_ms: Date.now() - startedAt,
    });
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    logRequest({
      request_id: requestId,
      method: request.method,
      path: url.pathname,
      status: 502,
      duration_ms: Date.now() - startedAt,
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonError(502, "PROXY_UPSTREAM_UNAVAILABLE", "The analysis service is temporarily unavailable.", requestId, origin);
  }
}
