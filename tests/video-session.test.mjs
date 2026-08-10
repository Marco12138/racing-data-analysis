import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { initialVideoState } from "../frontend/lib/videoSession.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, ".tmp-xrk-test");
const outFile = join(outDir, "workspace.mjs");

mkdirSync(outDir, { recursive: true });
execFileSync(join(root, "node_modules/.bin/esbuild"), [
  join(root, "tests/fixtures/video-panel-entry.tsx"),
  "--bundle",
  "--format=esm",
  "--platform=node",
  "--jsx=automatic",
  "--external:react",
  "--external:react-dom",
  "--external:recharts",
  "--external:lucide-react",
  "--external:html-to-image",
  `--outfile=${outFile}`,
], { stdio: "pipe" });
const { VideoPanelTest } = await import(pathToFileURL(outFile).href);

after(() => {
  rmSync(outDir, { recursive: true, force: true });
});

function analysisFixture() {
  return {
    inspection_id: "a".repeat(32),
    expires_at: "2026-08-17T00:00:00+00:00",
    file_fingerprint: "fixture",
    metadata: {},
    capabilities: {
      gps: true,
      rpm: true,
      lap_timing: true,
      official_sectors: false,
      direct_brake: false,
      direct_throttle: false,
    },
    reference_lap: 1,
    target_lap: 2,
    fastest_lap: { lap: 1, lap_time: 10.0 },
    lap_rows: [],
    track: {
      track_id: "fixture-track",
      lap_length_m: 800,
      reference_lap: 1,
      target_lap: 2,
      reference: [],
      target: [],
    },
    comparison: [],
    lap_quality: {
      config: { absolute_gap_threshold_s: 0.5, relative_gap_threshold_pct: 1 },
      laps: [],
      reference_eligible_count: 0,
      top_valid_laps: [],
      fastest_consistent_lap: null,
      minimum_top_laps_met: false,
      notice: null,
    },
    top_laps_comparison: {
      laps: [],
      fastest_consistent_lap: null,
      aligned: [],
      distance_step_m: null,
      synthetic_curve_generated: false,
    },
    events: [],
    event_comparison: [],
    sectors: null,
    zones: { automatic: [], active: [], comparisons: [] },
    evidence_catalog: {},
    consensus_benchmark: {
      reference_policy: "real_completed_reference_eligible_laps_only",
      lap_order: [],
      lap_count: 0,
      synthetic_curve_generated: false,
      corners: [],
    },
    achievable_improvement_range: {
      minimum_improvement_s: 0,
      maximum_improvement_s: 0,
      confidence: "low",
      basis: [],
      source_laps: [],
      limitations: [],
    },
    ai_coach_summary: {
      reference_statement: "",
      top_valid_laps: [],
      common_fast_patterns: [],
      fastest_lap_net_differences: [],
      fastest_lap_unique_features: [],
      emerging_improvements: [],
      rejected_apparent_improvements: [],
      training_priorities: [],
      stable_strengths: [],
      limitations: [],
    },
    video_sync: {},
    warnings: [],
    report: "",
  };
}

function noop() {}

function panelProps(overrides = {}) {
  return {
    analysis: analysisFixture(),
    cursorDistance: 0,
    seekRequest: null,
    onCursor: noop,
    videoUrl: "blob:test-video",
    videoName: "onboard.MOV",
    videoFile: new File(["x"], "onboard.MOV", { type: "video/quicktime" }),
    videoDurationS: 620,
    calibration: null,
    offsetMs: 0,
    setVideoUrl: noop,
    setVideoName: noop,
    setVideoFile: noop,
    setVideoDurationS: noop,
    setCalibration: noop,
    setOffsetMs: noop,
    ...overrides,
  };
}

function render(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(VideoPanelTest, { ...panelProps(overrides), locale: "zh" }),
  );
}

test("initialVideoState builds the player state from an initial file", () => {
  const file = new File(["x"], "onboard.MOV", { type: "video/quicktime" });
  const state = initialVideoState(file, () => "blob:initial");
  assert.equal(state.videoUrl, "blob:initial");
  assert.equal(state.videoName, "onboard.MOV");
  assert.equal(state.videoFile, file);

  const empty = initialVideoState(null, () => "blob:unused");
  assert.equal(empty.videoUrl, "");
  assert.equal(empty.videoName, "");
  assert.equal(empty.videoFile, null);
});

test("VideoSyncPanel shows the player and hides the upload area when a video is loaded", () => {
  const html = render();
  assert.match(html, /<video/);
  assert.doesNotMatch(html, /accept="video\/\*"/);
  assert.match(html, /更换视频/);
  assert.match(html, /onboard\.MOV/);
});

test("VideoSyncPanel shows the upload area when no video is loaded", () => {
  const html = render({ videoUrl: "", videoName: "", videoFile: null });
  assert.doesNotMatch(html, /<video/);
  assert.match(html, /accept="video\/\*"/);
  assert.doesNotMatch(html, /更换视频/);
});
