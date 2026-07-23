import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html", host: "localhost" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the racing analysis workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /AI Racing Telemetry Analysis/);
  assert.match(html, /Local Video Analysis/);
  assert.match(html, /Lap &amp; Sector Analysis/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("keeps real video analysis separate from explicit demo data", async () => {
  const [dashboard, videoApi, layout, packageJson] = await Promise.all([
    readFile(new URL("../frontend/components/RacingDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../frontend/lib/videoApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /normalizeLapRows\(\[\]\)/);
  assert.match(dashboard, /loadDemoData/);
  assert.match(dashboard, /当前为视频独立分析模式/);
  assert.match(videoApi, /127\.0\.0\.1:8000/);
  assert.match(videoApi, /\/api\/video\/jobs/);
  assert.match(layout, /og\.png/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
