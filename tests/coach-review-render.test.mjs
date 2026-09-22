import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(`${root}/tmp`, { recursive: true });
const dir = mkdtempSync(`${root}/tmp/coach-review-test-`);
execFileSync(`${root}/node_modules/.bin/esbuild`, [`${root}/tests/fixtures/coach-review-entry.tsx`, "--bundle", "--format=esm", "--platform=node", "--jsx=automatic",
  "--external:react", "--external:react-dom", "--external:recharts", "--external:lucide-react", `--outfile=${dir}/entry.mjs`], { stdio: "pipe" });
const { CoachReviewTest } = await import(pathToFileURL(`${dir}/entry.mjs`).href);
after(() => rmSync(dir, { recursive: true, force: true }));
const { analysis: demoAnalysis } = JSON.parse(readFileSync(`${root}/public/demo/reviewed-real-session.json`));
const analysis = { ...demoAnalysis, inspection_id: "a".repeat(32), file_fingerprint: "b".repeat(64) };

test("demo reviews never offer a vote, including with a local video attached", () => {
  const html = renderToStaticMarkup(createElement(CoachReviewTest, { analysis: demoAnalysis, locale: "zh", readOnly: true,
    videoUrl: "blob:local-only", videoFile: null, videoDurationS: 50, calibration: null, onSync() {}, onCursor() {} }));
  assert.match(html, /演示模式不收集复核投票/);
  assert.doesNotMatch(html, /<fieldset/);
});

test("Chinese coach review includes real Top 3 and all four selection choices, disabled without video", () => {
  const html = renderToStaticMarkup(createElement(CoachReviewTest, { analysis, locale: "zh", videoUrl: "", videoFile: null, videoDurationS: 0, calibration: null, onSync() {}, onCursor() {} }));
  for (const label of ["Sector 优势", "累计时间差", "系统挑选的复盘片段是否精准", "部分准确", "不准确", "无法判断", "不上传视频"]) assert.ok(html.includes(label), label);
  assert.match(html, /<fieldset disabled/);
  assert.doesNotMatch(html, /<video/);
  assert.doesNotMatch(html, /THEORETICAL BEST|theoretical RPM/i);
});

test("English coach review retains unavailable and no-guarantee boundaries", () => {
  const html = renderToStaticMarkup(createElement(CoachReviewTest, { analysis, locale: "en", videoUrl: "", videoFile: null, videoDurationS: 0, calibration: null, onSync() {}, onCursor() {} }));
  assert.match(html, /Did the system select the right review clip/);
  assert.match(html, /Observed comparison, not promised improvement/);
  assert.match(html, /No local video selected/);
  assert.doesNotMatch(html, /系统挑选/);
});

test("missing telemetry produces an explicit empty state and no fabricated clip", () => {
  const empty = { ...analysis, track: null, top_laps_comparison: { ...analysis.top_laps_comparison, aligned: [] }, sectors: null };
  const html = renderToStaticMarkup(createElement(CoachReviewTest, { analysis: empty, locale: "en", videoUrl: "", videoFile: null, videoDurationS: 0, calibration: null, onSync() {}, onCursor() {} }));
  assert.match(html, /Comparable corner clips are unavailable/);
  assert.doesNotMatch(html, /data-testid="coach-review-card"/);
});
