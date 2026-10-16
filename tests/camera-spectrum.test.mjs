import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(`${root}/tmp`, { recursive: true });
const dir = mkdtempSync(`${root}/tmp/spectrum-test-`);
execFileSync(`${root}/node_modules/.bin/esbuild`, [`${root}/frontend/lib/cameraSpectrum.ts`, "--bundle", "--format=esm", "--platform=node", `--outfile=${dir}/entry.mjs`], { stdio: "pipe" });
const { cameraSpectrum } = await import(pathToFileURL(`${dir}/entry.mjs`).href);
after(() => rmSync(dir, { recursive: true, force: true }));

function signal() {
  const time_s = Array.from({ length: 4001 }, (_, i) => i/200);
  const value = time_s.map(t => 2*Math.sin(2*Math.PI*20*t));
  return { time_s, columns: [value, value, value], unit: "m/s²" };
}

test("one-sided Welch preserves physical variance and band RMS, not peak normalization", () => {
  const result = cameraSpectrum(signal(), 0, 0, 20);
  assert.equal(result.status, "calculated");
  const bin = result.frequencies_hz[1]-result.frequencies_hz[0];
  assert.ok(Math.abs(result.density.reduce((a,b) => a+b, 0)*bin-2) < .01);
  assert.ok(Math.abs(result.band_10_80_rms-Math.sqrt(2)) < .01);
  assert.equal(result.unit, "(m/s²)²/Hz");
  assert.equal(result.body_dynamics_available, false);
  assert.equal(result.time_method, "payload_uniform_estimate");
});

test("gaps, invalid values, irregular clocks, missing units and unbounded intervals fail explicitly", () => {
  for (const mutation of [s => { s.time_s[1000] += .004; }, s => { s.columns[0][800] = NaN; }, s => { s.unit = "unknown"; }]) {
    const s = signal(); mutation(s);
    assert.equal(cameraSpectrum(s, 0, 0, 20).status, "unavailable");
  }
  assert.equal(cameraSpectrum(signal(), 0, 0, 120).status, "unavailable");
  assert.equal(cameraSpectrum(signal(), 0, 0, 25).status, "unavailable");
});
