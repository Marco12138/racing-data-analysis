import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(`${root}/tmp`, { recursive: true });
const dir = mkdtempSync(`${root}/tmp/manual-review-test-`);
execFileSync(`${root}/node_modules/.bin/esbuild`, [`${root}/tests/fixtures/manual-review-entry.tsx`, "--bundle", "--format=esm", "--platform=node", "--jsx=automatic",
  "--external:react", "--external:react-dom", "--external:lucide-react", `--outfile=${dir}/entry.mjs`], { stdio: "pipe" });
const { ManualReviewTest, validateManualReview, restoreManualReview, reviewDistanceAtTime, manualReviewWindow, selectCoachReviews } = await import(pathToFileURL(`${dir}/entry.mjs`).href);
after(() => rmSync(dir, { recursive: true, force: true }));
const trace = Array.from({ length: 101 }, (_, i) => ({ distance_m: i, session_time_s: 100 + i / 5, lap_time_s: i / 5, speed: 60, rpm: 9000 }));
const video = { duration_s: 30, size_bytes: 200, last_modified_ms: 1000, mime_type: "video/mp4" };
const anchor = { version: 1, target_lap: 2, offset_ms: -100000, telemetry_distance_m: 50, telemetry_session_time_s: 110, video_time_s: 10, calibrated_at: "2026-09-15T00:00:00Z", video };
const clip = { version: 1, lap: 2, start_s: 5, end_s: 15, video, calibration: anchor, sync_confirmed: true, saved_at: "2026-09-15T00:00:00Z" };

test("a manual crop can be previewed without fabricating synchronization", () => {
  assert.equal(validateManualReview({ ...clip, sync_confirmed: false, calibration: null }, [], 2, video), null);
  assert.equal(validateManualReview({ ...clip, calibration: null }, trace, 2, video), "anchor_required");
});

test("linked crops preserve session time and accept only the matching real lap and file", () => {
  assert.equal(validateManualReview(clip, trace, 2, video), null);
  assert.equal(validateManualReview(clip, trace, 3, video), "wrong_lap_or_video");
  assert.equal(validateManualReview(clip, trace, 2, { ...video, size_bytes: 300 }), "wrong_lap_or_video");
  assert.equal(validateManualReview({ ...clip, calibration: { ...anchor, target_lap: 3 } }, trace, 2, video), "anchor_required");
  assert.deepEqual(manualReviewWindow(clip, trace, 50), { start_s: 5, end_s: 15, focus_s: 10 });
});

test("invalid crop bounds, wrong anchors and long gaps are rejected", () => {
  for (const changes of [{ start_s: -1 }, { end_s: 40 }, { start_s: 15 }, { end_s: 5.01 }]) {
    assert.equal(validateManualReview({ ...clip, ...changes }, trace, 2, video), "invalid_window");
  }
  assert.equal(validateManualReview({ ...clip, end_s: 25 }, trace, 2, video), "outside_telemetry");
  assert.equal(validateManualReview({ ...clip, calibration: { ...anchor, offset_ms: 0 } }, trace, 2, video), "anchor_mismatch");
  const missing = structuredClone(trace); missing[40].session_time_s = null;
  assert.equal(validateManualReview(clip, missing, 2, video), "telemetry_gap");
});

test("timestamp inverse never uses lap-array indices, extrapolation or missing spans", () => {
  assert.ok(Math.abs(reviewDistanceAtTime(trace, 107.1) - 35.5) < 1e-9);
  assert.equal(reviewDistanceAtTime(trace, 99), null);
  assert.equal(reviewDistanceAtTime(trace, 121), null);
  assert.equal(reviewDistanceAtTime([trace[0], trace[100]], 110), null);
  assert.equal(reviewDistanceAtTime([{ ...trace[50], session_time_s: null }, trace[51]], 110.1), null);
});

test("restoration is metadata-only and revalidates file identity and anchors", () => {
  const serialized = JSON.stringify([{ ...clip, filename: "not-retained.mp4" }]);
  const result = restoreManualReview(serialized, trace, 2, video);
  assert.equal(result.lap, 2);
  assert.equal("filename" in result, false);
  assert.equal(restoreManualReview(serialized, trace, 2, { ...video, last_modified_ms: 1001 }), null);
  assert.equal(restoreManualReview("not json", trace, 2, video), null);
});

const { analysis } = JSON.parse(readFileSync(`${root}/public/demo/reviewed-real-session.json`));
test("explicit references must remain real and quality eligible", () => {
  const eligible = analysis.lap_quality.top_valid_laps.find(l => l.lap !== analysis.target_lap).lap;
  assert.ok(selectCoachReviews(analysis, eligible).every(r => r.referenceLap === eligible));
  assert.deepEqual(selectCoachReviews(analysis, -1), []);
  assert.deepEqual(selectCoachReviews(analysis, analysis.target_lap), []);
  const rejected = analysis.lap_quality.laps.find(l => !l.analysis_eligible);
  if (rejected) assert.deepEqual(selectCoachReviews(analysis, rejected.lap), []);
});

for (const locale of ["zh", "en"]) test(`both sides have a manual entry even when automatic video is unavailable (${locale})`, () => {
  const html = renderToStaticMarkup(createElement(ManualReviewTest, { locale, review: selectCoachReviews(analysis)[0], fingerprint: "test",
    defaultFile: null, defaultUrl: "", defaultDuration: 0, targetCalibration: null, referenceCalibration: null,
    context: false, onCursor() {}, feedback: () => null }));
  const label = locale === "zh" ? "添加 / 调整片段" : "Add / Adjust clip";
  assert.equal(html.split(label).length - 1, 2);
  assert.ok(html.indexOf('data-testid="review-video-reference"') < html.indexOf('data-testid="review-video-target"'));
  assert.doesNotMatch(html, /<video/);
  assert.doesNotMatch(html, /THEORETICAL BEST|theoretical RPM/i);
});
