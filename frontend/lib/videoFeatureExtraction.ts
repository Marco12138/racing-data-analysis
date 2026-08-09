export type VideoSyncFeature = {
  time_s: number;
  brightness: number;
  motion: number;
};

export type PixelFeature = {
  brightness: number;
  motion: number;
};

const DEFAULT_MAX_SAMPLES = 360;
const SAMPLE_WIDTH = 64;
const SAMPLE_HEIGHT = 36;

/** Compute privacy-safe brightness and frame-change summaries from RGBA pixels. */
export function summarizeVideoFrame(
  rgba: Uint8ClampedArray,
  previousLuma: Uint8Array | null
): PixelFeature & { luma: Uint8Array } {
  const pixelCount = Math.floor(rgba.length / 4);
  if (pixelCount <= 0) throw new Error("The sampled video frame is empty.");

  const luma = new Uint8Array(pixelCount);
  let brightnessTotal = 0;
  let motionTotal = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const value = Math.round(
      rgba[offset] * 0.2126 + rgba[offset + 1] * 0.7152 + rgba[offset + 2] * 0.0722
    );
    luma[pixel] = value;
    brightnessTotal += value;
    if (previousLuma?.length === pixelCount) {
      motionTotal += Math.abs(value - previousLuma[pixel]);
    }
  }

  return {
    brightness: brightnessTotal / pixelCount,
    motion: previousLuma?.length === pixelCount ? motionTotal / pixelCount : 0,
    luma,
  };
}

/** Uniformly choose bounded browser sampling times without exposing video frames. */
export function videoFeatureSampleTimes(
  durationS: number,
  maxSamples = DEFAULT_MAX_SAMPLES
): number[] {
  if (!Number.isFinite(durationS) || durationS <= 0) return [];
  const count = Math.max(8, Math.min(maxSamples, Math.ceil(durationS) + 1));
  if (count === 1) return [0];
  const safeEnd = Math.max(0, durationS - 0.05);
  return Array.from(
    { length: count },
    (_, index) => (safeEnd * index) / (count - 1)
  );
}

/**
 * Extract bounded frame summaries in the browser. The video file and decoded
 * pixels remain local; callers send only time, brightness and motion numbers.
 */
export async function extractVideoSyncFeatures(
  video: HTMLVideoElement,
  options: { signal?: AbortSignal; maxSamples?: number } = {}
): Promise<VideoSyncFeature[]> {
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    throw new Error("Video metadata is unavailable for automatic alignment.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_WIDTH;
  canvas.height = SAMPLE_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The browser cannot read video frame summaries.");

  const wasPaused = video.paused;
  const originalTime = video.currentTime;
  video.pause();
  let previousLuma: Uint8Array | null = null;
  const features: VideoSyncFeature[] = [];

  try {
    for (const timeS of videoFeatureSampleTimes(video.duration, options.maxSamples)) {
      throwIfAborted(options.signal);
      await seekVideo(video, timeS, options.signal);
      context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      const pixels = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
      const summary = summarizeVideoFrame(pixels, previousLuma);
      previousLuma = summary.luma;
      features.push({
        time_s: round(video.currentTime, 3),
        brightness: round(summary.brightness, 3),
        motion: round(summary.motion, 3),
      });
    }
  } finally {
    await seekVideo(video, originalTime).catch(() => undefined);
    if (!wasPaused) void video.play().catch(() => undefined);
  }
  return features;
}

function seekVideo(
  video: HTMLVideoElement,
  timeS: number,
  signal?: AbortSignal
): Promise<void> {
  if (Math.abs(video.currentTime - timeS) < 0.001) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The browser could not decode a sampled video frame."));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Automatic alignment was cancelled.", "AbortError"));
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    video.currentTime = timeS;
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Automatic alignment was cancelled.", "AbortError");
  }
}

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}
