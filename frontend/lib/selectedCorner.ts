import type { VideoSyncCalibration } from "./videoTelemetrySync";
import { matchesReviewVideo, type VideoIdentity } from "./manualReview";
import { resolveApiUrl } from "./config";

export type CornerMetrics = { entry_speed_kmh: number; minimum_speed_kmh: number; exit_speed_kmh: number; minimum_position_fraction: number; minimum_rpm: number | null };
export type CornerLap = {
  lap: number; status: "candidate" | "excluded"; reason: string | null;
  quality: { analysis_eligible: boolean; reasons: string[] };
  start_session_s?: number; end_session_s?: number; elapsed_s?: number; downstream_s?: number | null;
  start_distance_m?: number; end_distance_m?: number;
  profile?: { progress: number[]; speed: number[]; rpm: number[] | null; metrics: CornerMetrics };
};
export type CornerGroup = { id: number; laps: number[]; count: number; representative_lap: number; median_time_s: number; time_range_s: number[]; median_downstream_s: number | null; median_combined_s: number | null; metrics: CornerMetrics };
export type SelectedCornerResult = {
  version: 1; source_lap: number; start_session_s: number; end_session_s: number;
  laps: CornerLap[]; synthetic_curve_generated: false;
  patterns: { status: "insufficient_confirmed_laps" | "no_clear_separation" | "exploratory_groups";
    groups: CornerGroup[]; confirmed_laps: number[]; most_common_group_ids: number[];
    fastest_observed_group_ids: number[]; common_is_fastest: boolean | null;
    confidence: "low"; silhouette: number | null; channels?: string[] };
};
export type CornerRequest = { inspection_id: string; source_lap: number; start_session_s: number; end_session_s: number; confirmed_laps: number[] };

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
export function cornerVideoWindow(row: CornerLap, anchor: VideoSyncCalibration, duration: number) {
  if (row.status !== "candidate" || !Number.isFinite(row.start_session_s) || !Number.isFinite(row.end_session_s)) return null;
  const start = row.start_session_s! + anchor.offset_ms / 1000, end = row.end_session_s! + anchor.offset_ms / 1000;
  return start >= 0 && end > start && Math.max(end, start + 5) <= duration ? { start, end } : null;
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
