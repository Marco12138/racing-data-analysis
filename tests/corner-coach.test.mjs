import assert from "node:assert/strict";
import { test, after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url)), dir = mkdtempSync(`${root}/tmp/coach-test-`);
execFileSync(`${root}/node_modules/.bin/esbuild`, [`${root}/frontend/lib/cornerCoach.ts`, "--bundle", "--format=esm", "--platform=node", `--outfile=${dir}/coach.mjs`], { stdio: "pipe" });
const { compareCornerBest } = await import(pathToFileURL(`${dir}/coach.mjs`).href);
after(() => rmSync(dir, { recursive: true, force: true }));
function row(lap, full, times, downstream = 2) {
  return { lap, status: "candidate", quality: { analysis_eligible: true, lap_time: full }, elapsed_s: times.at(-1), downstream_s: downstream,
    spatial_profile: { status: "available", method: "shared_directed_spatial_gates", points: times.map((t, i) => ({ distance_m: i * 10, elapsed_s: t, session_time_s: 40 * lap + t, speed: 60 + i, rpm: i ? 9000 : 0 })) } };
}
const pair = () => [row(4, 41.2, [0, 1, 2, 3], 2.3), row(5, 41, [0, 1.2, 2.1, 3.1], 2)];
test("section best versus actual full-lap best: observed deltas, shared positions and downstream reversal", () => {
  const rows = pair(), original = JSON.stringify(rows), result = compareCornerBest(rows);
  assert.equal(result.status, "available"); assert.equal(result.section.lap, 4); assert.equal(result.overall.lap, 5);
  assert.ok(Math.abs(result.gain_s - .1) < 1e-9);
  assert.ok(Math.abs(result.downstream_gain_s + .3) < 1e-9);
  assert.ok(Math.abs(result.combined_gain_s + .2) < 1e-9);
  assert.ok(Math.abs(result.parts.reduce((s, p) => s + p.gain_s, 0) - result.gain_s) < 1e-9);
  assert.ok(result.parts[0].gain_s > 0 && result.parts[1].gain_s < 0);
  assert.equal(result.samples[0].section_rpm, 0);
  assert.equal(result.samples[0].gain_s, 0);
  assert.equal(JSON.stringify(rows), original);
});
test("a single best real lap or an exact tie is reported honestly", () => {
  const rows = [row(4, 41, [0, 1, 2, 3]), row(5, 41.2, [0, 1, 2, 3.1])];
  assert.equal(compareCornerBest(rows).status, "same_lap");
  rows[1].elapsed_s = 3;
  const result = compareCornerBest(rows);
  assert.equal(result.status, "same_lap"); assert.deepEqual(result.sectionTies, [4, 5]);
  assert.equal(compareCornerBest([rows[0]]).reason, "insufficient_candidates");
});
test("GPS warnings and manual rejection cannot be overridden or replaced by a runner up", () => {
  assert.equal(compareCornerBest(pair(), [5]).reason, "overall_gps_warning");
  assert.equal(compareCornerBest(pair(), [], [5]).reason, "overall_video_rejected");
  assert.equal(compareCornerBest(pair(), [4]).reason, "insufficient_candidates");
  const rows = [...pair(), row(6, 41.1, [0, 1.1, 2.2, 3.2])];
  assert.equal(compareCornerBest(rows, [4]).status, "same_lap");
  rows[1].status = "excluded";
  assert.equal(compareCornerBest(rows).reason, "overall_section_unavailable");
});
test("quality exclusions do not become reference laps", () => {
  const fastButBad = row(1, 20, [0, .5, 1, 1.5]); fastButBad.quality.analysis_eligible = false;
  assert.equal(compareCornerBest([fastButBad, ...pair()]).overall.lap, 5);
  assert.equal(compareCornerBest([fastButBad]).reason, "no_valid_lap_time");
});
test("missing RPM or downstream data stays unavailable without discarding observed speed", () => {
  const rows = pair(); rows[0].downstream_s = null;
  rows[0].spatial_profile.points.forEach(p => p.rpm = null);
  const result = compareCornerBest(rows);
  assert.equal(result.status, "available"); assert.equal(result.combined_gain_s, null);
  assert.ok(result.samples.every(p => p.section_rpm === null && p.section_speed !== null));
});
test("a downstream-only GPS warning withholds retention without rejecting the usable section", () => {
  for (const flagged of [[4], [5]]) {
    const result = compareCornerBest(pair(), [], [], flagged);
    assert.equal(result.status, "available");
    assert.equal(result.downstream_gps_warning, true);
    assert.equal(result.downstream_gain_s, null);
    assert.equal(result.combined_gain_s, null);
    assert.ok(Math.abs(result.gain_s - .1) < 1e-9);
  }
});
test("legacy, nonmonotonic or different-position profiles never masquerade as aligned curves", () => {
  for (const corrupt of [
    r => delete r.spatial_profile,
    r => r.spatial_profile.method = "normalized_distance",
    r => r.spatial_profile.points[1].distance_m += 1,
    r => r.spatial_profile.points[1].elapsed_s = 4,
    r => r.spatial_profile.points[0].session_time_s = NaN,
    r => r.spatial_profile.points.at(-1).elapsed_s += .1,
  ]) {
    const rows = pair(); corrupt(rows[1]);
    assert.equal(compareCornerBest(rows).reason, "shared_checkpoints_unavailable");
  }
});
