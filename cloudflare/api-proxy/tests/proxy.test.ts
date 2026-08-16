import assert from "node:assert/strict";
import test from "node:test";

import { buildUpstreamUrl, handleRequest, isAllowedOrigin, isApiPath } from "../src/proxy.ts";

const env = {
  UPSTREAM_ORIGIN: "https://railway.example",
  ALLOWED_ORIGINS: "https://frontend.example",
  ALLOWED_ORIGIN_HOST_PATTERNS: "ai-racing-telemetry-platform-*.vercel.app",
  MAX_REQUEST_BYTES: "52428800",
} as Env;

test("only the fixed API prefix is accepted", () => {
  assert.equal(isApiPath("/api/v1/health"), true);
  assert.equal(isApiPath("/api/v10/health"), false);
  assert.equal(isApiPath("/health"), false);
});

test("upstream origin is fixed while path and query are preserved", () => {
  const url = buildUpstreamUrl("https://proxy.example/api/v1/health?detail=1", env.UPSTREAM_ORIGIN);
  assert.equal(url.toString(), "https://railway.example/api/v1/health?detail=1");
});

test("only project-scoped HTTPS Vercel preview origins match the wildcard", () => {
  const exact = new Set(["https://frontend.example"]);
  const patterns = ["ai-racing-telemetry-platform-*.vercel.app"];
  assert.equal(isAllowedOrigin("https://frontend.example", exact, patterns), true);
  assert.equal(
    isAllowedOrigin(
      "https://ai-racing-telemetry-platform-git-fix-marco12138s-projects.vercel.app",
      exact,
      patterns,
    ),
    true,
  );
  assert.equal(isAllowedOrigin("https://attacker.vercel.app", exact, patterns), false);
  assert.equal(
    isAllowedOrigin("https://ai-racing-telemetry-platform-.vercel.app", exact, patterns),
    false,
  );
  assert.equal(
    isAllowedOrigin("https://ai-racing-telemetry-platform-test.vercel.app/path", exact, patterns),
    false,
  );
  assert.equal(
    isAllowedOrigin("http://ai-racing-telemetry-platform-test.vercel.app", exact, patterns),
    false,
  );
});

test("allowed requests stream their body and receive exact-origin CORS", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("xrk-bytes"));
      controller.close();
    },
  });
  const request = new Request("https://proxy.example/api/v1/xrk/inspect", {
    method: "POST",
    headers: { Origin: "https://frontend.example", "Content-Type": "application/octet-stream" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  let forwardedBody: BodyInit | null | undefined;
  const response = await handleRequest(request, env, async (_input, init) => {
    forwardedBody = init?.body;
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  assert.equal(forwardedBody, request.body);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://frontend.example");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("unknown origins and oversized uploads are rejected before forwarding", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return new Response();
  };
  const forbidden = await handleRequest(
    new Request("https://proxy.example/api/v1/health", { headers: { Origin: "https://attacker.example" } }),
    env,
    fetcher,
  );
  const oversized = await handleRequest(
    new Request("https://proxy.example/api/v1/xrk/inspect", {
      method: "POST",
      headers: { Origin: "https://frontend.example", "Content-Length": "52428801" },
    }),
    env,
    fetcher,
  );

  assert.equal(forbidden.status, 403);
  assert.equal(oversized.status, 413);
  assert.equal(calls, 0);
});

test("upstream failures return a public structured error", async () => {
  const response = await handleRequest(
    new Request("https://proxy.example/api/v1/health", { headers: { Origin: "https://frontend.example" } }),
    env,
    async () => {
      throw new Error("private upstream detail");
    },
  );
  const payload = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 502);
  assert.equal(payload.error_code, "PROXY_UPSTREAM_UNAVAILABLE");
  assert.equal(JSON.stringify(payload).includes("private upstream detail"), false);
});
