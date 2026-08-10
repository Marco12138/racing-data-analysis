import assert from "node:assert/strict";
import test from "node:test";

import {
  canStartNewSession,
  commitPendingVideo,
  isXrkFileName,
} from "../frontend/lib/sessionUpload.ts";

function file(name) {
  return new File(["x"], name);
}

test("isXrkFileName accepts .xrk and .xrz only", () => {
  assert.equal(isXrkFileName("session.xrk"), true);
  assert.equal(isXrkFileName("session.xrz"), true);
  assert.equal(isXrkFileName("SAMPLE.XRK"), true);
  assert.equal(isXrkFileName("video.mp4"), false);
  assert.equal(isXrkFileName("data.csv"), false);
});

test("the combined entry starts with telemetry and makes video optional", () => {
  assert.equal(canStartNewSession({ xrkFile: file("a.xrk"), videoFile: null }), true);
  assert.equal(canStartNewSession({ xrkFile: file("a.xrk"), videoFile: file("onboard.MOV") }), true);
  assert.equal(canStartNewSession({ xrkFile: null, videoFile: file("onboard.MOV") }), false);
  assert.equal(canStartNewSession({ xrkFile: file("onboard.mp4"), videoFile: null }), false);
});

test("commitPendingVideo carries the pending video into the active slot", () => {
  const pending = file("pending.MOV");
  const active = file("active.MOV");
  assert.equal(commitPendingVideo(pending, active), pending);
  assert.equal(commitPendingVideo(null, active), active);
  assert.equal(commitPendingVideo(null, null), null);
});
