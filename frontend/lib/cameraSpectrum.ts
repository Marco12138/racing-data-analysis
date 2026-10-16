import { stft } from "./audioRpm";
import type { CameraImuSeries } from "./gpmfTelemetry";

export type CameraSpectrum = { status: "unavailable"; reason: string } | {
  status: "calculated"; frequencies_hz: number[]; density: number[]; unit: string;
  source_rate_hz: number; grid_rate_hz: number; sample_count: number; windows: number;
  band_10_80_rms: number | null; time_method: "payload_uniform_estimate";
  method: string; body_dynamics_available: false;
};

/** Local exploratory Welch density; never compare unpaired devices or infer bandwidth. */
export function cameraSpectrum(series: CameraImuSeries, axis: number, start: number, end: number): CameraSpectrum {
  if (![0, 1, 2].includes(axis) || !Number.isFinite(start) || !Number.isFinite(end) || end-start < 6 || end-start > 60)
    return { status: "unavailable", reason: "INTERVAL_6_TO_60_SECONDS_REQUIRED" };
  if (!["m/s²", "m/s^2", "rad/s"].includes(series.unit)) return { status: "unavailable", reason: "UNIT_UNSUPPORTED" };
  const indexes = series.time_s.flatMap((t, i) => t >= start && t <= end ? [i] : []);
  if (indexes.length < 1024) return { status: "unavailable", reason: "INSUFFICIENT_SAMPLES" };
  const t = indexes.map(i => series.time_s[i]), v = indexes.map(i => series.columns[axis][i]);
  const dt = t.slice(1).map((time, i) => time-t[i]);
  if (!v.every(Number.isFinite) || dt.some(d => !Number.isFinite(d) || d <= 0)) return { status: "unavailable", reason: "INVALID_VALUES_OR_TIME" };
  const sorted = [...dt].sort((a, b) => a-b), median = sorted[Math.floor(sorted.length/2)];
  if (t[0]-start > median*2 || end-t.at(-1)! > median*2 || dt.some(d => Math.abs(d/median-1) > .1))
    return { status: "unavailable", reason: "TIMING_GAPS_OR_IRREGULARITY" };
  // Upsample, never reduce the observed rate. No anti-alias downsampling is hidden.
  const rate = 1/sorted[0], sourceRate = 1/median;
  if (rate > 1000 || rate < 40) return { status: "unavailable", reason: "SAMPLE_RATE_UNSUPPORTED" };
  const signal: number[] = [];
  let right = 1;
  for (let q = t[0]; q <= t.at(-1)!; q += 1/rate) {
    while (right < t.length-1 && t[right] < q) right++;
    const weight = (q-t[right-1])/(t[right]-t[right-1]);
    signal.push(v[right-1]+weight*(v[right]-v[right-1]));
  }
  const n = 1024, hop = 512;
  let energy = 0, windows = 0;
  for (let i = 0; i < n; i++) energy += (.5-.5*Math.cos(2*Math.PI*i/(n-1)))**2;
  const density = new Array(n/2+1).fill(0);
  for (let begin = 0; begin+n <= signal.length; begin += hop) {
    const slice = signal.slice(begin, begin+n);
    const mean = slice.reduce((a, b) => a+b, 0)/n;
    const { magnitude } = stft(slice.map(x => x-mean), { sampleRate: rate, windowSize: n, hopSize: n });
    for (let k = 0; k < density.length; k++) density[k] += magnitude[0][k]**2 * (k === 0 || k === n/2 ? 1 : 2)/(rate*energy);
    windows++;
  }
  if (windows < 2) return { status: "unavailable", reason: "INSUFFICIENT_WELCH_WINDOWS" };
  const frequency = density.map((_, i) => i*rate/n);
  const power = density.map(p => p/windows);
  const band = frequency.reduce((sum, f, i) => f >= 10 && f <= 80 ? sum+power[i]*rate/n : sum, 0);
  return { status: "calculated", frequencies_hz: frequency, density: power,
    unit: series.unit === "rad/s" ? "(rad/s)²/Hz" : "(m/s²)²/Hz", source_rate_hz: sourceRate,
    grid_rate_hz: rate, sample_count: signal.length, windows, band_10_80_rms: sourceRate/2 > 80 ? Math.sqrt(band) : null,
    time_method: "payload_uniform_estimate", body_dynamics_available: false,
    method: "linear upsample to fastest observed interval; 1024-sample Hann; per-window mean removed; 50% overlap; one-sided physical density" };
}
