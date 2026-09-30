import assert from "node:assert/strict";
import { test } from "node:test";
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
