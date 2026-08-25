import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCoachVideoPair,
  buildCoachVideoWindow,
} from "../frontend/lib/coachVideoEvidence.ts";

const targetTrack = [
  { distance_m: 100, session_time_s: 20 },
  { distance_m: 150, session_time_s: 23 },
  { distance_m: 200, session_time_s: 26 },
];

test("coach evidence creates a four-second clip around the event", () => {
  assert.deepEqual(
    buildCoachVideoWindow(targetTrack, 150, 2_000, 60),
    {
      start_s: 23,
      end_s: 27,
      focus_distance_m: 150,
    },
  );
});

test("coach evidence keeps a full three-to-five-second clip at the boundary", () => {
  const clip = buildCoachVideoWindow(targetTrack, 150, -22_500, 5);
  assert.deepEqual(clip, {
    start_s: 0,
    end_s: 4,
    focus_distance_m: 150,
  });
});

test("coach evidence stays unavailable without usable session time", () => {
  assert.equal(
    buildCoachVideoWindow([{ distance_m: 100, session_time_s: null }], 100, 0, 10),
    null,
  );
});

test("coach evidence rejects clips whose calibrated event is outside the video", () => {
  assert.equal(buildCoachVideoWindow(targetTrack, 200, 40_000, 60), null);
});

test("coach evidence creates two clips from real reference and target lap times", () => {
  const referenceTrack = [
    { distance_m: 150, session_time_s: 8 },
  ];
  assert.deepEqual(
    buildCoachVideoPair(referenceTrack, targetTrack, 150, 150, 2_000, 60),
    {
      reference: { start_s: 8, end_s: 12, focus_distance_m: 150 },
      target: { start_s: 23, end_s: 27, focus_distance_m: 150 },
    },
  );
});

test("coach evidence refuses a partial pair when either lap is outside the video", () => {
  assert.equal(
    buildCoachVideoPair(
      [{ distance_m: 150, session_time_s: 80 }],
      targetTrack,
      150,
      150,
      0,
      60,
    ),
    null,
  );
});
