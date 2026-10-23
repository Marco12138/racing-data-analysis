import { readLandmarkFrames, withLandmarkDecoder, type LandmarkFrame } from "./landmarkVideo";
import { BOUNDARY_RECTS, rankBoundaryFrames } from "./reviewBoundaryVisual";
import { grayscalePatch, matchLandmarkFrame, type TrackLandmark } from "./trackLandmarks";
import { extractGoproTelemetry, type GnssPositionPoint } from "./gpmfTelemetry";

export type RepeatedPass = { id: string; start_s: number; end_s: number; thumbnail: string;
  status: "candidate" | "ambiguous"; scores: (number | null)[]; endpoint_scores: (number | null)[];
  confirmed: false; uncertainty_s: .5 };

/** A coarse camera GPS gate narrows visual search; it is not a validated synchronization result. */
export function gpsPassCandidates(source: GnssPositionPoint[], start: number, target: GnssPositionPoint[]) {
  const valid = (p: GnssPositionPoint) => p.fix === 3 && [p.time_s, p.lat, p.lon, p.speed_kmh].every(Number.isFinite)
    && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && p.speed_kmh >= 5;
  function at(time: number) {
    const i = source.findIndex(p => p.time_s >= time);
    if (i <= 0) return null;
    const a = source[i - 1], b = source[i], dt = b.time_s - a.time_s;
    if (!valid(a) || !valid(b) || dt <= 0 || dt > .5) return null;
    const f = (time - a.time_s) / dt;
    return { lat: a.lat + f * (b.lat - a.lat), lon: a.lon + f * (b.lon - a.lon) };
  }
  const center = at(start), before = at(start - .3), after = at(start + .3);
  if (!center || !before || !after) return null;
  const xy = (p: {lat: number; lon: number}) => [(p.lon - center.lon) * Math.cos(center.lat * Math.PI / 180) * 111195, (p.lat - center.lat) * 111195];
  const p = xy(before), q = xy(after), dx = q[0] - p[0], dy = q[1] - p[1], length = Math.hypot(dx, dy);
  if (length < 2) return null;
  const normal = [dx / length, dy / length];
  const hits: {time: number; score: number}[] = [];
  let excluded = 0;
  for (let i = 1; i < target.length; i++) {
    const a = target[i - 1], b = target[i], dt = b.time_s - a.time_s;
    if (!valid(a) || !valid(b) || dt <= 0 || dt > .5) { excluded++; continue; }
    const u = xy(a), v = xy(b), delta = [v[0] - u[0], v[1] - u[1]], distance = Math.hypot(...delta);
    const expected = (a.speed_kmh + b.speed_kmh) / 7.2 * dt;
    if (Math.abs(distance - expected) > Math.max(3, expected * .5)) { excluded++; continue; }
    const sa = u[0] * normal[0] + u[1] * normal[1], sb = v[0] * normal[0] + v[1] * normal[1];
    if (sa >= 0 || sb < 0 || distance < .01 || (delta[0] * normal[0] + delta[1] * normal[1]) / distance < .5) continue;
    const f = -sa / (sb - sa), x = u[0] + delta[0] * f, y = u[1] + delta[1] * f;
    if (Math.hypot(x, y) <= 12) hits.push({ time: a.time_s + dt * f, score: 1 });
  }
  return { peaks: separatePassPeaks(hits, 61), excluded };
}

/** Select separate local peaks, not one global winner and not assumed lap numbers. */
export function separatePassPeaks(rows: { time: number; score: number }[], maximum = 60) {
  const chosen: typeof rows = [];
  for (const row of rows.filter(r => Number.isFinite(r.score) && r.score >= .72).sort((a, b) => b.score - a.score)) {
    if (chosen.every(c => Math.abs(c.time - row.time) >= 5)) chosen.push(row);
    if (chosen.length >= maximum) break;
  }
  return chosen.sort((a, b) => a.time - b.time);
}

function templates(frame: LandmarkFrame) {
  return BOUNDARY_RECTS.map(rect => ({ rect, patch: grayscalePatch(frame.rgba, frame.width, frame.height, rect) }) as TrackLandmark);
}

/** Bounded coarse-to-fine appearance search. Similarity never confirms lap identity or synchronization. */
export async function findRepeatedPasses(source: { url: string; start: number; file?: File }, target: { url: string; duration: number; file?: File },
  signal: AbortSignal, progress: (fraction: number) => void): Promise<{ passes: RepeatedPass[]; sampled_frames: number; truncated: boolean; mode: "gps_then_visual" | "visual_only"; excluded: number }> {
  if (target.duration < 5 || target.duration > 1800) throw Error("search_duration_limit");
  const reference = await readLandmarkFrames(source.url, [source.start, source.start + 5], signal);
  const patches = templates(reference[0]), endPatches = templates(reference[1]);
  let gps: ReturnType<typeof gpsPassCandidates> = null;
  if (source.file && target.file) {
    try {
      const a = await extractGoproTelemetry(source.file, { signal });
      const b = source.file === target.file ? a : await extractGoproTelemetry(target.file, { signal });
      if (a.video_gps.length && b.video_gps.length) gps = gpsPassCandidates(a.video_gps, source.start, b.video_gps);
    } catch { signal.throwIfAborted(); }
  }
  progress(.1);
  return withLandmarkDecoder(target.url, signal, async read => {
    const coarse: { time: number; score: number }[] = [];
    let sampled = 0;
    for (let time = 0; !gps && time <= target.duration - 5; time += .5) {
      const frame = await read(time); sampled++;
      const scores = patches.map(p => matchLandmarkFrame(p, frame.rgba, frame.width, frame.height)?.score ?? -1);
      coarse.push({ time, score: Math.min(...scores) });
      progress(.1 + .6 * time / target.duration);
    }
    const peaks = (gps?.peaks ?? separatePassPeaks(coarse, 61)).filter(p => p.time >= 0 && p.time + 5 <= target.duration), passes: RepeatedPass[] = [];
    let excluded = gps?.excluded ?? 0;
    for (const [index, peak] of peaks.slice(0, 60).entries()) {
      signal.throwIfAborted();
      const low = Math.max(0, peak.time - 1.5), high = Math.min(target.duration - 5, peak.time + 1.5);
      const frames: LandmarkFrame[] = [];
      for (let i = 0; i <= 24; i++) { frames.push(await read(low + (high - low) * i / 24)); sampled++; }
      const ranked = rankBoundaryFrames(reference[0], frames, peak.time);
      if (!gps && ranked.status !== "candidate") { excluded++; progress(.7 + .3 * (index + 1) / Math.min(60, peaks.length)); continue; }
      const start = ranked.time ?? peak.time;
      const end = await read(Math.min(target.duration - .001, start + 5)); sampled++;
      passes.push({ id: `pass-${start.toFixed(3)}`, start_s: start, end_s: start + 5,
        thumbnail: frames.reduce((a, b) => Math.abs(a.time - start) < Math.abs(b.time - start) ? a : b).url,
        status: ranked.status === "candidate" ? "candidate" : "ambiguous",
        scores: ranked.regions.map(r => r.candidate?.score ?? null),
        endpoint_scores: endPatches.map(p => matchLandmarkFrame(p, end.rgba, end.width, end.height)?.score ?? null),
        confirmed: false, uncertainty_s: .5 });
      progress(.7 + .3 * (index + 1) / Math.min(60, peaks.length));
    }
    progress(1);
    return { passes, sampled_frames: sampled, truncated: peaks.length > 60, mode: gps ? "gps_then_visual" : "visual_only", excluded };
  });
}
