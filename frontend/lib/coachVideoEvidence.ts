import type { XrkTrackPoint } from "./xrkAnalysisApi";

export type CoachVideoWindow = {
  start_s: number;
  end_s: number;
  focus_distance_m: number;
};

/** Build a short local-video review clip around one telemetry event. */
export function buildCoachVideoWindow(
  targetTrack: XrkTrackPoint[],
  focusDistanceM: number,
  offsetMs: number,
  videoDurationS: number,
  clipDurationS = 4,
): CoachVideoWindow | null {
  if (!targetTrack.length || !Number.isFinite(videoDurationS) || videoDurationS < 3) {
    return null;
  }
  const usableTrack = targetTrack.filter(
    (point) => typeof point.session_time_s === "number" && Number.isFinite(point.session_time_s),
  );
  const focus = nearestByDistance(usableTrack, focusDistanceM);
  if (
    typeof focus?.session_time_s !== "number"
    || !Number.isFinite(focus.session_time_s)
  ) {
    return null;
  }

  const duration = Math.min(5, Math.max(3, clipDurationS));
  const focusTime = focus.session_time_s + offsetMs / 1000;
  if (!Number.isFinite(focusTime) || focusTime < 0 || focusTime > videoDurationS) {
    return null;
  }
  const start = Math.min(
    Math.max(0, focusTime - duration / 2),
    videoDurationS - duration,
  );
  const end = start + duration;
  return {
    start_s: start,
    end_s: end,
    focus_distance_m: focus.distance_m,
  };
}

function nearestByDistance(points: XrkTrackPoint[], distanceM: number): XrkTrackPoint | null {
  let nearest: XrkTrackPoint | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const delta = Math.abs(point.distance_m - distanceM);
    if (delta < bestDelta) {
      nearest = point;
      bestDelta = delta;
    }
  }
  return nearest;
}
