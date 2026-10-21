import assert from "node:assert/strict";
import { test } from "node:test";
import { REVIEW_STEPS, guidedReviewKey, reviewDecision, buildGuidedDebrief } from "../frontend/lib/guidedReview.ts";

const review = { id: "zone-1", name: "Zone 1", referenceLap: 4, targetLap: 5, netLoss: .12 };
const receipt = side => ({ reviewKey: guidedReviewKey(review), side, clipId: side, verdict: "accurate", current: true, syncConfirmed: true });
test("six bilingual steps remain task ordered, with optional custom review before debrief", () => {
  assert.equal(REVIEW_STEPS.length, 6);
  assert.equal(REVIEW_STEPS[2][1], "Pair a lap");
  assert.equal(REVIEW_STEPS[4][1], "Your corner");
  assert.ok(REVIEW_STEPS.every(s => s.length === 2 && s.every(Boolean)));
});
test("debrief needs both currently checked, synchronized sides, not just one saved vote", () => {
  assert.equal(reviewDecision(review, [receipt("reference")]), "pending");
  assert.equal(reviewDecision(review, [receipt("reference"), receipt("target")]), "confirmed");
  for (const changed of [{ current: false }, { syncConfirmed: false }, { clipId: "" }, { verdict: "uncertain" }, { verdict: "partly_accurate" }]) {
    assert.equal(reviewDecision(review, [receipt("reference"), { ...receipt("target"), ...changed }]), "pending");
  }
});
test("rejected, stale and different-lap evidence never becomes a training recommendation", () => {
  const rejected = buildGuidedDebrief([review], [receipt("reference"), { ...receipt("target"), verdict: "inaccurate" }]);
  assert.equal(rejected.opportunities.length, 0); assert.equal(rejected.rejected.length, 1);
  assert.equal(reviewDecision({ ...review, targetLap: 6 }, [receipt("reference"), receipt("target")]), "pending");
  assert.equal(reviewDecision(review, [{ ...receipt("target"), verdict: "inaccurate", current: false }]), "pending");
});
test("descriptive strengths and opportunities stay separate with no summed target time", () => {
  const strength = { ...review, id: "zone-2", netLoss: -.05 };
  const votes = [review, strength].flatMap(r => ["reference", "target"].map(side => ({ ...receipt(side), reviewKey: guidedReviewKey(r) })));
  const result = buildGuidedDebrief([review, strength], votes);
  assert.deepEqual(result.opportunities, [review]); assert.deepEqual(result.strengths, [strength]);
  assert.deepEqual(Object.keys(result).sort(), ["opportunities", "pending", "rejected", "strengths"]);
});
