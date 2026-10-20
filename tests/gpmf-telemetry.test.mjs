import assert from "node:assert/strict";
import { test } from "node:test";
import { openAsBlob } from "node:fs";
import { fileURLToPath } from "node:url";
import { consumeGpmfPacket, extractGoproTelemetry, parseGpsUtc, validateMovie } from "../frontend/lib/gpmfTelemetry.ts";

function audit() {
  return { summary: { streams: [], warnings: [] }, video_clock: [], video_gps: [] };
}
function packet(extra = {}) {
  return { DEVC: { STRM: { interpretSamples: "GPS5", GPS5: Array.from({ length: 20 }, () => [300000000, 1140000000, 0, 10000, 1000]),
    UNIT: ["deg", "deg", "m", "m/s", "m/s"], SCAL: [1e7, 1e7, 1000, 1000, 100], GPSF: 3, GPSU: "250324104500.250", ...extra } } };
}
const timing = { cts: 40000, duration: 2000, timescale: 2000 };

test("GPSU is explicit UTC with strict dates and never a movie-date fallback", () => {
  assert.equal(parseGpsUtc("250324104500.250"), Date.parse("2025-03-24T10:45:00.250Z") / 1000);
  for (const value of [undefined, "", "2025-03-24", "250231104500.000", "250324254500.000", 12345]) assert.equal(parseGpsUtc(value), null);
  const a = audit(); consumeGpmfPacket(a, packet({ GPSU: undefined }), timing);
  assert.equal(a.video_clock.length, 0);
  assert.ok(a.video_gps.length);
});

test("sample CTS uses track timescale, preserves fix and converts measured units", () => {
  const a = audit(); consumeGpmfPacket(a, packet(), timing);
  assert.equal(a.video_clock[0].time_s, 20);
  assert.equal(a.video_clock[0].fix, 3);
  assert.equal(a.summary.streams[0].sample_count, 20);
  assert.equal(a.summary.streams[0].sample_rate_hz, 20);
  assert.equal(a.video_gps.length, 5);
  assert.equal(a.video_gps[0].speed_kmh, 36);
  assert.equal(a.video_gps[0].lat, 30);
  assert.equal(a.video_gps[0].time_s, 20.075);
});

test("bad fix is retained as unusable, not silently promoted to a GPS lock", () => {
  const a = audit(); consumeGpmfPacket(a, packet({ GPSF: 0 }), timing);
  assert.ok(a.video_clock.every((p) => p.fix === 0));
  assert.ok(a.video_gps.every((p) => p.fix === 0));
});

test("HUD speed is opt-in, native GPS5 2D, and does not change the sync summary", () => {
  const plain = audit(), hud = { ...audit(), video_speed: [] };
  const rows = Array.from({ length: 20 }, (_, i) => [300000000,1140000000,0,i * 1000,99999]);
  consumeGpmfPacket(plain, packet({ GPS5: rows }), timing);
  consumeGpmfPacket(hud, packet({ GPS5: rows }), timing);
  assert.equal(plain.video_speed, undefined);
  assert.deepEqual(hud.video_gps, plain.video_gps);
  assert.deepEqual(hud.video_clock, plain.video_clock);
  assert.equal(hud.video_speed.length, 20);
  assert.deepEqual(hud.video_speed[0], { time_s:20, speed_kmh:0, fix:3 });
  assert.equal(hud.video_speed[1].time_s, 20.05);
  assert.equal(hud.video_speed[1].speed_kmh, 3.6);
});

test("HUD preserves bad samples and fixes rather than interpolating over them", () => {
  const a = { ...audit(), video_speed: [] };
  consumeGpmfPacket(a, packet({ GPSF:0, GPS5:[[300000000,1140000000,0,NaN,0], [300000000,1140000000,0,0,0]] }), timing);
  assert.deepEqual(a.video_speed, [{ time_s:20, speed_kmh:null, fix:0 }, { time_s:20.5, speed_kmh:0, fix:0 }]);
  consumeGpmfPacket(a, packet({ GPS5:[[300000000,1140000000,0,Infinity,0]] }), {...timing,cts:42000});
  assert.equal(a.video_speed[2].speed_kmh, null);
});

test("camera IMU is counted without producing body-frame values", () => {
  const a = audit(); consumeGpmfPacket(a, { DEVC: { STRM: [
    { interpretSamples: "ACCL", SIUN: "m/s²", ACCL: [[0, 0, 9.8], [0, 0, 9.8]] },
    { interpretSamples: "GYRO", SIUN: "rad/s", GYRO: [[0, 0, 0]] },
  ] } }, timing);
  assert.deepEqual(a.summary.streams.map((s) => s.key), ["ACCL", "GYRO"]);
  assert.equal(a.video_clock.length, 0);
  assert.equal(a.video_gps.length, 0);
  assert.doesNotMatch(JSON.stringify(a), /longitudinal|lateral|roll|pitch/);
});

test("raw orientation, signs, units and timing fields are retained without body calibration", () => {
  const a = audit();
  const stream = { interpretSamples: "GYRO", GYRO: [[1, 2, 3]], SIUN: "rad/s",
    ORIN: "YxZ", ORIO: "ZXY", SCAL: 100, MTRX: [1,0,0,0,1,0,0,0,1], TSMP: 1, STMP: 12345 };
  consumeGpmfPacket(a, { DEVC: { STRM: stream } }, timing);
  const s = a.summary.streams[0];
  assert.equal(s.input_orientation, "YxZ"); assert.equal(s.output_orientation, "ZXY");
  assert.equal(s.source, "camera_imu"); assert.equal(s.body_frame_calibrated, false);
  assert.deepEqual(s.scale, [100]); assert.deepEqual(s.timing_fields, ["TSMP", "STMP"]);
  consumeGpmfPacket(a, { DEVC: { STRM: { ...stream, ORIO: "XYZ" } } }, { ...timing, cts: 42000 });
  assert.equal(s.orientation_consistent, false);
  assert.ok(a.summary.warnings.includes("CAMERA_AXIS_METADATA_CHANGED"));
});

test("opt-in camera samples remain local scaled raw columns on an explicitly estimated clock", () => {
  const a = { ...audit(), camera_imu: {} };
  consumeGpmfPacket(a, { DEVC: { STRM: { interpretSamples: "ACCL", ACCL: [[2,4,6],[4,8,12]], SCAL: [2], SIUN: "m/s²", ORIN: "YxZ", ORIO: "ZXY" } } }, timing);
  assert.deepEqual(a.camera_imu.ACCL.columns, [[1,2], [2,4], [3,6]]);
  assert.deepEqual(a.camera_imu.ACCL.time_s, [20,20.5]);
  assert.equal(a.video_gps.length, 0);
  assert.equal(a.summary.streams[0].body_frame_calibrated, false);
});

test("unsupported GPS variants and units degrade explicitly", () => {
  for (const extra of [{ SCAL: [0] }, { UNIT: ["x"] }]) {
    const a = audit(); consumeGpmfPacket(a, packet(extra), timing);
    assert.equal(a.video_clock.length, 0); assert.ok(a.summary.warnings.length);
  }
  const a = audit(); consumeGpmfPacket(a, { DEVC: { STRM: { interpretSamples: "GPS9", GPS9: [[1,2,3,4,5,6,7,8,9]] } } }, timing);
  assert.ok(a.summary.warnings.includes("GPS9_NOT_YET_VALIDATED"));
});

test("fragmentation and unhandled timeline edits cannot yield a false video clock", () => {
  const movie = { duration: 60000, timescale: 1000, isFragmented: false, tracks: [{ id: 1, codec: "gpmd" }] };
  assert.equal(validateMovie(movie), 60);
  assert.throws(() => validateMovie({ ...movie, isFragmented: true }), /FRAGMENTED/);
  assert.throws(() => validateMovie({ ...movie, duration: 3700000 }), /DURATION/);
  assert.throws(() => validateMovie({ ...movie, tracks: [{ ...movie.tracks[0], edits: [{ media_time: -1, media_rate_integer: 1, media_rate_fraction: 0 }] }] }), /EDIT_LIST/);
});

test("cancelled, oversized, empty and malformed local files fail before any network", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(extractGoproTelemetry(new Blob(["bad"]), { signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(extractGoproTelemetry({ size: 21 * 1024 ** 3 }), /SIZE_LIMIT/);
  await assert.rejects(extractGoproTelemetry(new Blob()), /SIZE_LIMIT/);
  await assert.rejects(extractGoproTelemetry(new Blob(["bad"])), /INVALID_MP4/);
});

test("published metadata-free clip is not reported as a GPS-capable edited original", async () => {
  const file = await openAsBlob(fileURLToPath(new URL("../public/demo/video/sector-1-lap-5.mp4", import.meta.url)));
  await assert.rejects(extractGoproTelemetry(file, { includeGpsSpeed:true }), /GPMF_TRACK_UNAVAILABLE/);
});
