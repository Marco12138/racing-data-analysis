import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(`${root}/tmp`, { recursive: true });
const dir = mkdtempSync(`${root}/tmp/gnss-review-test-`);
execFileSync(`${root}/node_modules/.bin/esbuild`, [`${root}/tests/fixtures/gnss-sync-entry.tsx`, "--bundle", "--format=esm", "--platform=node", "--jsx=automatic",
  "--external:react", "--external:react-dom", "--external:recharts", "--external:lucide-react", "--external:mp4box", "--external:gopro-telemetry", `--outfile=${dir}/entry.mjs`], { stdio: "pipe" });
const { GnssSyncTest, GoproPanelTest } = await import(pathToFileURL(`${dir}/entry.mjs`).href);
after(() => rmSync(dir, { recursive: true, force: true }));
const result = { offset_ms: 23700, status: "weak", evidence: { clock_offset_ms: 23800,
  matched_video_range_s: [24, 300], matched_telemetry_range_s: [.3, 276.3], lap_coverage: [{ lap: 1, coverage: "full" }],
  speed_check: { passed: false, validation_max_residual_s: .35 }, spatial_check: { median_error_m: 2.5 },
  reason_codes: ["AIM_TOW_QUANTIZED", "SENSOR_VIDEO_LATENCY_UNCALIBRATED"] } };

test("Chinese GNSS candidate shows limitations and requires three checks", () => {
  const html = renderToStaticMarkup(createElement(GnssSyncTest, { locale: "zh", result,
    points: [1, 2, 3].map((t) => ({ video_time_s: t+23.7, session_time_s: t, distance_m: t*10 })), onPreview() {}, onDecision() { return true; } }));
  for (const text of ["证据不足", "阶梯记录", "尚未标定", "不代表帧级精度", "圈中", "L1"]) assert.ok(html.includes(text), text);
  assert.match(html, /<button[^>]+disabled=""[^>]*>.*?确认并保存/s);
  assert.doesNotMatch(html, /已保存人工确认/);
});

test("English review remains unavailable without full-lap coverage", () => {
  const html = renderToStaticMarkup(createElement(GnssSyncTest, { locale: "en", result, points: [], onPreview() {}, onDecision() { return true; } }));
  assert.match(html, /not fully covered/);
  assert.match(html, /uncalibrated/);
  assert.doesNotMatch(html, /圈中|精度/);
});

test("demo cannot request GNSS sync and privacy is explicit", () => {
  const html = renderToStaticMarkup(createElement(GoproPanelTest, { locale: "zh", file: new File([], "private.mp4"), duration: 300,
    inspectionId: "public-demo", points: [], disabled: false, onPreview() {}, onDecision() { return true; } }));
  assert.match(html, /<button[^>]+disabled=""/);
  assert.match(html, /视频留在本机/);
  assert.match(html, /相机 IMU 不用于车体分析/);
});

test("playback-unavailable is not mislabeled as a wrong target lap", () => {
  const html = renderToStaticMarkup(createElement(GnssSyncTest, { locale: "zh", result, points: [], playbackUnavailable: true,
    onPreview() {}, onDecision() { return true; } }));
  assert.match(html, /需先解决播放问题/);
  assert.doesNotMatch(html, /请选择覆盖列表/);
});
