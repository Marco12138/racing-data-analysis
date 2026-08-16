/**
 * Browser-local engine RPM estimation from onboard video audio.
 *
 * The audio never leaves the device: the page decodes the file with the Web
 * Audio API, computes a short-time Fourier transform, tracks the exhaust
 * firing frequency with a harmonic product spectrum, and converts it to RPM.
 * A single-cylinder two-stroke fires once per revolution (RPM = Hz * 60); a
 * four-stroke single fires once per two revolutions (RPM = Hz * 120).
 */

export type StftResult = {
  times: number[];
  frequencies: number[];
  magnitude: Float32Array[];
};

export type EngineRpmTrace = {
  rpm: number[];
  confidence: number[];
};

export type RpmEvent = {
  entry_s: number;
  apex_s: number;
  exit_s: number;
  drop_rpm: number;
};

export type LapAudioAnalysis = {
  /** Video-relative timestamps of the RPM samples. */
  times: number[];
  rpm: number[];
  events: RpmEvent[];
  strokes: 2 | 4;
  frameRate: number;
  lapStartS: number;
  lapEndS: number;
};

const MAX_VIDEO_SECONDS = 900;
const DEFAULT_WINDOW_SIZE = 2048;
const DEFAULT_HOP_SIZE = 2048;
const MAX_FRAMES = 4000;

/** In-place radix-2 Cooley-Tukey FFT. Both arrays must be equal power-of-two length. */
function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n === 0 || (n & (n - 1)) !== 0) {
    throw new Error("FFT size must be a power of two.");
  }
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tmpRe = re[i];
      re[i] = re[j];
      re[j] = tmpRe;
      const tmpIm = im[i];
      im[i] = im[j];
      im[j] = tmpIm;
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    const half = length >> 1;
    for (let i = 0; i < n; i += length) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k += 1) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
        const bIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + half] = aRe - bRe;
        im[i + k + half] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return window;
}

/**
 * Short-time Fourier transform of a mono audio slice. Returns one magnitude
 * row per frame and the corresponding time/frequency grids.
 */
export function stft(
  audio: Float32Array | number[],
  options: { sampleRate?: number; windowSize?: number; hopSize?: number } = {},
): StftResult {
  const sampleRate = options.sampleRate ?? 0;
  const windowSize = options.windowSize ?? DEFAULT_WINDOW_SIZE;
  const hopSize = options.hopSize ?? DEFAULT_HOP_SIZE;
  if (sampleRate <= 0) throw new Error("Sample rate must be positive.");
  if (windowSize <= 0 || (windowSize & (windowSize - 1)) !== 0) {
    throw new Error("STFT window size must be a power of two.");
  }
  const samples = audio instanceof Float32Array ? audio : Float32Array.from(audio);
  const frameCount =
    samples.length >= windowSize
      ? Math.floor((samples.length - windowSize) / hopSize) + 1
      : 0;
  const window = hannWindow(windowSize);
  const frequencies: number[] = [];
  for (let bin = 0; bin <= windowSize / 2; bin += 1) {
    frequencies.push((bin * sampleRate) / windowSize);
  }
  const times: number[] = [];
  const magnitude: Float32Array[] = [];
  const re = new Float32Array(windowSize);
  const im = new Float32Array(windowSize);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * hopSize;
    for (let i = 0; i < windowSize; i += 1) {
      re[i] = samples[offset + i] * window[i];
      im[i] = 0;
    }
    fftInPlace(re, im);
    const row = new Float32Array(windowSize / 2 + 1);
    for (let bin = 0; bin <= windowSize / 2; bin += 1) {
      row[bin] = Math.hypot(re[bin], im[bin]);
    }
    magnitude.push(row);
    times.push(offset / sampleRate);
  }
  return { times, frequencies, magnitude };
}

function interpolateSpectrum(
  frame: Float32Array,
  frequencies: number[],
  targetHz: number,
): number {
  if (targetHz <= frequencies[0]) return frame[0];
  const last = frequencies.length - 1;
  if (targetHz >= frequencies[last]) return frame[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frequencies[mid] <= targetHz) lo = mid;
    else hi = mid;
  }
  const fLo = frequencies[lo];
  const fHi = frequencies[hi];
  const ratio = fHi > fLo ? (targetHz - fLo) / (fHi - fLo) : 0;
  return frame[lo] * (1 - ratio) + frame[hi] * ratio;
}

function medianSmooth(values: number[], window = 7): number[] {
  const radius = Math.max(1, Math.floor(window / 2));
  const result: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - radius);
    const end = Math.min(values.length, i + radius + 1);
    const sorted = values.slice(start, end).sort((a, b) => a - b);
    result.push(sorted[Math.floor(sorted.length / 2)]);
  }
  return result;
}

function movingAverage(values: number[], window: number): number[] {
  const radius = Math.max(1, Math.floor(window / 2));
  const result: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - radius);
    const end = Math.min(values.length, i + radius + 1);
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += values[j];
    result.push(sum / (end - start));
  }
  return result;
}

/**
 * Smooth a raw RPM trace for event detection. A wide median first removes
 * octave jumps in the harmonic tracker, then a moving average removes the
 * remaining frame-to-frame jitter without hiding real brake events.
 */
export function smoothRpmForEvents(
  values: number[],
  options: { medianWindow?: number; averageWindow?: number } = {},
): number[] {
  const medianWindow = options.medianWindow ?? 9;
  const averageWindow = options.averageWindow ?? 15;
  return movingAverage(medianSmooth(values, medianWindow), averageWindow);
}

/**
 * Track the exhaust firing frequency over time using a harmonic product
 * spectrum and convert it to engine RPM for a single-cylinder engine.
 */
export function trackEngineRpm(
  spectrum: StftResult,
  options: { strokes?: 2 | 4; minRpm?: number; maxRpm?: number; smoothWindow?: number } = {},
): EngineRpmTrace {
  const strokes = options.strokes ?? 2;
  const rpmPerHz = strokes === 2 ? 60 : 120;
  const minHz = (options.minRpm ?? (strokes === 2 ? 4500 : 2250)) / rpmPerHz;
  const maxHz = (options.maxRpm ?? (strokes === 2 ? 17000 : 9000)) / rpmPerHz;
  const frequencies = spectrum.frequencies;
  if (frequencies.length === 0 || spectrum.magnitude.length === 0) {
    return { rpm: [], confidence: [] };
  }

  // Evaluate the harmonic product on a fine grid (0.5 Hz) so high harmonics
  // align with the true spectrum instead of falling between FFT bins.
  const gridStepHz = 0.5;
  const gridLength = Math.max(1, Math.floor((maxHz - minHz) / gridStepHz) + 1);
  const raw: number[] = [];
  const confidence: number[] = [];
  for (const frame of spectrum.magnitude) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    let total = 0;
    for (let i = 0; i < gridLength; i += 1) {
      const candidateHz = minHz + i * gridStepHz;
      let product = 1;
      for (let harmonic = 1; harmonic <= 6; harmonic += 1) {
        product *= Math.max(
          interpolateSpectrum(frame, frequencies, candidateHz * harmonic),
          1e-9,
        );
      }
      total += product;
      if (product > bestValue) {
        bestValue = product;
        bestIndex = i;
      }
    }
    raw.push((minHz + bestIndex * gridStepHz) * rpmPerHz);
    const mean = total / gridLength;
    confidence.push(mean > 0 ? bestValue / mean : 0);
  }
  return { rpm: medianSmooth(raw, options.smoothWindow ?? 7), confidence };
}

function zoneRanges(mask: boolean[], dt: number, minDurationS: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start: number | null = null;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] && start === null) start = i;
    else if (!mask[i] && start !== null) {
      if ((i - start) * dt >= minDurationS) ranges.push([start, i - 1]);
      start = null;
    }
  }
  if (start !== null && (mask.length - start) * dt >= minDurationS) {
    ranges.push([start, mask.length - 1]);
  }
  return ranges;
}

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

/**
 * Detect lift/brake events from an RPM trace: a sustained RPM drop followed
 * by a recovery. Returns entry/apex/exit candidates in video seconds.
 */
export function detectLiftEvents(
  times: number[],
  rpm: number[],
  options: {
    dropRateRpmPerS?: number;
    riseRateRpmPerS?: number;
    minDropRpm?: number;
    maxEventS?: number;
    minDurationS?: number;
  } = {},
): RpmEvent[] {
  if (times.length < 10 || times.length !== rpm.length) return [];
  const dropRate = options.dropRateRpmPerS ?? 1400;
  const riseRate = options.riseRateRpmPerS ?? 1400;
  const minDrop = options.minDropRpm ?? 1800;
  const maxEventS = options.maxEventS ?? 12;
  const minDurationS = options.minDurationS ?? 0.35;

  const dt = (times[times.length - 1] - times[0]) / Math.max(1, times.length - 1);
  if (dt <= 0) return [];
  const gradient: number[] = [];
  for (let i = 0; i < rpm.length; i += 1) {
    const prev = rpm[Math.max(0, i - 1)];
    const next = rpm[Math.min(rpm.length - 1, i + 1)];
    gradient.push((next - prev) / (2 * dt));
  }
  const drops = zoneRanges(gradient.map((value) => value < -dropRate), dt, minDurationS);
  const rises = zoneRanges(gradient.map((value) => value > riseRate), dt, minDurationS);

  const raw: RpmEvent[] = [];
  for (const [dropStart, dropEnd] of drops) {
    const dropStartS = times[dropStart];
    const dropEndS = times[dropEnd];
    const follow = rises.find(([riseStart]) => {
      const gapS = times[riseStart] - dropEndS;
      return riseStart > dropEnd && gapS > 0 && gapS < maxEventS;
    });
    if (!follow) continue;
    const [, riseEnd] = follow;
    const riseEndS = times[riseEnd];
    let apexIndex = -1;
    let minRpm = Infinity;
    for (let i = 0; i < times.length; i += 1) {
      if (times[i] >= dropStartS && times[i] <= riseEndS && rpm[i] < minRpm) {
        minRpm = rpm[i];
        apexIndex = i;
      }
    }
    if (apexIndex < 0) continue;
    const entryRpm = rpm[dropStart];
    if (entryRpm - minRpm < minDrop) continue;
    const apexS = times[apexIndex];
    if (apexS <= dropStartS + 0.01 || apexS >= riseEndS - 0.01) continue;
    raw.push({
      entry_s: dropStartS,
      apex_s: apexS,
      exit_s: riseEndS,
      drop_rpm: entryRpm - minRpm,
    });
  }

  raw.sort((a, b) => a.entry_s - b.entry_s);
  const merged: RpmEvent[] = [];
  for (const event of raw) {
    const prev = merged[merged.length - 1];
    if (prev && event.entry_s < prev.exit_s) {
      if (event.drop_rpm > prev.drop_rpm) {
        prev.apex_s = event.apex_s;
        prev.drop_rpm = event.drop_rpm;
      }
      prev.exit_s = Math.max(prev.exit_s, event.exit_s);
    } else {
      merged.push({ ...event });
    }
  }
  return merged.map((event) => ({
    entry_s: round(event.entry_s, 2),
    apex_s: round(event.apex_s, 2),
    exit_s: round(event.exit_s, 2),
    drop_rpm: round(event.drop_rpm, 0),
  }));
}

function monoChannel(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels <= 0) return new Float32Array(0);
  const left = buffer.getChannelData(0);
  if (buffer.numberOfChannels === 1) return left;
  const right = buffer.getChannelData(1);
  const out = new Float32Array(left.length);
  for (let i = 0; i < left.length; i += 1) {
    out[i] = (left[i] + right[i]) / 2;
  }
  return out;
}

/** Decode a local video/audio file with the Web Audio API; nothing is uploaded. */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const data = await file.arrayBuffer();
  const contextTypes = globalThis as unknown as {
    OfflineAudioContext?: typeof OfflineAudioContext;
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  };
  const AudioContext = contextTypes.OfflineAudioContext ?? contextTypes.webkitOfflineAudioContext;
  if (!AudioContext) throw new Error("AUDIO_UNSUPPORTED");
  const context = new AudioContext(1, 1, 44100);
  const buffer = await context.decodeAudioData(data);
  if (!buffer || buffer.duration <= 0 || buffer.numberOfChannels === 0) {
    throw new Error("NO_AUDIO_TRACK");
  }
  return buffer;
}

/**
 * Full pipeline for one lap range: decode -> STFT -> RPM tracking -> events.
 * All times are relative to the video (lapStartS is added back).
 */
export async function analyzeLapAudio(
  file: File,
  options: {
    startS: number;
    endS: number;
    strokes?: 2 | 4;
    onProgress?: (fraction: number) => void;
  },
): Promise<LapAudioAnalysis> {
  const strokes = options.strokes ?? 2;
  options.onProgress?.(0.05);
  const buffer = await decodeAudioFile(file);
  if (buffer.duration > MAX_VIDEO_SECONDS) throw new Error("VIDEO_TOO_LONG");
  options.onProgress?.(0.2);

  const mono = monoChannel(buffer);
  const sampleRate = buffer.sampleRate;
  const startS = Math.max(0, Math.min(options.startS, buffer.duration - 0.05));
  const endS = Math.max(startS + 2, Math.min(options.endS, buffer.duration));
  const from = Math.floor(startS * sampleRate);
  const to = Math.min(mono.length, Math.ceil(endS * sampleRate));
  const slice = mono.subarray(from, to);

  let hopSize = DEFAULT_HOP_SIZE;
  const approxFrames = slice.length / hopSize;
  if (approxFrames > MAX_FRAMES) {
    hopSize = Math.max(2048, Math.ceil((slice.length / MAX_FRAMES) / 256) * 256);
  }
  const spectrum = stft(slice, {
    sampleRate,
    windowSize: DEFAULT_WINDOW_SIZE,
    hopSize,
  });
  options.onProgress?.(0.78);

  const trace = trackEngineRpm(spectrum, { strokes });
  options.onProgress?.(0.92);

  const times = spectrum.times.map((value) => round(value + startS, 3));
  const smoothedRpm = smoothRpmForEvents(trace.rpm);
  const events = detectLiftEvents(times, smoothedRpm);
  options.onProgress?.(1);

  return {
    times,
    rpm: smoothedRpm.map((value) => Math.round(value)),
    events,
    strokes,
    frameRate: sampleRate / hopSize,
    lapStartS: startS,
    lapEndS: endS,
  };
}
