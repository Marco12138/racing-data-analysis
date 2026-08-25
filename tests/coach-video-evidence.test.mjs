import assert from "node:assert/strict";
import test from "node:test";

import { buildCoachVideoWindow } from "../frontend/lib/coachVideoEvidence.ts";

const targetTrack = [
  { distance_m: 100, session_time_s: 20 },
  { distance_m: 150, session_time_s: 23 },
  { distance_m: 200, session_time_s: 26 },
];

test("coach evidence maps a telemetry zone to a padded video clip", () => {
  assert.deepEqual(
    buildCoachVideoWindow(targetTrack, 100, 200, 2_000, 60, 1),
    {
      start_s: 21,
      end_s: 29,
      entry_distance_m: 100,
      exit_distance_m: 200,
    },
  );
});

test("coach evidence clamps clips to the local video duration", () => {
  const clip = buildCoachVideoWindow(targetTrack, 150, 200, -22_500, 5, 1);
  assert.deepEqual(clip, {
    start_s: 0,
    end_s: 4.5,
    entry_distance_m: 150,
    exit_distance_m: 200,
  });
});

test("coach evidence stays unavailable without usable session time", () => {
  assert.equal(
    buildCoachVideoWindow([{ distance_m: 100, session_time_s: null }], 90, 110, 0, 10),
    null,
  );
});
