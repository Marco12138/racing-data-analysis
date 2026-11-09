import assert from "node:assert/strict";
import test from "node:test";

import {
  FrontendApiConfigError,
  resolveApiConfig,
  resetApiConfigForTests,
  validateApiOrigin,
} from "../frontend/lib/config.ts";

test("a stalled runtime-config lookup releases the readiness check to the validated fallback", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { hostname: "localhost", protocol: "http:" } } });
  t.after(() => {
    resetApiConfigForTests();
    if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window;
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
  }));
  const pending = resolveApiConfig();
  t.mock.timers.tick(8000);
  const config = await pending;
  assert.ok(["local", "build"].includes(config.source));
});

test("accepts a secure public API origin", () => {
  assert.equal(
    validateApiOrigin("https://backend.example.com/", "https:"),
    "https://backend.example.com"
  );
});

test("rechecking can recover from an invalid address without accepting it", async t => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { hostname: "frontend.example", protocol: "https:" } } });
  t.after(() => {
    resetApiConfigForTests();
    if (prior) Object.defineProperty(globalThis, "window", prior); else delete globalThis.window;
  });
  let address = "http://localhost:8000";
  t.mock.method(globalThis, "fetch", async () => Response.json({ apiOrigin: address, xrkUploadUrl: address + "/api/v1/xrk/inspect" }));
  await assert.rejects(resolveApiConfig(), FrontendApiConfigError);
  address = "https://backend.example";
  assert.equal((await resolveApiConfig()).apiOrigin, address);
});

test("rejects loopback APIs on a public HTTPS page", () => {
  for (const origin of [
    "http://localhost:8000",
    `http://${["127", "0", "0", "1"].join(".")}:8000`,
  ]) {
    assert.throws(
      () => validateApiOrigin(origin, "https:"),
      (error) =>
        error instanceof FrontendApiConfigError &&
        error.code === "XRK_FRONTEND_API_MISCONFIGURED"
    );
  }
});

test("rejects an insecure remote API on a public HTTPS page", () => {
  assert.throws(
    () => validateApiOrigin("http://backend.example.com", "https:"),
    FrontendApiConfigError
  );
});

test("allows a local HTTP API during local development", () => {
  assert.equal(
    validateApiOrigin("http://localhost:8000", "http:"),
    "http://localhost:8000"
  );
});
