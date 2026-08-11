import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSessionSummary,
  findRepeatedWeaknesses,
  perTrackFastestCurve,
  rankTrainingPriorities,
  summarizeProfile,
} from "../frontend/lib/driverProfile.ts";

function summary(overrides = {}) {
  return buildSessionSummary({
    inspection_id: "s1",
    track_id: "track-a",
    track_name: "Track A",
    driver_name: "Driver",
    vehicle_name: "Kart",
    fastest_lap: { lap: 13, lap_time: 40.5 },
    corner_improvements: [
      { corner: "Zone 4", net_gain: 0.24 },
      { corner: "Zone 1", net_gain: 0.05 },
    ],
    training_priorities: ["Test a sustained RPM recovery near 282.0 m."],
    ...overrides,
  });
}

test("buildSessionSummary filters non-positive gains and applies defaults", () => {
  const built = buildSessionSummary({
    inspection_id: "x",
    track_id: "",
    track_name: "",
    driver_name: "D",
    vehicle_name: "V",
    fastest_lap: { lap: 1, lap_time: 42.0 },
    corner_improvements: [
      { corner: "A", net_gain: 0.2 },
      { corner: "B", net_gain: 0 },
      { corner: "C", net_gain: -0.1 },
    ],
    training_priorities: [],
  });
  assert.equal(built.track_id, "unknown-track");
  assert.equal(built.track_name, "Unknown track");
  assert.deepEqual(built.corner_improvements, [{ corner: "A", net_gain: 0.2 }]);
  assert.equal(typeof built.analyzed_at, "number");
});

test("perTrackFastestCurve groups by track and orders by time", () => {
  const sessions = [
    summary({ inspection_id: "a", analyzed_at: 100, fastest_lap: { lap: 1, lap_time: 41.0 } }),
    summary({ inspection_id: "b", analyzed_at: 300, fastest_lap: { lap: 2, lap_time: 40.5 } }),
    summary({ inspection_id: "c", analyzed_at: 200, fastest_lap: { lap: 1, lap_time: 40.2 } }),
  ];
  const curve = perTrackFastestCurve(sessions);
  assert.equal(curve.length, 1);
  assert.deepEqual(curve[0].laps.map((lap) => lap.lap_time), [41.0, 40.2, 40.5]);
});

test("findRepeatedWeaknesses requires 3+ sessions and 0.1s+ net gain", () => {
  const sessions = [
    summary({ inspection_id: "a", corner_improvements: [{ corner: "Zone 4", net_gain: 0.24 }] }),
    summary({ inspection_id: "b", corner_improvements: [{ corner: "Zone 4", net_gain: 0.18 }] }),
    summary({ inspection_id: "c", corner_improvements: [{ corner: "Zone 4", net_gain: 0.12 }] }),
    summary({ inspection_id: "d", corner_improvements: [{ corner: "Zone 1", net_gain: 0.24 }] }),
    summary({ inspection_id: "e", corner_improvements: [{ corner: "Zone 1", net_gain: 0.24 }] }),
  ];
  const weaknesses = findRepeatedWeaknesses(sessions);
  assert.equal(weaknesses.length, 1);
  assert.equal(weaknesses[0].corner, "Zone 4");
  assert.equal(weaknesses[0].sessions_count, 3);
  assert.equal(weaknesses[0].average_net_gain, 0.18);
});

test("rankTrainingPriorities counts weekly priorities and sorts by frequency", () => {
  const now = Date.now();
  const sessions = [
    summary({
      inspection_id: "a",
      analyzed_at: now - 1000,
      training_priorities: ["Recovery near 282.0 m", "Lift near 110.0 m"],
    }),
    summary({
      inspection_id: "b",
      analyzed_at: now - 2000,
      training_priorities: ["Recovery near 282.0 m"],
    }),
    summary({
      inspection_id: "old",
      analyzed_at: now - 8 * 24 * 3600 * 1000,
      training_priorities: ["Recovery near 282.0 m"],
    }),
  ];
  const focus = rankTrainingPriorities(sessions);
  assert.deepEqual(focus.map((item) => item.priority), ["Recovery near 282.0 m", "Lift near 110.0 m"]);
  assert.equal(focus[0].sessions, 2);
});

test("summarizeProfile aggregates the profile view", () => {
  const profile = summarizeProfile([
    summary({ inspection_id: "a" }),
    summary({ inspection_id: "b" }),
    summary({ inspection_id: "c" }),
  ]);
  assert.equal(profile.total_sessions, 3);
  assert.equal(profile.tracks.length, 1);
  assert.equal(profile.weaknesses.length, 1);
  assert.ok(Array.isArray(profile.weekly_focus));
});
