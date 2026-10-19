import { matchLandmarkFrame, rankLandmarkMatches, type LandmarkRect, type TrackLandmark } from "./trackLandmarks";

export type LandmarkFrame = { url: string; width: number; height: number; rgba: Uint8ClampedArray; time: number };

export function captureLandmarkFrame(video: HTMLVideoElement): LandmarkFrame {
  if (video.readyState < 2 || !video.videoWidth) throw Error("frame_unavailable");
  const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = Math.round(320 * video.videoHeight / video.videoWidth);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw Error("canvas_unavailable");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return { url: canvas.toDataURL("image/jpeg", .8), width: canvas.width, height: canvas.height,
    rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data, time: video.currentTime };
}

async function seekFrame(video: HTMLVideoElement, time: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!video.seeking && Math.abs(video.currentTime - time) < .005 && video.readyState >= 2) return;
  await new Promise<void>((resolve, reject) => {
    const done = () => { cleanup(); resolve(); }, fail = () => { cleanup(); reject(Error("frame_unavailable")); };
    const timer = setTimeout(fail, 5000);
    function cleanup() { clearTimeout(timer); video.removeEventListener("seeked", done); video.removeEventListener("error", fail); signal.removeEventListener("abort", fail); }
    video.addEventListener("seeked", done, { once: true }); video.addEventListener("error", fail, { once: true }); signal.addEventListener("abort", fail, { once: true });
    video.currentTime = time;
  });
  signal.throwIfAborted();
}

/** Small local-only frame batch for explicit boundary review. The visible player is untouched. */
export async function readLandmarkFrames(url: string, times: number[], signal: AbortSignal): Promise<LandmarkFrame[]> {
  signal.throwIfAborted();
  if (!url.startsWith("blob:") || !times.length || times.length > 32 || !times.every(t => Number.isFinite(t) && t >= 0))
    throw Error("invalid_local_search");
  const probe = document.createElement("video"); probe.muted = true; probe.preload = "auto";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(failed, 10000);
      function cleanup() { clearTimeout(timer); probe.removeEventListener("loadeddata", loaded); probe.removeEventListener("error", failed); signal.removeEventListener("abort", failed); }
      function loaded() { cleanup(); resolve(); }
      function failed() { cleanup(); reject(Error("frame_unavailable")); }
      probe.addEventListener("loadeddata", loaded, { once: true }); probe.addEventListener("error", failed, { once: true }); signal.addEventListener("abort", failed, { once: true });
      probe.src = url;
    });
    if (times.some(t => t > probe.duration)) throw Error("outside_video");
    const frames: LandmarkFrame[] = [];
    // At the exact file endpoint, inspect the last decodable frame, not a nonexistent next frame.
    for (const time of times) { await seekFrame(probe, Math.min(time, Math.max(0, probe.duration - .001)), signal); frames.push(captureLandmarkFrame(probe)); await new Promise(resolve => setTimeout(resolve, 0)); }
    return frames;
  } finally { probe.pause(); probe.removeAttribute("src"); probe.load(); }
}

/** Decode at most 25 local frames, without seeking the user's visible player or uploading pixels. */
export async function searchLandmarkVideo(url: string, landmark: TrackLandmark,
  window: { start_s: number; end_s: number }, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!url.startsWith("blob:") || ![window.start_s, window.end_s].every(Number.isFinite)
    || window.start_s < 0 || window.end_s <= window.start_s || window.end_s - window.start_s > 12)
    throw Error("invalid_local_search");
  const probe = document.createElement("video"); probe.muted = true; probe.preload = "auto";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(Error("load_timeout")); }, 10000);
      const loaded = () => { cleanup(); resolve(); }, failed = () => { cleanup(); reject(Error("load_failed")); };
      function cleanup() { clearTimeout(timer); probe.removeEventListener("loadeddata", loaded); probe.removeEventListener("error", failed); signal.removeEventListener("abort", failed); }
      probe.addEventListener("loadeddata", loaded, { once: true }); probe.addEventListener("error", failed, { once: true }); signal.addEventListener("abort", failed, { once: true });
      probe.src = url;
    });
    signal.throwIfAborted();
    if (window.end_s > probe.duration) throw Error("outside_video");
    const matches: Array<{ time: number; score: number; rect: LandmarkRect }> = [];
    for (let i = 0; i < 25; i++) {
      await seekFrame(probe, window.start_s + (window.end_s - window.start_s) * i / 25, signal);
      const f = captureLandmarkFrame(probe), match = matchLandmarkFrame(landmark, f.rgba, f.width, f.height);
      if (match) matches.push({ time: f.time, ...match });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const result = rankLandmarkMatches(matches);
    if (!result.candidate) return { ...result, frame: null };
    await seekFrame(probe, result.candidate.time, signal);
    return { ...result, frame: captureLandmarkFrame(probe) };
  } finally { probe.pause(); probe.removeAttribute("src"); probe.load(); }
}
