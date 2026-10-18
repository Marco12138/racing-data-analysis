/** Private, read-only frame audit using the production landmark matcher unchanged. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";

const directory = resolve(process.argv[2] ?? "");
if (!relative(resolve("tmp"), directory) || relative(resolve("tmp"), directory).startsWith("..")) {
  throw new Error("Private audit output must be a subdirectory of tmp/.");
}
execFileSync(resolve("node_modules/.bin/esbuild"), ["frontend/lib/trackLandmarks.ts", "--bundle", "--format=esm",
  "--platform=node", `--outfile=${directory}/landmarks.mjs`], { stdio: "pipe" });
const { grayscalePatch, matchLandmarkFrame, rankLandmarkMatches } = await import(pathToFileURL(`${directory}/landmarks.mjs`));
const manifest = JSON.parse(readFileSync(`${directory}/frames.json`));
const frame = id => new Uint8ClampedArray(readFileSync(`${directory}/frames/${id}.rgba`));
const compare = (template, id) => matchLandmarkFrame(template, frame(id), manifest.width, manifest.height);
const results = manifest.pairs.map(pair => ({ ...pair, checks: pair.checks.map(check => {
  const source = frame(check.reference_frame);
  const patches = manifest.regions.map(region => {
    const template = { rect: region.rect, patch: grayscalePatch(source, manifest.width, manifest.height, region.rect) };
    const score = item => ({ time: item.time_s, frame: item.frame, score: null, ...compare(template, item.frame) });
    const predicted = score(check.predicted);
    const search = check.search.map(score).filter(r => Number.isFinite(r.score));
    const ranked = rankLandmarkMatches(search);
    const controls = check.controls.map(score).filter(r => Number.isFinite(r.score));
    return { region: region.name, rect: region.rect, predicted, search, controls, ranked,
      best_shift_s: ranked.candidate ? ranked.candidate.time - check.predicted.time_s : null,
      control_exceedance_fraction: controls.length && ranked.candidate
        ? controls.filter(r => r.score >= ranked.candidate.score).length / controls.length : null,
      interpretation: "similarity_candidate_not_position_truth; controls_are_descriptive_not_a_p_value" };
  });
  return { ...check, patches };
}) }));
writeFileSync(`${directory}/visual-results.json`, JSON.stringify({ thresholds_unchanged: true,
  automatic_anchor_updates: false, raw_video_uploaded: false, regions: manifest.regions, pairs: results }, null, 2));
console.log(JSON.stringify({ pairs: results.length, automatic_anchor_updates: false }));
