import { reviewValue, type ReviewSelection } from "./coachReview";
import { reviewDistanceAtTime } from "./manualReview";

export const REVIEW_CLIP_SECONDS = 5;
export const MANUAL_PICK_UNCERTAINTY_S = .5;

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
