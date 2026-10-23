import type { ReviewPoint, ReviewWindow } from "./coachReview";
import { reviewDistanceAtTime } from "./manualReview";

export type ClipTiming = { clip: ReviewWindow; offsetS: number; confirmed: boolean };
export type ClipSample = { distance: number; reference_speed: number | null; target_speed: number | null;
  reference_rpm: number | null; target_rpm: number | null; reference_elapsed: number; target_elapsed: number; delta: number };
export type ClipMetrics = { elapsed: number; entrySpeed: number | null; minimumSpeed: number | null;
  exitSpeed: number | null; minimumRpm: number | null };
export type ClipComparison = { status: "unavailable"; reason: "unconfirmed" | "outside_telemetry" | "no_overlap" | "telemetry_gap" } | {
  status: "available"; start: number; end: number; samples: ClipSample[];
  reference: ClipMetrics; target: ClipMetrics; delta: number;
  thirds: { start: number; end: number; delta: number }[];
  domains: { speed: [number, number]; rpm: [number, number] };
};
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Interpolate adjacent real samples only; use the existing 10m / 1s gap limits. */
function at(trace: ReviewPoint[], distance: number, key: keyof ReviewPoint): number | null {
  const i = trace.findIndex(p => p.distance_m >= distance), b = trace[i], a = trace[i - 1];
  if (!b) return null;
  if (b.distance_m === distance) return finite(b[key]) ? b[key] : null;
  if (!a || !finite(a[key]) || !finite(b[key]) || !finite(a.session_time_s) || !finite(b.session_time_s)
    || b.distance_m <= a.distance_m || b.distance_m - a.distance_m > 10
    || b.session_time_s <= a.session_time_s || b.session_time_s - a.session_time_s > 1) return null;
  return a[key] + (b[key] - a[key]) * (distance - a.distance_m) / (b.distance_m - a.distance_m);
}

/** Check every source edge touching the interval, including partially crossed edges. */
function continuous(trace: ReviewPoint[], start: number, end: number): boolean {
  const right = trace.findIndex(p => p.distance_m >= end);
  const left = trace.findIndex(p => p.distance_m >= start);
  if (left < 0 || right < 0) return false;
  const from = trace[left].distance_m === start ? left : left - 1;
  if (from < 0) return false;
  const points = trace.slice(from, right + 1);
  return points.length >= 2 && points.every((p, i) => finite(p.distance_m) && finite(p.session_time_s)
    && (!i || p.distance_m > points[i - 1].distance_m && p.distance_m - points[i - 1].distance_m <= 10
      && p.session_time_s > points[i - 1].session_time_s! && p.session_time_s - points[i - 1].session_time_s! <= 1));
}

/** Resolve a confirmed clip to its own telemetry; never borrow another lap's offset. */
function bounds(trace: ReviewPoint[], timing: ClipTiming): [number, number] | null {
  const { clip, offsetS } = timing;
  if (![clip.start_s, clip.end_s, offsetS].every(finite) || clip.end_s <= clip.start_s) return null;
  const start = reviewDistanceAtTime(trace, clip.start_s - offsetS), end = reviewDistanceAtTime(trace, clip.end_s - offsetS);
  return start !== null && end !== null && end > start ? [start, end] : null;
}

function domain(values: Array<number | null>): [number, number] {
  const valid = values.filter(finite);
  if (!valid.length) return [0, 1];
  const low = Math.min(...valid), high = Math.max(...valid), padding = Math.max((high - low) * .08, 1);
  return [Math.max(0, low - padding), high + padding];
}

/** Compare only the shared distance interval. Equal video durations are not lap deltas. */
export function compareClipTelemetry(reference: ReviewPoint[], target: ReviewPoint[],
  a: ClipTiming | null, b: ClipTiming | null): ClipComparison {
  if (!a?.confirmed || !b?.confirmed) return { status: "unavailable", reason: "unconfirmed" };
  const ab = bounds(reference, a), bb = bounds(target, b);
  if (!ab || !bb) return { status: "unavailable", reason: "outside_telemetry" };
  const start = Math.max(ab[0], bb[0]), end = Math.min(ab[1], bb[1]);
  if (end - start < 1) return { status: "unavailable", reason: "no_overlap" };
  if (!continuous(reference, start, end) || !continuous(target, start, end)) return { status: "unavailable", reason: "telemetry_gap" };
  const a0 = at(reference, start, "session_time_s"), b0 = at(target, start, "session_time_s");
  if (a0 === null || b0 === null) return { status: "unavailable", reason: "telemetry_gap" };
  const cuts = [start, start + (end - start) / 3, start + (end - start) * 2 / 3, end];
  const distances = [...new Set([...cuts, ...reference.map(p => p.distance_m), ...target.map(p => p.distance_m)])]
    .filter(d => finite(d) && d >= start && d <= end).sort((x, y) => x - y);
  const samples: ClipSample[] = [];
  for (const d of distances) {
    const ta = at(reference, d, "session_time_s"), tb = at(target, d, "session_time_s");
    if (ta === null || tb === null) return { status: "unavailable", reason: "telemetry_gap" };
    samples.push({ distance: d - start, reference_speed: at(reference, d, "speed"), target_speed: at(target, d, "speed"),
      reference_rpm: at(reference, d, "rpm"), target_rpm: at(target, d, "rpm"),
      reference_elapsed: ta - a0, target_elapsed: tb - b0, delta: (tb - b0) - (ta - a0) });
  }
  const metrics = (side: "reference" | "target"): ClipMetrics => {
    const speeds = samples.map(p => p[`${side}_speed`]), rpms = samples.map(p => p[`${side}_rpm`]);
    return { elapsed: samples.at(-1)![`${side}_elapsed`], entrySpeed: speeds[0], exitSpeed: speeds.at(-1)!,
      minimumSpeed: speeds.every(finite) ? Math.min(...speeds) : null,
      minimumRpm: rpms.every(finite) ? Math.min(...rpms) : null };
  };
  const thirds = cuts.slice(0, -1).map((d, i) => ({ start: d - start, end: cuts[i + 1] - start,
    delta: (at(target, cuts[i + 1], "session_time_s")! - at(target, d, "session_time_s")!)
      - (at(reference, cuts[i + 1], "session_time_s")! - at(reference, d, "session_time_s")!) }));
  return { status: "available", start, end, samples, reference: metrics("reference"), target: metrics("target"),
    delta: samples.at(-1)!.delta, thirds, domains: {
      speed: domain(samples.flatMap(p => [p.reference_speed, p.target_speed])),
      rpm: domain(samples.flatMap(p => [p.reference_rpm, p.target_rpm])),
    } };
}
