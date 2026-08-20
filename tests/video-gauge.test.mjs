import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVideoDeltaCurve,
  telemetryAtVideoTime,
} from "../frontend/lib/videoGauge.ts";

function trackPoint(distance, sessionTime, values) {
  return {
    distance_m: distance,
    session_time_s: sessionTime,
    lap_time_s: sessionTime,
    local_x_m: 0,
    local_y_m: 0,
    latitude: null,
    longitude: null,
    speed: values.speed ?? null,
    rpm: values.rpm ?? null,
    longitudinal_g: values.longitudinal_g ?? null,
    lateral_g: values.lateral_g ?? null,
  };
}

const points = [
  trackPoint(0, 10, { speed: 10, rpm: 5000, longitudinal_g: 0.1, lateral_g: 0.2 }),
  trackPoint(100, 20, { speed: 20, rpm: 8000, longitudinal_g: 0.3, lateral_g: -0.4 }),
  trackPoint(200, 30, { speed: 30, rpm: 11000, longitudinal_g: 0.5, lateral_g: 0.6 }),
];

test("telemetryAtVideoTime interpolates readings using the alignment offset", () => {
  // video 25s with offset 5000ms => session 20s (exact second point)
  const gauge = telemetryAtVideoTime(points, 25, 5000);
  assert.equal(gauge.speed_kmh, 72); // 20 m/s
  assert.equal(gauge.rpm, 8000);
  assert.equal(gauge.longitudinal_g, 0.3);
  assert.equal(gauge.lateral_g, -0.4);

  // video 22.5s with offset 5000ms => session 17.5s (75% between points)
  const midway = telemetryAtVideoTime(points, 22.5, 5000);
  assert.equal(midway.speed_kmh, 63); // 17.5 m/s
  assert.equal(midway.rpm, 7250);
});

test("telemetryAtVideoTime returns nulls when no telemetry is available", () => {
  const empty = telemetryAtVideoTime([], 10, 0);
  assert.equal(empty.speed_kmh, null);
  assert.equal(empty.rpm, null);

  const partial = telemetryAtVideoTime(
    [trackPoint(0, 10, { speed: 10 })],
    10,
    0
  );
  assert.equal(partial.speed_kmh, 36);
  assert.equal(partial.rpm, null);
});

test("buildVideoDeltaCurve maps comparison rows onto the video timeline", () => {
  const comparison = [
    { distance_m: 0, cumulative_time_delta_s: 0 },
    { distance_m: 100, cumulative_time_delta_s: 0.5 },
    { distance_m: 200, cumulative_time_delta_s: 1.2 },
    { distance_m: 250, cumulative_time_delta_s: 9 }, // out of range -> skipped
    { distance_m: 100, cumulative_time_delta_s: null }, // null delta -> skipped
  ];
  const curve = buildVideoDeltaCurve(comparison, points, 5000);
  assert.equal(curve.length, 3);
  assert.deepEqual(
    curve.map((point) => point.video_time_s),
    [15, 25, 35]
  );
  assert.deepEqual(
    curve.map((point) => point.delta_s),
    [0, 0.5, 1.2]
  );
});

test("buildVideoDeltaCurve returns empty without usable target points", () => {
  assert.deepEqual(buildVideoDeltaCurve([{ distance_m: 0, cumulative_time_delta_s: 0 }], [], 0), []);
});
