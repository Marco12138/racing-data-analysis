import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(`${root}/tmp`, { recursive: true });
const dir = mkdtempSync(`${root}/tmp/track-reference-test-`);
execFileSync(`${root}/node_modules/.bin/esbuild`, [`${root}/tests/fixtures/track-reference-entry.tsx`, "--bundle", "--format=esm", "--platform=node", "--jsx=automatic",
  "--external:react", "--external:react-dom", "--external:lucide-react", `--outfile=${dir}/entry.mjs`], { stdio: "pipe" });
const { TrackReferenceTest, referenceGate, parseTrackReference, nearestReferenceIndex, orderTrackCorners,
  submitClipFeedback, submitNarrativeFeedback, submitCoachValidation } = await import(pathToFileURL(`${dir}/entry.mjs`).href);
after(() => rmSync(dir, { recursive: true, force: true }));
const points = Array.from({ length: 800 }, (_, i) => [130 * Math.cos(i / 800 * 2 * Math.PI), 130 * Math.sin(i / 800 * 2 * Math.PI)]);
const draft = { schema_version: 1, track_id: "mock-track", revision: 1, venue_aliases: [], direction: "CCW", origin_lat: 30, origin_lon: 114,
  source_fingerprint: "a".repeat(64), source_lap: 1, reference_path: points, start_finish_gate: referenceGate(points, 0), corners: [], acceptance: {}, source: "real_observed_lap", official: false };

test("portable track geometry round-trips without telemetry or a synthetic reference", () => {
  assert.deepEqual(parseTrackReference(JSON.stringify(draft)), draft);
  assert.throws(() => parseTrackReference('{"schema_version": 2}'));
  assert.throws(() => parseTrackReference(JSON.stringify({ ...draft, reference_path: [[0, 0]] })));
  assert.throws(() => parseTrackReference(JSON.stringify({ ...draft, official: true })));
  assert.equal(nearestReferenceIndex(points, points[125]), 125);
  const gate = referenceGate(points, 125);
  assert.equal(gate.confirmed, false);
  assert.ok(Math.abs(Math.hypot(...gate.forward) - 1) < 1e-10);
});

test("moving the finish gate reorders stable corner IDs, never renumbers them", () => {
  const corners = [10, 100, 300].map(i => ({ id: `T${i}`, entry_gate: referenceGate(points, i) }));
  const ordered = orderTrackCorners({ ...draft, corners, start_finish_gate: referenceGate(points, 150) });
  assert.deepEqual(ordered.map(c => c.id), ["T300", "T10", "T100"]);
});

for (const locale of ["zh", "en"]) test(`demo map controls are read-only (${locale})`, () => {
  const html = renderToStaticMarkup(createElement(TrackReferenceTest, { locale, inspectionId: "published-demo", referenceLap: 13, readOnly: true }));
  assert.ok(html.includes(locale === "zh" ? "演示 Session 为只读" : "Demo sessions are read-only"));
  assert.equal((html.match(/ disabled=""/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<svg[^>]*viewBox="Infinity/);
});

test("demo feedback exits before any network request", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; throw new Error("Unexpected demo upload"); };
  assert.equal(await submitClipFeedback("https://backend.test", "/api/v1", { session_fingerprint: "redacted" }, fetcher), false);
  assert.equal(await submitNarrativeFeedback("https://backend.test", "/api/v1", { token: "published-demo" }, fetcher), false);
  assert.equal(await submitCoachValidation("https://backend.test", "/api/v1", { data_origin: "demo" }, fetcher), false);
  assert.equal(calls, 0);
});
