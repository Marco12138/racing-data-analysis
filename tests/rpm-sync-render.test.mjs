import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(`${root}/tmp`, { recursive: true });
const dir = mkdtempSync(`${root}/tmp/rpm-review-test-`);
execFileSync(`${root}/node_modules/.bin/esbuild`, [`${root}/tests/fixtures/rpm-sync-entry.tsx`, "--bundle", "--format=esm", "--platform=node", "--jsx=automatic",
  "--external:react", "--external:react-dom", "--external:recharts", "--external:lucide-react", `--outfile=${dir}/entry.mjs`], { stdio: "pipe" });
const { RpmSyncTest } = await import(pathToFileURL(`${dir}/entry.mjs`).href);
after(() => rmSync(dir, { recursive: true, force: true }));
const result = { offset_ms: -8500, status: "ambiguous", evidence: { best_correlation: .95,
  selected_method: "dominant_band", window_offset_spread_s: .1, reason_codes: ["REPEATED_LAP_AMBIGUITY"],
  distant_alternative: { offset_s: 33, correlation: .94 } } };

test("Chinese review exposes ambiguity and cannot confirm before three checks", () => {
  const html = renderToStaticMarkup(createElement(RpmSyncTest, { result, locale: "zh", verdict: null,
    points: [1,2,3].map((t) => ({ video_time_s:t, session_time_s:t+8.5, distance_m:t*20 })), onPreview() {}, onDecision() {} }));
  for (const text of ["存在错圈", "另一圈也可能匹配", "不是成功概率", "圈中", "不吻合", "不确定"]) assert.ok(html.includes(text), text);
  assert.match(html, /<button[^>]+disabled=""[^>]*>.*?确认并保存同步/s);
  assert.doesNotMatch(html, /已保存人工确认/);
});

test("English review degrades when the lap is not covered", () => {
  const html = renderToStaticMarkup(createElement(RpmSyncTest, { result, locale: "en", points: [], verdict: null, onPreview() {}, onDecision() {} }));
  assert.match(html, /does not cover the current lap/);
  assert.match(html, /not a probability/);
  assert.doesNotMatch(html, /已保存|起点附近/);
});

test("partial recordings show independent clocks and only candidate lap coverage", () => {
  const partial = { ...result, status: "weak", evidence: { ...result.evidence,
    reason_codes: ["PARTIAL_RECORDING_OVERLAP"], matched_video_range_s: [0,60], matched_telemetry_range_s: [240,300],
    lap_coverage: [{ lap:5, coverage:"partial" }, { lap:6, coverage:"full" }, { lap:7, coverage:"partial" }],
  } };
  for (const locale of ["zh", "en"]) {
    const html = renderToStaticMarkup(createElement(RpmSyncTest, { result:partial, locale, points:[], verdict:null, onPreview(){}, onDecision(){} }));
    assert.match(html, /240\.00/);
    assert.match(html, /0\.00/);
    assert.match(html, /L6/);
    assert.match(html, /L5, L7/);
    assert.match(html, locale === "zh" ? /待核对/ : /unverified/);
  }
});
