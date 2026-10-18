import { reviewValue, reviewWindowAtOffset, type ReviewPoint, type ReviewWindow } from "./coachReview";
import { matchesReviewVideo, reviewDistanceAtTime, type VideoIdentity } from "./manualReview";
import type { VideoSyncCalibration } from "./videoTelemetrySync";
import type { TrackLandmark } from "./trackLandmarks";

export type LoggerLapRange = { lap: number; telemetry_start_s: number; telemetry_end_s: number };
export type ReviewCandidate = {
  method: "confirmed_anchor_elapsed_time_v1";
  source: VideoSyncCalibration; lap: number; window: ReviewWindow;
  focus_session_s: number; elapsed_from_anchor_s: number; lap_start_delta_s: number;
  predicted_lap_start_s: number; predicted_lap_end_s: number;
  sync_confirmed: false;
};
export type CandidateResult = { candidate: ReviewCandidate | null; reason: string };
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Same-session, same-file proposals only. Never save or promote a propagated anchor. */
export function inferReviewCandidate(trace: ReviewPoint[], lap: number, focus: number,
  anchors: VideoSyncCalibration[], ranges: LoggerLapRange[], video: VideoIdentity | null,
  context?: { entry: number; exit: number }, startDistance?: number): CandidateResult {
  const unavailable = (reason: string): CandidateResult => ({ candidate: null, reason });
  const validRange = (r: LoggerLapRange) => finite(r.telemetry_start_s) && finite(r.telemetry_end_s)
    && r.telemetry_end_s > r.telemetry_start_s;
  const range = ranges.find(r => r.lap === lap && validRange(r));
  const at = reviewValue(trace, focus, "session_time_s");
  if (!video || !range || at === null || at < range.telemetry_start_s || at > range.telemetry_end_s)
    return unavailable("missing_real_timing");
  const sources = anchors.filter(a => {
    const r = ranges.find(r => r.lap === a.target_lap && validRange(r));
    return a.target_lap !== lap && r && matchesReviewVideo(a.video, video)
      && (!a.review || a.review.verdict === "confirmed")
      && [a.offset_ms, a.video_time_s, a.telemetry_session_time_s].every(finite)
      && a.video_time_s >= 0 && a.video_time_s <= video.duration_s
      && a.telemetry_session_time_s >= r.telemetry_start_s && a.telemetry_session_time_s <= r.telemetry_end_s
      && Math.abs(a.video_time_s - a.telemetry_session_time_s - a.offset_ms / 1000) <= .002;
  }).sort((a, b) => Math.abs(a.telemetry_session_time_s - at) - Math.abs(b.telemetry_session_time_s - at));
  if (!sources.length) return unavailable("no_matching_anchor");
  // Conflicting human marks need review, not an average or an automatically fitted clock.
  if (Math.max(...sources.map(a => a.offset_ms)) - Math.min(...sources.map(a => a.offset_ms)) > 250)
    return unavailable("anchors_disagree");
  const source = sources[0], offset = source.offset_ms / 1000;
  const window = reviewWindowAtOffset(trace, focus, offset, video.duration_s, context, startDistance);
  if (!window) return unavailable("outside_video_or_timing");
  const start = window.start_s - offset, end = window.end_s - offset;
  const a = reviewDistanceAtTime(trace, start), b = reviewDistanceAtTime(trace, end);
  if (a === null || b === null || b <= a || start < range.telemetry_start_s || end > range.telemetry_end_s)
    return unavailable("outside_video_or_timing");
  if (trace.some((p, i) => {
    if (p.distance_m >= a && p.distance_m <= b && !finite(p.session_time_s)) return true;
    const previous = trace[i - 1];
    if (!previous || previous.distance_m >= b || p.distance_m <= a) return false;
    return p.distance_m <= previous.distance_m || p.distance_m - previous.distance_m > 10
      || !finite(p.session_time_s) || !finite(previous.session_time_s)
      || p.session_time_s <= previous.session_time_s || p.session_time_s - previous.session_time_s > 1;
  }))
    return unavailable("telemetry_gap");
  const sourceRange = ranges.find(r => r.lap === source.target_lap)!;
  return { reason: "confirmation_required", candidate: {
    method: "confirmed_anchor_elapsed_time_v1", source, lap, window, focus_session_s: at,
    elapsed_from_anchor_s: at - source.telemetry_session_time_s,
    lap_start_delta_s: range.telemetry_start_s - sourceRange.telemetry_start_s,
    predicted_lap_start_s: range.telemetry_start_s + offset,
    predicted_lap_end_s: range.telemetry_end_s + offset, sync_confirmed: false,
  } };
}

/** Search one already-confirmed fixed landmark near its predicted crossing, never the whole lap. */
export function candidateLandmarkCheck(library: TrackLandmark[], candidate: ReviewCandidate,
  trace: ReviewPoint[], videoKey: string) {
  for (const landmark of library) {
    const sighting = landmark.sightings.find(s => s.lap === candidate.source.target_lap
      && s.videoKey === videoKey && s.syncKey === JSON.stringify(candidate.source)
      && s.relation === "passing" && finite(s.distanceM));
    if (!sighting) continue;
    const time = reviewValue(trace, sighting.distanceM!, "session_time_s");
    if (time === null) continue;
    const expected = time + candidate.source.offset_ms / 1000;
    if (expected < candidate.window.start_s || expected > candidate.window.end_s) continue;
    return { landmark, expected, window: { start_s: Math.max(candidate.window.start_s, expected - 2),
      end_s: Math.min(candidate.window.end_s, expected + 2) } };
  }
  return null;
}
