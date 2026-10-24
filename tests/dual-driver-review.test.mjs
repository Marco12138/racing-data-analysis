import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const root = fileURLToPath(new URL("..", import.meta.url)), dir = mkdtempSync(`${root}/tmp/dual-driver-test-`);
execFileSync(`${root}/node_modules/.bin/esbuild`, [`${root}/tests/fixtures/dual-driver-entry.tsx`, "--bundle", "--format=esm", "--platform=node", "--jsx=automatic",
  "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  "--external:react", "--external:react-dom", "--external:recharts", "--external:lucide-react", `--outfile=${dir}/entry.mjs`], { stdio: "pipe" });
const m = await import(pathToFileURL(`${dir}/entry.mjs`).href);
after(() => rmSync(dir, { recursive: true, force: true }));
test("six steps expose separate files, no fabricated metrics, and the free workspace", () => {
  for (const locale of ["zh", "en"]) {
    const html = renderToStaticMarkup(h(m.I18nProvider, { initialLocale: locale }, h(m.DualDriverReview)));
    assert.equal((html.match(/type="file"/g) ?? []).length, 4);
    assert.match(html, /href="\/workspace"/);
    assert.ok(html.includes(locale === "zh" ? "双车手遥测复盘" : "Two-driver telemetry review"));
    assert.doesNotMatch(html, /40\.326|variance_s2|theoretical|synthetic target/);
  }
});
test("pass search retains multiple visits and suppresses duplicate nearby frames", () => {
  const rows = [{time:10,score:.9},{time:10.2,score:.95},{time:50,score:.88},{time:90,score:.8},{time:120,score:.7}];
  assert.deepEqual(m.separatePassPeaks(rows).map(r => r.time), [10.2,50,90]);
  assert.equal(m.separatePassPeaks([{time:0,score:NaN}]).length, 0);
});
test("GPS gate candidates keep direction, gaps and invalid fixes explicit", () => {
  const points = Array.from({length:501}, (_,i)=>{const t=i*.1,theta=t*Math.PI/10;return {time_s:t,lat:30+Math.sin(theta)*.0003,lon:114+Math.cos(theta)*.0003,speed_kmh:35,fix:3};});
  const result=m.gpsPassCandidates(points,5,points);
  assert.ok(result);assert.ok(result.peaks.length>=2);assert.ok(result.peaks.every(p=>Math.abs((p.time-5)%20)<.1));
  assert.equal(m.gpsPassCandidates(points.map(p=>({...p,fix:0})),5,points),null);
  const invalid=m.gpsPassCandidates(points,5,points.map(p=>({...p,fix:0})));
  assert.equal(invalid.peaks.length,0);assert.ok(invalid.excluded>0);
  const reverse=points.map((p,i)=>({...points[points.length-1-i],time_s:p.time}));
  assert.equal(m.gpsPassCandidates(points,5,reverse).peaks.length,0);
});
test("manual anchors are scoped to session, file and lap with exact offset semantics", () => {
  const row = {version:1,fileKey:"file",inspectionId:"session",lap:4,video_start_s:159.55,video_end_s:200.614,offset_s:23.464,uncertainty_s:.5,confirmed:true};
  assert.ok(m.parseDriverBinding(JSON.stringify(row), "session", "file", 4, 406, 136.086));
  assert.equal(m.parseDriverBinding(JSON.stringify(row), "other", "file", 4, 406, 136.086), null);
  assert.equal(m.parseDriverBinding(JSON.stringify(row), "session", "other", 4, 406, 136.086), null);
  assert.equal(m.parseDriverBinding(JSON.stringify({...row,offset_s:99}), "session", "file", 4, 406, 136.086), null);
  assert.notEqual(m.bindingKey("a","f",4), m.bindingKey("b","f",4));
  assert.equal(m.driverClipStart({start_session_s:140},row,406),163.464);
  assert.equal(m.driverClipStart({start_session_s:174},row,406),null);
});
test("live telemetry cannot extrapolate or bridge missing values", () => {
  const rows = [{session_time_s:0,rpm:8000},{session_time_s:.1,rpm:8100},{session_time_s:1,rpm:9000}];
  assert.equal(m.channelAt(rows,.05,"rpm"),8050);
  assert.equal(m.channelAt(rows,.5,"rpm"),null);
  assert.equal(m.channelAt(rows,-1,"rpm"),null);
  assert.equal(m.channelAt(rows,2,"rpm"),null);
  assert.equal(m.channelAt(rows,0,"speed"),null);
});
test("full gate duration and explicit clip corrections share one telemetry clock", () => {
  const obs={start_session_s:140,end_session_s:150.2,elapsed_s:10.2};
  const binding={video_start_s:159.55,video_end_s:200.614,offset_s:23.464};
  const window=m.driverClipWindow(obs,binding,406);
  assert.equal(window.start,163.464);assert.equal(window.end,173.664);
  assert.equal(m.clipTelemetryTime(164.964,163.964,obs),141);
  assert.equal(m.clipTelemetryTime(160,163.964,obs),null);
  assert.equal(m.clipTelemetryTime(175,163.964,obs),null);
  assert.equal(m.driverClipWindow({...obs,end_session_s:200},binding,406),null);
  assert.equal(binding.offset_s,23.464);
});
test("paired review offers one audible side and an explicit mute option", () => {
  const html=renderToStaticMarkup(h(m.I18nProvider,{initialLocale:"zh"},h(m.ReviewAudioControl,{value:0,onChange(){}})));
  assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);
  assert.match(html,/A 声音/);assert.match(html,/B 声音/);assert.match(html,/静音/);
});
test("search gallery declares candidate status and does not claim complete coverage", () => {
  const html = renderToStaticMarkup(h(m.I18nProvider,{initialLocale:"zh"},h(m.RepeatedPassSearch,{
    source:{url:"blob:a",start:10},target:{url:"blob:b",duration:100},onPreview(){},onUse(){}
  })));
  assert.match(html,/不代表完整圈数/); assert.match(html,/5 秒/); assert.doesNotMatch(html,/已同步|100%/);
});
