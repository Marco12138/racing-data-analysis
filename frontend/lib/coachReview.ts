import type { XrkAnalysis } from "./xrkAnalysisApi";
import type { VideoSyncCalibration } from "./videoTelemetrySync";

export const REVIEW_VERSION = "coach-review-v1";
export type ReviewPoint = { distance_m: number; session_time_s: number | null; lap_time_s: number | null; speed: number | null; rpm: number | null; local_x_m: number | null; local_y_m: number | null };
export type ReviewSelection = {
  id: string; name: string; referenceLap: number; targetLap: number;
  entry: number; exit: number; downstreamEnd: number; focus: number;
  localLoss: number; downstreamDelta: number; netLoss: number;
  reference: ReviewPoint[]; target: ReviewPoint[];
  repeatCount: number; sourceLaps: number[];
};
export type ReviewWindow = { start_s: number; end_s: number; focus_s: number };

const numeric = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;

/** Keep real lap traces; null channels remain null, never zero-filled. */
export function reviewTrace(analysis: XrkAnalysis, lap: number): ReviewPoint[] {
  let raw: Array<Record<string, unknown>>;
  if (analysis.track && lap === analysis.target_lap) raw = analysis.track.target as unknown as Array<Record<string, unknown>>;
  else if (analysis.track && lap === analysis.reference_lap) raw = analysis.track.reference as unknown as Array<Record<string, unknown>>;
  else raw = analysis.top_laps_comparison.aligned.map(row => ({
    distance_m: row.distance_m,
    ...Object.fromEntries(["session_time_s", "lap_time_s", "speed", "rpm", "local_x_m", "local_y_m"].map(k => [k, row[`lap_${lap}_${k}`]])),
  }));
  return raw.filter(row => numeric(row.distance_m) !== null).map(row => ({
    distance_m: Number(row.distance_m), session_time_s: numeric(row.session_time_s),
    lap_time_s: numeric(row.lap_time_s), speed: numeric(row.speed), rpm: numeric(row.rpm),
    local_x_m: numeric(row.local_x_m), local_y_m: numeric(row.local_y_m),
  }));
}

/** Bounded interpolation: no extrapolation or interpolation through missing samples. */
export function reviewValue(trace: ReviewPoint[], distance: number, key: keyof ReviewPoint): number | null {
  const right = trace.findIndex(row => row.distance_m >= distance);
  if (right < 0) return null;
  if (trace[right].distance_m === distance) return numeric(trace[right][key]);
  if (!right) return null;
  const a = trace[right - 1], b = trace[right];
  const va = numeric(a[key]), vb = numeric(b[key]);
  const gap = b.distance_m - a.distance_m;
  if (va === null || vb === null || gap <= 0 || gap > 10) return null;
  return va + (vb - va) * (distance - a.distance_m) / gap;
}

function elapsed(trace: ReviewPoint[], entry: number, exit: number): number | null {
  const start = reviewValue(trace, entry, "lap_time_s"), end = reviewValue(trace, exit, "lap_time_s");
  const inside = trace.filter(p => p.distance_m >= entry && p.distance_m <= exit);
  if (start === null || end === null || end <= start || inside.length < 2) return null;
  if (inside.some((p, i) => p.lap_time_s === null || (i > 0 && (p.distance_m <= inside[i-1].distance_m
    || p.distance_m - inside[i-1].distance_m > 10 || p.lap_time_s! <= inside[i-1].lap_time_s!)))) return null;
  return end - start;
}

/** Rank review candidates, not guaranteed improvements; each comparator is one real Top 3 lap. */
export function selectCoachReviews(analysis: XrkAnalysis, referenceOverride: number | null = null): ReviewSelection[] {
  const top = analysis.lap_quality.top_valid_laps.filter(p => p.analysis_eligible).slice(0, 3);
  const target = reviewTrace(analysis, analysis.target_lap);
  const references = referenceOverride === null ? top : (analysis.lap_quality.laps ?? top).filter(p => p.lap === referenceOverride && p.analysis_eligible);
  const peers = references.filter(p => p.lap !== analysis.target_lap).map(p => ({ lap: p.lap, trace: reviewTrace(analysis, p.lap) }));
  const candidates: ReviewSelection[] = [];
  for (const corner of analysis.consensus_benchmark.corners) {
    const entry = corner.entry_distance_m, exit = corner.exit_distance_m, downstream = corner.downstream_end_distance_m;
    const targetZone = elapsed(target, entry, exit), targetTotal = elapsed(target, entry, downstream);
    if (targetZone === null || targetTotal === null) continue;
    const eligible = peers.map(p => ({ ...p, zone: elapsed(p.trace, entry, exit), total: elapsed(p.trace, entry, downstream) }))
      .filter((p): p is typeof p & { zone: number; total: number } => p.zone !== null && p.total !== null)
      .sort((a, b) => a.total - b.total || a.lap - b.lap);
    const best = eligible[0];
    if (!best) continue;
    const localLoss = targetZone - best.zone, netLoss = targetTotal - best.total;
    if (Math.abs(netLoss) < 0.001 && Math.abs(localLoss) < 0.001) continue;
    const inside = target.filter(p => p.distance_m >= entry && p.distance_m <= exit && p.speed !== null);
    const minimum = inside.reduce<ReviewPoint | null>((a, b) => !a || b.speed! < a.speed! ? b : a, null);
    candidates.push({ id: corner.corner_id, name: corner.corner, referenceLap: best.lap, targetLap: analysis.target_lap,
      entry, exit, downstreamEnd: downstream, focus: minimum?.distance_m ?? (entry + exit) / 2,
      localLoss, downstreamDelta: netLoss - localLoss, netLoss,
      reference: best.trace, target, repeatCount: corner.occurrence_count, sourceLaps: corner.supporting_laps });
  }
  // Non-overlapping review windows avoid presenting the same gain as several opportunities.
  const selected: ReviewSelection[] = [];
  for (const row of candidates.sort((a, b) => b.netLoss - a.netLoss || a.entry - b.entry)) {
    if (!selected.some(p => row.entry < p.exit && p.entry < row.exit)) selected.push(row);
    if (selected.length === 3) break;
  }
  return selected;
}

/** Require a matching manually calibrated lap/video; never borrow the other lap's offset. */
export function calibratedReviewWindow(trace: ReviewPoint[], lap: number, focus: number,
  calibration: VideoSyncCalibration | null, file: Pick<File, "size" | "lastModified" | "type"> | null,
  duration: number, context?: { entry: number; exit: number }): ReviewWindow | null {
  if (!calibration || !file || calibration.target_lap !== lap || duration < 3
    || calibration.video.size_bytes !== file.size || calibration.video.last_modified_ms !== file.lastModified
    || Math.abs(calibration.video.duration_s - duration) > .1) return null;
  const at = reviewValue(trace, focus, "session_time_s");
  const timed = trace.filter(p => p.session_time_s !== null);
  const first = timed[0]?.session_time_s, last = timed.at(-1)?.session_time_s;
  if (at === null || first == null || last == null) return null;
  const offset = calibration.offset_ms / 1000, focusTime = at + offset;
  const lower = Math.max(0, first + offset), upper = Math.min(duration, last + offset);
  if (focusTime < lower || focusTime > upper || upper - lower < 3) return null;
  let start = Math.max(lower, Math.min(focusTime - 2, upper - 4));
  let end = Math.min(upper, start + 4);
  if (context) {
    const a = reviewValue(trace, context.entry, "session_time_s"), b = reviewValue(trace, context.exit, "session_time_s");
    if (a === null || b === null || a + offset < lower || b + offset > upper || b - a > 120) return null;
    start = a + offset; end = b + offset;
  }
  return end - start >= 3 ? { start_s: start, end_s: end, focus_s: focusTime } : null;
}

/** Opaque, versioned identity changes with the selected evidence and synchronization. */
export async function reviewIdentity(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("");
}
