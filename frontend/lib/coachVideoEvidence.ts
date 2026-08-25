import type { XrkTrackPoint } from "./xrkAnalysisApi";

export type CoachVideoWindow = {
  start_s: number;
  end_s: number;
  entry_distance_m: number;
  exit_distance_m: number;
};

/** Map one telemetry zone to a bounded local-video window using a verified offset. */
export function buildCoachVideoWindow(
  targetTrack: XrkTrackPoint[],
  entryDistanceM: number,
  exitDistanceM: number,
  offsetMs: number,
  videoDurationS: number,
  paddingS = 0.8,
): CoachVideoWindow | null {
  if (!targetTrack.length || !Number.isFinite(videoDurationS) || videoDurationS <= 0) {
    return null;
  }
  const usableTrack = targetTrack.filter(
    (point) => typeof point.session_time_s === "number" && Number.isFinite(point.session_time_s),
  );
  const entry = nearestByDistance(usableTrack, entryDistanceM);
  const exit = nearestByDistance(usableTrack, exitDistanceM);
  if (
    typeof entry?.session_time_s !== "number"
    || !Number.isFinite(entry.session_time_s)
    || typeof exit?.session_time_s !== "number"
    || !Number.isFinite(exit.session_time_s)
  ) {
    return null;
  }

  const rawStart = entry.session_time_s + offsetMs / 1000;
  const rawEnd = exit.session_time_s + offsetMs / 1000;
  const start = Math.max(0, Math.min(rawStart, rawEnd) - Math.max(0, paddingS));
  const end = Math.min(videoDurationS, Math.max(rawStart, rawEnd) + Math.max(0, paddingS));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.25) {
    return null;
  }
  return {
    start_s: start,
    end_s: end,
    entry_distance_m: Math.min(entryDistanceM, exitDistanceM),
    exit_distance_m: Math.max(entryDistanceM, exitDistanceM),
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
