import { readLandmarkFrames } from "./landmarkVideo";
import { rankBoundaryFrames, verifyBoundarySequence } from "./reviewBoundaryVisual";

/** Check both physical boundaries independently; proposals never alter time calibration. */
export async function checkSelectedCornerFrames(url: string, source: { start: number; end: number },
  target: { start: number; end: number }, duration: number, signal: AbortSignal) {
  const reference = await readLandmarkFrames(url, [source.start, source.end], signal);
  const boundaries = [];
  for (const [index, expected] of [target.start, target.end].entries()) {
    const low = Math.max(0, expected - .5), high = Math.min(duration - .001, expected + .5);
    if (low >= high) throw Error("outside_video");
    const frames = await readLandmarkFrames(url, [...Array.from({ length: 13 }, (_, i) => low + (high - low) * i / 12), expected], signal);
    let rank = rankBoundaryFrames(reference[index], frames.slice(0, 13), expected);
    if (rank.time !== null && index === 0) {
      const sequence = await verifyBoundarySequence({ url, start: source.start }, { url, start: rank.time }, signal);
      if (!sequence.consistent) rank = { ...rank, status: "ambiguous", time: null };
    }
    boundaries.push({ status: rank.status, proposed_time_s: rank.time,
      scores: rank.regions.map(r => r.candidate?.score ?? null),
      reference: reference[index].url, expected: frames[13].url,
      proposed: rank.time === null ? null : frames.find(f => Math.abs(f.time - rank.time!) < .001)?.url ?? null });
  }
  return { boundaries, sync_confirmed: false as const, manual_anchor_unchanged: true as const };
}
