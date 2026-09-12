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
