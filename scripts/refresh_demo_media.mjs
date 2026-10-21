/** Restore approved excerpt audio and publish only clip-relative GPS5 speed, not raw GPMF. */
import { openAsBlob } from "node:fs";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { extractGoproTelemetry } from "../frontend/lib/gpmfTelemetry.ts";
import { isPublishedVideoReview } from "../frontend/lib/publishedVideoReview.ts";

const { values } = parseArgs({ options: { video: { type: "string" }, ffmpeg: { type: "string" }, "approved-for-publication": { type: "boolean" } } });
if (!values.video || !values.ffmpeg || !values["approved-for-publication"])
  throw new Error("Requires --video, --ffmpeg and --approved-for-publication. Only existing approved excerpts are exported.");
await mkdir("tmp", { recursive: true });
const temp = await mkdtemp(resolve("tmp/demo-media-"));
let goproSpeedAt;
try {
  execFileSync(resolve("node_modules/.bin/esbuild"), ["frontend/lib/goproVideoSpeed.ts", "--bundle", "--platform=node", "--format=esm",
    "--external:mp4box", "--external:gopro-telemetry", `--outfile=${temp}/speed.mjs`], { stdio: "pipe" });
  ({ goproSpeedAt } = await import(pathToFileURL(`${temp}/speed.mjs`).href));
} finally { await rm(temp, { recursive: true, force: true }); }
const artifactPath = resolve("public/demo/reviewed-real-session.json");
const artifact = JSON.parse(await readFile(artifactPath, "utf8")), review = artifact.analysis.video_review;
if (!isPublishedVideoReview(review)) throw new Error("Invalid published review.");
const audit = await extractGoproTelemetry(await openAsBlob(values.video), { includeGpsSpeed: true });
const points = audit.video_speed ?? [];
if (!points.length) throw new Error("Original video has no GPS5 speed.");
const clips = [];
for (const clip of review.clips) {
  const start = clip.source_start_s, end = start + clip.duration_s;
  if (end > audit.summary.duration_s) throw new Error("Excerpt outside original recording.");
  const boundary = time => ({ time_s: time - start, speed_kmh: goproSpeedAt(points, time).speed_kmh,
    fix: goproSpeedAt(points, time).reason === "available" ? 3 : 0 });
  // Endpoints are bounded interpolations; interior points retain actual GPS5 values and gaps.
  const samples = [boundary(start), ...points.filter(p => p.time_s > start && p.time_s < end)
    .map(p => ({ time_s: p.time_s - start, speed_kmh: p.speed_kmh, fix: p.fix })), boundary(end)];
  const output = resolve("public/demo/video", basename(clip.url));
  execFileSync(values.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(start), "-i", values.video, "-t", "5",
    "-map", "0:v:0", "-map", "0:a:0", "-map_metadata", "-1", "-map_chapters", "-1",
    "-vf", "scale=960:-2,fps=30", "-c:v", "libx264", "-crf", "25", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output], { stdio: "pipe" });
  const revision = createHash("sha256").update(await readFile(output)).update(JSON.stringify(samples)).digest("hex").slice(0, 16);
  clips.push({ url: clip.url, source_start_s: start, duration_s: clip.duration_s, revision, audio_present: true,
    speed_source: "gopro_gps5_2d", timing: "video_cts_uniform_packet_samples", sensor_latency_calibrated: false, points: samples });
}
await writeFile(resolve("public/demo/video/media.json"), JSON.stringify({ version: 1, clips }) + "\n");
review.audio_removed = false;
await writeFile(artifactPath, JSON.stringify(artifact) + "\n");
console.log(`Refreshed ${clips.length} approved five-second excerpts with audio and clip-relative GPS5 speed. No coordinates or UTC published.`);
