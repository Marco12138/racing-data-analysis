import { matchesReviewVideo, type VideoIdentity } from "./manualReview";
import type { GnssSegmentedCheck, GnssSegmentStatus } from "./xrkAnalysisApi";

export const REVIEW_GPS_EVENT = "racing-review-gps-evidence";
export const reviewGpsKey = (fingerprint: string) => `racing-review-gps:v1:${fingerprint}`;
export type ReviewGpsEvidence = {
  version: 1; video: VideoIdentity;
  segments: Array<{ session_range_s: [number, number]; status: GnssSegmentStatus }>;
};

/** Persist diagnostic intervals only, never a new offset or a passed whole-recording verdict. */
export function reviewGpsEvidence(video: VideoIdentity, check: GnssSegmentedCheck): ReviewGpsEvidence {
  return { version: 1, video, segments: check.segments.map(s => ({ session_range_s: s.session_range_s, status: s.status })) };
}

export function parseReviewGpsEvidence(raw: string | null, video: VideoIdentity): ReviewGpsEvidence | null {
  try {
    const p = JSON.parse(raw ?? "null");
    if (p?.version !== 1 || !p.video || !matchesReviewVideo(p.video, video) || !Array.isArray(p.segments)
      || p.segments.length > 1000 || !p.segments.every((s: ReviewGpsEvidence["segments"][number]) =>
        Array.isArray(s.session_range_s) && s.session_range_s.length === 2 && s.session_range_s.every(Number.isFinite)
        && s.session_range_s[1] > s.session_range_s[0]
        && ["passed", "gps_inconsistent", "fit_only", "insufficient", "untested"].includes(s.status))) return null;
    return p;
  } catch { return null; }
}

/** Map diagnostic telemetry intervals with the active manual/candidate offset, not the GNSS proposal. */
export function reviewGpsOverlaps(evidence: ReviewGpsEvidence | null, start: number, end: number, offset: number) {
  if (!evidence || ![start, end, offset].every(Number.isFinite)) return [];
  return evidence.segments.filter(s => s.session_range_s[0] + offset < end && s.session_range_s[1] + offset > start)
    .map(s => ({ ...s, video_range_s: s.session_range_s.map(t => t + offset) as [number, number] }));
}
