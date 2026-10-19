export type ComparisonStart = {
  start_s: number; end_s: number; uncertainty_s: .5; method: "manual_start_plus_five_v1";
};

/** A human mark defines a five-second observation, never a spatial warp or lap time. */
export function comparisonStart(time: number, duration: number): ComparisonStart | null {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || time < 0 || time + 5 > duration) return null;
  return { start_s: time, end_s: time + 5, uncertainty_s: .5, method: "manual_start_plus_five_v1" };
}

/** Sampled local identity prevents a different file from inheriting saved landmarks. No filename is stored. */
export async function comparisonVideoKey(file: File): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 65536)).arrayBuffer());
  const bytes = new Uint8Array(head.length + tail.length); bytes.set(head); bytes.set(tail, head.length);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `${file.size}:${Array.from(hash, n => n.toString(16).padStart(2, "0")).join("")}`;
}

/** Wait for the requested frame before starting paired playback; cancellation never moves a saved mark. */
export async function seekComparisonVideo(video: HTMLVideoElement, time: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!video.seeking && Math.abs(video.currentTime - time) < .005 && video.readyState >= 2) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(fail, 5000);
    function cleanup() { clearTimeout(timer); video.removeEventListener("seeked", done); video.removeEventListener("error", fail); signal.removeEventListener("abort", fail); }
    function done() { cleanup(); resolve(); }
    function fail() { cleanup(); reject(Error("playback_unavailable")); }
    video.addEventListener("seeked", done, { once: true }); video.addEventListener("error", fail, { once: true });
    signal.addEventListener("abort", fail, { once: true }); video.currentTime = time;
  });
  signal.throwIfAborted();
}

export type SavedVideoComparison = {
  version: 1; id: string; pair_key: string; name: string; drivers: [string, string];
  starts: [ComparisonStart, ComparisonStart]; same_location_confirmed: true;
};

/** Restore only bounded metadata for the same two local files, never inferred synchronization. */
export function parseVideoComparisons(raw: string | null, pairKey: string, durations: [number, number]): SavedVideoComparison[] {
  try {
    const rows = JSON.parse(raw ?? "[]");
    if (!Array.isArray(rows) || !pairKey) return [];
    return rows.filter((r): r is SavedVideoComparison => r?.version === 1 && r.pair_key === pairKey
      && typeof r.id === "string" && r.id.length <= 80 && typeof r.name === "string" && r.name.length > 0 && r.name.length <= 80
      && r.same_location_confirmed === true && Array.isArray(r.drivers) && r.drivers.length === 2
      && r.drivers.every((s: unknown) => typeof s === "string" && s.length <= 60)
      && Array.isArray(r.starts) && r.starts.length === 2 && r.starts.every((s: ComparisonStart, i: number) =>
        s?.method === "manual_start_plus_five_v1" && s.uncertainty_s === .5 && comparisonStart(s.start_s, durations[i]) !== null
        && s.end_s === s.start_s + 5)).slice(0, 10);
  } catch { return []; }
}
