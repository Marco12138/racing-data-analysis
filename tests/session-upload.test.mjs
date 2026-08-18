import assert from "node:assert/strict";
import test from "node:test";

import {
  canStartNewSession,
  commitPendingVideo,
  isXrkFileName,
} from "../frontend/lib/sessionUpload.ts";
import {
  binaryFileUploadRequest,
  exceedsUploadLimit,
  materializeUploadBlob,
} from "../frontend/lib/fileUpload.ts";
import { consumeSelectedFile } from "../frontend/lib/fileUpload.ts";

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

test("materializeUploadBlob detaches bytes from the browser File handle", async () => {
  const file = new File(["<hCNFsample"], "sample.xrk", { type: "application/octet-stream" });
  const blob = await materializeUploadBlob(file);
  assert.notEqual(blob, file);
  assert.equal(blob.size, file.size);
  assert.equal(await blob.text(), "<hCNFsample");
});

test("upload limit is enforced before the network request", () => {
  const selected = new File(["12345"], "large.xrk");
  assert.equal(exceedsUploadLimit(selected, 4), true);
  assert.equal(exceedsUploadLimit(selected, 5), false);
  assert.equal(exceedsUploadLimit(selected, null), false);
});

test("XRK browser upload uses a raw body and encoded filename header", () => {
  const selected = new File(["<hCNFsample"], "driver session.xrk");
  const request = binaryFileUploadRequest(selected, selected.name);
  assert.equal(request.method, "POST");
  assert.equal(request.body, selected);
  assert.equal(request.headers["Content-Type"], "application/octet-stream");
  assert.equal(request.headers["X-XRK-Filename"], "driver%20session.xrk");
});

test("selected file remains available until an async upload settles", async () => {
  const selected = file("safari-session.xrk");
  let releaseUpload;
  let reset = false;
  const upload = consumeSelectedFile(
    selected,
    async (received) => {
      assert.equal(received, selected);
      await new Promise((resolve) => { releaseUpload = resolve; });
      assert.equal(reset, false);
    },
    () => { reset = true; },
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(reset, false);
  releaseUpload();
  await upload;
  assert.equal(reset, true);
});
