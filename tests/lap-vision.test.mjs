import assert from "node:assert/strict";
import test from "node:test";

import {
  buildManualCorner,
  lateralPositionFromRgba,
  sampleTimes,
  segmentCorners,
  smooth,
} from "../frontend/lib/lapVision.ts";

function solidRgba(width, height, color) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = color[0];
    rgba[i * 4 + 1] = color[1];
    rgba[i * 4 + 2] = color[2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

test("lateralPositionFromRgba finds the mid-luminance stripe centroid", () => {
  const width = 100;
  const height = 60;
  const rgba = solidRgba(width, height, [0, 0, 0]); // dark background
  // Mid-gray road stripe on the right 30% of the analysis band.
  const stripeLeft = 70;
  const stripeRight = 99;
  for (let row = Math.floor(height * 0.35); row < Math.floor(height * 0.65); row += 1) {
    for (let col = stripeLeft; col <= stripeRight; col += 1) {
      const offset = (row * width + col) * 4;
      rgba[offset] = 128;
      rgba[offset + 1] = 128;
      rgba[offset + 2] = 128;
    }
  }
  const lateral = lateralPositionFromRgba(rgba, width, height);
  assert.ok(lateral !== null);
  assert.ok(Math.abs(lateral - 84.5 / 99) < 0.05, `lateral=${lateral}`);
});

test("lateralPositionFromRgba returns null for flat frames", () => {
  const rgba = solidRgba(40, 30, [128, 128, 128]);
  assert.equal(lateralPositionFromRgba(rgba, 40, 30), null);
});

test("smooth reduces noise without changing length", () => {
  const values = [0, 10, 0, 10, 0];
  const smoothed = smooth(values, 3);
  assert.equal(smoothed.length, values.length);
  assert.ok(Math.abs(smoothed[2] - 20 / 3) < 1e-9);
});

test("segmentCorners finds one sustained turn with apex", () => {
  // Lateral drifts right then returns: one right-hand corner.
  const samples = [];
  for (let i = 0; i < 120; i += 1) {
    const time = i * 0.25; // 30s at 4fps
    const lateral =
      i < 30
        ? 0.5
        : i < 60
          ? 0.5 + ((i - 30) / 30) * 0.45
          : i < 90
            ? 0.95 - ((i - 60) / 30) * 0.45
            : 0.5;
    samples.push({ time_s: time, lateral });
  }
  const corners = segmentCorners(samples, { minDurationS: 2 });
  assert.ok(corners.length >= 1, `corners=${JSON.stringify(corners)}`);
  const corner = corners[0];
  assert.equal(corner.direction, 1);
  assert.ok(corner.apex >= corner.start && corner.apex <= corner.end);
  assert.ok(corner.apex > corner.start);
});

test("sampleTimes spans the lap at the requested rate", () => {
  const times = sampleTimes(10, 50, 8);
  assert.equal(times.length, 320);
  assert.equal(times[0], 10);
  assert.ok(Math.abs(times[times.length - 1] - 50) < 1e-9);
});

test("buildManualCorner validates and names marked points", () => {
  const corner = buildManualCorner(3.2, 4.1, 5.4, 3);
  assert.equal(corner.name, "T3");
  assert.equal(corner.start, 3.2);
  assert.equal(corner.apex, 4.1);
  assert.equal(corner.end, 5.4);
  assert.throws(() => buildManualCorner(5, 4, 6, 1));
  assert.throws(() => buildManualCorner(3, 3, 5, 1));
  assert.throws(() => buildManualCorner(Number.NaN, 4, 5, 1));
});
