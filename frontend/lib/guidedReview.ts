import type { ReviewSelection } from "./coachReview";

export const REVIEW_STEPS = [
  ["导入素材", "Import"], ["数据概览", "Session"], ["单圈配对", "Pair a lap"],
  ["推荐复盘", "Review"], ["自选弯道", "Your corner"], ["本节总结", "Debrief"],
] as const;
export type ReviewStep = 0 | 1 | 2 | 3 | 4 | 5;
export type ReviewReceipt = {
  reviewKey: string; side: "reference" | "target"; clipId: string;
  verdict: "accurate" | "partly_accurate" | "inaccurate" | "uncertain" | "";
  current: boolean; syncConfirmed: boolean;
};

/** Decisions only apply to the exact real-lap comparison reviewed by the driver. */
export function guidedReviewKey(review: Pick<ReviewSelection, "id" | "referenceLap" | "targetLap">): string {
  return `${review.id}:${review.referenceLap}:${review.targetLap}`;
}

/** A saved vote is not enough: both currently visible clip bindings must still be valid. */
export function reviewDecision(review: ReviewSelection, receipts: ReviewReceipt[]): "confirmed" | "rejected" | "pending" {
  const sides = receipts.filter(r => r.reviewKey === guidedReviewKey(review) && r.current && r.clipId);
  if (sides.some(r => r.verdict === "inaccurate")) return "rejected";
  return ["reference", "target"].every(side => sides.some(r => r.side === side && r.verdict === "accurate" && r.syncConfirmed))
    ? "confirmed" : "pending";
}

/** Descriptive observations, never combined gains or a synthetic target lap. */
export function buildGuidedDebrief(reviews: ReviewSelection[], receipts: ReviewReceipt[]) {
  const confirmed = reviews.filter(r => reviewDecision(r, receipts) === "confirmed");
  return {
    strengths: confirmed.filter(r => r.netLoss <= 0),
    opportunities: confirmed.filter(r => r.netLoss > 0),
    rejected: reviews.filter(r => reviewDecision(r, receipts) === "rejected"),
    pending: reviews.filter(r => reviewDecision(r, receipts) === "pending"),
  };
}
