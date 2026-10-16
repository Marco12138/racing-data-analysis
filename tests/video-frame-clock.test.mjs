import assert from "node:assert/strict";
import { test } from "node:test";
import { observeVideoClock } from "../frontend/lib/videoFrameClock.ts";

function video(framed = true) {
  const target = new EventTarget();
  const callbacks = new Map();
  let next = 0;
  return Object.assign(target, { currentTime: 0, paused: false, ended: false,
    requestVideoFrameCallback: framed ? fn => { callbacks.set(++next, fn); return next; } : undefined,
    cancelVideoFrameCallback: id => callbacks.delete(id),
    frame(now, mediaTime) { const [id, fn] = callbacks.entries().next().value; callbacks.delete(id); fn(now, { mediaTime }); },
    event(name) { target.dispatchEvent(new Event(name)); }, pending: () => callbacks.size });
}

test("clock uses presented media time, not currentTime, and measures actual callback rate", () => {
  const v = video(), samples = [];
  const stop = observeVideoClock(v, s => samples.push(s));
  v.currentTime = 20;
  for (let i = 0; i <= 60; i++) v.frame(i*1000/60, i/60);
  assert.equal(samples.at(-1).time_s, 1);
  assert.equal(samples.at(-1).mode, "video-frame");
  assert.ok(Math.abs(samples.at(-1).refresh_hz-60) < .01);
  assert.equal(v.pending(), 1);
  stop(); assert.equal(v.pending(), 0);
  v.event("play"); assert.equal(v.pending(), 0);
});

test("seek and pause refresh a stopped clock and playback restarts without duplicates", () => {
  const v = video(), samples = [];
  const stop = observeVideoClock(v, s => samples.push(s));
  v.paused = true; v.currentTime = 5; v.event("pause");
  assert.equal(v.pending(), 0); assert.equal(samples.at(-1).time_s, 5);
  v.currentTime = 10; v.event("seeked");
  assert.equal(samples.at(-1).time_s, 10); assert.equal(v.pending(), 0);
  v.paused = false; v.event("play"); v.event("play");
  assert.equal(v.pending(), 1);
  stop();
});

test("older browsers fall back to media events and detach on replacement", () => {
  const v = video(false), samples = [];
  const stop = observeVideoClock(v, s => samples.push(s));
  v.currentTime = 3; v.event("timeupdate");
  assert.deepEqual(samples, [{ time_s: 3, mode: "timeupdate", refresh_hz: null }]);
  stop(); v.event("timeupdate"); assert.equal(samples.length, 1);
});
