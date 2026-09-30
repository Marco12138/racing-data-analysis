/** Private local audit: sparse metadata reads only; never uploads media. */
import { openAsBlob } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { parseArgs } from "node:util";
import { extractGoproTelemetry } from "../frontend/lib/gpmfTelemetry.ts";

const { values } = parseArgs({ options: { file: { type: "string" }, output: { type: "string", default: "tmp/gpmf-audit/camera.json" } } });
if (!values.file) throw new Error("Use --file <private original GoPro MP4> [--output tmp/.../camera.json]");
const output = resolve(values.output);
const within = relative(resolve("tmp"), output);
if (!within || within.startsWith("..") || within.startsWith("/")) throw new Error("Output must stay under ignored tmp/.");
const audit = await extractGoproTelemetry(await openAsBlob(values.file));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(audit, null, 2));
console.log(JSON.stringify(audit.summary, null, 2));
console.log(`Private clock/position audit saved to ${output}`);
