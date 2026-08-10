import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchStoryboardPayload,
  parseStoryboardResponse,
} from "../frontend/lib/storyboardApi.ts";

function validPayload() {
  return {
    schema_version: 1,
    token: "share-token-abc123",
    watermark: "AI 生成，请与教练核实",
    created_at: "2026-08-10T00:00:00+00:00",
    expires_at: "2026-08-17T00:00:00+00:00",
    analysis: {
      reference_lap: 13,
      target_lap: 8,
      fastest_lap: { lap: 13, lap_time: 40.326 },
    },
    video: { duration_s: 620, required: true, uploaded: false },
    nodes: [
      {
        id: "corner-1",
        kind: "corner",
        title: "第 1 弯：可改进 0.047 秒",
        time_range: [512.1, 518.4],
        distance_range_m: [110, 171],
        telemetry_overlay: {
          distance_m: [110, 140, 171],
          session_time_s: [512.1, 514.2, 518.4],
          speed_kmh: [80, 45, 74],
          rpm: [9000, 7000, 10000],
          longitudinal_g: [-0.8, -1.1, 0.2],
          lateral_g: [0.1, 1.2, 0.3],
          throttle: [null, null, null],
          brake: [null, null, null],
          available: { throttle: false, brake: false },
        },
        insight: "基于真实圈 13、8 的净收益 0.047 秒。",
        drill: "连续三圈只改变这一处操作。",
        evidence_laps: [13, 8],
        corner: { name: "Suggested Zone 1", entry_distance_m: 110, exit_distance_m: 171 },
        source: "structured",
      },
    ],
  };
}

test("accepts a valid backend storyboard payload", () => {
  const parsed = parseStoryboardResponse(validPayload());
  assert.equal(parsed?.token, "share-token-abc123");
  assert.equal(parsed?.nodes.length, 1);
  assert.equal(parsed?.nodes[0].time_range[1], 518.4);
  assert.equal(parsed?.nodes[0].telemetry_overlay.speed_kmh.length, 3);
  assert.equal(parsed?.nodes[0].corner?.name, "Suggested Zone 1");
});

test("rejects untrusted or malformed storyboard payloads", () => {
  assert.equal(parseStoryboardResponse({ ...validPayload(), schema_version: 2 }), null);
  assert.equal(parseStoryboardResponse({ ...validPayload(), token: "" }), null);
  assert.equal(parseStoryboardResponse({ ...validPayload(), nodes: [] }), null);
  assert.equal(
    parseStoryboardResponse({
      ...validPayload(),
      nodes: [{ ...validPayload().nodes[0], drill: "" }],
    }),
    null,
  );
  assert.equal(
    parseStoryboardResponse({
      ...validPayload(),
      nodes: [{
        ...validPayload().nodes[0],
        telemetry_overlay: {
          ...validPayload().nodes[0].telemetry_overlay,
          speed_kmh: [80],
        },
      }],
    }),
    null,
  );
  assert.equal(
    parseStoryboardResponse({
      ...validPayload(),
      nodes: [{ ...validPayload().nodes[0], time_range: [10] }],
    }),
    null,
  );
});

test("accepts unavailable pedal channels as empty arrays", () => {
  const payload = validPayload();
  payload.nodes[0].telemetry_overlay.throttle = [];
  payload.nodes[0].telemetry_overlay.brake = [];
  const parsed = parseStoryboardResponse(payload);
  assert.equal(parsed?.nodes[0].telemetry_overlay.throttle.length, 0);
  assert.equal(parsed?.nodes[0].telemetry_overlay.available.brake, false);
});

test("fetchStoryboardPayload returns null instead of trusting bad responses", async () => {
  const ok = async () => new Response(JSON.stringify(validPayload()), { status: 200 });
  const notFound = async () => new Response("{}", { status: 404 });
  const invalid = async () => new Response(JSON.stringify({ schema_version: 9 }), { status: 200 });
  const networkError = async () => {
    throw new Error("network down");
  };

  const parsed = await fetchStoryboardPayload("https://api.example", "/api/v1", "token-1", ok);
  assert.equal(parsed?.token, "share-token-abc123");
  assert.equal(await fetchStoryboardPayload("https://api.example", "/api/v1", "token-1", notFound), null);
  assert.equal(await fetchStoryboardPayload("https://api.example", "/api/v1", "token-1", invalid), null);
  assert.equal(await fetchStoryboardPayload("https://api.example", "/api/v1", "token-1", networkError), null);
});
