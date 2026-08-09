import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateVideoOffsetMs,
  createVideoSyncCalibration,
  nearestPointByDistance,
  nearestPointBySessionTime,
  nextSeekRequest,
  parseVideoSyncCalibration,
  telemetrySessionTimeBounds,
  telemetryToVideoTimeS,
  validateVideoSeek,
  videoToTelemetryTimeS,
} from "../frontend/lib/videoTelemetrySync.ts";
import {
  summarizeVideoFrame,
  videoFeatureSampleTimes,
} from "../frontend/lib/videoFeatureExtraction.ts";

const points = [
  { distance_m: 0, session_time_s: 100 },
  { distance_m: 50, session_time_s: 102.5 },
  { distance_m: 100, session_time_s: 105 },
];

test("video offset uses an explicit and reversible sign convention", () => {
  assert.equal(calculateVideoOffsetMs(14.25, 10), 4250);
  assert.equal(calculateVideoOffsetMs(7.5, 10), -2500);
  assert.equal(telemetryToVideoTimeS(10, 4250), 14.25);
  assert.equal(videoToTelemetryTimeS(14.25, 4250), 10);
});

test("video seeks reject unavailable, negative, and over-duration targets", () => {
  assert.equal(validateVideoSeek(4, 0).ok, false);
  assert.equal(validateVideoSeek(-0.001, 20).ok, false);
  assert.equal(validateVideoSeek(20.001, 20).ok, false);
  assert.deepEqual(validateVideoSeek(20, 20), { ok: true, time_s: 20 });
});

test("telemetry lookup uses distance and session time independently", () => {
  assert.equal(nearestPointByDistance(points, 44)?.distance_m, 50);
  assert.equal(nearestPointBySessionTime(points, 104.7)?.distance_m, 100);
  assert.deepEqual(telemetrySessionTimeBounds(points), { start_s: 100, end_s: 105 });
});

test("same-distance seeks receive a new sequence number", () => {
  const first = nextSeekRequest(null, 50);
  const repeated = nextSeekRequest(first, 50);
  assert.equal(first.distance_m, repeated.distance_m);
  assert.equal(repeated.sequence, first.sequence + 1);
});

test("calibration persists only non-sensitive anchor metadata", () => {
  const calibration = createVideoSyncCalibration({
    videoTimeS: 12.5,
    telemetryPoint: points[1],
    targetLap: 7,
    videoDurationS: 60,
    fileSizeBytes: 123456,
    fileLastModifiedMs: 987654,
    fileMimeType: "video/mp4",
    calibratedAt: "2026-08-09T00:00:00.000Z",
  });
  const serialized = JSON.stringify(calibration);
  assert.equal(calibration.offset_ms, -90000);
  assert.deepEqual(parseVideoSyncCalibration(serialized), calibration);
  assert.equal(serialized.includes("filename"), false);
  assert.equal(serialized.includes("path"), false);
  assert.equal(serialized.includes("blob:"), false);
});

test("invalid saved calibration is ignored", () => {
  assert.equal(parseVideoSyncCalibration("not-json"), null);
  assert.equal(parseVideoSyncCalibration(JSON.stringify({ version: 1, offset_ms: 10 })), null);
});

test("browser feature summaries use luminance and frame differences only", () => {
  const first = summarizeVideoFrame(
    new Uint8ClampedArray([100, 100, 100, 255, 200, 200, 200, 255]),
    null
  );
  const second = summarizeVideoFrame(
    new Uint8ClampedArray([120, 120, 120, 255, 180, 180, 180, 255]),
    first.luma
  );
  assert.equal(first.brightness, 150);
  assert.equal(first.motion, 0);
  assert.equal(second.brightness, 150);
  assert.equal(second.motion, 20);
});

test("video feature sampling is bounded and spans the readable duration", () => {
  const samples = videoFeatureSampleTimes(572.16, 360);
  assert.equal(samples.length, 360);
  assert.equal(samples[0], 0);
  assert.ok(samples.at(-1) <= 572.16);
  assert.deepEqual(videoFeatureSampleTimes(0), []);
});
