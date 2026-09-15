import assert from "node:assert/strict";
import test from "node:test";

import {
  canStartNewSession,
  commitPendingVideo,
  isXrkFileName,
  resolveLocalXrkSource,
} from "../frontend/lib/sessionUpload.ts";
import {
  binaryFileUploadRequest,
  multipartFileUploadRequest,
  describeFileReadError,
  exceedsUploadLimit,
  materializeXrkFile,
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

test("materializeXrkFile preserves the name for a delayed session start", async () => {
  const file = new File(["<hCNFsample"], "session.xrk");
  const stable = await materializeXrkFile(file);
  assert.notEqual(stable, file);
  assert.equal(stable.name, "session.xrk");
  assert.equal(stable.size, file.size);
  assert.equal(await stable.text(), "<hCNFsample");
});

test("file read errors are explained without raw internals", () => {
  assert.match(
    describeFileReadError(new DOMException("blocked", "NotReadableError")),
    /系统拒绝/
  );
  assert.match(
    describeFileReadError(new DOMException("blocked", "NotReadableError")),
    /复制到桌面或下载目录/
  );
  assert.match(
    describeFileReadError(new DOMException("blocked", "SecurityError")),
    /系统拒绝/
  );
  assert.match(
    describeFileReadError(new TypeError("arrayBuffer is not a function")),
    /升级 Safari/
  );
  assert.match(
    describeFileReadError(new Error("generic failure")),
    /无法读取/
  );
});

test("local library source falls back to the first available file", () => {
  const sources = [
    {
      source_id: "first",
      name: "ren_kosmic_WUHAN_a_0809.xrk",
      kind: "xrk",
      size_bytes: 2826404,
      root: "racing数据",
      relative_path: "ren_kosmic_WUHAN_a_0809.xrk",
      modified_at: 1742539904,
    },
    {
      source_id: "second",
      name: "Marco_Kr 2025 old vega_WSK-WUHAN_a_0059.xrk",
      kind: "xrk",
      size_bytes: 3614891,
      root: "racing数据",
      relative_path: "Marco_Kr 2025 old vega_WSK-WUHAN_a_0059.xrk",
      modified_at: 1748253818,
    },
  ];

  assert.equal(resolveLocalXrkSource(sources, "")?.source_id, "first");
  assert.equal(resolveLocalXrkSource(sources, "second")?.source_id, "second");
  assert.equal(resolveLocalXrkSource(sources, "missing")?.source_id, "first");
  assert.equal(resolveLocalXrkSource([], "first"), null);
});

test("materializeUploadBlob falls back to FileReader when arrayBuffer is missing", async () => {
  const originalFileReader = globalThis.FileReader;
  class TestFileReader {
    result = null;
    error = null;
    onload = null;
    onerror = null;
    onabort = null;
    readAsArrayBuffer(blob) {
      blob.slice().arrayBuffer().then(
        (buffer) => {
          this.result = buffer;
          this.onload?.();
        },
        (error) => {
          this.error = error;
          this.onerror?.();
        }
      );
    }
  }
  globalThis.FileReader = TestFileReader;
  try {
    const file = new File(["<hCNFsample"], "fallback.xrk");
    Object.defineProperty(file, "arrayBuffer", { value: undefined });
    const blob = await materializeUploadBlob(file);
    assert.equal(blob.size, file.size);
    assert.equal(await blob.text(), "<hCNFsample");
  } finally {
    if (originalFileReader === undefined) {
      delete globalThis.FileReader;
    } else {
      globalThis.FileReader = originalFileReader;
    }
  }
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

test("standard browser upload preserves detached bytes and lets the browser set its boundary", async () => {
  const source = new File([new Uint8Array([0, 255, 60, 104, 67, 78, 70])], "车手 session.xrk");
  const detached = await materializeUploadBlob(source);
  const controller = new AbortController();
  const options = multipartFileUploadRequest(detached, source.name, controller.signal);
  assert.equal(options.headers, undefined);
  assert.equal(options.signal, controller.signal);
  assert.ok(options.body instanceof FormData);
  const wire = new Request("https://backend.example/api/v1/xrk/inspect", options);
  assert.match(wire.headers.get("Content-Type"), /^multipart\/form-data; boundary=/);
  const decoded = await wire.formData();
  const uploaded = decoded.get("file");
  assert.equal(uploaded.name, source.name);
  assert.equal(uploaded.size, source.size);
  assert.deepEqual(new Uint8Array(await uploaded.arrayBuffer()), new Uint8Array(await source.arrayBuffer()));
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
