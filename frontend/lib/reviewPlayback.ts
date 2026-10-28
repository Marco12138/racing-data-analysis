export type ReviewPlaybackTarget = { video: HTMLVideoElement | null; start: number; end: number };
export type ReviewPlaybackState = "playing" | "paused" | "ended" | "unavailable";

function canResume({ video, start, end }: ReviewPlaybackTarget): boolean {
  return !!video && video.readyState >= 2 && !video.ended && Number.isFinite(start) && Number.isFinite(end)
    && end > start && video.currentTime >= start - .015 && video.currentTime < end - .015;
}

export function reviewPlaybackState(targets: ReviewPlaybackTarget[]): ReviewPlaybackState {
  if (targets.some(t => t.video && !t.video.paused && !t.video.ended)) return "playing";
  if (targets.length < 2 || targets.some(t => !t.video || t.video.readyState < 2)) return "unavailable";
  if (targets.some(canResume)) return "paused";
  return "ended";
}

export function pauseReviewPlayback(targets: ReviewPlaybackTarget[]) {
  targets.forEach(t => t.video?.pause());
}

/** Resume each unfinished side in place; never seek or modify a synchronization anchor. */
export async function resumeReviewPlayback(targets: ReviewPlaybackTarget[]) {
  if (reviewPlaybackState(targets) !== "paused") return;
  const outcomes = await Promise.allSettled(targets.filter(canResume).map(t => t.video!.play()));
  const failed = outcomes.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) { pauseReviewPlayback(targets); throw failed.reason; }
}
