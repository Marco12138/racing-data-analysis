import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calibratedReviewWindow, reviewIdentity, reviewValue, selectCoachReviews } from "../frontend/lib/coachReview.ts";
import { submitClipFeedback } from "../frontend/lib/feedbackApi.ts";

function fixture() {
  const trace = (lap, factor) => Array.from({ length: 101 }, (_, d) => ({ distance_m: d, lap_time_s: d * factor,
    session_time_s: 100 * lap + d * factor, speed: 60 - Math.abs(d - 50), rpm: 8000 + d, local_x_m: d, local_y_m: 0 }));
  return {
    reference_lap: 1, target_lap: 4,
    track: { reference: trace(1, .2), target: trace(4, .25) },
    lap_quality: { top_valid_laps: [1, 2, 3].map(lap => ({ lap, analysis_eligible: true })) },
    top_laps_comparison: { aligned: trace(2, .19).map((r, i) => ({ distance_m: i,
      ...Object.fromEntries(Object.entries(r).map(([k, v]) => [`lap_2_${k}`, v])),
      ...Object.fromEntries(Object.entries(trace(3, .23)[i]).map(([k, v]) => [`lap_3_${k}`, v])),
    })) },
    consensus_benchmark: { corners: [{ corner_id: "corner-1", corner: "Zone 1", entry_distance_m: 20, exit_distance_m: 60, downstream_end_distance_m: 90, occurrence_count: 2, supporting_laps: [1, 2] }] },
  };
}

test("selects one real Top 3 reference by complete corner plus downstream, without mutating data", () => {
  const analysis = fixture(), before = structuredClone(analysis);
  const [review] = selectCoachReviews(analysis);
  assert.equal(review.referenceLap, 2);
  assert.equal(review.targetLap, 4);
  assert.ok(Math.abs(review.netLoss - 4.2) < 1e-8);
  assert.ok(Math.abs(review.netLoss - review.localLoss - review.downstreamDelta) < 1e-8);
  assert.deepEqual(analysis, before);
});

test("ineligible fast laps cannot enter selection and missing data is not padded", () => {
  const analysis = fixture();
  analysis.lap_quality.top_valid_laps[1].analysis_eligible = false;
  assert.equal(selectCoachReviews(analysis)[0].referenceLap, 1);
  analysis.track.target[50].lap_time_s = null;
  assert.deepEqual(selectCoachReviews(analysis), []);
});

test("bounded trace lookup rejects extrapolation, nulls and long gaps", () => {
  const trace = fixture().track.target;
  assert.equal(reviewValue(trace, -1, "speed"), null);
  assert.equal(reviewValue(trace, 101, "speed"), null);
  trace[4].speed = null;
  assert.equal(reviewValue(trace, 3.5, "speed"), null);
  assert.equal(reviewValue([trace[1], trace[40]], 20, "speed"), null);
});

const file = { size: 200, lastModified: 100, type: "video/mp4" };
const calibration = { target_lap: 4, offset_ms: -400000, video: { duration_s: 30, size_bytes: 200, last_modified_ms: 100 } };

test("video windows require their own lap calibration and matching file identity", () => {
  const trace = fixture().track.target;
  assert.deepEqual(calibratedReviewWindow(trace, 4, 50, calibration, file, 30), { start_s: 10.5, end_s: 14.5, focus_s: 12.5 });
  assert.equal(calibratedReviewWindow(trace, 1, 50, calibration, file, 30), null);
  assert.equal(calibratedReviewWindow(trace, 4, 50, null, file, 30), null);
  assert.equal(calibratedReviewWindow(trace, 4, 50, calibration, { ...file, size: 300 }, 30), null);
  assert.equal(calibratedReviewWindow(trace, 4, 500, calibration, file, 30), null);
});

test("longer context is derived from real boundary times, not a fixed duration", () => {
  assert.deepEqual(calibratedReviewWindow(fixture().track.target, 4, 50, calibration, file, 30, { entry: 20, exit: 90 }),
    { start_s: 5, end_s: 22.5, focus_s: 12.5 });
});

test("missing edge timestamps do not hide valid video coverage or fabricate boundary times", () => {
  const trace = fixture().track.target;
  trace[0].session_time_s = null;
  trace.at(-1).session_time_s = null;
  assert.deepEqual(calibratedReviewWindow(trace, 4, 50, calibration, file, 30),
    { start_s: 10.5, end_s: 14.5, focus_s: 12.5 });
  assert.equal(calibratedReviewWindow(trace, 4, 50, calibration, file, 30, { entry: 0, exit: 100 }), null);
});

test("changing lap, synchronization or clip bounds invalidates the feedback identity", async () => {
  assert.equal(await reviewIdentity([1, 2]), await reviewIdentity([1, 2]));
  assert.notEqual(await reviewIdentity([1, 2]), await reviewIdentity([1, 3]));
});

test("feedback uses only the dedicated contract and requires server acknowledgement", async () => {
  const payload = { feedback_id: "a".repeat(32), clip_id: "b".repeat(64), verdict: "accurate" };
  let body;
  assert.equal(await submitClipFeedback("https://backend.example/", "/api/v1/", payload, async (url, init) => {
    assert.equal(url, "https://backend.example/api/v1/feedback/clip-selection");
    body = JSON.parse(init.body);
    return Response.json({ received: true, id: payload.feedback_id, verdict: payload.verdict });
  }), true);
  assert.deepEqual(body, payload);
  assert.equal(await submitClipFeedback("", "/api/v1", payload, async () => Response.json({ received: false })), false);
  assert.equal(await submitClipFeedback("", "/api/v1", payload, async () => { throw Error("offline"); }), false);
});

test("reviewed public artifact yields traceable clips, never invented laps or a synthetic curve", () => {
  const resource = JSON.parse(readFileSync(new URL("../public/demo/reviewed-real-session.json", import.meta.url)));
  const analysis = resource.analysis;
  const rows = selectCoachReviews(analysis);
  assert.ok(rows.length > 0 && rows.length <= 3);
  for (const row of rows) {
    assert.ok(analysis.lap_quality.top_valid_laps.some(lap => lap.lap === row.referenceLap));
    assert.equal(row.targetLap, analysis.target_lap);
    assert.ok(Number.isFinite(row.netLoss));
  }
});
