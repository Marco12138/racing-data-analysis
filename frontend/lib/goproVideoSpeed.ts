import { extractGoproTelemetry, type GoproSpeedPoint } from "./gpmfTelemetry";

export type SpeedReading = { speed_kmh: number | null; reason: "available" | "no_gps" | "outside_coverage" | "gps_invalid" | "gap" };

/** Frame-time lookup on this video's own metadata clock. Never extrapolate or hold a stale value. */
export function goproSpeedAt(points: readonly GoproSpeedPoint[], time: number): SpeedReading {
  const missing = (reason: SpeedReading["reason"]): SpeedReading => ({ speed_kmh: null, reason });
  if (!points.length) return missing("no_gps");
  if (!Number.isFinite(time) || time < points[0].time_s || time > points[points.length - 1].time_s) return missing("outside_coverage");
  let low = 0, high = points.length - 1;
  while (low < high) { const mid = (low + high) >>> 1; if (points[mid].time_s < time) low = mid + 1; else high = mid; }
  const b = points[low], a = b.time_s === time ? b : points[low - 1];
  const valid = (p: GoproSpeedPoint) => p.fix === 3 && p.speed_kmh !== null && Number.isFinite(p.speed_kmh) && p.speed_kmh >= 0 && p.speed_kmh <= 600;
  if (!a || !valid(a) || !valid(b)) return missing("gps_invalid");
  // This display-only bound does not alter any GNSS synchronization quality gate.
  const gap = b.time_s - a.time_s;
  if (gap > .25 || gap < 0) return missing("gap");
  return { speed_kmh: gap === 0 ? b.speed_kmh : a.speed_kmh! + (b.speed_kmh! - a.speed_kmh!) * (time - a.time_s) / gap, reason: "available" };
}

type SpeedLoader = (file: File, options: { signal: AbortSignal; onProgress: (progress: number) => void }) => Promise<GoproSpeedPoint[]>;

/** Share a local extraction between two players of the same File, not between different drivers' files. */
export function createGoproSpeedCache(load: SpeedLoader) {
  type Entry = { controller: AbortController; promise: Promise<GoproSpeedPoint[]>; listeners: Set<(p: number) => void>; progress: number; settled: boolean };
  const cache = new WeakMap<File, Entry>();
  return (file: File, onProgress: (progress: number) => void) => {
    let entry = cache.get(file);
    if (!entry) {
      const controller = new AbortController();
      const next: Entry = { controller, listeners: new Set(), progress: 0, settled: false, promise: Promise.resolve([]) };
      next.promise = Promise.resolve().then(() => load(file, { signal: controller.signal, onProgress: p => {
        next.progress = p; next.listeners.forEach(listener => listener(p));
      } })).then(points => {
        controller.signal.throwIfAborted();
        if (points.some((p, i) => !Number.isFinite(p.time_s) || p.time_s < 0 || (i > 0 && p.time_s <= points[i - 1].time_s)))
          throw new Error("GPMF_INVALID_TIMING");
        return points;
      }).catch(error => { if (cache.get(file) === next) cache.delete(file); throw error; })
        .finally(() => { next.settled = true; });
      cache.set(file, next); entry = next;
    }
    const current = entry;
    const listener = (p: number) => onProgress(p);
    current.listeners.add(listener); listener(current.progress);
    return { promise: current.promise, release: () => {
      current.listeners.delete(listener);
      if (!current.listeners.size && !current.settled) {
        current.controller.abort();
        if (cache.get(file) === current) cache.delete(file);
      }
    } };
  };
}

export const acquireGoproSpeed = createGoproSpeedCache(async (file, options) => {
  const audit = await extractGoproTelemetry(file, { ...options, includeGpsSpeed: true });
  if (!audit.video_speed?.length && audit.summary.warnings.some(w => ["GPS9_NOT_YET_VALIDATED", "GPS_SCALE_UNSUPPORTED", "GPS_UNIT_UNSUPPORTED"].includes(w)))
    throw new Error("GPMF_GPS_VARIANT_UNSUPPORTED");
  return audit.video_speed ?? [];
});
