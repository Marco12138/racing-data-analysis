import { reviewValue, type ReviewSelection } from "./coachReview";
import { reviewDistanceAtTime } from "./manualReview";

export const REVIEW_CLIP_SECONDS = 5;
export const MANUAL_PICK_UNCERTAINTY_S = .5;

/** Extend the viewing interval only; keep consensus scores and saved anchors unchanged. */
export function reviewContextBounds(review: ReviewSelection): { entry: number; exit: number } {
  const fallback = { entry: review.entry, exit: review.downstreamEnd };
  if (review.kind === "sector") return fallback;
  const trace = review.target;
  const focus = reviewValue(trace, review.focus, "session_time_s");
  const entryTime = reviewValue(trace, review.entry, "session_time_s");
  const exitTime = reviewValue(trace, review.downstreamEnd, "session_time_s");
  if (focus === null || entryTime === null || exitTime === null) return fallback;
  const rows = trace.filter(p => p.session_time_s !== null && p.session_time_s >= entryTime - 4 && p.session_time_s <= exitTime + 4);
  if (rows.length < 10 || rows.some((p, i) => p.speed === null || (i > 0 &&
    (p.session_time_s! <= rows[i - 1].session_time_s! || p.session_time_s! - rows[i - 1].session_time_s! > 1
      || p.distance_m - rows[i - 1].distance_m > 10)))) return fallback;
  const smooth = rows.map((_, i) => {
    const values = rows.slice(Math.max(0, i - 2), i + 3).map(p => p.speed!).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  });
  const before = rows.map((p, i) => ({ p, i })).filter(({ p }) => p.session_time_s! < focus);
  const after = rows.map((p, i) => ({ p, i })).filter(({ p }) => p.session_time_s! >= exitTime);
  if (!before.length || !after.length) return fallback;
  const peak = Math.max(...before.map(({ i }) => smooth[i]));
  const approach = before.filter(({ i }) => smooth[i] >= peak - .1).at(-1)!;
  const recovery = after.reduce((a, b) => smooth[b.i] > smooth[a.i] ? b : a);
  const entry = Math.min(review.entry, rows[Math.max(0, approach.i - 2)].distance_m);
  const exit = Math.max(review.downstreamEnd, recovery.p.distance_m);
  return reviewValue(review.reference, entry, "session_time_s") !== null && reviewValue(review.reference, exit, "session_time_s") !== null
    ? { entry, exit } : fallback;
}

/** The confirmed frame must bind to the start actually displayed, not the old preview. */
export function reviewStartDistance(review: ReviewSelection, context: boolean): number | null {
  return context ? reviewContextBounds(review).entry : sharedReviewStart(review);
}

/** Derive one spatial start from one real lap, then reuse it on both sides. */
export function sharedReviewStart(review: ReviewSelection): number | null {
  const at = reviewValue(review.reference, review.focus, "session_time_s");
  const first = review.reference[0]?.session_time_s;
  if (at === null || first == null) return null;
  return reviewDistanceAtTime(review.reference, Math.max(first, at - 2));
}

/** Manual picking tolerance is descriptive, never a relaxed synchronization gate. */
export function manualStartBounds(start: number): [number, number] {
  return [start - MANUAL_PICK_UNCERTAINTY_S, start + MANUAL_PICK_UNCERTAINTY_S];
}
