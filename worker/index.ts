/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  API_URL?: string;
  API_PREFIX?: string;
  DEPLOYMENT_MODE?: string;
  NEXT_PUBLIC_API_URL?: string;
  NEXT_PUBLIC_API_PREFIX?: string;
  NEXT_PUBLIC_DEPLOYMENT_MODE?: string;
  MAX_REQUEST_BYTES?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/v1" || url.pathname.startsWith("/api/v1/")) {
      return proxyApiRequest(request, env);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    if (url.pathname === "/api/runtime-config") {
      const apiOrigin = url.origin;
      const apiPrefix =
        env.API_PREFIX ??
        env.NEXT_PUBLIC_API_PREFIX ??
        "/api/v1";
      const deploymentMode =
        env.DEPLOYMENT_MODE ??
        env.NEXT_PUBLIC_DEPLOYMENT_MODE ??
        "public-demo";
      return Response.json(
        { apiOrigin, apiPrefix, deploymentMode },
        {
          headers: {
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'none'",
            "X-Content-Type-Options": "nosniff",
          },
        }
      );
    }

    if (url.pathname === "/" && request.method === "GET") {
      const summary = await fetchPublicDemoSummary(env);
      if (summary) {
        const forwardedHeaders = new Headers(request.headers);
        forwardedHeaders.set("x-racing-demo-summary", encodeURIComponent(summary));
        request = new Request(request, { headers: forwardedHeaders });
      }
    }

    if (url.pathname.startsWith("/story/") && request.method === "GET") {
      const storyboard = await fetchPublicStoryboard(env, url.pathname);
      if (storyboard) {
        const forwardedHeaders = new Headers(request.headers);
        forwardedHeaders.set("x-racing-storyboard", encodeURIComponent(storyboard));
        request = new Request(request, { headers: forwardedHeaders });
      }
    }

    const response = await handler.fetch(request, env, ctx);
    if (url.pathname !== "/" || request.method !== "GET") return response;

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Cache-Control", "private, no-store");
    responseHeaders.set("Vary", "Accept-Language, Cookie");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};

function runtimeApiOrigin(env: Env): string {
  const configured = (env.API_URL ?? env.NEXT_PUBLIC_API_URL ?? "").trim();
  if (!configured) return "";
  try {
    const parsed = new URL(configured);
    const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" || loopback) return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

async function proxyApiRequest(request: Request, env: Env): Promise<Response> {
  const requestId = request.headers.get("X-Request-ID") || crypto.randomUUID();
  const origin = runtimeApiOrigin(env);
  if (!origin) {
    return proxyError(503, "PROXY_UPSTREAM_NOT_CONFIGURED", "The analysis service is not configured.", requestId);
  }
  if (!["GET", "HEAD", "POST", "DELETE", "OPTIONS"].includes(request.method)) {
    return proxyError(405, "PROXY_METHOD_NOT_ALLOWED", "The request method is not allowed.", requestId);
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  const maxRequestBytes = Number(env.MAX_REQUEST_BYTES || 52_428_800);
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    return proxyError(413, "PROXY_REQUEST_TOO_LARGE", "The request exceeds the proxy upload limit.", requestId);
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, origin);
  const headers = new Headers(request.headers);
  headers.delete("Host");
  headers.delete("Origin");
  headers.delete("Referer");
  headers.set("X-Request-ID", requestId);
  headers.set("X-Forwarded-Proto", "https");

  try {
    const response = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    responseHeaders.set("X-Request-ID", requestId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch {
    return proxyError(502, "PROXY_UPSTREAM_UNAVAILABLE", "The analysis service is temporarily unavailable.", requestId);
  }
}

function proxyError(status: number, errorCode: string, message: string, requestId: string): Response {
  return Response.json(
    { status: "error", error_code: errorCode, message, request_id: requestId },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Request-ID": requestId,
      },
    },
  );
}

async function fetchPublicDemoSummary(env: Env): Promise<string | null> {
  const origin = runtimeApiOrigin(env);
  if (!origin) return null;
  const prefix = (env.API_PREFIX ?? env.NEXT_PUBLIC_API_PREFIX ?? "/api/v1").replace(/\/+$/, "");
  try {
    const response = await fetch(`${origin}${prefix}/xrk/demo-session`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const text = await response.text();
    return text.length <= 48_000 ? text : null;
  } catch {
    return null;
  }
}

async function fetchPublicStoryboard(
  env: Env,
  pathname: string,
): Promise<string | null> {
  const token = pathname.replace(/^\/story\//, "");
  const origin = runtimeApiOrigin(env);
  if (!origin) return null;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const prefix = (env.API_PREFIX ?? env.NEXT_PUBLIC_API_PREFIX ?? "/api/v1").replace(/\/+$/, "");
  try {
    const response = await fetch(`${origin}${prefix}/storyboards/${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const text = await response.text();
    return text.length <= 250_000 ? text : null;
  } catch {
    return null;
  }
}

export default worker;
