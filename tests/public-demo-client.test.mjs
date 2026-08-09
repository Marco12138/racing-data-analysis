import assert from "node:assert/strict";
import test from "node:test";

import { fetchPublicDemoSummary } from "../frontend/lib/publicDemo.ts";

function validSummary() {
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
        { distance_m: 10, local_x_m: 10, local_y_m: 2 },
      ],
    },
    sector_loss: {
      source: "virtual_distance",
      official: false,
      sector_best: { sector_1: 12.8 },
      laps: [],
    },
    summary: { source: "structured", narrative: null, bullets: ["Measured values only."] },
    synthetic_curve_generated: false,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("client demo loader accepts a reviewed real-session summary", async () => {
  const fetcher = async () => jsonResponse(validSummary());
  const result = await fetchPublicDemoSummary("https://api.example", "/api/v1", fetcher);
  assert.equal(result?.fastest_lap.lap, 13);
  assert.equal(result?.fastest_lap.lap_time, 40.326);
});

test("client demo loader normalizes origin and prefix", async () => {
  let requested = "";
  const fetcher = async (url) => {
    requested = url;
    return jsonResponse(validSummary());
  };
  await fetchPublicDemoSummary("https://api.example/", "api/v1/", fetcher);
  assert.equal(requested, "https://api.example/api/v1/xrk/demo-session");
});

test("client demo loader returns null instead of fabricating data", async () => {
  const notOk = async () => jsonResponse({}, 500);
  const synthetic = async () => jsonResponse({
    ...validSummary(),
    synthetic_curve_generated: true,
  });
  const unreviewed = async () => jsonResponse({
    ...validSummary(),
    provenance: { ...validSummary().provenance, publication_permission: "unknown" },
  });
  const networkFailure = async () => {
    throw new Error("network down");
  };

  assert.equal(await fetchPublicDemoSummary("https://api.example", "/api/v1", notOk), null);
  assert.equal(await fetchPublicDemoSummary("https://api.example", "/api/v1", synthetic), null);
  assert.equal(await fetchPublicDemoSummary("https://api.example", "/api/v1", unreviewed), null);
  assert.equal(await fetchPublicDemoSummary("https://api.example", "/api/v1", networkFailure), null);
});
