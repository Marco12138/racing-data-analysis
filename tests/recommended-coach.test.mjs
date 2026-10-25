import assert from "node:assert/strict";
import { test, after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url)), dir = mkdtempSync(`${root}/tmp/recommended-test-`);
execFileSync(`${root}/node_modules/.bin/esbuild`, [`${root}/frontend/lib/recommendedCoach.ts`, "--bundle", "--format=esm", "--platform=node", `--outfile=${dir}/coach.mjs`], { stdio: "pipe" });
const { recommendedCoachSeed, coachObservation } = await import(pathToFileURL(`${dir}/coach.mjs`).href);
after(() => rmSync(dir, { recursive: true, force: true }));
const video = { size_bytes: 100, last_modified_ms: 1, duration_s: 400, mime_type: "video/mp4" };
const anchor = { target_lap: 4, offset_ms: 23464, calibrated_at: "test", review: { verdict: "confirmed" }, video };
const review = { id: "zone-1", name: "Zone 1", entry: 20, exit: 70, focus: 45 };
const analysis = { inspection_id: "test", target_lap: 4, reference_lap: 5, lap_quality: { laps: [{ lap: 4, analysis_eligible: true }] },
  track: { target: Array.from({ length: 101 }, (_, i) => ({ distance_m: i, session_time_s: 140 + i / 5 })) },
  video_sync: { lap_video_ranges: [{ lap: 4, telemetry_start_s: 136.086, telemetry_end_s: 177.15 }] } };
test("recommendations reuse a confirmed real anchor and invalidate identity on offset change", () => {
  const before = JSON.stringify(anchor), seed = recommendedCoachSeed(analysis, review, [anchor], video);
  assert.equal(seed.sourceLap, 4); assert.equal(seed.videoStart, 170.464); assert.equal(JSON.stringify(anchor), before);
  assert.notEqual(seed.key, recommendedCoachSeed(analysis, review, [{ ...anchor, offset_ms: 23964 }], video).key);
});
test("missing timing, changed video and unconfirmed anchors cannot seed a recommendation", () => {
  assert.equal(recommendedCoachSeed(analysis, review, [{ ...anchor, review: undefined }], video), null);
  assert.equal(recommendedCoachSeed(analysis, review, [anchor], { ...video, size_bytes: 200 }), null);
  assert.equal(recommendedCoachSeed(analysis, { ...review, focus: 200 }, [anchor], video), null);
  const broken = structuredClone(analysis); broken.track.target[45].session_time_s = null;
  assert.equal(recommendedCoachSeed(broken, review, [anchor], video), null);
});
test("half-second boundary margins reject unusable lap windows", () => {
  const tiny = structuredClone(analysis); tiny.video_sync.lap_video_ranges[0].telemetry_end_s = 139;
  assert.equal(recommendedCoachSeed(tiny, review, [anchor], video), null);
});
const evidence = () => ({ id: "zone-1", name: "Zone 1", videoConfirmed: false, contextComplete: false,
  comparison: { status: "available", section: { lap: 4 }, overall: { lap: 5 }, gain_s: .1, downstream_gain_s: -.3,
    combined_gain_s: -.2, downstream_gps_warning: false, parts: [{ index: 0, gain_s: .2 }, { index: 1, gain_s: -.1 }, { index: 2, gain_s: 0 }] } });
test("bilingual observations locate gains, downstream reversal and partial coverage", () => {
  for (const zh of [true, false]) {
    const text = coachObservation(evidence(), zh).join(" ");
    assert.match(text, /L4.*L5/); assert.match(text, /0.100/); assert.match(text, /0.200/);
    assert.ok(text.includes(zh ? "反而慢" : "behind"));
    assert.ok(text.includes(zh ? "不能称为完整弯道" : "not a complete corner"));
    assert.ok(text.includes(zh ? "视频仍待" : "remain unconfirmed"));
  }
});
test("unknown downstream, GPS and rejection never become a retained advantage", () => {
  const e = evidence(); e.comparison.combined_gain_s = null; e.comparison.downstream_gps_warning = true;
  assert.match(coachObservation(e, true).join(" "), /下游有 GPS 异常，不能判断/);
  e.comparison = { status: "unavailable", reason: "overall_video_rejected" };
  assert.match(coachObservation(e, false).join(" "), /rejected; comparison withheld/);
  assert.doesNotMatch(coachObservation(e, false).join(" "), /0.100|largest contribution/);
});
test("same-lap winner and missing calculations never invent a faster style", () => {
  const e = evidence(); e.comparison = { status: "same_lap", overall: { lap: 5 } };
  assert.match(coachObservation(e, true)[0], /同时是区段与整圈最快/);
  e.comparison = null; assert.match(coachObservation(e, true)[0], /尚未完成/);
});
test("recommendation and debrief export share wording and retain manual/GPS boundaries", () => {
  const panel = readFileSync(`${root}/frontend/components/SelectedCornerPanel.tsx`, "utf8");
  const summary = readFileSync(`${root}/frontend/components/GuidedReview.tsx`, "utf8");
  assert.match(panel, /coachObservation\(coachEvidence, zh\)/); assert.match(summary, /coachObservation\(row, zh\)/);
  assert.match(summary, /coachText\.flatMap\(row => row.lines\)/);
  assert.match(panel, /clip\.start - \.5, clip\.end \+ \.5/); assert.doesNotMatch(panel, /localStorage\.setItem/);
});
