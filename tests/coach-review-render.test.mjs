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
const { CoachReviewTest, CoachDebriefTest, reviewContextBounds, reviewStartDistance } = await import(pathToFileURL(`${dir}/entry.mjs`).href);
after(() => rmSync(dir, { recursive: true, force: true }));
const { analysis: demoAnalysis } = JSON.parse(readFileSync(`${root}/public/demo/reviewed-real-session.json`));
const analysis = { ...demoAnalysis, video_review: undefined, inspection_id: "a".repeat(32), file_fingerprint: "b".repeat(64) };

test("full-context confirmation binds the displayed approach, not the five-second preview", () => {
  const trace = Array.from({length: 201}, (_, i) => ({distance_m:i, session_time_s:i / 10,
    lap_time_s:i / 10, speed:i < 40 ? 65 + i / 8 : i < 70 ? 70 - (i - 40) * 4 / 3 : Math.min(70, 30 + (i - 70)),
    rpm:8000,local_x_m:i,local_y_m:0}));
  const review = {entry:60,exit:90,downstreamEnd:110,focus:70,target:trace,reference:trace};
  const saved = JSON.stringify(review), bounds = reviewContextBounds(review);
  assert.ok(bounds.entry < 40);
  assert.ok(bounds.exit >= 110);
  assert.equal(reviewStartDistance(review,true),bounds.entry);
  assert.equal(reviewStartDistance(review,false),50);
  assert.notEqual(reviewStartDistance(review,true),reviewStartDistance(review,false));
  assert.equal(JSON.stringify(review), saved);
});

test("demo reviews never offer a vote, including with a local video attached", () => {
  const html = renderToStaticMarkup(createElement(CoachReviewTest, { analysis: demoAnalysis, locale: "zh", readOnly: true,
    videoUrl: "blob:local-only", videoFile: null, videoDurationS: 50, calibration: null, onSync() {}, onCursor() {} }));
  assert.match(html, /样例不收集教练投票/);
  assert.match(html, /data-testid="published-video-review"/);
  assert.equal((html.match(/<video/g) ?? []).length, 2);
  assert.equal((html.match(/data-testid="gopro-speed-overlay"/g) ?? []).length, 2);
  assert.match(html, /声音来源/);
  assert.equal((html.match(/ muted=""/g) ?? []).length, 1, "only one side is muted by default");
  assert.doesNotMatch(html, /<fieldset/);
});

test("guided recommendations show pending status without promoting a single vote", () => {
  const html = renderToStaticMarkup(createElement(CoachReviewTest, { analysis, locale: "zh", guidedPage: "recommended", receipts: [],
    videoUrl: "", videoFile: null, videoDurationS: 0, calibration: null, onSync() {}, onCursor() {} }));
  assert.match(html, /待核对/);
  assert.doesNotMatch(html, /两侧已确认/);
  assert.match(html, /data-testid="paired-video-controls"/);
  assert.match(html, /class="order-2 col-span-full" data-testid="review-playback-controls"/);
  const pairs = (html.match(/data-testid="paired-video-controls"/g) ?? []).length;
  assert.equal((html.match(/data-testid="review-media"/g) ?? []).length, pairs * 2);
  assert.equal((html.match(/class="order-3 min-w-0" data-testid="review-telemetry"/g) ?? []).length, pairs * 2);
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

test("layered summary retains observations with no training and reports actual generation status", () => {
  const data = {...analysis, narrative_status: {status:"fallback", reason:"timeout", language:"zh"}, coach_debrief: {
    version:1, language:"zh", observations:[{id:"z", location:"区间 1", text:"转速下降迹象比参考圈提前 5.0 米。"}],
    reviews:[{id:"z", location:"区间 1", text:"核对减速与出弯过程。"}], training:[], no_training_reason:"目前没有足够证据建议改变驾驶操作。", limitations:[]}};
  const html = renderToStaticMarkup(createElement(CoachDebriefTest, {analysis:data, locale:"zh"}));
  for(const phrase of ["AI 请求超时", "已观察到的事实", "值得复盘的片段", "提前 5.0 米", "没有足够证据"]) assert.ok(html.includes(phrase));
  assert.doesNotMatch(html, /AI 叙事已启用|没有通过验证的重点/);
});

test("narrative in another language never masquerades as a successful localized summary", () => {
  const data = {...analysis, narrative:"English only narrative", narrative_status:{status:"generated", reason:"ok", language:"en"}};
  const html = renderToStaticMarkup(createElement(CoachDebriefTest, {analysis:data, locale:"zh"}));
  assert.doesNotMatch(html, /English only narrative|本次 AI 叙事已生成/);
  assert.match(html, /语言切换/);
});

test("Top 3 segment observations explain a lost downstream gain in both languages", () => {
  const data={...analysis,top_lap_segments:{status:"calculated",segments:[{
    id:"sector_1",number:1,status:"calculated",rows:[{lap:5,time_s:10},{lap:4,time_s:10.1}],winner_laps:[5],
    comparisons:[{reference_lap:5,target_lap:4,local_gain_s:.1,next_sector_delta_s:-.2,net_gain_through_next_s:-.1}]}]}};
  for(const locale of ["zh","en"]) {
    const html=renderToStaticMarkup(createElement(CoachReviewTest,{analysis:data,locale,videoUrl:"",videoFile:null,
      videoDurationS:0,calibration:null,onSync(){},onCursor(){},readOnly:true}));
    assert.match(html,/data-testid="top-lap-segments"/);
    assert.match(html,/L5/); assert.match(html,/0.100/); assert.match(html,/0.200/);
    assert.ok(html.includes(locale==="zh"?"反而慢":"across both it is"));
    assert.ok(html.includes(locale==="zh"?"参照物仅用于解释":"landmarks only explain"));
    assert.doesNotMatch(html,/<video/);
  }
});
