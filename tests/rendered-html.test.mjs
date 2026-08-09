import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html", host: "localhost" } }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the public racing analysis demo", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /AI Racing Telemetry Analysis Platform/);
  assert.match(html, /Try Demo/);
  assert.match(html, /Telemetry Analysis/);
  assert.match(html, /Lap &amp; Sector Analysis/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("server-renders verified sample metrics injected by the Sites worker", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://backend.example/api/v1/xrk/demo-session") {
      return new Response(JSON.stringify(sampleSummary()), {
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };
  try {
    const response = await render({
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      API_URL: "https://backend.example",
      API_PREFIX: "/api/v1",
    });
    const html = await response.text();
    assert.match(html, /40\.326s/);
    assert.match(html, /Anonymized sample XRK session/);
    assert.match(html, /GPS track/);
    assert.match(html, /Sector loss overview/);
    assert.match(html, /Structured fallback/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("serves the Sites API origin from Worker runtime configuration", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("runtime-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("https://frontend.example/api/runtime-config"),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      API_URL: "https://backend.example/",
      API_PREFIX: "/api/v1",
      DEPLOYMENT_MODE: "public-demo",
    },
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    apiOrigin: "https://backend.example",
    apiPrefix: "/api/v1",
    deploymentMode: "public-demo",
  });
});

test("keeps public imports, browser video preview, and runtime API routing explicit", async () => {
  const [
    publicPage,
    publicClient,
    dashboard,
    inspectionWorkspace,
    aimImportApi,
    xrkAnalysisApi,
    videoApi,
    frontendConfig,
    worker,
    layout,
    packageJson,
  ] = await Promise.all([
    readFile(new URL("../frontend/components/PublicDemoPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../frontend/components/PublicDemoClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../frontend/components/RacingDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../frontend/components/XrkInspectionWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../frontend/lib/aimImportApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../frontend/lib/xrkAnalysisApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../frontend/lib/videoApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../frontend/lib/config.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /normalizeLapRows\(\[\]\)/);
  assert.match(dashboard, /loadDemoData/);
  assert.match(dashboard, /BrowserVideoUpload/);
  assert.match(dashboard, /canvas\.toDataURL/);
  assert.match(dashboard, /Telemetry channel unavailable/);
  assert.match(dashboard, /XRK Server Import/);
  assert.match(dashboard, /Virtual sectors/);
  assert.match(inspectionWorkspace, /Continue to Analysis/);
  assert.match(inspectionWorkspace, /Available channels/);
  assert.match(aimImportApi, /\/imports\/aim/);
  assert.match(aimImportApi, /FormData/);
  assert.match(xrkAnalysisApi, /resolveApiUrl/);
  assert.match(xrkAnalysisApi, /XRK_FRONTEND_API_MISCONFIGURED|FrontendApiConfigError/);
  assert.match(dashboard, /当前为视频独立分析模式/);
  assert.match(publicPage, /loadServerPublicDemo/);
  assert.match(publicClient, /Try Demo with sample XRK session/);
  assert.match(publicClient, /Upload Data/);
  assert.doesNotMatch(frontendConfig, /http:\/\/127\.0\.0\.1:8000/);
  assert.match(frontendConfig, /\/api\/runtime-config/);
  assert.match(frontendConfig, /XRK_FRONTEND_API_MISCONFIGURED/);
  assert.match(worker, /\/api\/runtime-config/);
  assert.match(worker, /API_URL/);
  assert.match(frontendConfig, /\/api\/v1/);
  assert.match(frontendConfig, /public-demo/);
  assert.match(videoApi, /\/video\/jobs/);
  assert.match(layout, /og\.png/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

function sampleSummary() {
  return {
    schema_version: 1,
    provenance: {
      dataset_kind: "anonymized_real_session",
      derived_from_real_session: true,
      publication_permission: "confirmed",
    },
    display: { driver: "Anonymous Driver", vehicle: "Anonymous Kart", track: "Anonymous Circuit" },
    fastest_lap: { lap: 13, lap_time: 40.326 },
    lap_rows: [{ lap: 13, lap_time: 40.326 }],
    track: {
      lap_length_m: 818.6,
      points: [
        { distance_m: 0, local_x_m: 0, local_y_m: 0 },
        { distance_m: 10, local_x_m: 10, local_y_m: 4 },
      ],
    },
    sector_loss: {
      source: "virtual_distance",
      official: false,
      sector_best: { sector_1: 12.8 },
      laps: [{ lap: 13, total_loss_s: 0.2, sector_losses: { sector_1: 0.2 } }],
    },
    summary: { source: "structured", narrative: null, bullets: ["Real evidence summary."] },
    synthetic_curve_generated: false,
  };
}
