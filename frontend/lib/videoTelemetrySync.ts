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
