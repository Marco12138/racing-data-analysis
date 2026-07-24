import assert from "node:assert/strict";
import test from "node:test";

import {
  FrontendApiConfigError,
  validateApiOrigin,
} from "../frontend/lib/config.ts";

test("accepts a secure public API origin", () => {
  assert.equal(
    validateApiOrigin("https://backend.example.com/", "https:"),
    "https://backend.example.com"
  );
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
