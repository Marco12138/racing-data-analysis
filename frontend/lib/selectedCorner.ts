import type { VideoSyncCalibration } from "./videoTelemetrySync";
import { matchesReviewVideo, type VideoIdentity } from "./manualReview";
import { resolveApiUrl } from "./config";

export type CornerMetrics = { entry_speed_kmh: number; minimum_speed_kmh: number; exit_speed_kmh: number; minimum_position_fraction: number; minimum_rpm: number | null };
export type CornerTelemetryPoint = { session_time_s: number; elapsed_s: number; speed: number | null; rpm: number | null };
export type CornerSpatialPoint = CornerTelemetryPoint & { distance_m: number };
export type CornerLap = {
  lap: number; status: "candidate" | "excluded"; reason: string | null;
  quality: { analysis_eligible: boolean; reasons: string[]; lap_time?: number };
  start_session_s?: number; end_session_s?: number; elapsed_s?: number; downstream_s?: number | null;
  start_distance_m?: number; end_distance_m?: number;
  profile?: { progress: number[]; speed: number[]; rpm: number[] | null; metrics: CornerMetrics };
  telemetry?: CornerTelemetryPoint[];
  spatial_profile?: { status: "available" | "unavailable"; reason: string | null; method: "shared_directed_spatial_gates"; points: CornerSpatialPoint[] };
};
export type CornerGroup = { id: number; laps: number[]; count: number; representative_lap: number; median_time_s: number; time_range_s: number[]; median_downstream_s: number | null; median_combined_s: number | null; metrics: CornerMetrics };
export type SelectedCornerResult = {
  version: 1; source_lap: number; start_session_s: number; end_session_s: number;
  context?: { status: string; reason: string } | null;
  laps: CornerLap[]; synthetic_curve_generated: false;
  patterns: { status: "insufficient_confirmed_laps" | "no_clear_separation" | "exploratory_groups";
    groups: CornerGroup[]; confirmed_laps: number[]; most_common_group_ids: number[];
    fastest_observed_group_ids: number[]; common_is_fastest: boolean | null;
    confidence: "low"; silhouette: number | null; channels?: string[] };
};
export type CornerRequest = { inspection_id: string; source_lap: number; start_session_s: number; end_session_s: number; confirmed_laps: number[]; include_context?: boolean };

/** Keep the human anchor immutable; a five-second crop cannot span logger laps. */
export function selectCornerWindow(start: number, anchor: VideoSyncCalibration, video: VideoIdentity,
  ranges: Array<{ lap: number; telemetry_start_s: number; telemetry_end_s: number }>) {
  if (!matchesReviewVideo(anchor.video, video) || !Number.isFinite(start) || start < 0 || start + 5 > video.duration_s) return null;
  const range = ranges.find(r => r.lap === anchor.target_lap);
  const time = start - anchor.offset_ms / 1000;
  if (!range || time - .5 < range.telemetry_start_s || time + 5.5 > range.telemetry_end_s) return null;
  return { source_lap: anchor.target_lap, start_session_s: time, end_session_s: time + 5 };
}

/** Same-session elapsed timing only proposes a clip, never confirms another lap. */
export function cornerVideoWindow(row: CornerLap, anchor: VideoSyncCalibration, duration: number, anchors: VideoSyncCalibration[] = []) {
  if (row.status !== "candidate" || !Number.isFinite(row.start_session_s) || !Number.isFinite(row.end_session_s)) return null;
  const own = anchors.find(a => a.target_lap === row.lap && matchesReviewVideo(a.video, anchor.video)) ?? anchor;
  const start = row.start_session_s! + own.offset_ms / 1000, end = row.end_session_s! + own.offset_ms / 1000;
  return start >= 0 && end > start && Math.max(end, start + 5) <= duration ? { start, end, offset: own.offset_ms / 1000 } : null;
}

export function browsableCornerLaps(rows: CornerLap[], anchor: VideoSyncCalibration, duration: number, anchors: VideoSyncCalibration[] = []) {
  return rows.filter(row => cornerVideoWindow(row, anchor, duration, anchors) !== null);
}

/** A camera clock maps to its own lap only; candidate offsets are never saved as anchors. */
export function cornerTelemetryTime(row: CornerLap, videoTime: number, videoStart: number): number | null {
  const elapsed = videoTime - videoStart;
  if (row.status !== "candidate" || !Number.isFinite(row.start_session_s) || !Number.isFinite(row.end_session_s)
    || !Number.isFinite(elapsed) || elapsed < -1e-6 || elapsed > row.end_session_s! - row.start_session_s! + 1e-6) return null;
  return Math.max(row.start_session_s!, Math.min(row.end_session_s!, row.start_session_s! + elapsed));
}

export function cornerChannelAt(points: CornerTelemetryPoint[], time: number, channel: "speed" | "rpm"): number | null {
  if (!Number.isFinite(time)) return null;
  const i = points.findIndex(p => p.session_time_s >= time - 1e-8);
  if (i < 0) return null;
  const b = points[i], value = b[channel];
  if (Math.abs(b.session_time_s - time) <= 1e-8) return typeof value === "number" && Number.isFinite(value) ? value : null;
  if (!i) return null;
  const a = points[i - 1], previous = a[channel], dt = b.session_time_s - a.session_time_s;
  return dt > 0 && dt <= .5 && typeof value === "number" && typeof previous === "number" && Number.isFinite(value) && Number.isFinite(previous)
    ? previous + (value - previous) * (time - a.session_time_s) / dt : null;
}

export function cornerTelemetryDomains(rows: Array<CornerLap | undefined>): Record<"speed" | "rpm", [number, number]> {
  const domain = (channel: "speed" | "rpm"): [number, number] => {
    const values = rows.flatMap(r => r?.telemetry ?? []).map(p => p[channel]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (!values.length) return [0, 1];
    const min = Math.min(...values), max = Math.max(...values), pad = Math.max(1, (max - min) * .05);
    return [Math.max(0, min - pad), max + pad];
  };
  return { speed: domain("speed"), rpm: domain("rpm") };
}

export async function analyzeSelectedCorner(request: CornerRequest, signal?: AbortSignal): Promise<SelectedCornerResult> {
  const response = await fetch(await resolveApiUrl("/xrk/selected-corner"), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error_code?: unknown };
    throw Error(typeof body.error_code === "string" ? body.error_code : `CORNER_SERVICE_${response.status}`);
  }
  return response.json();
}
