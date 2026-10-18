/** Private GPS5 audit without the application's boxcar; never uploads media. */
import { openAsBlob } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { parseArgs } from "node:util";
import { createFile } from "mp4box";
import decode from "gopro-telemetry";
import { validateMovie } from "../frontend/lib/gpmfTelemetry.ts";

const { values } = parseArgs({ options: { file: { type: "string" }, output: { type: "string", default: "tmp/gpmf-audit/packets.json" } } });
if (!values.file) throw new Error("Use --file <private original MP4> --output tmp/.../packets.json");
const output = resolve(values.output), within = relative(resolve("tmp"), output);
if (!within || within.startsWith("..") || within.startsWith("/")) throw new Error("Output must stay under ignored tmp/.");
const file = await openAsBlob(values.file);
if (!file.size || file.size > 20 * 1024 ** 3) throw new Error("GPMF_FILE_SIZE_LIMIT");
const mp4 = createFile();
let info = null, offset = 0, bytesRead = 0;
mp4.onReady = value => { info = value; };
mp4.onError = () => { throw new Error("GPMF_INVALID_MP4"); };
while (!info && offset < file.size) {
  const buffer = await file.slice(offset, Math.min(offset + 131072, file.size)).arrayBuffer();
  bytesRead += buffer.byteLength;
  if (bytesRead > 32 * 1024 ** 2) throw new Error("GPMF_HEADER_LIMIT");
  const next = mp4.appendBuffer(Object.assign(buffer, { fileStart: offset }));
  offset = Number.isFinite(next) && next > offset ? next : offset + buffer.byteLength;
}
if (!info) throw new Error("GPMF_INVALID_MP4");
validateMovie(info);
const tracks = info.tracks.filter(t => t.codec === "gpmd");
if (tracks.length !== 1) throw new Error("GPMF_TRACK_UNAVAILABLE");
const packets = mp4.getTrackSamplesInfo(tracks[0].id);
if (!packets.length || packets.length > 3600 || packets.reduce((sum, p) => sum + p.size, 0) > 32 * 1024 ** 2)
  throw new Error("GPMF_PACKET_LIMIT");
const list = value => Array.isArray(value) ? value : [value];
const gps = [], metadata = [];
let previousEnd = -1;
for (const [index, p] of packets.entries()) {
  const start = p.cts / p.timescale, duration = p.duration / p.timescale;
  if (![start, duration].every(Number.isFinite) || duration <= 0 || start < 0 || start < previousEnd - .001
    || !Number.isSafeInteger(p.offset) || p.offset < 0 || !Number.isSafeInteger(p.size) || p.size <= 0
    || p.size > 1024 ** 2 || p.offset + p.size > file.size) throw new Error("GPMF_INVALID_PACKET");
  previousEnd = start + duration;
  const parsed = await decode({ rawData: new Uint8Array(await file.slice(p.offset, p.offset + p.size).arrayBuffer()) }, { raw: true, stream: ["GPS5"] });
  for (const device of list(parsed.DEVC)) for (const stream of list(device.STRM)) {
    if (stream.interpretSamples !== "GPS5") continue;
    const rows = stream.GPS5, scale = stream.SCAL, units = stream.SIUN ?? stream.UNIT;
    if (!Array.isArray(scale) || scale.length !== 5 || !scale.every(v => Number.isFinite(v) && v > 0)
      || units?.[0] !== "deg" || units?.[1] !== "deg" || units?.[3] !== "m/s") throw new Error("GPMF_GPS_UNIT_OR_SCALE_UNSUPPORTED");
    if (!Array.isArray(rows) || !rows.length || rows.length > 10000 || gps.length + rows.length > 200000) throw new Error("GPMF_SAMPLE_LIMIT");
    metadata.push({ index, start, duration, GPSU: stream.GPSU, GPSF: stream.GPSF, GPSP: stream.GPSP,
      TSMP: stream.TSMP, STMP: stream.STMP, TIMO: stream.TIMO, count: rows.length, scale });
    for (const [i, row] of rows.entries()) {
      if (row.length !== 5 || !row.every(Number.isFinite)) throw new Error("GPMF_INVALID_GPS_SAMPLE");
      gps.push({ time_s: start + i * duration / rows.length, lat: row[0] / scale[0], lon: row[1] / scale[1],
        speed_kmh: row[3] / scale[3] * 3.6, speed_3d_kmh: row[4] / scale[4] * 3.6,
        fix: stream.GPSF, dop: Number.isFinite(stream.GPSP) ? stream.GPSP / 100 : null, packet: index });
    }
  }
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({
  method: "unaveraged_GPS5_values_uniform_payload_times_not_hardware_timestamps",
  packets: metadata, gps,
}, null, 2));
console.log(`Private GPS5 audit: ${gps.length} samples, ${metadata.length} packets. Saved under tmp/.`);
