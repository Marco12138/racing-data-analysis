/** Local-only metadata extraction. Movie creation dates are never GPS clocks. */
export type GnssClockPoint = { time_s: number; utc_s: number; fix: number };
export type GnssPositionPoint = { time_s: number; lat: number; lon: number; speed_kmh: number; fix: number };
type Stream = Record<string, unknown>;
type Packet = { cts: number; duration: number; timescale: number; size: number; offset: number };
type Track = { id: number; codec: string; type: string; edits?: Array<{ media_time: number; media_rate_integer: number; media_rate_fraction: number }> };
export type Movie = { duration: number; timescale: number; isFragmented: boolean; tracks: Track[] };
export type GoproAudit = {
  summary: {
    parser: string; duration_s: number; bytes_read: number; packet_count: number;
    streams: Array<{ key: string; unit: string; sample_count: number; sample_rate_hz: number; first_time_s: number; last_time_s: number }>;
    warnings: string[]; camera_imu_body_calibrated: false; gps_clock_source: string;
    sample_time_method: string; speed_summary_method: string;
  };
  video_clock: GnssClockPoint[];
  video_gps: GnssPositionPoint[];
};

/** GPSU is YYMMDDhhmmss.sss UTC, independent of local timezone or MP4 dates. */
export function parseGpsUtc(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?\0*$/.exec(value);
  if (!match) return null;
  const [, yy, mm, dd, hh, min, sec, fraction] = match;
  const year = 2000 + Number(yy);
  const ms = Date.UTC(year, +mm - 1, +dd, +hh, +min, +sec);
  const date = new Date(ms);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== +mm - 1 || date.getUTCDate() !== +dd
    || +hh > 23 || +min > 59 || +sec > 59) return null;
  return ms / 1000 + Number(fraction ?? 0);
}

function list(value: unknown): Stream[] {
  return (Array.isArray(value) ? value : [value]).filter((x): x is Stream => !!x && typeof x === "object");
}

/** Read numeric values without applying camera orientation or body-frame transforms. */
export function consumeGpmfPacket(audit: GoproAudit, parsed: Stream, packet: Pick<Packet, "cts" | "duration" | "timescale">): void {
  const start = packet.cts / packet.timescale;
  const duration = packet.duration / packet.timescale;
  if (![start, duration].every(Number.isFinite) || start < 0 || duration <= 0) throw new Error("GPMF_INVALID_TIMING");
  for (const device of list(parsed.DEVC)) for (const stream of list(device.STRM)) {
    const key = String(stream.interpretSamples);
    if (!["GPS5", "GPS9", "ACCL", "GYRO"].includes(key)) continue;
    const rows = stream[key];
    if (!Array.isArray(rows) || !rows.length || rows.length > 10000 || !rows.every(Array.isArray)) continue;
    const rawUnits = stream.SIUN ?? stream.UNIT;
    const unit = Array.isArray(rawUnits) ? rawUnits.join(", ") : String(rawUnits ?? "unknown");
    let summary = audit.summary.streams.find((s) => s.key === key);
    if (!summary) {
      summary = { key, unit, sample_count: 0, sample_rate_hz: 0, first_time_s: start, last_time_s: start };
      audit.summary.streams.push(summary);
    }
    summary.sample_count += rows.length;
    summary.last_time_s = start + duration;
    summary.sample_rate_hz = summary.sample_count / (summary.last_time_s - summary.first_time_s);
    if (key === "ACCL" || key === "GYRO") continue;
    if (key === "GPS9") {
      audit.summary.warnings.push("GPS9_NOT_YET_VALIDATED");
      continue;
    }
    const scale = Array.isArray(stream.SCAL) ? stream.SCAL : [stream.SCAL];
    if (scale.length !== 5 || !scale.every((v) => typeof v === "number" && Number.isFinite(v) && v > 0)) {
      audit.summary.warnings.push("GPS_SCALE_UNSUPPORTED");
      continue;
    }
    const units = Array.isArray(rawUnits) ? rawUnits : [];
    if (units[0] !== "deg" || units[1] !== "deg" || units[3] !== "m/s") {
      audit.summary.warnings.push("GPS_UNIT_UNSUPPORTED");
      continue;
    }
    const fix = [0, 1, 2, 3].includes(Number(stream.GPSF)) ? Number(stream.GPSF) : 0;
    const utc = parseGpsUtc(stream.GPSU);
    if (utc != null) audit.video_clock.push({ time_s: start, utc_s: utc, fix });
    // A 0.2 s boxcar summary limits aliasing and payload size. This is not a
    // replacement for native telemetry and is used only for coarse sync checks.
    const binSize = Math.max(1, Math.ceil(rows.length * .2 / duration));
    for (let begin = 0; begin < rows.length; begin += binSize) {
      const end = Math.min(rows.length, begin + binSize);
      const group = rows.slice(begin, end).map((row) => row.map((v: unknown, i: number) => Number(v) / scale[i]));
      if (!group.every((r) => r.length === 5 && r.every(Number.isFinite))) continue;
      const mean = (i: number) => group.reduce((sum, row) => sum + row[i], 0) / group.length;
      const lat = mean(0), lon = mean(1), speed = mean(3) * 3.6;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || speed < 0 || speed > 600) continue;
      audit.video_gps.push({ time_s: start + ((begin + end - 1) / 2) * duration / rows.length,
        lat, lon, speed_kmh: speed, fix });
    }
  }
  audit.summary.warnings = [...new Set(audit.summary.warnings)];
}

/** Reject edits whose metadata clock cannot be mapped to HTML video time safely. */
export function validateMovie(movie: Movie): number {
  const duration = movie.duration / movie.timescale;
  if (movie.isFragmented) throw new Error("GPMF_FRAGMENTED_UNSUPPORTED");
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error("GPMF_DURATION_LIMIT");
  for (const track of movie.tracks.filter((t) => t.type === "video" || t.codec === "gpmd")) {
    if (track.edits && (track.edits.length !== 1 || track.edits.some((e) => e.media_time !== 0
      || e.media_rate_integer !== 1 || e.media_rate_fraction !== 0))) throw new Error("GPMF_EDIT_LIST_UNSUPPORTED");
  }
  return duration;
}

/** Sparse reads of MP4 sample tables and gpmd packets, never audio/video decoding. */
export async function extractGoproTelemetry(file: Blob, options: {
  signal?: AbortSignal; onProgress?: (fraction: number) => void;
} = {}): Promise<GoproAudit> {
  const check = () => {
    options.signal?.throwIfAborted();
    if (Date.now() - started > 120000) throw new Error("GPMF_TIMEOUT");
  };
  const started = Date.now();
  check();
  if (!file.size || file.size > 20 * 1024 ** 3) throw new Error("GPMF_FILE_SIZE_LIMIT");
  const { createFile } = await import("mp4box");
  const { default: decode } = await import("gopro-telemetry");
  const mp4 = createFile();
  let info: Movie | null = null, parserFailed = false, bytesRead = 0, offset = 0;
  mp4.onError = () => { parserFailed = true; };
  mp4.onReady = (movie: Movie) => { info = movie; };
  while (!info && offset < file.size) {
    check();
    const buffer = await file.slice(offset, Math.min(offset + 128 * 1024, file.size)).arrayBuffer();
    bytesRead += buffer.byteLength;
    if (bytesRead > 32 * 1024 ** 2) throw new Error("GPMF_HEADER_LIMIT");
    const next = mp4.appendBuffer(Object.assign(buffer, { fileStart: offset }));
    if (parserFailed) throw new Error("GPMF_INVALID_MP4");
    offset = Number.isFinite(next) && next > offset ? next : offset + buffer.byteLength;
  }
  if (!info) throw new Error("GPMF_INVALID_MP4");
  const movie = info as Movie;
  const duration = validateMovie(movie);
  const tracks = movie.tracks.filter((t) => t.codec === "gpmd");
  if (tracks.length !== 1) throw new Error("GPMF_TRACK_UNAVAILABLE");
  const packets: Packet[] = mp4.getTrackSamplesInfo(tracks[0].id);
  if (!packets.length || packets.length > 3600 || packets.reduce((sum, p) => sum + p.size, 0) > 32 * 1024 ** 2)
    throw new Error("GPMF_PACKET_LIMIT");
  const audit: GoproAudit = { summary: {
    parser: "mp4box@0.5.2 + gopro-telemetry@1.2.11 (raw)", duration_s: duration, bytes_read: bytesRead,
    packet_count: packets.length, streams: [], warnings: ["CAMERA_IMU_NOT_BODY_FRAME", "PAYLOAD_FRAME_LATENCY_UNCALIBRATED"],
    camera_imu_body_calibrated: false, gps_clock_source: "GPSU only; no movie creation-date fallback",
    sample_time_method: "MP4 gpmd CTS/timescale; uniform timing within each payload, not native per-sample hardware timestamps",
    speed_summary_method: "within-payload 0.2s boxcar; center timestamp; not a dynamics signal",
  }, video_clock: [], video_gps: [] };
  let previousEnd = -1;
  for (const [index, packet] of packets.entries()) {
    check();
    if (!Number.isSafeInteger(packet.offset) || packet.offset < 0 || !Number.isSafeInteger(packet.size)
      || packet.size <= 0 || packet.size > 1024 ** 2 || packet.offset + packet.size > file.size
      || packet.cts / packet.timescale < previousEnd - .001) throw new Error("GPMF_INVALID_PACKET");
    previousEnd = (packet.cts + packet.duration) / packet.timescale;
    const bytes = new Uint8Array(await file.slice(packet.offset, packet.offset + packet.size).arrayBuffer());
    audit.summary.bytes_read += bytes.byteLength;
    const parsed: Stream = await decode({ rawData: bytes }, { raw: true, stream: ["GPS5", "GPS9", "ACCL", "GYRO"] });
    consumeGpmfPacket(audit, parsed, packet);
    if (audit.video_clock.length > 3600 || audit.video_gps.length > 20000) throw new Error("GPMF_SAMPLE_LIMIT");
    options.onProgress?.((index + 1) / packets.length);
  }
  check();
  if (audit.video_gps.some((p) => p.time_s > duration)) audit.summary.warnings.push("METADATA_BEYOND_VIDEO_END_EXCLUDED");
  audit.video_clock = audit.video_clock.filter((p) => p.time_s <= duration);
  audit.video_gps = audit.video_gps.filter((p) => p.time_s <= duration);
  if (!audit.video_clock.some((p) => p.fix >= 3)) audit.summary.warnings.push("GOPRO_GPS_UTC_UNAVAILABLE");
  return audit;
}
