import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmedLandmarkSighting, grayscalePatch, landmarkEventText, matchLandmarkFrame, parseLandmarks, patchCorrelation, rankLandmarkMatches } from "../frontend/lib/trackLandmarks.ts";

const rect = { x: .25, y: .25, w: .25, h: .25 };
function fixture() {
  const rgba = new Uint8ClampedArray(96 * 64 * 4);
  let seed = 36;
  for (let i=0; i<rgba.length; i+=4) { seed=(seed*1664525+1013904223)>>>0; rgba[i]=rgba[i+1]=rgba[i+2]=seed>>>24; rgba[i+3]=255; }
  const patch = grayscalePatch(rgba, 96, 64, rect);
  return { rgba, landmark: { version: 1, id: "fixed-1", scope: "session-a", cornerId: "zone-1", name: "路肩末端", nameEn: "Kerb end", thumbnail: "data:image/jpeg;base64,AA==", rect, patch,
    sightings: [{ lap: 1, videoKey: "video-a", syncKey: "manual-anchor", videoTimeS: 10, distanceM: 280, relation: "passing", confirmedAt: "2026-10-16" }] } };
}

test("local library rejects different session/corner, corrupt storage and oversized payloads", () => {
  const { landmark } = fixture();
  const raw = JSON.stringify([landmark]);
  assert.equal(parseLandmarks(raw, "session-a", "zone-1").length, 1);
  assert.deepEqual(parseLandmarks(raw, "other", "zone-1"), []);
  assert.deepEqual(parseLandmarks(raw, "session-a", "zone-9"), []);
  assert.deepEqual(parseLandmarks("broken", "session-a", "zone-1"), []);
  assert.deepEqual(parseLandmarks(JSON.stringify([{...landmark, patch: [NaN]}]), "session-a", "zone-1"), []);
});

test("template correlation handles brightness and refuses flat/invalid patches", () => {
  const { landmark } = fixture();
  assert.ok(patchCorrelation(landmark.patch, landmark.patch.map(v=>v*.5+10)) > .999);
  assert.equal(patchCorrelation(Array(576).fill(20), Array(576).fill(40)), null);
  assert.equal(patchCorrelation([NaN], [NaN]), null);
});

test("bounded template search finds exact patch, only as an unconfirmed candidate", () => {
  const { rgba, landmark } = fixture();
  const match = matchLandmarkFrame(landmark, rgba, 96, 64);
  assert.ok(match.score > .999); assert.deepEqual(match.rect, rect);
  assert.equal(rankLandmarkMatches([{time:1, ...match}]).status, "candidate");
  assert.equal(rankLandmarkMatches([{time:1, ...match}, {time:4, ...match}]).status, "ambiguous");
  assert.equal(rankLandmarkMatches([{time:1, score:.4, rect}]).candidate, null);
});

test("only confirmed passing + synchronization permits a landmark-relative description", () => {
  const { landmark } = fixture(), sighting = landmark.sightings[0];
  assert.match(landmarkEventText(landmark, sighting, 275, "rpm_drop", "zh"), /路肩末端.*前约 5.0 米/);
  assert.match(landmarkEventText(landmark, sighting, 285, "recovery", "en"), /5.0 m after passing.*Kerb end/);
  assert.equal(landmarkEventText(landmark, {...sighting, relation:"visible"}, 275, "rpm_drop", "zh"), null);
  assert.equal(landmarkEventText(landmark, {...sighting, syncKey:""}, 275, "rpm_drop", "zh"), null);
  assert.equal(landmarkEventText(landmark, {...sighting, distanceM:null}, 275, "rpm_drop", "zh"), null);
  assert.equal(landmarkEventText(landmark, sighting, 600, "rpm_drop", "zh"), null);
});

test("changed lap, file or calibration invalidates summary landmark association", () => {
  const { landmark } = fixture();
  assert.ok(confirmedLandmarkSighting(landmark, 1, "video-a", "manual-anchor"));
  assert.equal(confirmedLandmarkSighting(landmark, 2, "video-a", "manual-anchor"), null);
  assert.equal(confirmedLandmarkSighting(landmark, 1, "video-b", "manual-anchor"), null);
  assert.equal(confirmedLandmarkSighting(landmark, 1, "video-a", "corrected-anchor"), null);
  assert.equal(confirmedLandmarkSighting(landmark, 1, "video-a", ""), null);
});
