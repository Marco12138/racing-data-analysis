/**
 * Browser-side helpers that map the video timeline to telemetry values.
 *
 * The offset convention is ``video time = telemetry session time + offset``,
 * so a video second maps to the telemetry session second via
 * ``session_time_s = video_time_s - offset_ms / 1000``.
 */

import type { XrkComparisonRow, XrkTrackPoint } from "./xrkAnalysisApi";

export type TelemetryGauge = {
  speed_kmh: number | null;
  rpm: number | null;
  longitudinal_g: number | null;
  lateral_g: number | null;
};

export type VideoDeltaPoint = {
  video_time_s: number;
  delta_s: number;
};

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function interpolateChannel(
  points: XrkTrackPoint[],
  sessionTimeS: number,
  pick: (point: XrkTrackPoint) => number | null,
): number | null {
  const valid: Array<{ time: number; value: number }> = [];
  for (const point of points) {
    const value = pick(point);
    if (point.session_time_s != null && Number.isFinite(point.session_time_s) && value != null && Number.isFinite(value)) {
      valid.push({ time: point.session_time_s, value });
    }
  }
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0].value;
  valid.sort((a, b) => a.time - b.time);
  if (sessionTimeS <= valid[0].time) return valid[0].value;
  const last = valid[valid.length - 1];
  if (sessionTimeS >= last.time) return last.value;
  let lo = 0;
  let hi = valid.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (valid[mid].time <= sessionTimeS) lo = mid;
    else hi = mid;
  }
  const t0 = valid[lo].time;
  const t1 = valid[hi].time;
  const ratio = t1 > t0 ? (sessionTimeS - t0) / (t1 - t0) : 0;
  return valid[lo].value + (valid[hi].value - valid[lo].value) * ratio;
}

/** Interpolated telemetry readings at the current video time. */
export function telemetryAtVideoTime(
  points: XrkTrackPoint[],
  videoTimeS: number,
  offsetMs: number,
): TelemetryGauge {
  const sessionTimeS = videoTimeS - offsetMs / 1000;
  const speedMps = interpolateChannel(points, sessionTimeS, (point) => point.speed);
  return {
    speed_kmh: speedMps == null ? null : round(speedMps * 3.6, 1),
    rpm: interpolateChannel(points, sessionTimeS, (point) => point.rpm),
    longitudinal_g: interpolateChannel(points, sessionTimeS, (point) => point.longitudinal_g),
    lateral_g: interpolateChannel(points, sessionTimeS, (point) => point.lateral_g),
  };
}

/**
 * Map the distance-domain comparison rows onto the video timeline.
 * Each comparison row's distance is converted to a target-lap session time
 * using the track points, then shifted by the alignment offset.
 */
export function buildVideoDeltaCurve(
  comparison: XrkComparisonRow[],
  targetPoints: XrkTrackPoint[],
  offsetMs: number,
): VideoDeltaPoint[] {
  const distances: number[] = [];
  const sessionTimes: number[] = [];
  for (const point of targetPoints) {
    if (
      point.distance_m != null &&
      Number.isFinite(point.distance_m) &&
      point.session_time_s != null &&
      Number.isFinite(point.session_time_s)
    ) {
      distances.push(point.distance_m);
      sessionTimes.push(point.session_time_s);
    }
  }
  if (distances.length < 2) return [];

  const result: VideoDeltaPoint[] = [];
  for (const row of comparison) {
    const distance = row.distance_m;
    const delta = row.cumulative_time_delta_s;
    if (distance == null || delta == null || !Number.isFinite(distance) || !Number.isFinite(delta)) {
      continue;
    }
    if (distance < distances[0] || distance > distances[distances.length - 1]) continue;
    let lo = 0;
    let hi = distances.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (distances[mid] <= distance) lo = mid;
      else hi = mid;
    }
    const ratio = (distance - distances[lo]) / Math.max(1e-9, distances[hi] - distances[lo]);
    const sessionTimeS = sessionTimes[lo] + (sessionTimes[hi] - sessionTimes[lo]) * ratio;
    result.push({
      video_time_s: round(sessionTimeS + offsetMs / 1000, 3),
      delta_s: round(delta, 3),
    });
  }
  result.sort((a, b) => a.video_time_s - b.video_time_s);
  return result;
}
