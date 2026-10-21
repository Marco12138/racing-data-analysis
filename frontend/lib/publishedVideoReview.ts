import type { TopLapSegment } from "./xrkAnalysisApi";
import type { GoproSpeedPoint } from "./gpmfTelemetry";

export type PublishedVideoReview = {
  version: 1;
  anchor_lap: number;
  anchor_video_start_s: number;
  anchor_uncertainty_s: number;
  offset_s: number;
  whole_recording_verified: false;
  audio_removed: boolean;
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
    && typeof v.audio_removed === "boolean" && v.metadata_removed === true
    && Number.isFinite(v.anchor_video_start_s) && v.anchor_uncertainty_s === .5
    && Array.isArray(v.segments) && v.segments.length > 0
    && Array.isArray(v.clips) && v.clips.length > 0 && v.clips.every(c =>
      /^\/demo\/video\/sector-\d+-lap-\d+\.mp4$/.test(c.url)
      && /^\/demo\/video\/sector-\d+-lap-\d+\.jpg$/.test(c.poster)
      && c.duration_s === 5 && Number.isFinite(c.source_start_s) && c.source_start_s >= 0
      && c.alignment_status === "manual_anchor_extrapolated"
      && v.segments.some(s => s.id === c.sector_id && s.rows.some(r => r.lap === c.lap)));
}

export type PublishedClipMedia = {
  url: string; source_start_s: number; duration_s: number; revision: string;
  audio_present: true; speed_source: "gopro_gps5_2d";
  timing: "video_cts_uniform_packet_samples"; sensor_latency_calibrated: false;
  points: GoproSpeedPoint[];
};

/** Bind sanitized speed to the exact excerpt, including older cached demo summaries. */
export function publishedClipMedia(clip: PublishedVideoReview["clips"][number], manifest: unknown): PublishedClipMedia | null {
  if (!manifest || typeof manifest !== "object") return null;
  const m = manifest as { version?: number; clips?: PublishedClipMedia[] };
  if (m.version !== 1 || !Array.isArray(m.clips)) return null;
  const row = m.clips.find(c => c.url === clip.url && c.source_start_s === clip.source_start_s && c.duration_s === clip.duration_s);
  if (!row || !/^[a-f0-9]{16}$/.test(row.revision) || row.audio_present !== true
    || row.speed_source !== "gopro_gps5_2d" || row.timing !== "video_cts_uniform_packet_samples" || row.sensor_latency_calibrated !== false
    || !Array.isArray(row.points) || !row.points.length || row.points.length > 1000
    || row.points.some((p, i) => !Number.isFinite(p.time_s) || p.time_s < 0 || p.time_s > clip.duration_s
      || (i > 0 && p.time_s <= row.points[i - 1].time_s) || ![0, 1, 2, 3].includes(p.fix)
      || (p.speed_kmh !== null && (!Number.isFinite(p.speed_kmh) || p.speed_kmh < 0 || p.speed_kmh > 600)))) return null;
  return row;
}
