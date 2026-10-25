import { resolveApiUrl } from "./config";
import type { XrkAnalysis, XrkLapQualityRow } from "./xrkAnalysisApi";

export type DriverPoint = { session_time_s: number; lap_time_s: number; distance_m: number;
  local_x_m: number; local_y_m: number; speed?: number | null; rpm?: number | null };
export type DriverSession = { metadata: Record<string, string | number | null>; selected_lap: number;
  file_fingerprint?: string;
  timing: { start_time_ms: number; end_time_ms: number; duration_s: number }; track: DriverPoint[];
  lap_quality: XrkAnalysis["lap_quality"]; gps_quality: Record<string, unknown>;
  channel_provenance: Record<string, { source: string; name?: string }>;
  fastest_five: { laps: XrkLapQualityRow[]; count: number; fastest: XrkLapQualityRow | null;
    variance_s2: number | null; status: string } };
export type CornerObservation = { start_session_s: number; end_session_s: number; elapsed_s: number;
  metrics: Record<string, number | null>; profile: { progress: number[]; speed: number[]; rpm: number[] | null };
  events: { type: string; from_entry_s: number; confidence: string; evidence: Record<string, unknown> }[];
  driver_input_confirmed: false };
export type DriverCorner = { id: string; status: "candidate" | "unavailable"; reason?: string;
  context?: { status: string; reason: string };
  a?: CornerObservation; b?: CornerObservation; difference_s?: number; differences?: Record<string, number | null> };
export type DualDriverResult = { version: 1; sessions: { a: DriverSession; b: DriverSession };
  corners: DriverCorner[]; warnings: string[]; limitations?: string[]; registration: null | { status: string };
  synthetic_curve_generated: false };
export type DriverBinding = { version: 1; fileKey: string; inspectionId: string; lap: number;
  video_start_s: number; video_end_s: number; offset_s: number; uncertainty_s: .5; confirmed: true };

/** Separate namespace: this workflow never writes existing single-driver anchors. */
export function bindingKey(inspectionId: string, fileKey: string, lap: number) {
  return `racing-dual-binding:v1:${inspectionId}:${fileKey}:${lap}`;
}

export function parseDriverBinding(raw: string | null, inspectionId: string, fileKey: string,
  lap: number, duration: number, sessionStart: number): DriverBinding | null {
  try {
    const r = JSON.parse(raw ?? "null");
    return r?.version === 1 && r.fileKey === fileKey && r.inspectionId === inspectionId && r.lap === lap
      && r.confirmed === true && r.uncertainty_s === .5
      && [r.video_start_s, r.video_end_s, r.offset_s].every(Number.isFinite)
      && r.video_start_s >= 0 && r.video_end_s > r.video_start_s && r.video_end_s <= duration
      && Math.abs(r.offset_s - (r.video_start_s - sessionStart)) < 1e-6 ? r : null;
  } catch { return null; }
}

/** A bounded five-second observation must stay within the manually paired lap. */
export function driverClipStart(observation: CornerObservation, binding: DriverBinding, duration: number): number | null {
  const start = observation.start_session_s + binding.offset_s;
  return Number.isFinite(start) && start >= binding.video_start_s && start + 5 <= Math.min(duration, binding.video_end_s) ? start : null;
}

/** Playback and telemetry use the same physical interval, with independent video clocks. */
export function driverClipWindow(observation: CornerObservation, binding: DriverBinding, duration: number) {
  const start = observation.start_session_s + binding.offset_s, end = observation.end_session_s + binding.offset_s;
  return [start, end].every(Number.isFinite) && end > start && start >= binding.video_start_s
    && end <= Math.min(duration, binding.video_end_s) ? { start, end } : null;
}

export function clipTelemetryTime(videoTime: number, videoStart: number, observation: CornerObservation) {
  const elapsed = videoTime - videoStart;
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= observation.elapsed_s + .001
    ? observation.start_session_s + elapsed : null;
}

export function channelAt(points: DriverPoint[], time: number, key: "rpm" | "speed"): number | null {
  const i = points.findIndex(p => p.session_time_s >= time);
  if (i < 0) return null;
  const b = points[i];
  if (b.session_time_s === time) return typeof b[key] === "number" && Number.isFinite(b[key]) ? b[key]! : null;
  if (!i) return null;
  const a = points[i - 1], dt = b.session_time_s - a.session_time_s;
  if (dt <= 0 || dt > .5 || typeof a[key] !== "number" || typeof b[key] !== "number" || !Number.isFinite(a[key]) || !Number.isFinite(b[key])) return null;
  return a[key]! + (b[key]! - a[key]!) * (time - a.session_time_s) / dt;
}

export async function requestDriverReview(ids: [string, string], laps: [number | null, number | null],
  signal: AbortSignal, start?: number): Promise<DualDriverResult> {
  const response = await fetch(await resolveApiUrl("/comparisons/review"), { method: "POST", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      session_a: { inspection_id: ids[0], lap: laps[0] }, session_b: { inspection_id: ids[1], lap: laps[1] }, source_start_s: start ?? null, include_context: true }) });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw Error(`${error.message || "Comparison unavailable"} [${error.error_code || response.status}]`);
  }
  return response.json();
}
