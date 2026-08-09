import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parsePublicDemoSummary } from "../frontend/lib/publicDemo.ts";

function summary() {
  return {
    schema_version: 1,
    provenance: {
      dataset_kind: "anonymized_real_session",
      derived_from_real_session: true,
      publication_permission: "confirmed",
    },
    display: { driver: "Anonymous Driver", vehicle: "Anonymous Kart", track: "Anonymous Circuit" },
    fastest_lap: { lap: 13, lap_time: 40.326 },
    lap_rows: [{ lap: 13, lap_time: 40.326 }],
    track: {
      lap_length_m: 818.6,
      points: [
        { distance_m: 0, local_x_m: 0, local_y_m: 0 },
        { distance_m: 10, local_x_m: 10, local_y_m: 2 },
      ],
    },
    sector_loss: {
      source: "virtual_distance",
      official: false,
      sector_best: { sector_1: 12.8 },
      laps: [],
    },
    summary: { source: "structured", narrative: null, bullets: ["Measured values only."] },
    synthetic_curve_generated: false,
  };
}

test("accepts a publication-reviewed real demo summary", () => {
  assert.equal(parsePublicDemoSummary(summary())?.fastest_lap.lap_time, 40.326);
});

test("rejects synthetic or unreviewed public demo summaries", () => {
  assert.equal(parsePublicDemoSummary({ ...summary(), synthetic_curve_generated: true }), null);
  assert.equal(parsePublicDemoSummary({
    ...summary(),
    provenance: { ...summary().provenance, publication_permission: "unknown" },
  }), null);
});

test("frontend contract accepts the backend packaged real-session summary", () => {
  const packaged = JSON.parse(readFileSync(
    new URL("../backend/app/resources/demo_session.json", import.meta.url),
    "utf8",
  ));
  const parsed = parsePublicDemoSummary(packaged);
  assert.equal(parsed?.fastest_lap.lap, 13);
  assert.equal(parsed?.fastest_lap.lap_time, 40.326);
  assert.equal(parsed?.lap_rows.length, 13);
  assert.equal(parsed?.synthetic_curve_generated, false);
});
