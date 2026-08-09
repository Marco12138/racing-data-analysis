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
      const apiOrigin = runtimeApiOrigin(env);
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

    return handler.fetch(request, env, ctx);
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

export default worker;
