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
const { GnssSyncTest, GoproPanelTest, GoproChannelsTest } = await import(pathToFileURL(`${dir}/entry.mjs`).href);
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

test("geometry overlay keeps metric aspect and labels shared evidence, not accuracy", () => {
  const geometry = { status: "candidate", proposed_offset_s: 23.75, validation_median_m: 3,
    validation_p95_m: 8, overlay: [{ session_time_s: 30, role: "validation", aim_xy_m: [0,0],
      camera_raw_xy_m: [3,4], camera_registered_xy_m: [1,1] }] };
  const html = renderToStaticMarkup(createElement(GnssSyncTest, { locale: "zh", result: { ...result, evidence: { ...result.evidence, geometry_check: geometry } },
    points: [], onPreview() {}, onDecision() { return true; } }));
  for (const text of ["轨迹候选偏移", "留出位置差", "不是独立", "AiM GPS", "GoPro GPS", "23.750"]) assert.ok(html.includes(text), text);
  assert.match(html, /viewBox="0 0 640 380"/);
});

test("camera provenance labels do not promote declared axes to body yaw", () => {
  const html = renderToStaticMarkup(createElement(GoproChannelsTest, { locale: "zh", audit: { summary: { streams: [{
    key: "GYRO", source: "camera_imu", unit: "rad/s", sample_count: 200, sample_rate_hz: 199.1,
    input_orientation: "YxZ", output_orientation: "ZXY", orientation_consistent: true, scale: [100], timing_fields: ["TSMP"],
  }] } } }));
  for (const text of ["YxZ", "ZXY", "未完成", "不解释为车体偏航", "不代表硬件带宽"]) assert.ok(html.includes(text), text);
});

test("offset diagnostics name the failed window without claiming accuracy or overwriting anchors", () => {
  const inspected={...result,evidence:{...result.evidence,
    speed_check:{...result.evidence.speed_check,residual_limit_s:.25,worst_validation_window:{session_center_s:232.437,offset_s:24.149,correlation:.9121}},
    offset_diagnostics:{selected_method:"clock_sample_median",tow_is_held:true,estimators:[
      {method:"clock_sample_median",offset_s:23.799},{method:"clock_linear_intercept",offset_s:23.738927}]}}};
  for(const locale of ["zh","en"]) {
    const html=renderToStaticMarkup(createElement(GnssSyncTest,{locale,result:inspected,points:[],onPreview(){},onDecision(){return true;}}));
    for(const text of ["23.799","23.739","232.44","0.350","0.250"]) assert.ok(html.includes(text));
    assert.ok(html.includes(locale==="zh"?"未剔除该窗口":"window was not discarded"));
    assert.ok(html.includes(locale==="zh"?"不会覆盖人工锚点":"do not overwrite manual anchors"));
    assert.match(html,/<button[^>]+disabled=""/);
  }
});

test("failed speed match shows evidence without calling it a measured video delay", () => {
  const diagnostic = {
    session_range_s:[22,40],video_range_s:[45.7,63.7],fit_offset_s:23.7,local_best_offset_s:24.05,
    at_fit_offset:{sample_count:90,rmse_kmh:10,max_absolute_difference_kmh:40,
      peak:{session_time_s:34,aim_speed_kmh:70,camera_speed_kmh:30}},
    at_local_best_offset:{rmse_kmh:9,max_absolute_difference_kmh:35},
    position_at_fit_offset:{median_m:2,p95_m:12,max_m:14},camera_clock_epoch_span_s:.09,trace:[],
  };
  for (const locale of ["zh","en"]) {
    const html=renderToStaticMarkup(createElement(GnssSyncTest,{locale,
      result:{...result,evidence:{...result.evidence,speed_check:{...result.evidence.speed_check,window_diagnostic:diagnostic}}},
      points:[],onPreview(){},onDecision(){return true;}}));
    assert.match(html,/gnss-window-diagnostic/);
    for(const text of ["40.00","35.00","0.090","70.0","30.0"]) assert.ok(html.includes(text),text);
    assert.ok(html.includes(locale==="zh"?"非实测延迟":"not measured delay"));
    assert.ok(html.includes(locale==="zh"?"未删除样本或放宽门槛":"no samples were removed or limits relaxed"));
    assert.ok(html.includes(locale==="zh"?"请保留已确认的人工锚点":"Keep confirmed manual anchors"));
    assert.match(html,/<button[^>]+disabled=""/);
  }
});
