import assert from "node:assert/strict";
import { test, after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), dir = mkdtempSync(`${root}/tmp/gopro-speed-test-`);
execFileSync(`${root}/node_modules/.bin/esbuild`, [`${root}/frontend/lib/goproVideoSpeed.ts`, "--bundle", "--format=esm", "--platform=node",
  "--external:mp4box", "--external:gopro-telemetry", `--outfile=${dir}/speed.mjs`], { stdio:"pipe" });
const { goproSpeedAt, createGoproSpeedCache } = await import(pathToFileURL(`${dir}/speed.mjs`).href);
after(() => rmSync(dir, { recursive:true, force:true }));
const point = (t, speed, fix = 3) => ({ time_s:t, speed_kmh:speed, fix });

test("frame lookup preserves real zeros and interpolates only this file's GPS speed", () => {
  const a = [point(10,0),point(10.1,36)], b = [point(10,50),point(10.1,60)];
  assert.equal(goproSpeedAt(a,10).speed_kmh,0);
  assert.ok(Math.abs(goproSpeedAt(a,10.05).speed_kmh-18)<1e-10);
  assert.ok(Math.abs(goproSpeedAt(b,10.05).speed_kmh-55)<1e-10);
  assert.equal(goproSpeedAt(a,10.1).speed_kmh,36);
});

test("no extrapolation, stale holding, invalid-fix bridging or long-gap interpolation", () => {
  const p = [point(10,30),point(10.1,null),point(10.2,40),point(11,50)];
  for (const t of [9.99,11.01,NaN,Infinity]) assert.equal(goproSpeedAt(p,t).reason,"outside_coverage");
  for (const t of [10.05,10.1,10.15]) assert.equal(goproSpeedAt(p,t).reason,"gps_invalid");
  assert.equal(goproSpeedAt(p,10.5).reason,"gap");
  for (const value of [point(1,25,2),point(1,NaN),point(1,-1),point(1,601)]) assert.equal(goproSpeedAt([value],1).speed_kmh,null);
  assert.equal(goproSpeedAt([],0).reason,"no_gps");
});

test("same-file players share extraction; a different file never inherits samples", async () => {
  let count=0;
  const acquire=createGoproSpeedCache(async file=>{ count++; return [point(1,file.size)]; });
  const a=new File(["a"],"a.mp4"), b=new File(["bb"],"b.mp4");
  const first=acquire(a,()=>{}), second=acquire(a,()=>{}), other=acquire(b,()=>{});
  assert.equal(first.promise,second.promise);
  assert.equal((await first.promise)[0].speed_kmh,1);
  assert.equal((await other.promise)[0].speed_kmh,2);
  assert.equal(count,2);
  first.release(); second.release(); other.release();
  const again=acquire(a,()=>{}); await again.promise; again.release(); assert.equal(count,2);
});

test("last subscriber cancels pending reads, not the other active player", async () => {
  let signal;
  const acquire=createGoproSpeedCache(async (_file, options)=>{
    signal=options.signal;
    await new Promise((_,reject)=>signal.addEventListener("abort",()=>reject(new DOMException("cancelled","AbortError")),{once:true}));
  });
  const file=new File(["a"],"a.mp4"), a=acquire(file,()=>{}), b=acquire(file,()=>{});
  await Promise.resolve(); a.release(); assert.equal(signal.aborted,false);
  const rejected=assert.rejects(b.promise,{name:"AbortError"}); b.release(); assert.equal(signal.aborted,true); await rejected;
});

test("malformed timing fails closed; extraction errors can be retried", async () => {
  let count=0;
  const acquire=createGoproSpeedCache(async()=>{count++;return [point(2,40),point(2,50)];});
  const file=new File(["a"],"a.mp4");
  for (let i=0;i<2;i++){const handle=acquire(file,()=>{});await assert.rejects(handle.promise,/INVALID_TIMING/);handle.release();}
  assert.equal(count,2);
});
