import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, statSync } from "node:fs";
import { isPublishedVideoReview } from "../frontend/lib/publishedVideoReview.ts";

const { analysis } = JSON.parse(readFileSync(new URL("../public/demo/reviewed-real-session.json", import.meta.url)));
const review = analysis.video_review;

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

test("published media rejects remote paths and fabricated confirmation", () => {
  assert.equal(isPublishedVideoReview({ ...review, whole_recording_verified: true }), false);
  assert.equal(isPublishedVideoReview({ ...review, clips: [{ ...review.clips[0], url: "https://external/video.mp4" }] }), false);
  assert.equal(isPublishedVideoReview({ ...review, clips: [{ ...review.clips[0], duration_s: 400 }] }), false);
});
