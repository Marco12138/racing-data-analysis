import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const directory = mkdtempSync(join(process.cwd(), ".tmp-xrk-trust-"));
after(() => rmSync(directory, { recursive: true, force: true }));
const output = join(directory, "inspection.mjs");
execFileSync("node_modules/.bin/esbuild", [
  "frontend/components/XrkInspectionWorkspace.tsx", "--bundle", "--format=esm",
  "--platform=node", "--jsx=automatic", "--external:react", "--external:lucide-react", `--outfile=${output}`,
], { stdio: "pipe" });
const { XrkInspectionWorkspace } = await import(pathToFileURL(output).href);

test("inspection distinguishes GPS-derived yaw from physical and calibrated sensors", () => {
  const html = renderToStaticMarkup(React.createElement(XrkInspectionWorkspace, {
    onContinue() {}, analyzing: false,
    inspection: {
      filename: "mock.xrk", file_size_bytes: 100, laps: 1,
      session_summary: { fastest_lap: null, session_duration_s: 1 },
      parser: { library: "mock", version: "test", platform: "test" },
      processing_duration_ms: 1, warnings: [], warning_codes: [],
      has_gyro: true, has_accelerometer: true, has_gps_yaw: true,
      sensor_capabilities: { gyro_present: false, accelerometer_present: false, body_dynamics_available: false },
      channels: [{ name: "GPS_Yaw_Rate", canonical_name: "yaw_rate", source: "gps_derived",
        evidence_class: "calculated", unit: "deg/s", available: true, all_zero: true,
        sample_count: 20, native_sample_rate_hz: 10, sample_rate_hz: 9, analysis_usage: [] }],
    },
  }));
  assert.match(html, /gps_derived/);
  assert.match(html, /calculated/);
  assert.match(html, /10.0 Hz/);
  assert.match(html, /存在但信息不足/);
  assert.match(html, /Physical gyro[^]*?Unavailable/);
  assert.match(html, /Body dynamics[^]*?Unavailable/);
});
