export const VIDEO_SYNC_CALIBRATION_VERSION = 1;

export type TelemetrySyncPoint = {
  distance_m: number;
  session_time_s?: number | null;
};

export type SeekRequest = {
  distance_m: number;
  sequence: number;
};

export type VideoSyncCalibration = {
  version: typeof VIDEO_SYNC_CALIBRATION_VERSION;
  offset_ms: number;
  telemetry_distance_m: number;
  telemetry_session_time_s: number;
  video_time_s: number;
  target_lap: number;
  calibrated_at: string;
  review?: { method: "audio_rpm_multi_window_v1" | "gpmf_gnss_v1" | "manual_lap_bounds_v1"; verdict: "confirmed"; scope: "session" | "selected_lap"; checked_points: number };
  lap_bounds?: ManualLapBounds;
  video: {
    duration_s: number;
    size_bytes: number;
    last_modified_ms: number;
    mime_type: string;
  };
};

export type VideoSeekValidation =
  | { ok: true; time_s: number }
  | { ok: false; time_s: null; message: string };

export type ManualLapBounds = {
  video_start_s: number; video_end_s: number;
  telemetry_start_s: number; telemetry_end_s: number;
  video_duration_s: number; telemetry_duration_s: number; end_residual_s: number;
};

/** Compare actual logger boundaries, never the cropped GPS track or fastest-lap estimate. */
export function inspectManualLapBounds(videoStart: number, videoEnd: number,
  telemetryStart: number, telemetryEnd: number, videoDuration: number): ManualLapBounds | null {
  if (![videoStart, videoEnd, telemetryStart, telemetryEnd, videoDuration].every(Number.isFinite)
    || videoDuration <= 0 || videoStart < 0 || videoEnd > videoDuration || videoEnd <= videoStart
    || telemetryStart < 0 || telemetryEnd <= telemetryStart) return null;
  return { video_start_s: videoStart, video_end_s: videoEnd,
    telemetry_start_s: telemetryStart, telemetry_end_s: telemetryEnd,
    video_duration_s: videoEnd-videoStart, telemetry_duration_s: telemetryEnd-telemetryStart,
    end_residual_s: (videoEnd-videoStart)-(telemetryEnd-telemetryStart) };
}

/** Bind the human-confirmed start; the second mark checks duration, never stretches time. */
export function createManualLapCalibration(bounds: ManualLapBounds, input: {
  targetLap: number; videoDurationS: number; fileSizeBytes: number;
  fileLastModifiedMs: number; fileMimeType: string;
}): VideoSyncCalibration {
  const checked = inspectManualLapBounds(bounds.video_start_s, bounds.video_end_s,
    bounds.telemetry_start_s, bounds.telemetry_end_s, input.videoDurationS);
  if (!checked || !Number.isInteger(input.targetLap) || input.targetLap < 1)
    throw new Error("A real lap and valid video boundaries are required.");
  return { ...createVideoSyncCalibration({ ...input, videoTimeS: checked.video_start_s,
    telemetryPoint: { distance_m: 0, session_time_s: checked.telemetry_start_s } }),
    lap_bounds: checked,
    review: { method: "manual_lap_bounds_v1", verdict: "confirmed", scope: "selected_lap", checked_points: 2 } };
}

/** Offset convention: video time = telemetry session time + offset. */
export function calculateVideoOffsetMs(
  videoTimeS: number,
  telemetrySessionTimeS: number
): number {
  if (!Number.isFinite(videoTimeS) || !Number.isFinite(telemetrySessionTimeS)) {
    throw new Error("Video and telemetry times must be finite numbers.");
  }
  return Math.round((videoTimeS - telemetrySessionTimeS) * 1000);
}

export function telemetryToVideoTimeS(sessionTimeS: number, offsetMs: number): number {
  return sessionTimeS + offsetMs / 1000;
}

export function videoToTelemetryTimeS(videoTimeS: number, offsetMs: number): number {
  return videoTimeS - offsetMs / 1000;
}

export function validateVideoSeek(
  targetTimeS: number,
  durationS: number
): VideoSeekValidation {
  if (!Number.isFinite(durationS) || durationS <= 0) {
    return {
      ok: false,
      time_s: null,
      message: "Video duration is unavailable. Wait for the video metadata to load.",
    };
  }
  if (!Number.isFinite(targetTimeS)) {
    return { ok: false, time_s: null, message: "The calculated video time is invalid." };
  }
  if (targetTimeS < 0 || targetTimeS > durationS) {
    return {
      ok: false,
      time_s: null,
      message: `Calculated video time ${targetTimeS.toFixed(3)}s is outside 0-${durationS.toFixed(3)}s. Recalibrate T = D.`,
    };
  }
  return { ok: true, time_s: targetTimeS };
}

export function nearestPointByDistance<T extends TelemetrySyncPoint>(
  points: T[],
  distanceM: number
): T | null {
  return nearestUsablePoint(points, (point) => point.distance_m, distanceM);
}

export function nearestPointBySessionTime<T extends TelemetrySyncPoint>(
  points: T[],
  sessionTimeS: number
): T | null {
  return nearestUsablePoint(
    points.filter((point) => Number.isFinite(point.session_time_s)),
    (point) => Number(point.session_time_s),
    sessionTimeS
  );
}

export function telemetrySessionTimeBounds(
  points: TelemetrySyncPoint[]
): { start_s: number; end_s: number } | null {
  const values = points
    .map((point) => point.session_time_s)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return null;
  return { start_s: Math.min(...values), end_s: Math.max(...values) };
}

/** Review a whole target lap only when the proposed mapping covers its bounds. */
export function rpmReviewPoints(
  points: TelemetrySyncPoint[], offsetMs: number, videoDurationS: number,
  analyzedRange: [number, number] | undefined,
): Array<{ session_time_s: number; video_time_s: number; distance_m: number }> {
  const bounds = telemetrySessionTimeBounds(points);
  if (!bounds || !analyzedRange || !Number.isFinite(offsetMs)) return [];
  const first = telemetryToVideoTimeS(bounds.start_s, offsetMs);
  const last = telemetryToVideoTimeS(bounds.end_s, offsetMs);
  if (first < 0 || last > videoDurationS || first < analyzedRange[0] - .3 || last > analyzedRange[1] + .3) return [];
  return [.05, .5, .95].flatMap((fraction) => {
    const point = nearestPointBySessionTime(points, bounds.start_s + fraction * (bounds.end_s - bounds.start_s));
    return point?.session_time_s != null ? [{
      session_time_s: point.session_time_s, distance_m: point.distance_m,
      video_time_s: telemetryToVideoTimeS(point.session_time_s, offsetMs),
    }] : [];
  });
}

export function nextSeekRequest(
  previous: SeekRequest | null,
  distanceM: number
): SeekRequest {
  return {
    distance_m: distanceM,
    sequence: (previous?.sequence ?? 0) + 1,
  };
}

export function createVideoSyncCalibration(input: {
  videoTimeS: number;
  telemetryPoint: TelemetrySyncPoint;
  targetLap: number;
  videoDurationS: number;
  fileSizeBytes: number;
  fileLastModifiedMs: number;
  fileMimeType: string;
  calibratedAt?: string;
}): VideoSyncCalibration {
  const telemetryTime = input.telemetryPoint.session_time_s;
  if (typeof telemetryTime !== "number" || !Number.isFinite(telemetryTime)) {
    throw new Error("The current target-lap point has no telemetry session time.");
  }
  const seek = validateVideoSeek(input.videoTimeS, input.videoDurationS);
  if (!seek.ok) throw new Error(seek.message);
  return {
    version: VIDEO_SYNC_CALIBRATION_VERSION,
    offset_ms: calculateVideoOffsetMs(input.videoTimeS, telemetryTime),
    telemetry_distance_m: round(input.telemetryPoint.distance_m, 3),
    telemetry_session_time_s: round(telemetryTime, 6),
    video_time_s: round(input.videoTimeS, 6),
    target_lap: input.targetLap,
    calibrated_at: input.calibratedAt ?? new Date().toISOString(),
    video: {
      duration_s: round(input.videoDurationS, 3),
      size_bytes: Math.max(0, Math.trunc(input.fileSizeBytes)),
      last_modified_ms: Math.max(0, Math.trunc(input.fileLastModifiedMs)),
      mime_type: input.fileMimeType.slice(0, 100),
    },
  };
}

export function parseVideoSyncCalibration(value: string | null): VideoSyncCalibration | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<VideoSyncCalibration>;
    if (
      parsed.version !== VIDEO_SYNC_CALIBRATION_VERSION
      || !isFiniteNumber(parsed.offset_ms)
      || !isFiniteNumber(parsed.telemetry_distance_m)
      || !isFiniteNumber(parsed.telemetry_session_time_s)
      || !isFiniteNumber(parsed.video_time_s)
      || !Number.isInteger(parsed.target_lap)
      || typeof parsed.calibrated_at !== "string"
      || !parsed.video
      || !isFiniteNumber(parsed.video.duration_s)
      || !isFiniteNumber(parsed.video.size_bytes)
      || !isFiniteNumber(parsed.video.last_modified_ms)
      || typeof parsed.video.mime_type !== "string"
    ) {
      return null;
    }
    if (parsed.lap_bounds) {
      const b = parsed.lap_bounds;
      const checked = inspectManualLapBounds(b.video_start_s, b.video_end_s,
        b.telemetry_start_s, b.telemetry_end_s, parsed.video.duration_s);
      if (!checked || Math.abs(calculateVideoOffsetMs(b.video_start_s, b.telemetry_start_s)-parsed.offset_ms) > 1)
        return null;
      parsed.lap_bounds = checked;
    }
    return parsed as VideoSyncCalibration;
  } catch {
    return null;
  }
}

function nearestUsablePoint<T>(
  points: T[],
  value: (point: T) => number,
  target: number
): T | null {
  if (!Number.isFinite(target)) return null;
  return points.reduce<T | null>((best, candidate) => {
    const candidateValue = value(candidate);
    if (!Number.isFinite(candidateValue)) return best;
    if (!best || Math.abs(candidateValue - target) < Math.abs(value(best) - target)) {
      return candidate;
    }
    return best;
  }, null);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}
