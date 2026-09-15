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
  "--external:qrcode",
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
    React.createElement(VideoPanelTest, { ...panelProps(overrides), locale: overrides.locale ?? "zh" }),
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

test("SingleLapAnalysisPanel shows the player and hides the upload area when a video is loaded", () => {
  const html = render();
  assert.match(html, /<video/);
  assert.doesNotMatch(html, /accept="video\/\*"/);
  assert.match(html, /更换视频/);
  assert.match(html, /onboard\.MOV/);
});

test("SingleLapAnalysisPanel shows the upload area when no video is loaded", () => {
  const html = render({ videoUrl: "", videoName: "", videoFile: null });
  assert.doesNotMatch(html, /<video/);
  assert.match(html, /accept="video\/\*"/);
  assert.doesNotMatch(html, /更换视频/);
});

test("SingleLapAnalysisPanel shows lap-range and audio auto-mark controls for a loaded video", () => {
  const html = render();
  assert.match(html, /设圈起点/);
  assert.match(html, /设圈终点/);
  assert.match(html, /听声自动标注/);
  assert.match(html, /入弯点/);
  assert.match(html, /单圈分析/);
  assert.match(html, /音频 RPM 自动对齐/);
  assert.match(html, /实时遥测仪表盘/);
});

test("single-lap RPM controls expose actual session laps including non-reference targets", () => {
  const analysis = analysisFixture();
  analysis.lap_rows = [{ lap: 1, lap_time: 40.123 }, { lap: 2, lap_time: 42.567 }];
  analysis.lap_quality.laps = [{ lap: 1, analysis_eligible: true }, { lap: 2, analysis_eligible: false }];
  const html = render({ analysis, onAnalyze: async () => {} });
  assert.match(html, /对应遥测圈 \/ Telemetry lap/);
  assert.match(html, /第 1 圈 · 40\.123s/);
  assert.match(html, /第 2 圈 · 42\.567s · 非参考圈/);
  assert.match(html, /<option value="2" selected=""/);
  assert.match(html, /视频段起点（秒）/);
  assert.match(html, /视频段终点（秒）/);
  assert.doesNotMatch(html, /第 3 圈/);
});

test("lap selection locks during analysis and RPM is disabled without a measured channel", () => {
  const analysis = analysisFixture();
  analysis.capabilities.rpm = false;
  const html = render({ analysis, analyzing: true, onAnalyze: async () => {} });
  assert.match(html, /<select aria-label="对应遥测圈 \/ Telemetry lap" disabled=""/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>(?:.|\n)*?音频 RPM 自动对齐/);
});

test("single-lap controls support English labels", () => {
  const html = render({ locale: "en" });
  assert.match(html, /Telemetry lap \/ 对应遥测圈/);
  assert.match(html, /Video segment start \(s\)/);
  assert.match(html, /Video segment end \(s\)/);
});
