import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, statSync } from "node:fs";
import { isPublishedVideoReview, publishedClipMedia } from "../frontend/lib/publishedVideoReview.ts";
import { createFile } from "mp4box";

const { analysis } = JSON.parse(readFileSync(new URL("../public/demo/reviewed-real-session.json", import.meta.url)));
const review = analysis.video_review;
const media = JSON.parse(readFileSync(new URL("../public/demo/video/media.json", import.meta.url)));

test("approved video demo uses real top-three laps, a preserved manual anchor and five-second excerpts", () => {
  assert.equal(isPublishedVideoReview(review), true);
  assert.deepEqual(analysis.lap_quality.top_valid_laps.map(l => l.lap), [5, 4, 6]);
  assert.equal(review.anchor_video_start_s, 159.55);
  assert.equal(review.anchor_uncertainty_s, .5);
  assert.equal(review.whole_recording_verified, false);
  assert.equal(review.clips.length, 9);
  assert.ok(review.clips.some(c => c.gps_warning));
  assert.deepEqual(review.segments, analysis.top_lap_segments.segments);
  for (const c of review.clips) {
    assert.ok(Math.abs(c.source_start_s - c.telemetry_start_s - review.offset_s) < 1e-6);
    assert.equal(c.duration_s, 5);
    assert.ok(statSync(new URL(`../public${c.url}`, import.meta.url)).size < 2_000_000);
    assert.ok(statSync(new URL(`../public${c.poster}`, import.meta.url)).size > 0);
  }
  for (const s of review.segments) {
    assert.equal(new Set(review.clips.filter(c => c.sector_id === s.id).map(c => c.start_distance_m)).size, 1);
  }
});

test("all approved clips have actual audio and bounded, sanitized GPS5 samples", () => {
  assert.equal(review.audio_removed, false);
  assert.equal(media.clips.length, review.clips.length);
  for (const clip of review.clips) {
    const row = publishedClipMedia(clip, media);
    assert.ok(row);
    assert.ok(row.points.length > 60);
    assert.equal(row.points[0].time_s, 0);
    assert.equal(row.points.at(-1).time_s, 5);
    assert.ok(row.points.some(p => p.speed_kmh > 0));
    for (const p of row.points) assert.deepEqual(Object.keys(p).sort(), ["fix", "speed_kmh", "time_s"]);
    const data = readFileSync(new URL(`../public${clip.url}`, import.meta.url));
    const mp4 = createFile(); let info;
    mp4.onReady = value => { info = value; };
    mp4.appendBuffer(Object.assign(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), { fileStart: 0 }));
    assert.equal(info.audioTracks.length, 1);
    assert.equal(info.videoTracks.length, 1);
    assert.equal(info.tracks.length, 2, "no raw GPS/UTC track published");
    assert.ok(Math.abs(info.duration / info.timescale - 5) < .06);
  }
  assert.doesNotMatch(JSON.stringify(media), /latitude|longitude|GPSU|\/Users\/|GH010681|martin|WSK-WUHAN/i);
});

test("media cannot be associated with another excerpt, source, clock or invalid samples", () => {
  const clip = review.clips[0], valid = publishedClipMedia(clip, media);
  assert.equal(publishedClipMedia({ ...clip, source_start_s: clip.source_start_s + .1 }, media), null);
  assert.equal(publishedClipMedia({ ...clip, duration_s: 4 }, media), null);
  for (const patch of [{ speed_source: "aim" }, { sensor_latency_calibrated: true }, { timing: "utc" },
    { points: [{ time_s: -1, speed_kmh: 50, fix: 3 }] }, { points: [{ time_s: 0, speed_kmh: NaN, fix: 3 }] },
    { points: [valid.points[0], valid.points[0]] }]) {
    assert.equal(publishedClipMedia(clip, { version: 1, clips: [{ ...valid, ...patch }] }), null);
  }
  assert.equal(isPublishedVideoReview({ ...review, audio_removed: true }), true, "legacy backend summary remains readable");
});

test("published media rejects remote paths and fabricated confirmation", () => {
  assert.equal(isPublishedVideoReview({ ...review, whole_recording_verified: true }), false);
  assert.equal(isPublishedVideoReview({ ...review, clips: [{ ...review.clips[0], url: "https://external/video.mp4" }] }), false);
  assert.equal(isPublishedVideoReview({ ...review, clips: [{ ...review.clips[0], duration_s: 400 }] }), false);
});
