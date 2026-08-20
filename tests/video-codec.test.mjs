import assert from "node:assert/strict";
import test from "node:test";

import { detectVideoCodecFromFile } from "../frontend/lib/videoCodec.ts";

function fileFromBytes(bytes) {
  return new File([new Uint8Array(bytes)], "clip.mp4", { type: "video/mp4" });
}

test("detects HEVC from hvc1 sample-entry marker", async () => {
  const bytes = Array.from({ length: 4096 }, (_, i) => (i * 7) % 256);
  const marker = [0x68, 0x76, 0x63, 0x31]; // "hvc1"
  bytes.splice(200, marker.length, ...marker);
  assert.equal(await detectVideoCodecFromFile(fileFromBytes(bytes)), "hevc");
});

test("detects H.264 from avc1 sample-entry marker", async () => {
  const bytes = Array.from({ length: 4096 }, (_, i) => (i * 3) % 256);
  const marker = [0x61, 0x76, 0x63, 0x31]; // "avc1"
  bytes.splice(120, marker.length, ...marker);
  assert.equal(await detectVideoCodecFromFile(fileFromBytes(bytes)), "h264");
});

test("returns unknown for files without a recognized marker", async () => {
  const bytes = Array.from({ length: 2048 }, () => 0);
  assert.equal(await detectVideoCodecFromFile(fileFromBytes(bytes)), "unknown");
});

test("does not throw for an empty file", async () => {
  assert.equal(await detectVideoCodecFromFile(fileFromBytes([])), "unknown");
});
