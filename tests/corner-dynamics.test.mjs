import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const directory = mkdtempSync(join(process.cwd(), ".tmp-corner-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
const output = join(directory, "summary.mjs");
execFileSync("node_modules/.bin/esbuild", ["frontend/components/CornerDynamicsSummary.tsx", "--bundle",
  "--format=esm", "--platform=node", "--jsx=automatic", "--external:react", `--outfile=${output}`], { stdio: "pipe" });
const { CornerDynamicsSummary } = await import(pathToFileURL(output).href);

test("corner summary distinguishes mean intervals and unknown sensor noise in both languages", () => {
  const analysis = { target_lap: 1, corner_dynamics: { status: "calculated", corners: [{ zone_id: "test", name: "Test zone",
    phases: [], comparisons: { minimum_speed_kmh: { target_minus_reference: .1,
      outside_observed_repeatability_band: null, repeatability: { lap_count: 2, mean_ci95: null } } } }] } };
  const zh = renderToStaticMarkup(React.createElement(CornerDynamicsSummary, { analysis, locale: "zh" }));
  const en = renderToStaticMarkup(React.createElement(CornerDynamicsSummary, { analysis, locale: "en" }));
  assert.match(zh, /非差值 CI/);
  assert.match(zh, /尚不能判断/);
  assert.match(zh, /少于 5 圈/);
  assert.match(en, /Sensor noise is uncalibrated/);
  assert.doesNotMatch(zh, /0\.35/);
});

test("old responses do not acquire invented phase results", () => {
  assert.equal(renderToStaticMarkup(React.createElement(CornerDynamicsSummary, { analysis: {}, locale: "en" })), "");
});

test("legacy bootstrap intervals and self-containing comparison flags are hidden", () => {
  const analysis = { target_lap: 1, corner_dynamics: { status: "calculated", corners: [{ zone_id: "test", name: "Test",
    phases: [], comparisons: { minimum_speed_kmh: { target_minus_reference: .1,
      outside_observed_repeatability_band: true, repeatability: { lap_count: 8, mean_ci95: [48.123, 48.456],
        ci_method: "moving_block_bootstrap_lap_means_block2_1000_seed0" } } } }] } };
  const html = renderToStaticMarkup(React.createElement(CornerDynamicsSummary, { analysis, locale: "en" }));
  assert.match(html, /Reanalysis required/);
  assert.doesNotMatch(html, /48\.123|48\.456|Outside empirical band/);
});

test("current intervals expose assumptions and excluded-pair background count", () => {
  const analysis = { target_lap: 1, corner_dynamics: { status: "calculated", corners: [{ zone_id: "test", name: "Test",
    phases: [], comparisons: { minimum_speed_kmh: { target_minus_reference: .1,
      outside_observed_repeatability_band: false, repeatability: { lap_count: 8, mean_ci95: [47.5, 49.5], ci_method: "student_t_iid_mean" },
      background: { method: "leave_two_out", status: "calculated", lap_count: 6, source_laps: [2, 3, 4, 5, 6, 7] } } } }] } };
  const html = renderToStaticMarkup(React.createElement(CornerDynamicsSummary, { analysis, locale: "en" }));
  assert.match(html, /47\.500/);
  assert.match(html, /Background laps.*6/);
  assert.match(html, /serial correlation or drift can cause undercoverage/);
  assert.match(html, /Within empirical band/);
});

test("unavailable selected laps do not get mislabeled as insufficient background", () => {
  const analysis = { target_lap: 1, corner_dynamics: { status: "calculated", corners: [{ zone_id: "test", name: "Test",
    phases: [], comparisons: { minimum_speed_kmh: { target_minus_reference: null,
      outside_observed_repeatability_band: null, repeatability: { lap_count: 8, mean_ci95: [47.5, 49.5], ci_method: "student_t_iid_mean" },
      background: { method: "leave_two_out", status: "calculated", lap_count: 6, source_laps: [2, 3, 4, 5, 6, 7] } } } }] } };
  const html = renderToStaticMarkup(React.createElement(CornerDynamicsSummary, { analysis, locale: "en" }));
  assert.match(html, /Comparison lap unavailable/);
  assert.doesNotMatch(html, /Insufficient background laps/);
});
