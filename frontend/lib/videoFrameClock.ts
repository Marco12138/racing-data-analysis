export type VideoClockSample = {
  time_s: number;
  mode: "video-frame" | "timeupdate";
  refresh_hz: number | null;
};

/** Follow presented media timestamps; never estimate recorder synchronization. */
export function observeVideoClock(video: HTMLVideoElement, emit: (sample: VideoClockSample) => void): () => void {
  const framed = typeof video.requestVideoFrameCallback === "function";
  let stopped = false;
  let handle: number | null = null;
  let previous: number | null = null;
  let count = 0;
  let hz: number | null = null;
  const publish = (time: number) => {
    if (!stopped && Number.isFinite(time)) emit({ time_s: time, mode: framed ? "video-frame" : "timeupdate", refresh_hz: hz });
  };
  const schedule = () => {
    if (!stopped && framed && handle === null && !video.paused && !video.ended) {
      handle = video.requestVideoFrameCallback(frame);
    }
  };
  const frame: VideoFrameRequestCallback = (now, metadata) => {
    handle = null;
    if (stopped) return;
    if (previous === null) { previous = now; count = 0; }
    else count += 1;
    if (now - previous >= 1000) {
      hz = count * 1000 / (now - previous);
      previous = now; count = 0;
    }
    publish(metadata.mediaTime);
    schedule();
  };
  const reset = () => { previous = null; count = 0; hz = null; };
  const play = () => { reset(); schedule(); };
  const pause = () => {
    if (handle !== null) video.cancelVideoFrameCallback(handle);
    handle = null; reset(); publish(video.currentTime);
  };
  const seek = () => { reset(); publish(video.currentTime); schedule(); };
  const fallback = () => { if (!framed) publish(video.currentTime); };
  const events = { play, pause, ended: pause, seeked: seek, loadeddata: seek, timeupdate: fallback };
  for (const [name, fn] of Object.entries(events)) video.addEventListener(name, fn);
  schedule();
  return () => {
    stopped = true;
    if (handle !== null) video.cancelVideoFrameCallback(handle);
    for (const [name, fn] of Object.entries(events)) video.removeEventListener(name, fn);
  };
}
