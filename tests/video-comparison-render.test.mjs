import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import {fileURLToPath,pathToFileURL} from "node:url";
import {after,test} from "node:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
const root=fileURLToPath(new URL("..",import.meta.url)), dir=mkdtempSync(`${root}/tmp/video-comparison-test-`);
execFileSync(`${root}/node_modules/.bin/esbuild`,[`${root}/tests/fixtures/video-comparison-entry.tsx`,"--bundle","--format=esm","--platform=node","--jsx=automatic",
  "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  "--external:react","--external:react-dom","--external:recharts","--external:lucide-react",`--outfile=${dir}/entry.mjs`],{stdio:"pipe"});
const {WorkspaceTest,LandmarkTest,BoundaryTest,SpeedTest}=await import(pathToFileURL(`${dir}/entry.mjs`).href);
after(()=>rmSync(dir,{recursive:true,force:true}));
test("video workspace starts with two local files, not synthetic metrics",()=>{
  for(const locale of ["zh","en"]){
    const html=renderToStaticMarkup(createElement(WorkspaceTest,{locale}));
    assert.equal((html.match(/type="file"/g)??[]).length,2);
    assert.equal((html.match(/type="file" disabled=""/g)??[]).length,2);
    assert.match(html,/aria-busy="true"/);
    assert.match(html,/data-testid="driver-video-comparison"/);
    assert.ok(html.includes(locale==="zh"?"双车手对照":"Two-driver comparison"));
    assert.ok(html.includes(locale==="zh"?"单圈实验":"Single-lap experiment"));
    assert.doesNotMatch(html,/<video|41\.055|GPS speed|racing-line trace/);
  }
});
test("video-only landmark search never claims GPS or calibrated passing distances",()=>{
  const zh=renderToStaticMarkup(createElement(LandmarkTest,{locale:"zh"}));
  assert.match(zh,/此处只有视频/); assert.match(zh,/不同机位/);
  assert.doesNotMatch(zh,/位置来自 GPS|车头与参照物齐平/);
  const en=renderToStaticMarkup(createElement(LandmarkTest,{locale:"en"}));
  assert.match(en,/Video only: location requires human confirmation/);
});
test("boundary check retains uncertainty, manual authority and advisory endpoint",()=>{
  const html=renderToStaticMarkup(createElement(BoundaryTest,{locale:"zh"}));
  assert.match(html,/±0.5 秒/); assert.match(html,/不修改锚点/); assert.match(html,/终点只作复核/);
  assert.doesNotMatch(html,/timing-based|计时推算片段/);
});
test("speed overlay names the camera source and hides invalid readings in both languages",()=>{
  for(const locale of ["zh","en"]){
    const good=renderToStaticMarkup(createElement(SpeedTest,{locale,available:true}));
    assert.match(good,/GoPro GPS/);assert.match(good,/42\.3/);assert.match(good,/km\/h/);
    assert.match(good,/data-video-time="12.5"/);
    const bad=renderToStaticMarkup(createElement(SpeedTest,{locale,available:false}));
    assert.doesNotMatch(bad,/42\.3/);
    assert.ok(bad.includes(locale==="zh"?"GPS 信号无效":"Invalid GPS fix"));
    assert.match(bad,/data-speed-kmh=""/);
  }
});
