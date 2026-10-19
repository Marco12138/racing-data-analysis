import type { TopLapSegment } from "./xrkAnalysisApi";

export type PublishedVideoReview = {
  version: 1;
  anchor_lap: number;
  anchor_video_start_s: number;
  anchor_uncertainty_s: number;
  offset_s: number;
  whole_recording_verified: false;
  audio_removed: true;
  metadata_removed: true;
  segments: TopLapSegment[];
  clips: Array<{
    sector_id: string; lap: number; url: string; poster: string; duration_s: number;
    source_start_s: number; telemetry_start_s: number; start_distance_m: number;
    gps_warning: boolean; alignment_status: "manual_anchor_extrapolated";
  }>;
};

/** Published media is limited to reviewed same-origin excerpts, never arbitrary upload URLs. */
export function isPublishedVideoReview(value: unknown): value is PublishedVideoReview {
  if (!value || typeof value !== "object") return false;
  const v = value as PublishedVideoReview;
  return v.version === 1 && v.whole_recording_verified === false
    && v.audio_removed === true && v.metadata_removed === true
    && Number.isFinite(v.anchor_video_start_s) && v.anchor_uncertainty_s === .5
    && Array.isArray(v.segments) && v.segments.length > 0
    && Array.isArray(v.clips) && v.clips.length > 0 && v.clips.every(c =>
      /^\/demo\/video\/sector-\d+-lap-\d+\.mp4$/.test(c.url)
      && /^\/demo\/video\/sector-\d+-lap-\d+\.jpg$/.test(c.poster)
      && c.duration_s === 5 && Number.isFinite(c.source_start_s) && c.source_start_s >= 0
      && c.alignment_status === "manual_anchor_extrapolated"
      && v.segments.some(s => s.id === c.sector_id && s.rows.some(r => r.lap === c.lap)));
}
