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
const { ManualReviewTest, validateManualReview, restoreManualReview, reviewDistanceAtTime, manualReviewWindow, selectCoachReviews,
  inferReviewCandidate, candidateLandmarkCheck, searchLandmarkVideo, sharedReviewStart, manualStartBounds, reviewWindowAtOffset,
  reviewGpsEvidence, parseReviewGpsEvidence, reviewGpsOverlaps, rankBoundaryFrames } = await import(pathToFileURL(`${dir}/entry.mjs`).href);
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

const longVideo = { ...video, duration_s: 500 };
const source = { ...anchor, target_lap: 4, telemetry_session_time_s: 100, video_time_s: 123.45,
  offset_ms: 23450, video: longVideo, review: { method: "manual_lap_bounds_v1", verdict: "confirmed", scope: "selected_lap", checked_points: 2 } };
const ranges = [
  { lap: 4, telemetry_start_s: 100, telemetry_end_s: 141.7 },
  { lap: 5, telemetry_start_s: 141.7, telemetry_end_s: 182.95 },
  { lap: 7, telemetry_start_s: 225.4, telemetry_end_s: 268 },
];
const targetTrace = trace.map(p => ({ ...p, session_time_s: 141.7 + p.lap_time_s }));
const estimate = (changes = {}) => inferReviewCandidate(changes.trace ?? targetTrace, changes.lap ?? 5, 50,
  changes.anchors ?? [source], changes.ranges ?? ranges, changes.video ?? longVideo, changes.context);

test("one real anchor locates other laps using actual session time, not lap numbers or a repeated lap duration", () => {
  const before = JSON.stringify(source);
  const result = estimate().candidate;
  assert.ok(result); assert.equal(result.sync_confirmed, false);
  assert.ok(Math.abs(result.lap_start_delta_s - 41.7) < 1e-9);
  assert.ok(Math.abs(result.window.focus_s - 175.15) < 1e-9);
  const seventh = estimate({ lap: 7, trace: targetTrace.map(p => ({ ...p, session_time_s: 225.4 + p.lap_time_s })) }).candidate;
  assert.ok(Math.abs(seventh.lap_start_delta_s - 125.4) < 1e-9);
  assert.equal(JSON.stringify(source), before);
  assert.equal(result.calibration, undefined, "a candidate must not masquerade as a saved calibration");
});

test("candidate timing supports earlier laps and does not use untrusted video ranges", () => {
  const laterAnchor = { ...source, target_lap: 7, telemetry_session_time_s: 225.4, video_time_s: 248.85 };
  const result = estimate({ anchors: [laterAnchor], ranges: ranges.map(r => ({ ...r, video_start_s: 999, video_end_s: 1000 })) }).candidate;
  assert.ok(result.lap_start_delta_s < 0);
  assert.ok(Math.abs(result.window.focus_s - 175.15) < 1e-9);
});

test("missing real timing, another file, conflicting anchors and out-of-video proposals stay unavailable", () => {
  assert.equal(estimate({ ranges: [] }).candidate, null);
  assert.equal(estimate({ video: { ...longVideo, last_modified_ms: 1001 } }).candidate, null);
  assert.equal(estimate({ video: { ...longVideo, mime_type: "video/quicktime" } }).candidate, null);
  assert.equal(estimate({ anchors: [{ ...source, telemetry_session_time_s: 999 }] }).candidate, null);
  const conflict = { ...source, target_lap: 7, telemetry_session_time_s: 225.4, video_time_s: 249.2, offset_ms: 23800 };
  assert.equal(estimate({ anchors: [source, conflict] }).reason, "anchors_disagree");
  assert.equal(estimate({ anchors: [{ ...source, video_time_s: 490, offset_ms: 390000 }] }).candidate, null);
  assert.equal(estimate({ anchors: [{ ...source, offset_ms: 22000 }] }).candidate, null);
  assert.equal(estimate({ anchors: [] }).candidate, null);
});

test("candidate windows reject missing or nonmonotonic samples, long gaps and missing full-context boundaries", () => {
  const missing = structuredClone(targetTrace); missing[49].session_time_s = null;
  assert.equal(estimate({ trace: missing }).reason, "telemetry_gap");
  const reversed = structuredClone(targetTrace); reversed[49].session_time_s += 1;
  assert.equal(estimate({ trace: reversed }).reason, "telemetry_gap");
  assert.equal(estimate({ trace: targetTrace.filter((_, i) => i < 40 || i > 60) }).candidate, null);
  assert.equal(estimate({ context: { entry: 0, exit: 200 } }).candidate, null);
});

test("landmark checks need a confirmed passing point in the source lap and search only the proposed clip", () => {
  const candidate = estimate().candidate, videoKey = JSON.stringify(longVideo);
  const sighting = { lap: 4, videoKey, syncKey: JSON.stringify(source), relation: "passing", distanceM: 50 };
  const landmark = { id: "kerb", sightings: [sighting] };
  const check = candidateLandmarkCheck([landmark], candidate, targetTrace, videoKey);
  assert.ok(check); assert.ok(Math.abs(check.expected - 175.15) < 1e-9);
  assert.ok(check.window.start_s >= candidate.window.start_s);
  assert.ok(check.window.end_s <= candidate.window.end_s);
  for (const changes of [{ syncKey: "" }, { videoKey: "other" }, { lap: 7 }, { relation: "visible" }, { distanceM: 0 }]) {
    assert.equal(candidateLandmarkCheck([{ ...landmark, sightings: [{ ...sighting, ...changes }] }], candidate, targetTrace, videoKey), null);
  }
});

test("visual checks refuse remote videos, overly wide windows and cancellation before decoding", async () => {
  await assert.rejects(searchLandmarkVideo("https://remote/video.mp4", {}, { start_s: 0, end_s: 4 }, new AbortController().signal), /invalid_local_search/);
  await assert.rejects(searchLandmarkVideo("blob:local", {}, { start_s: 0, end_s: 100 }, new AbortController().signal), /invalid_local_search/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(searchLandmarkVideo("blob:local", {}, { start_s: 0, end_s: 4 }, abort.signal), /abort/i);
});

for (const locale of ["zh", "en"]) test(`an unconfirmed timing proposal is playable but cannot collect confirmed feedback (${locale})`, () => {
  const review = { ...selectCoachReviews(analysis)[0], referenceLap: 4, targetLap: 5, reference: trace, target: targetTrace, focus: 50 };
  const states = [];
  const html = renderToStaticMarkup(createElement(ManualReviewTest, { locale, review, fingerprint: "same-session",
    defaultFile: { size: 200, lastModified: 1000, type: "video/mp4" }, defaultUrl: "blob:local", defaultDuration: 500,
    targetCalibration: null, referenceCalibration: source, sessionCalibrations: [source], lapRanges: ranges,
    context: false, onCursor() {}, feedback: state => { states.push(state); return null; } }));
  assert.equal((html.match(/<video/g) ?? []).length, 2);
  assert.match(html, /data-testid="review-timing-candidate"/);
  assert.ok(html.includes(locale === "zh" ? "由已确认 L4 锚点推算" : "Estimated from confirmed L4 anchor"));
  const target = states.find(s => s.side === "target");
  assert.ok(target.clip); assert.equal(target.syncConfirmed, false); assert.equal(target.enabled, false);
});

test("a target's own confirmed anchor takes priority over a cross-lap prediction", () => {
  const target = { ...source, target_lap: 5, telemetry_session_time_s: 151.7, video_time_s: 175.25, offset_ms: 23550 };
  const review = { ...selectCoachReviews(analysis)[0], referenceLap: 4, targetLap: 5, reference: trace, target: targetTrace, focus: 50 };
  const states = [];
  const html = renderToStaticMarkup(createElement(ManualReviewTest, { locale: "en", review, fingerprint: "same-session",
    defaultFile: { size: 200, lastModified: 1000, type: "video/mp4" }, defaultUrl: "blob:local", defaultDuration: 500,
    targetCalibration: target, referenceCalibration: source, sessionCalibrations: [source, target], lapRanges: ranges,
    context: false, onCursor() {}, feedback: state => { states.push(state); return null; } }));
  assert.doesNotMatch(html, /data-testid="review-timing-candidate"/);
  assert.equal(states.find(s => s.side === "target").syncConfirmed, true);
  assert.ok(Math.abs(states.find(s => s.side === "target").clip.focus_s - 175.25) < 1e-9);
});

test("short clips use one real-lap spatial start and exactly five seconds on both sides", () => {
  const start = sharedReviewStart({ reference: trace, focus: 50 });
  assert.equal(start, 40);
  const slower = trace.map(p => ({ ...p, session_time_s: 150 + p.distance_m / 4 }));
  const a = reviewWindowAtOffset(trace, 50, 0, 500, undefined, start);
  const b = reviewWindowAtOffset(slower, 50, 0, 500, undefined, start);
  assert.equal(a.start_s, 108); assert.equal(b.start_s, 160);
  assert.equal(a.end_s - a.start_s, 5); assert.equal(b.end_s - b.start_s, 5);
  assert.equal(reviewDistanceAtTime(trace, a.start_s), reviewDistanceAtTime(slower, b.start_s));
  assert.deepEqual(manualStartBounds(159.55), [159.05, 160.05]);
});

test("five-second clips never shrink, cross a gap or move their requested start", () => {
  assert.equal(reviewWindowAtOffset(trace, 95, 0, 500, undefined, 90), null);
  assert.equal(reviewWindowAtOffset(trace, 50, 0, 110, undefined, 40), null);
  const gap = structuredClone(trace); gap[50].session_time_s = null;
  assert.equal(reviewWindowAtOffset(gap, 55, 0, 500, undefined, 40), null);
  gap[50] = trace[50]; gap[5].session_time_s = null;
  assert.ok(reviewWindowAtOffset(gap, 55, 0, 500, undefined, 40), "irrelevant earlier gaps do not erase a later clip");
  assert.equal(reviewWindowAtOffset(trace, 50, 0, 500, undefined, NaN), null);
});

test("manual start metadata round-trips without rewriting the source anchor or widening its gates", () => {
  const before = JSON.stringify(source);
  const marked = { ...clip, end_s: 10, start_confirmation: { method: "manual_start_plus_five_v1", uncertainty_s: .5,
    distance_m: 25, proposed_start_s: 5.2, source_anchor: source } };
  assert.equal(validateManualReview(marked, trace, 2, video), null);
  assert.deepEqual(restoreManualReview(JSON.stringify([marked]), trace, 2, video), marked);
  assert.equal(JSON.stringify(source), before);
  assert.equal(validateManualReview({ ...marked, end_s: 11 }, trace, 2, video), "invalid_window");
  assert.equal(validateManualReview({ ...marked, start_confirmation: { ...marked.start_confirmation, uncertainty_s: 2 } }, trace, 2, video), "invalid_window");
  assert.ok(restoreManualReview(JSON.stringify([clip]), trace, 2, video), "legacy manual ranges are retained");
});

test("GPS warnings follow manual offset, retain failures and reject another video", () => {
  const check = { segments: [{ session_range_s: [223.537, 241.337], video_range_s: [247.336, 265.136], status: "gps_inconsistent" }] };
  const stored = reviewGpsEvidence(longVideo, check);
  assert.equal(stored.offset_ms, undefined);
  const parsed = parseReviewGpsEvidence(JSON.stringify(stored), longVideo);
  const overlaps = reviewGpsOverlaps(parsed, 258.313, 263.313, 23.464);
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].status, "gps_inconsistent");
  assert.ok(Math.abs(overlaps[0].video_range_s[0] - 247.001) < 1e-9);
  assert.equal(reviewGpsOverlaps(parsed, 200, 205, 23.464).length, 0);
  assert.equal(parseReviewGpsEvidence(JSON.stringify(stored), { ...longVideo, size_bytes: 201 }), null);
  assert.equal(parseReviewGpsEvidence('{"version":1}', longVideo), null);
});

test("flat or repeatedly similar backgrounds cannot confirm synchronization", () => {
  const width = 96, height = 60;
  const flat = { width, height, rgba: new Uint8ClampedArray(width * height * 4).fill(100), time: 5 };
  assert.equal(rankBoundaryFrames(flat, [flat], 5).status, "weak");
  const textured = { ...flat, rgba: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i * 79 % 256) };
  const result = rankBoundaryFrames(textured, [{ ...textured, time: 3 }, { ...textured, time: 5 }, { ...textured, time: 7 }], 5);
  assert.equal(result.status, "ambiguous"); assert.equal(result.sync_confirmed, false); assert.equal(result.time, null);
});
