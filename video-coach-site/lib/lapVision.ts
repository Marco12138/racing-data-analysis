export type LapSample = {
  time_s: number;
  lateral: number; // normalized 0..1 across the frame width
};

export type CornerSegment = {
  start: number;
  end: number;
  apex: number;
  direction: 1 | -1;
  name?: string;
  notes?: string;
};

export type CornerIssue = {
  type: "overlap";
  index: number;
  prev: CornerSegment;
  next: CornerSegment;
  overlapS: number;
};

export type StraightGap = {
  index: number;
  prev: CornerSegment;
  next: CornerSegment;
  gapS: number;
};

const BAND_TOP = 0.35;
const BAND_BOTTOM = 0.65;
const MIN_MASK_RATIO = 0.05;

/**
 * Heuristic lateral position: horizontal centroid of the "road-like" luminance
 * band below the horizon, normalized to 0..1. Returns null when the band is
 * mostly empty (e.g., off-track or glare).
 */
export function lateralPositionFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): number | null {
  const rowStart = Math.floor(height * BAND_TOP);
  const rowEnd = Math.max(rowStart + 2, Math.floor(height * BAND_BOTTOM));
  const bandHeight = rowEnd - rowStart;

  const luma = new Uint8Array(width * bandHeight);
  for (let row = 0; row < bandHeight; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const offset = ((rowStart + row) * width + col) * 4;
      const value = Math.round(
        rgba[offset] * 0.2126 + rgba[offset + 1] * 0.7152 + rgba[offset + 2] * 0.0722
      );
      luma[row * width + col] = value;
    }
  }
  if (bandHeight * width === 0) return null;

  const sorted = Array.from(luma).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.25)];
  const hi = sorted[Math.floor(sorted.length * 0.75)];
  if (hi - lo < 4) return null;

  let maskCount = 0;
  let weighted = 0;
  let weightSum = 0;
  for (let row = 0; row < bandHeight; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const value = luma[row * width + col];
      if (value >= lo && value <= hi) {
        maskCount += 1;
        weighted += col * value;
        weightSum += value;
      }
    }
  }
  if (maskCount < bandHeight * width * MIN_MASK_RATIO) return null;
  const centroid = weighted / Math.max(1, weightSum);
  return Math.min(1, Math.max(0, centroid / Math.max(1, width - 1)));
}

export function smooth(values: number[], window = 5): number[] {
  const result: number[] = [];
  const radius = Math.max(1, Math.floor(window / 2));
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - radius);
    const end = Math.min(values.length, i + radius + 1);
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += values[j];
    result.push(sum / (end - start));
  }
  return result;
}

/**
 * Segment the lap into corners from lateral-position direction runs.
 * A corner is a sustained lateral-velocity run (same sign, long enough).
 */
export function segmentCorners(
  samples: LapSample[],
  options: { minDurationS?: number; velocityScale?: number } = {},
): CornerSegment[] {
  if (samples.length < 8) return [];
  const minDurationS = options.minDurationS ?? 1.0;
  const velocityScale = options.velocityScale ?? 0.5;

  const laterals = smooth(samples.map((sample) => sample.lateral));
  const velocities: number[] = [];
  for (let i = 1; i < laterals.length; i += 1) {
    velocities.push(laterals[i] - laterals[i - 1]);
  }
  const mean = velocities.reduce((sum, v) => sum + v, 0) / velocities.length;
  const variance =
    velocities.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) /
    Math.max(1, velocities.length);
  const threshold = Math.max(0.012, velocityScale * Math.sqrt(variance));

  const runs: Array<{ start: number; end: number; direction: 1 | -1 }> = [];
  let runStart: number | null = null;
  let runDirection: 1 | -1 = 1;
  for (let i = 0; i < velocities.length; i += 1) {
    const magnitude = Math.abs(velocities[i]);
    const direction: 1 | -1 = velocities[i] >= 0 ? 1 : -1;
    if (magnitude >= threshold) {
      if (runStart === null || direction !== runDirection) {
        if (runStart !== null) {
          runs.push({ start: runStart, end: i, direction: runDirection });
        }
        runStart = i;
        runDirection = direction;
      }
    } else if (runStart !== null) {
      runs.push({ start: runStart, end: i, direction: runDirection });
      runStart = null;
    }
  }
  if (runStart !== null) {
    runs.push({ start: runStart, end: velocities.length, direction: runDirection });
  }

  const corners: CornerSegment[] = [];
  for (const run of runs) {
    const start = samples[run.start].time_s;
    const end = samples[run.end].time_s;
    if (end - start < minDurationS) continue;
    const baseline = laterals[run.start];
    let apexIndex = run.start;
    let maxAbs = 0;
    for (let i = run.start; i <= run.end; i += 1) {
      const delta = Math.abs(laterals[i] - baseline);
      if (delta > maxAbs) {
        maxAbs = delta;
        apexIndex = i;
      }
    }
    corners.push({
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      apex: Number(samples[apexIndex].time_s.toFixed(3)),
      direction: run.direction,
    });
  }
  return corners;
}

export function sampleTimes(startS: number, endS: number, fps: number): number[] {
  const count = Math.max(20, Math.min(800, Math.round((endS - startS) * fps)));
  if (count === 1) return [startS];
  return Array.from(
    { length: count },
    (_, index) => startS + ((endS - startS) * index) / (count - 1)
  );
}

/**
 * Build one manually-marked corner from entry/apex/exit timestamps.
 * Throws when the three points are not strictly increasing.
 */
export function buildManualCorner(
  entry: number,
  apex: number,
  exit: number,
  index: number,
): CornerSegment {
  if (![entry, apex, exit].every(Number.isFinite)) {
    throw new Error("入弯/弯心/出弯时间必须是有限数字。");
  }
  if (!(entry < apex && apex < exit)) {
    throw new Error("入弯、弯心、出弯时间必须依次递增。");
  }
  return {
    start: Number(entry.toFixed(3)),
    apex: Number(apex.toFixed(3)),
    end: Number(exit.toFixed(3)),
    direction: 1,
    name: `T${index}`,
  };
}

/** Detect overlapping corner windows. Gaps between corners are normal (straights). */
export function findCornerIssues(
  corners: CornerSegment[],
): CornerIssue[] {
  const issues: CornerIssue[] = [];
  for (let i = 1; i < corners.length; i += 1) {
    const prev = corners[i - 1];
    const next = corners[i];
    if (next.start < prev.end) {
      issues.push({ type: "overlap", index: i, prev, next, overlapS: prev.end - next.start });
    }
  }
  return issues;
}

/** Straight sections between consecutive corners (positive gaps only). */
export function straightGaps(corners: CornerSegment[]): StraightGap[] {
  const gaps: StraightGap[] = [];
  for (let i = 1; i < corners.length; i += 1) {
    const prev = corners[i - 1];
    const next = corners[i];
    const gapS = next.start - prev.end;
    if (gapS > 0.05) {
      gaps.push({ index: i, prev, next, gapS: Number(gapS.toFixed(3)) });
    }
  }
  return gaps;
}

/** Fix overlaps by clipping the previous corner's exit; straights are preserved. */
export function resolveOverlapIssues(corners: CornerSegment[]): CornerSegment[] {
  const resolved = corners.map((corner) => ({ ...corner }));
  for (let i = 1; i < resolved.length; i += 1) {
    const prev = resolved[i - 1];
    const next = resolved[i];
    if (next.start < prev.end && next.start > prev.start) {
      resolved[i - 1] = { ...prev, end: Number(next.start.toFixed(3)) };
    }
  }
  return resolved;
}
