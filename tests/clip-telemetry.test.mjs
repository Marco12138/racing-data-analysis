import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(`${root}/tmp`, { recursive: true });
const dir = mkdtempSync(`${root}/tmp/clip-telemetry-test-`);
execFileSync(`${root}/node_modules/.bin/esbuild`, [`${root}/tests/fixtures/clip-telemetry-entry.tsx`, "--bundle", "--format=esm", "--platform=node", "--jsx=automatic",
  "--external:react", "--external:react-dom", "--external:recharts", "--external:lucide-react", `--outfile=${dir}/entry.mjs`], { stdio: "pipe" });
const { compareClipTelemetry, ClipTelemetryTest } = await import(pathToFileURL(`${dir}/entry.mjs`).href);
after(() => rmSync(dir, { recursive: true, force: true }));
const trace = (speed, origin = 100, step = 1) => Array.from({ length: 200 / step + 1 }, (_, i) => ({
  distance_m: i * step, session_time_s: origin + i * step / speed, lap_time_s: i * step / speed,
  speed: speed * 3.6, rpm: 9000 + i * step, local_x_m: i * step, local_y_m: 0,
}));
const a = trace(20), b = trace(10, 200, 2);
const timing = (start, offsetS = 0) => ({ clip: { start_s: start + offsetS, end_s: start + offsetS + 5, focus_s: start + offsetS + 2 }, offsetS, confirmed: true });
const compare = (aa = a, bb = b, ta = timing(100), tb = timing(200)) => compareClipTelemetry(aa, bb, ta, tb);
const close = (x, y) => assert.ok(Math.abs(x - y) < 1e-9, `${x} != ${y}`);

test("two five-second videos time the same distance, not the same clip duration", () => {
  const r = compare(); assert.equal(r.status, "available");
  close(r.start, 0); close(r.end, 50); close(r.reference.elapsed, 2.5); close(r.target.elapsed, 5); close(r.delta, 2.5);
  close(r.samples[0].delta, 0); close(r.thirds.reduce((sum, p) => sum + p.delta, 0), r.delta);
  close(r.reference.exitSpeed, 72); close(r.target.exitSpeed, 36);
});
test("fractional crossing times and unequal sampling use interpolation, independent offsets, and intersection", () => {
  const r = compare(a, b, timing(100.125, 23.464), timing(201.05, -30));
  assert.equal(r.status, "available"); close(r.start, 10.5); close(r.end, 60.5); close(r.delta, 2.5);
  close(r.reference.minimumRpm, 9010.5); close(r.target.minimumRpm, 9010.5);
});
test("unconfirmed, missing, out-of-range and non-overlapping clips never produce a delta", () => {
  assert.equal(compare(a, b, { ...timing(100), confirmed: false }).reason, "unconfirmed");
  assert.equal(compare(a, b, null).reason, "unconfirmed");
  assert.equal(compare(a, b, timing(99)).reason, "outside_telemetry");
  assert.equal(compare(a, b, timing(105), timing(200)).reason, "no_overlap");
  assert.equal(compare(a, b, timing(100, NaN)).reason, "outside_telemetry");
});
test("gaps and invalid source times are not bridged, including partial boundary edges", () => {
  for (const change of [p => { p[20].session_time_s = null; }, p => { p[20].session_time_s = p[19].session_time_s; },
    p => { p[20].session_time_s -= 1; }, p => { p.splice(10, 20); }]) {
    const bad = structuredClone(a); change(bad); assert.notEqual(compare(bad).status, "available");
  }
  const edge = structuredClone(a); edge[50].session_time_s += 1.1;
  assert.notEqual(compare(edge, b, timing(100.02), timing(200.02)).status, "available");
  const unrelated = structuredClone(a); unrelated[190].session_time_s = null;
  assert.equal(compare(unrelated).status, "available");
});
test("missing channels stay null, while legal zero RPM and speed values survive", () => {
  const absent = b.map(p => ({ ...p, rpm: null }));
  const r = compare(a, absent); assert.equal(r.status, "available"); assert.equal(r.target.minimumRpm, null);
  assert.ok(r.samples.every(p => p.target_rpm === null));
  const zeros = a.map(p => ({ ...p, rpm: 0, speed: 0 }));
  close(compare(zeros).reference.minimumRpm, 0); close(compare(zeros).reference.minimumSpeed, 0);
  const gap = structuredClone(a); gap[20].speed = null;
  const partial = compare(gap); assert.equal(partial.reference.minimumSpeed, null);
  assert.ok(partial.samples.some(p => p.reference_speed === null));
});
test("both panels receive one shared axis domain and no inputs or anchors are modified", () => {
  const ta = timing(100, 23.464), tb = timing(200, 23.55), before = JSON.stringify([a, b, ta, tb]);
  const r = compare(a, b, ta, tb); assert.equal(JSON.stringify([a, b, ta, tb]), before);
  assert.ok(r.domains.speed[0] <= 36 && r.domains.speed[1] >= 72);
  assert.ok(r.samples.every((p, i) => !i || p.distance > r.samples[i - 1].distance));
});
for (const locale of ["zh", "en"]) test(`visible paired telemetry and cautious timing labels (${locale})`, () => {
  const html = renderToStaticMarkup(createElement(ClipTelemetryTest, { comparison: compare(), locale }));
  for (const id of ["clip-telemetry-reference", "clip-telemetry-target", "clip-time-delta"]) assert.ok(html.includes(id));
  assert.match(html, /2\.500s/); assert.match(html, /5\.000s/); assert.match(html, /±0.5/); assert.match(html, /GPS/);
  assert.ok(html.includes(locale === "zh" ? "不是自动确认的入弯" : "not confirmed entry"));
  assert.doesNotMatch(html, /<details|THEORETICAL BEST|theoretical RPM/);
  const missing = renderToStaticMarkup(createElement(ClipTelemetryTest, { comparison: compare(a, b, null), locale }));
  assert.ok(missing.includes(locale === "zh" ? "两侧确认视频配对" : "Confirm both video pairings"));
  assert.doesNotMatch(missing, /2\.500s|5\.000s/);
});
