import assert from "node:assert/strict";
import test from "node:test";

import {
  detectEngineSourceAmbiguity,
  detectLiftEvents,
  smoothRpmForEvents,
  stft,
  trackEngineRpm,
} from "../frontend/lib/audioRpm.ts";

function harmonicAudio(seconds, sampleRate, fundamentalHz, harmonics) {
  const count = Math.floor(seconds * sampleRate);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const time = i / sampleRate;
    let value = 0;
    for (const harmonic of harmonics) {
      value += Math.sin(2 * Math.PI * fundamentalHz * harmonic * time) / harmonic;
    }
    out[i] = value;
  }
  return out;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

test("stft places the peak of a 150 Hz tone at the expected bin", () => {
  const sampleRate = 44100;
  const spectrum = stft(harmonicAudio(4, sampleRate, 150, [1, 2, 3, 4, 5, 6]), {
    sampleRate,
    windowSize: 4096,
    hopSize: 2048,
  });
  assert.ok(spectrum.times.length > 10);
  assert.equal(spectrum.frequencies[0], 0);

  let bestFreq = 0;
  let bestSum = -1;
  for (let i = 0; i < spectrum.frequencies.length; i += 1) {
    const freq = spectrum.frequencies[i];
    if (freq < 50 || freq > 600) continue;
    let sum = 0;
    for (const frame of spectrum.magnitude) sum += frame[i];
    if (sum > bestSum) {
      bestSum = sum;
      bestFreq = freq;
    }
  }
  assert.ok(Math.abs(bestFreq - 150) < 30, `bestFreq=${bestFreq}`);
});

test("trackEngineRpm converts a 150 Hz firing comb to ~9000 RPM (2-stroke)", () => {
  const sampleRate = 44100;
  const spectrum = stft(harmonicAudio(4, sampleRate, 150, [1, 2, 3, 4, 5, 6]), {
    sampleRate,
    windowSize: 4096,
    hopSize: 2048,
  });
  const trace = trackEngineRpm(spectrum, { strokes: 2 });
  assert.ok(trace.rpm.length === spectrum.times.length);
  const center = trace.rpm.slice(10, -10);
  assert.ok(Math.abs(median(center) - 9000) < 700, `median=${median(center)}`);
});

test("trackEngineRpm converts a 50 Hz firing comb to ~6000 RPM (4-stroke)", () => {
  const sampleRate = 44100;
  const spectrum = stft(harmonicAudio(4, sampleRate, 50, [1, 2, 3, 4, 5, 6]), {
    sampleRate,
    windowSize: 4096,
    hopSize: 2048,
  });
  const trace = trackEngineRpm(spectrum, { strokes: 4 });
  const center = trace.rpm.slice(10, -10);
  assert.ok(Math.abs(median(center) - 6000) < 500, `median=${median(center)}`);
});

test("detectLiftEvents finds one brake-accelerate cycle with ordered times", () => {
  const times = Array.from({ length: 201 }, (_, i) => i * 0.1);
  const rpm = times.map((time) => {
    if (time < 3.5) return 9000;
    if (time < 5) return 9000 - ((time - 3.5) / 1.5) * 4500;
    if (time < 8) return 4500;
    if (time < 10) return 4500 + ((time - 8) / 2) * 4500;
    return 9000;
  });
  const events = detectLiftEvents(times, rpm);
  assert.equal(events.length, 1);
  const event = events[0];
  assert.ok(event.entry_s >= 3 && event.entry_s <= 6, `entry=${event.entry_s}`);
  assert.ok(event.entry_s < event.apex_s && event.apex_s < event.exit_s);
  assert.ok(event.drop_rpm > 3000, `drop=${event.drop_rpm}`);
});

test("detectLiftEvents ignores gentle RPM changes below the drop threshold", () => {
  const times = Array.from({ length: 201 }, (_, i) => i * 0.1);
  const rpm = times.map((time) => {
    if (time < 4) return 8000;
    if (time < 6) return 8000 - ((time - 4) / 2) * 1000;
    if (time < 8) return 7000;
    if (time < 10) return 7000 + ((time - 8) / 2) * 1000;
    return 8000;
  });
  assert.equal(detectLiftEvents(times, rpm).length, 0);
});

test("smoothing removes octave jumps so a real braking event is still found", () => {
  const times = Array.from({ length: 401 }, (_, i) => i * 0.05);
  const base = times.map((time) => (time < 4 ? 9000 : time < 8 ? 4500 : 9000));
  const octaveNoise = base.map((value, index) =>
    index % 7 === 0 ? (value > 6000 ? 4500 : 9000) : value
  );
  const smoothed = smoothRpmForEvents(octaveNoise);
  assert.equal(smoothed.length, octaveNoise.length);
  const events = detectLiftEvents(times, smoothed);
  assert.equal(events.length, 1);
  const event = events[0];
  assert.ok(event.entry_s < event.apex_s && event.apex_s < event.exit_s);
  assert.ok(event.drop_rpm > 2000, `drop=${event.drop_rpm}`);
});

test("single engine tone is not flagged as ambiguous", () => {
  const sampleRate = 44100;
  const spectrum = stft(harmonicAudio(4, sampleRate, 150, [1, 2, 3, 4, 5, 6]), {
    sampleRate,
    windowSize: 2048,
    hopSize: 1024,
  });
  const result = detectEngineSourceAmbiguity(spectrum);
  assert.equal(result.ambiguous, false);
  assert.ok(result.persistent_peaks >= 1);
});

test("two persistent engine tones are flagged as ambiguous", () => {
  const sampleRate = 44100;
  const first = harmonicAudio(4, sampleRate, 150, [1, 2, 3]);
  const second = harmonicAudio(4, sampleRate, 220, [1, 2, 3]);
  const mixed = new Float32Array(first.length);
  for (let i = 0; i < mixed.length; i += 1) {
    mixed[i] = first[i] + 0.8 * second[i];
  }
  const spectrum = stft(mixed, { sampleRate, windowSize: 2048, hopSize: 1024 });
  const result = detectEngineSourceAmbiguity(spectrum);
  assert.equal(result.ambiguous, true);
  assert.ok(result.strength_ratio >= 0.6);
});
