/** Local, human-confirmed visual references. Similarity never establishes sync or identity. */
export type LandmarkRect = { x: number; y: number; w: number; h: number };
export type LandmarkSighting = {
  lap: number; videoKey: string; syncKey: string; videoTimeS: number; distanceM: number | null;
  relation: "visible" | "passing"; confirmedAt: string;
};
export type TrackLandmark = {
  version: 1; id: string; scope: string; cornerId: string; name: string; nameEn: string;
  thumbnail: string; rect: LandmarkRect; patch: number[]; sightings: LandmarkSighting[];
};
export const PATCH_SIZE = 24;
export const LANDMARK_EVENT = "racing-landmarks-changed";
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function confirmedLandmarkSighting(landmark: TrackLandmark, lap: number, videoKey: string, syncKey: string) {
  if (!videoKey || !syncKey) return null;
  return landmark.sightings.find(s => s.lap === lap && s.videoKey === videoKey && s.syncKey === syncKey) ?? null;
}

export function validLandmarkRect(r: LandmarkRect): boolean {
  return [r.x, r.y, r.w, r.h].every(finite) && r.x >= 0 && r.y >= 0 && r.w >= .03 && r.h >= .03 && r.x + r.w <= 1.001 && r.y + r.h <= 1.001;
}

/** Bound untrusted browser storage; never reuse another session's distances. */
export function parseLandmarks(raw: string | null, scope: string, cornerId: string): TrackLandmark[] {
  try {
    const rows = JSON.parse(raw ?? "[]");
    if (!Array.isArray(rows)) return [];
    return rows.filter((r): r is TrackLandmark => r?.version === 1 && r.scope === scope && r.cornerId === cornerId
      && typeof r.id === "string" && r.id.length <= 80 && typeof r.name === "string" && r.name.length > 0 && r.name.length <= 60
      && typeof r.nameEn === "string" && r.nameEn.length <= 80 && validLandmarkRect(r.rect ?? {})
      && typeof r.thumbnail === "string" && r.thumbnail.startsWith("data:image/jpeg;base64,") && r.thumbnail.length < 60000
      && Array.isArray(r.patch) && r.patch.length === PATCH_SIZE ** 2 && r.patch.every((n: unknown) => finite(n) && n >= 0 && n <= 255)
      && Array.isArray(r.sightings) && r.sightings.length <= 20 && r.sightings.every((s: LandmarkSighting) => Number.isInteger(s.lap)
        && typeof s.videoKey === "string" && typeof s.syncKey === "string" && finite(s.videoTimeS) && s.videoTimeS >= 0
        && (s.distanceM === null || (finite(s.distanceM) && s.distanceM >= 0)) && ["visible", "passing"].includes(s.relation)
        && typeof s.confirmedAt === "string")).slice(0, 12);
  } catch { return []; }
}

/** Zero-mean normalized correlation; flat patches are uninformative, not perfect matches. */
export function patchCorrelation(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 16 || !a.every(finite) || !b.every(finite)) return null;
  const meanA = a.reduce((s, n) => s + n, 0) / a.length, meanB = b.reduce((s, n) => s + n, 0) / b.length;
  let aa = 0, bb = 0, ab = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - meanA, y = b[i] - meanB; aa += x*x; bb += y*y; ab += x*y; }
  if (aa / a.length < 16 || bb / b.length < 16) return null;
  return Math.max(-1, Math.min(1, ab / Math.sqrt(aa * bb)));
}

export function grayscalePatch(rgba: Uint8ClampedArray, width: number, height: number, rect: LandmarkRect): number[] {
  if (!validLandmarkRect(rect) || rgba.length !== width * height * 4) return [];
  const values: number[] = [];
  for (let y = 0; y < PATCH_SIZE; y++) for (let x = 0; x < PATCH_SIZE; x++) {
    const px = Math.min(width - 1, Math.floor((rect.x + (x + .5) / PATCH_SIZE * rect.w) * width));
    const py = Math.min(height - 1, Math.floor((rect.y + (y + .5) / PATCH_SIZE * rect.h) * height));
    const i = (py * width + px) * 4;
    values.push(Math.round(.299 * rgba[i] + .587 * rgba[i+1] + .114 * rgba[i+2]));
  }
  return values;
}

/** Small bounded spatial/scale search for the same camera view, not semantic object recognition. */
export function matchLandmarkFrame(template: TrackLandmark, rgba: Uint8ClampedArray, width: number, height: number) {
  let best: { score: number; rect: LandmarkRect } | null = null;
  for (const scale of [.85, 1, 1.15]) for (const dx of [-.12, -.06, 0, .06, .12]) for (const dy of [-.08, 0, .08]) {
    const r = template.rect, w = r.w * scale, h = r.h * scale;
    const rect = { x: r.x + dx + (r.w-w)/2, y: r.y + dy + (r.h-h)/2, w, h };
    if (!validLandmarkRect(rect)) continue;
    const score = patchCorrelation(template.patch, grayscalePatch(rgba, width, height, rect));
    if (score !== null && (!best || score > best.score)) best = { score, rect };
  }
  return best;
}

export function rankLandmarkMatches(rows: Array<{ time: number; score: number; rect: LandmarkRect }>) {
  const sorted = rows.filter(r => finite(r.time) && finite(r.score)).sort((a, b) => b.score - a.score);
  const best = sorted[0];
  if (!best || best.score < .72) return { status: "weak" as const, candidate: null };
  const rival = sorted.find(r => Math.abs(r.time - best.time) > 1);
  if (rival && best.score - rival.score < .06) return { status: "ambiguous" as const, candidate: best };
  return { status: "candidate" as const, candidate: best };
}

/** Describe the observed event relative to a confirmed passing point, never prescribe an input. */
export function landmarkEventText(landmark: TrackLandmark, sighting: LandmarkSighting, eventDistance: number,
  event: "recovery" | "rpm_drop", locale: "zh" | "en"): string | null {
  if (sighting.relation !== "passing" || sighting.distanceM === null || !finite(eventDistance) || !sighting.syncKey) return null;
  const delta = eventDistance - sighting.distanceM;
  if (Math.abs(delta) > 100) return null;
  const name = locale === "en" ? landmark.nameEn || landmark.name : landmark.name;
  const amount = Math.abs(delta).toFixed(1);
  if (locale === "zh") return `${event === "recovery" ? "重新加速迹象" : "转速下降迹象"}出现在驶过「${name}」${delta < 0 ? "前" : "后"}约 ${amount} 米。`;
  return `The ${event === "recovery" ? "acceleration recovery" : "RPM reduction"} pattern occurs about ${amount} m ${delta < 0 ? "before" : "after"} passing “${name}”.`;
}
