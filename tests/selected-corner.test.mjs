import assert from "node:assert/strict";
import { test, after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url)), dir = mkdtempSync(`${root}/tmp/corner-test-`);
execFileSync(`${root}/node_modules/.bin/esbuild`, [`${root}/frontend/lib/selectedCorner.ts`, "--bundle", "--format=esm", "--platform=node", `--outfile=${dir}/corner.mjs`], { stdio: "pipe" });
const { selectCornerWindow, cornerVideoWindow, browsableCornerLaps, cornerTelemetryTime, cornerChannelAt, cornerTelemetryDomains } = await import(pathToFileURL(`${dir}/corner.mjs`).href);
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
test("an explicitly confirmed peer-lap anchor takes precedence over propagation", () => {
  const own={...anchor,target_lap:5,offset_ms:23000};
  const row={lap:5,status:"candidate",start_session_s:200,end_session_s:209};
  const saved=JSON.stringify([anchor,own]);
  assert.equal(cornerVideoWindow(row,anchor,400,[own]).start,223);
  assert.equal(cornerVideoWindow(row,anchor,400,[own]).end,232);
  assert.equal(cornerVideoWindow(row,anchor,400,[{...own,video:{...video,size_bytes:500}}]).start,223.45);
  assert.equal(JSON.stringify([anchor,own]),saved);
});

test("candidate navigation includes every playable real lap, not only a group representative", () => {
  const rows = [3, 4, 5, 6].map(lap => ({ lap, status: "candidate", start_session_s: 40 * lap, end_session_s: 40 * lap + 5 }));
  const before = JSON.stringify([rows, anchor]);
  assert.deepEqual(browsableCornerLaps(rows, anchor, 400).map(r => r.lap), [3, 4, 5, 6]);
  assert.deepEqual(browsableCornerLaps([...rows, { lap: 7, status: "excluded" }, { lap: 8, status: "candidate", start_session_s: 398, end_session_s: 403 }], anchor, 400).map(r => r.lap), [3, 4, 5, 6]);
  assert.equal(JSON.stringify([rows, anchor]), before);
});

test("each lap uses its own real clock rather than distance-profile indexes", () => {
  const a = { lap: 4, status: "candidate", start_session_s: 160, end_session_s: 171 };
  const b = { lap: 5, status: "candidate", start_session_s: 201, end_session_s: 211.5 };
  assert.equal(cornerTelemetryTime(a, 185, 183), 162);
  assert.equal(cornerTelemetryTime(b, 224.5, 223.5), 202);
  assert.equal(cornerTelemetryTime(b, 223, 223.5), null);
  assert.equal(cornerTelemetryTime(b, 235, 223.5), null);
  assert.equal(cornerTelemetryTime(b, NaN, 223.5), null);
  const points = [{ session_time_s: 201, elapsed_s: 0, speed: 0, rpm: 0 }, { session_time_s: 201.1, elapsed_s: .1, speed: 50, rpm: 8000 },
    { session_time_s: 201.3, elapsed_s: .3, speed: 60, rpm: null }, { session_time_s: 203, elapsed_s: 2, speed: 70, rpm: 9000 }];
  assert.equal(cornerChannelAt(points, 201, "rpm"), 0);
  assert.ok(Math.abs(cornerChannelAt(points, 201.05, "rpm") - 4000) < 1e-6);
  assert.equal(cornerChannelAt(points, 201.2, "rpm"), null);
  assert.equal(cornerChannelAt(points, 202, "speed"), null);
  assert.equal(cornerChannelAt(points, 200, "speed"), null);
  assert.equal(cornerChannelAt(points, 204, "speed"), null);
  const domains = cornerTelemetryDomains([{ ...a, telemetry: points }, { ...b, telemetry: [{ session_time_s: 201, elapsed_s: 0, speed: 100, rpm: 12000 }] }]);
  assert.deepEqual(domains.speed, [0, 105]);
  assert.deepEqual(domains.rpm, [0, 12600]);
});
