import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isPublishedRealDemo,
  loadPublishedRealDemo,
} from "../frontend/lib/realDemoSession.ts";

function reviewedEnvelope() {
  const qualityLaps = [{ lap: 1 }, { lap: 2 }, { lap: 3 }];
  return {
    schema_version: 1,
    provenance: {
      dataset_kind: "anonymized_real_session",
      derived_from_real_session: true,
      publication_permission: "confirmed",
      telemetry_values: "measured_or_backend_calculated_only",
    },
    privacy_review: {
      status: "passed",
      private_identifiers_removed: true,
      free_text_reviewed: true,
    },
    display: {
      driver: "Anonymous Driver",
      vehicle: "Anonymous Kart",
      track: "Anonymous Circuit",
      date: "Private",
    },
    analysis: {
      format: "aim_xrk_analysis",
      inspection_id: "private-token",
      file_fingerprint: "private-fingerprint",
      metadata: { Driver: "private value" },
      track: {
        track_id: "private-track-id",
        reference: [
          { distance_m: 0, local_x_m: 0, local_y_m: 0 },
          { distance_m: 1, local_x_m: 1, local_y_m: 1 },
        ],
      },
      comparison: [
        { distance_m: 0, reference_rpm: 1, target_rpm: 1 },
        { distance_m: 1, reference_rpm: 1, target_rpm: 1 },
      ],
      lap_quality: { top_valid_laps: qualityLaps },
      top_laps_comparison: {
        synthetic_curve_generated: false,
        laps: qualityLaps,
        aligned: [{}, {}],
      },
      consensus_benchmark: {
        reference_policy: "real_completed_reference_eligible_laps_only",
        synthetic_curve_generated: false,
        lap_order: [1, 2, 3],
        corners: [{}],
      },
      sectors: {
        lap_rows: [
          { lap: 1, lap_time: 1 },
          { lap: 2, lap_time: 1 },
          { lap: 3, lap_time: 1 },
        ],
      },
      zones: { active: [{}], comparisons: [{}] },
    },
  };
}

test("does not request an asset when the real demo is not configured", async () => {
  let called = false;
  const result = await loadPublishedRealDemo("", async () => {
    called = true;
    throw new Error("unexpected fetch");
  });

  assert.equal(result, null);
  assert.equal(called, false);
});

test("accepts only same-origin reviewed real-session artifacts", async () => {
  const artifact = reviewedEnvelope();
  const result = await loadPublishedRealDemo(
    "/demo/reviewed-session.json",
    async () => new Response(JSON.stringify(artifact), { status: 200 }),
  );

  assert.equal(result?.display.driver, "Anonymous Driver");
  assert.deepEqual(result?.analysis.metadata, { data_source: "Anonymized real session" });
  assert.equal(result?.analysis.inspection_id, "published-demo");
  assert.equal(result?.analysis.file_fingerprint, "redacted");
  assert.equal(result?.analysis.track?.track_id, "anonymous-circuit");
  assert.equal(
    await loadPublishedRealDemo(
      "https://untrusted.example/session.json",
      async () => new Response(JSON.stringify(artifact), { status: 200 }),
    ),
    null,
  );
});

test("rejects missing publication review and synthetic reference curves", () => {
  const unreviewed = reviewedEnvelope();
  unreviewed.provenance.publication_permission = "unknown";
  assert.equal(isPublishedRealDemo(unreviewed), false);

  const synthetic = reviewedEnvelope();
  synthetic.analysis.top_laps_comparison.synthetic_curve_generated = true;
  assert.equal(isPublishedRealDemo(synthetic), false);
});

test("bundled artifact is a reviewed real session without private coordinate fields", () => {
  const artifact = JSON.parse(
    readFileSync(new URL("../public/demo/reviewed-real-session.json", import.meta.url), "utf8"),
  );

  assert.equal(isPublishedRealDemo(artifact), true);
  assert.equal(artifact.analysis.lap_rows.length, 13);
  assert.equal(artifact.analysis.fastest_lap.lap, 13);
  assert.equal(artifact.analysis.fastest_lap.lap_time, 40.326);
  assert.deepEqual(artifact.analysis.metadata, { data_source: "Anonymized real session" });
  assert.equal(artifact.analysis.inspection_id, "published-demo");
  assert.equal(artifact.analysis.file_fingerprint, "redacted");
  assert.equal(artifact.analysis.track.track_id, "anonymous-circuit");
  assert.equal(hasPrivateCoordinateKey(artifact), false);
  assert.doesNotMatch(JSON.stringify(artifact), /\.xrk|\/Users\//i);
});

function hasPrivateCoordinateKey(value) {
  if (Array.isArray(value)) return value.some(hasPrivateCoordinateKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => (
    /gps_(lat|lon)|latitude|longitude/i.test(key) || hasPrivateCoordinateKey(item)
  ));
}
