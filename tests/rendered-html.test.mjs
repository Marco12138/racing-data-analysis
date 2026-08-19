import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(
  env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  acceptLanguage = "zh-CN,zh;q=0.9",
  cookie = "",
) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html", "accept-language": acceptLanguage, cookie, host: "localhost" } }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the public racing analysis demo", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Accept-Language, Cookie");

  const html = await response.text();
  assert.match(html, /AI 赛车遥测分析平台/);
  assert.match(html, /使用样例 XRK 体验 Demo/);
  assert.match(html, /遥测分析/);
  assert.match(html, /Lap &amp; Sector Analysis/);
  assert.match(html, /新建 Session/);
  assert.match(html, /开始分析/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("server and client share the Accept-Language locale on first render", async () => {
  const response = await render(undefined, "en-US,en;q=0.9");
  const html = await response.text();
  assert.match(html, /<html lang="en"/);
  assert.match(html, /AI Racing Telemetry Analysis Platform/);
  assert.match(html, /Try Demo with sample XRK session/);
  assert.doesNotMatch(html, /AI 赛车遥测分析平台/);
});

test("server render honors the explicit language cookie before Accept-Language", async () => {
  const response = await render(undefined, "zh-CN,zh;q=0.9", "racing-ui-language=en");
  const html = await response.text();
  assert.match(html, /<html lang="en"/);
  assert.match(html, /Try Demo with sample XRK session/);
  assert.doesNotMatch(html, /AI 赛车遥测分析平台/);
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
    }, "en-US,en;q=0.9");
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

test("serves the Sites API through the current public origin", async () => {
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
    apiOrigin: "https://frontend.example",
    apiPrefix: "/api/v1",
    xrkUploadUrl: "https://backend.example/api/v1/xrk/inspect",
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
  assert.match(dashboard, /playbackFailed/);
  assert.match(dashboard, /Telemetry channel unavailable/);
  assert.match(dashboard, /XRK Server Import/);
  assert.match(dashboard, /Virtual sectors/);
  assert.match(inspectionWorkspace, /Continue to Analysis/);
  assert.match(inspectionWorkspace, /Available channels/);
  assert.match(aimImportApi, /\/imports\/aim/);
  assert.match(aimImportApi, /FormData/);
  assert.match(xrkAnalysisApi, /resolveApiUrl/);
  assert.match(xrkAnalysisApi, /XRK_UPLOAD_TRANSPORT_FAILED/);
  assert.match(dashboard, /当前为视频独立分析模式/);
  assert.match(publicPage, /loadServerPublicDemo/);
  assert.match(publicClient, /hero\.tryDemo/);
  assert.match(publicClient, /hero\.upload/);
  assert.doesNotMatch(frontendConfig, /http:\/\/127\.0\.0\.1:8000/);
  assert.match(frontendConfig, /\/api\/runtime-config/);
  assert.match(frontendConfig, /XRK_FRONTEND_API_MISCONFIGURED/);
  assert.match(worker, /\/api\/runtime-config/);
  assert.match(worker, /proxyApiRequest/);
  assert.match(worker, /API_URL/);
  assert.match(frontendConfig, /\/api\/v1/);
  assert.match(frontendConfig, /public-demo/);
  assert.match(videoApi, /\/video\/jobs/);
  assert.match(layout, /og\.png/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("Sites proxies API uploads through the same public origin", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamRequest;
  globalThis.fetch = async (input, init) => {
    upstreamRequest = { url: String(input), init };
    return Response.json({ status: "ok" }, { headers: { "X-Request-ID": "upstream-id" } });
  };
  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("proxy-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("https://public.example/api/v1/xrk/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: "<hCNFsample",
      }),
      {
        ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
        API_URL: "https://backend.example",
        API_PREFIX: "/api/v1",
      },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    assert.equal(upstreamRequest.url, "https://backend.example/api/v1/xrk/inspect");
    assert.equal(upstreamRequest.init.method, "POST");
    assert.equal(await new Response(upstreamRequest.init.body).text(), "<hCNFsample");
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("server-renders a shared storyboard page instead of a 404", async () => {
  const originalFetch = globalThis.fetch;
  const storyboard = {
    schema_version: 1,
    token: "share-token-abc123456789",
    watermark: "AI 生成，请与教练核实",
    created_at: "2026-08-10T00:00:00+00:00",
    expires_at: "2026-08-17T00:00:00+00:00",
    analysis: {
      reference_lap: 13,
      target_lap: 8,
      fastest_lap: { lap: 13, lap_time: 40.326 },
    },
    video: { duration_s: 700, required: true, uploaded: false },
    nodes: [
      {
        id: "corner-1",
        kind: "corner",
        title: "第 1 弯：可改进 0.05 秒",
        time_range: [519.8, 525.5],
        distance_range_m: [110, 171],
        telemetry_overlay: {
          distance_m: [110, 140, 171],
          session_time_s: [519.8, 521.0, 525.5],
          speed_kmh: [80, 45, 74],
          rpm: [9000, 7000, 10000],
          longitudinal_g: [-0.8, -1.1, 0.2],
          lateral_g: [0.1, 1.2, 0.3],
          throttle: [],
          brake: [],
          available: { throttle: false, brake: false },
        },
        insight: "基于真实圈 13、8 的净收益 0.05 秒。",
        drill: "连续三圈只改变这一处操作。",
        evidence_laps: [13, 8],
        corner: { name: "Suggested Zone 1", entry_distance_m: 110, exit_distance_m: 171 },
        source: "structured",
      },
    ],
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://backend.example/api/v1/storyboards/share-token-abc123456789") {
      return new Response(JSON.stringify(storyboard), {
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };
  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("story-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/story/share-token-abc123456789", {
        headers: { accept: "text/html", host: "localhost" },
      }),
      {
        ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
        API_URL: "https://backend.example",
        API_PREFIX: "/api/v1",
      },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /AI 驾驶复盘短片/);
    assert.match(html, /AI 生成，请与教练核实/);
    assert.match(html, /第 1 弯：可改进 0\.05 秒/);
    assert.match(html, /连续三圈只改变这一处操作/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
