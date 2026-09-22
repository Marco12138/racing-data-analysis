import { resolveApiUrl } from "./config";

export type XY = [number, number];
export type SpatialGate = { a: XY; b: XY; forward: XY; confirmed: boolean };
export type TrackCorner = { id: string; name: string; entry_gate: SpatialGate; exit_gate: SpatialGate; confirmed: boolean };
export type TrackReference = {
  schema_version: 1; track_id: string; revision: number; venue_aliases: string[];
  direction: "CW" | "CCW"; origin_lat: number; origin_lon: number;
  source_fingerprint: string; source_lap: number; reference_path: XY[];
  start_finish_gate: SpatialGate; corners: TrackCorner[];
  acceptance: Record<string, number>; source: "real_observed_lap"; official: false;
};
type Registration = {
  status: string; translation_norm_m?: number; holdout_median_m?: number; holdout_p95_m?: number;
};
export type TrackMatch = {
  status: string; config_hash: string; manual_confirmation_required: boolean;
  coverage: { logger_laps: number; geometry_accepted_laps: number; platform_laps: number;
    gate_lap_pairs: number; exactly_once_gate_lap_pairs: number; exactly_once_ratio: number | null };
  laps: Array<{ logger_lap: number; logger_duration_s: number; geometry_status: string; reasons: string[]; registration?: Registration }>;
  traces: Array<{ logger_lap: number; raw_xy: XY[]; registered_xy: XY[] }>;
  platform_laps: Array<{ platform_lap: number; status: string; source_logger_laps: number[]; duration_s: number | null;
    corners: Array<{ id: string; name: string; status: string; duration_s: number | null; entry_count: number; exit_count: number }> }>;
  gate_phases: { status: string; reason?: string; corners: Array<{ id: string;
    phases: Array<{ lap: number; status: string; complete?: boolean; missing_phases?: string[]; reason?: string;
      events?: Record<string, { session_time_s: number; speed_kmh: number } | null> }> }> };
};

/** Client shape checks prevent corrupt local files reaching the map; server checks full geometry. */
export function parseTrackReference(text: string): TrackReference {
  if (text.length > 1_000_000) throw new Error("Track configuration exceeds 1 MB.");
  const value = JSON.parse(text) as TrackReference;
  const xy = (point: unknown): point is XY => Array.isArray(point) && point.length === 2 && point.every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 20000);
  const gate = (g: SpatialGate) => g && xy(g.a) && xy(g.b) && xy(g.forward) && typeof g.confirmed === "boolean";
  if (!value || value.schema_version !== 1 || !/^[A-Za-z0-9_-]{1,80}$/.test(value.track_id)
      || !Array.isArray(value.reference_path) || value.reference_path.length < 100 || value.reference_path.length > 5000
      || !value.reference_path.every(xy) || !gate(value.start_finish_gate)
      || !Array.isArray(value.corners) || value.corners.length > 30
      || !value.corners.every(c => c && /^[A-Za-z0-9_-]{1,40}$/.test(c.id) && typeof c.name === "string" && c.name.length <= 80 && gate(c.entry_gate) && gate(c.exit_gate))
      || !Number.isInteger(value.revision) || value.revision < 1 || !Number.isFinite(value.origin_lat) || !Number.isFinite(value.origin_lon)
      || !["CW", "CCW"].includes(value.direction) || value.source !== "real_observed_lap" || value.official !== false
      || !/^[0-9a-f]{64}$/.test(value.source_fingerprint) || !value.acceptance) {
    throw new Error("Invalid track configuration / 赛道配置无效");
  }
  return value;
}

/** The closest map point chooses a gate location, never overwrites measured driving lines. */
export function nearestReferenceIndex(points: XY[], point: XY): number {
  let best = 0, distance = Infinity;
  points.forEach((p, index) => { const d = Math.hypot(p[0] - point[0], p[1] - point[1]); if (d < distance) { best = index; distance = d; } });
  return best;
}

export function referenceGate(points: XY[], index: number, width = 20): SpatialGate {
  const before = points[(index - 4 + points.length) % points.length], after = points[(index + 4) % points.length];
  const length = Math.hypot(after[0] - before[0], after[1] - before[1]);
  if (length < .001) throw new Error("Unresolved path tangent / 无法确定轨迹方向");
  const forward: XY = [(after[0] - before[0]) / length, (after[1] - before[1]) / length];
  const normal: XY = [-forward[1] * width / 2, forward[0] * width / 2], p = points[index];
  return { a: [p[0] - normal[0], p[1] - normal[1]], b: [p[0] + normal[0], p[1] + normal[1]], forward, confirmed: false };
}

export function orderTrackCorners(config: TrackReference): TrackCorner[] {
  const center = (g: SpatialGate): XY => [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2];
  const start = nearestReferenceIndex(config.reference_path, center(config.start_finish_gate));
  const position = (c: TrackCorner) => (nearestReferenceIndex(config.reference_path, center(c.entry_gate)) - start + config.reference_path.length) % config.reference_path.length;
  return [...config.corners].sort((a, b) => position(a) - position(b));
}

async function request<T>(path: string, payload: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(await resolveApiUrl(path), { method: "POST", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? (response.status === 404 ? "Track service is not deployed / 赛道服务尚未部署" : `Track request failed (${response.status})`));
  }
  return response.json();
}

export function createTrackReference(inspectionId: string, lap: number, signal: AbortSignal): Promise<TrackReference> {
  return request("/tracks/reference", { inspection_id: inspectionId, lap, track_id: `observed-${inspectionId.slice(0, 8)}` }, signal);
}

export function matchTrackReference(inspectionId: string, config: TrackReference, signal: AbortSignal): Promise<TrackMatch> {
  return request("/tracks/match", { inspection_id: inspectionId, track_config: config }, signal);
}
