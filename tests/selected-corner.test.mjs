import assert from "node:assert/strict";
import { test, after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url)), dir = mkdtempSync(`${root}/tmp/corner-test-`);
execFileSync(`${root}/node_modules/.bin/esbuild`, [`${root}/frontend/lib/selectedCorner.ts`, "--bundle", "--format=esm", "--platform=node", `--outfile=${dir}/corner.mjs`], { stdio: "pipe" });
const { selectCornerWindow, cornerVideoWindow } = await import(pathToFileURL(`${dir}/corner.mjs`).href);
after(() => rmSync(dir, { recursive: true, force: true }));
const video = { size_bytes: 99, last_modified_ms: 123, duration_s: 400, mime_type: "video/mp4" };
const anchor = { video, target_lap: 4, offset_ms: 23450, video_time_s: 159.55, telemetry_session_time_s: 136.1 };
const ranges = [{ lap: 4, telemetry_start_s: 136.1, telemetry_end_s: 177.164 }];
test("five-second selection preserves manual anchor and boundary uncertainty", () => {
  const copy = JSON.stringify(anchor), result = selectCornerWindow(170, anchor, video, ranges);
  assert.equal(result.source_lap, 4); assert.equal(result.end_session_s - result.start_session_s, 5);
  assert.equal(JSON.stringify(anchor), copy);
  for (const time of [NaN, -1, 159.55, 196, 399]) assert.equal(selectCornerWindow(time, anchor, video, ranges), null);
  assert.equal(selectCornerWindow(170, anchor, { ...video, size_bytes: 100 }, ranges), null);
  assert.equal(selectCornerWindow(170, anchor, video, []), null);
});
test("candidates use real gate times, not fabricated five-second lap times", () => {
  const row = { status: "candidate", start_session_s: 200, end_session_s: 204.7 };
  const result = cornerVideoWindow(row, anchor, 400);
  assert.ok(Math.abs(result.end - result.start - 4.7) < 1e-10);
  assert.equal(cornerVideoWindow({ ...row, status: "excluded" }, anchor, 400), null);
  assert.equal(cornerVideoWindow(row, anchor, 228), null);
});
