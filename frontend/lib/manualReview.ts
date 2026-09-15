import { reviewValue, type ReviewPoint, type ReviewWindow } from "./coachReview";
import { parseVideoSyncCalibration, type VideoSyncCalibration } from "./videoTelemetrySync";

export type ReviewSide = "reference" | "target";
export type VideoIdentity = { size_bytes: number; last_modified_ms: number; duration_s: number; mime_type: string };
export type ManualReviewClip = {
  version: 1; lap: number; start_s: number; end_s: number; video: VideoIdentity;
  calibration: VideoSyncCalibration | null; sync_confirmed: boolean; saved_at: string;
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Only metadata identifying the local file is retained, never its name or contents. */
export function reviewVideoIdentity(file: Pick<File, "size" | "lastModified" | "type">, duration: number): VideoIdentity {
  return { size_bytes: file.size, last_modified_ms: file.lastModified, duration_s: duration, mime_type: file.type.slice(0, 100) };
}

export function matchesReviewVideo(a: VideoIdentity, b: VideoIdentity): boolean {
  return a.size_bytes === b.size_bytes && a.last_modified_ms === b.last_modified_ms
    && Math.abs(a.duration_s - b.duration_s) <= .1 && a.mime_type === b.mime_type;
}

/** Invert real monotonic timestamps without extrapolating or crossing missing segments. */
export function reviewDistanceAtTime(trace: ReviewPoint[], time: number): number | null {
  if (!finite(time)) return null;
  for (let i = 0; i < trace.length; i++) {
    const b = trace[i], a = trace[i - 1];
    if (b.session_time_s === time) return b.distance_m;
    if (!a || !finite(a.session_time_s) || !finite(b.session_time_s)) continue;
    const gap = b.distance_m - a.distance_m;
    if (gap <= 0 || gap > 10 || b.session_time_s <= a.session_time_s) continue;
    if (time > a.session_time_s && time < b.session_time_s) {
      return a.distance_m + gap * (time - a.session_time_s) / (b.session_time_s - a.session_time_s);
    }
  }
  return null;
}

/** A crop is previewable without synchronization; telemetry is gated separately. */
export function validateManualReview(clip: ManualReviewClip, trace: ReviewPoint[], lap: number, video: VideoIdentity): string | null {
  if (clip.version !== 1 || clip.lap !== lap || !matchesReviewVideo(clip.video, video)) return "wrong_lap_or_video";
  if (![clip.start_s, clip.end_s, video.duration_s].every(finite) || clip.start_s < 0
    || clip.end_s > video.duration_s || clip.end_s - clip.start_s < .1 || clip.end_s - clip.start_s > 120) return "invalid_window";
  if (!clip.sync_confirmed) return null;
  const anchor = clip.calibration;
  if (!anchor || anchor.target_lap !== lap || !matchesReviewVideo(anchor.video, video)) return "anchor_required";
  const actualTime = reviewValue(trace, anchor.telemetry_distance_m, "session_time_s");
  if (actualTime === null || Math.abs(actualTime - anchor.telemetry_session_time_s) > .02
    || Math.abs(anchor.video_time_s - actualTime - anchor.offset_ms / 1000) > .02) return "anchor_mismatch";
  const start = clip.start_s - anchor.offset_ms / 1000, end = clip.end_s - anchor.offset_ms / 1000;
  const a = reviewDistanceAtTime(trace, start), b = reviewDistanceAtTime(trace, end);
  if (a === null || b === null || b <= a) return "outside_telemetry";
  const inside = trace.filter(p => p.distance_m >= a && p.distance_m <= b);
  if (inside.some((p, i) => !finite(p.session_time_s) || (i > 0 && (!finite(inside[i-1].session_time_s)
    || p.session_time_s <= inside[i-1].session_time_s! || p.distance_m - inside[i-1].distance_m > 10)))) return "telemetry_gap";
  return null;
}

/** Read only the known revision schema; reselecting a different file cannot restore it. */
export function restoreManualReview(raw: string | null, trace: ReviewPoint[], lap: number, video: VideoIdentity): ManualReviewClip | null {
  try {
    const value = JSON.parse(raw ?? "null");
    const p = Array.isArray(value) ? value[0] : null;
    if (!p || p.version !== 1 || typeof p.sync_confirmed !== "boolean" || typeof p.saved_at !== "string" || !p.video) return null;
    const clip: ManualReviewClip = { version: 1, lap: p.lap, start_s: p.start_s, end_s: p.end_s,
      video: { size_bytes: p.video.size_bytes, last_modified_ms: p.video.last_modified_ms, duration_s: p.video.duration_s, mime_type: p.video.mime_type },
      calibration: parseVideoSyncCalibration(JSON.stringify(p.calibration)), sync_confirmed: p.sync_confirmed, saved_at: p.saved_at };
    return validateManualReview(clip, trace, lap, video) ? null : clip;
  } catch { return null; }
}

export function manualReviewWindow(clip: ManualReviewClip, trace: ReviewPoint[], focus: number): ReviewWindow {
  const time = reviewValue(trace, focus, "session_time_s");
  return { start_s: clip.start_s, end_s: clip.end_s,
    focus_s: clip.sync_confirmed && clip.calibration && time !== null ? time + clip.calibration.offset_ms / 1000 : (clip.start_s + clip.end_s) / 2 };
}
