import { grayscalePatch, matchLandmarkFrame, rankLandmarkMatches, type LandmarkRect, type TrackLandmark } from "./trackLandmarks";
import { readLandmarkFrames, type LandmarkFrame } from "./landmarkVideo";

export const BOUNDARY_RECTS: LandmarkRect[] = [
  { x: .04, y: .12, w: .4, h: .32 }, { x: .56, y: .12, w: .4, h: .32 },
];

/** Appearance suggestions retain the existing .72 similarity / .06 ambiguity gates. */
export function rankBoundaryFrames(reference: LandmarkFrame, frames: LandmarkFrame[], expected: number) {
  const regions = BOUNDARY_RECTS.map(rect => {
    const template = { rect, patch: grayscalePatch(reference.rgba, reference.width, reference.height, rect) } as TrackLandmark;
    return rankLandmarkMatches(frames.flatMap(f => {
      const match = matchLandmarkFrame(template, f.rgba, f.width, f.height);
      return match ? [{ ...match, time: f.time }] : [];
    }));
  });
  const times = regions.filter(r => r.status === "candidate").map(r => r.candidate!.time);
  const agreed = times.length === regions.length && Math.max(...times) - Math.min(...times) <= .25;
  const time = agreed ? times.reduce((a, b) => Math.abs(a - expected) < Math.abs(b - expected) ? a : b) : null;
  return { status: agreed ? "candidate" as const : regions.every(r => r.status === "weak") ? "weak" as const : "ambiguous" as const,
    time, regions, sync_confirmed: false as const };
}

/** Search only around the proposed start; the five-second endpoint is advisory, never fitted. */
export async function checkReviewBoundaries(reference: { url: string; start: number }, target: { url: string; start: number; duration: number }, signal: AbortSignal) {
  const low = Math.max(0, target.start - 2), high = Math.min(target.duration - 5, target.start + 2);
  if (high < low || target.start < low || target.start > high) throw Error("outside_video");
  const ref = await readLandmarkFrames(reference.url, [reference.start, reference.start + 5], signal);
  const times = Array.from({ length: 25 }, (_, i) => low + (high - low) * i / 24);
  const frames = await readLandmarkFrames(target.url, [...times, target.start, target.start + 5], signal);
  const start = rankBoundaryFrames(ref[0], frames.slice(0, 25), target.start);
  const expectedStart = frames[25], end = frames[26];
  const endpoint = BOUNDARY_RECTS.map(rect => matchLandmarkFrame({ rect,
    patch: grayscalePatch(ref[1].rgba, ref[1].width, ref[1].height, rect) } as TrackLandmark, end.rgba, end.width, end.height)?.score ?? null);
  return { reference: ref, target: [expectedStart, end], start, endpoint,
    suggested: start.time === null ? null : frames.find(f => f.time === start.time) ?? null };
}
