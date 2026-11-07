import assert from "node:assert/strict";
import { test, after } from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pauseReviewPlayback, resumeReviewPlayback, reviewPlaybackState } from "../frontend/lib/reviewPlayback.ts";
const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(`${root}/tmp`, { recursive: true });
const dir = mkdtempSync(`${root}/tmp/published-guide-test-`);
execFileSync(`${root}/node_modules/.bin/esbuild`, [`${root}/tests/fixtures/published-guided-entry.tsx`, "--bundle", "--format=esm", "--platform=node", "--jsx=automatic", "--external:react", "--external:react-dom", "--external:lucide-react", "--external:recharts", `--outfile=${dir}/entry.mjs`], { stdio: "pipe" });
const { PublishedGuideTest, publishedCoachEvidence, coachObservation, loadPublishedCoach, cornerTelemetryTime, cornerChannelAt, publishedPlaybackBounds } = await import(pathToFileURL(`${dir}/entry.mjs`).href);
after(() => rmSync(dir, { recursive: true, force: true }));
const source = readFileSync(`${root}/public/demo/reviewed-real-session.json`, "utf8");
const analysis = JSON.parse(source).analysis;
const evidence = JSON.parse(readFileSync(`${root}/public/demo/coach-evidence.json`, "utf8"));
const data = { analysis, review: analysis.video_review, evidence };
const render = (step, locale = "zh") => renderToStaticMarkup(createElement(PublishedGuideTest, { locale, data, step }));
function playbackTarget(time, start, end, options = {}) {
  const video = { paused: true, ended: false, readyState: 4, plays: 0, pauses: 0,
    get currentTime() { return time; }, set currentTime(_) { throw Error("Resume must not seek"); },
    play() { this.plays++; this.paused = false; return Promise.resolve(); },
    pause() { this.pauses++; this.paused = true; }, ...options };
  return { video, start, end };
}
test("paired resume retains independent paused times without resetting either side", async () => {
  const pair = [playbackTarget(103.1, 100, 105), playbackTarget(204.2, 200, 206)];
  assert.equal(reviewPlaybackState(pair), "paused");
  await resumeReviewPlayback(pair);
  assert.equal(reviewPlaybackState(pair), "playing");
  assert.deepEqual(pair.map(t => t.video.currentTime), [103.1, 204.2]);
  pauseReviewPlayback(pair);
  assert.equal(reviewPlaybackState(pair), "paused");
  await resumeReviewPlayback(pair);
  assert.deepEqual(pair.map(t => t.video.plays), [2, 2]);
});
test("native per-side pause is reflected by actual media state", () => {
  const pair = [playbackTarget(2, 0, 5, { paused: false }), playbackTarget(3, 0, 5)];
  assert.equal(reviewPlaybackState(pair), "playing");
  pair[0].video.pause();
  assert.equal(reviewPlaybackState(pair), "paused");
});
test("resume does not restart a completed side or cross the selected exit", async () => {
  const pair = [playbackTarget(5, 0, 5), playbackTarget(4.5, 0, 6)];
  await resumeReviewPlayback(pair);
  assert.deepEqual(pair.map(t => t.video.plays), [0, 1]);
  const complete = [playbackTarget(5, 0, 5), playbackTarget(6, 0, 6, { ended: true })];
  assert.equal(reviewPlaybackState(complete), "ended");
  await resumeReviewPlayback(complete);
  assert.deepEqual(complete.map(t => t.video.plays), [0, 0]);
});
test("resume never rewinds out-of-window players or starts unloaded media", async () => {
  const invalid = [playbackTarget(0, 100, 105), playbackTarget(8, 0, 5)];
  await resumeReviewPlayback(invalid);
  assert.deepEqual(invalid.map(t => t.video.plays), [0, 0]);
  const loading = [playbackTarget(2, 0, 5, { readyState: 0 }), playbackTarget(3, 0, 5)];
  assert.equal(reviewPlaybackState(loading), "unavailable");
  await resumeReviewPlayback(loading);
  assert.deepEqual(loading.map(t => t.video.plays), [0, 0]);
});
test("metadata-only preload can resume and let play request video frames", async () => {
  const pair = [playbackTarget(100, 100, 105, { readyState: 1 }), playbackTarget(200, 200, 206, { readyState: 1 })];
  assert.equal(reviewPlaybackState(pair), "paused");
  await resumeReviewPlayback(pair);
  assert.deepEqual(pair.map(t => t.video.plays), [1, 1]);
});
test("a failed resume pauses both sides instead of leaving one playing", async () => {
  const pair = [playbackTarget(2, 0, 5), playbackTarget(3, 0, 5, { play: () => Promise.reject(Error("blocked")) })];
  await assert.rejects(resumeReviewPlayback(pair), /blocked/);
  assert.ok(pair.every(t => t.video.paused));
});
test("all paired review surfaces use the shared native-state pause/resume button", () => {
  for (const file of ["PublishedGuidedReview", "SelectedCornerPanel", "DualDriverVideo", "ManualReviewVideo"]) {
    assert.match(readFileSync(`${root}/frontend/components/${file}.tsx`, "utf8"), /<ReviewPauseButton/);
  }
  for (const locale of ["zh", "en"]) {
    const html = render(3, locale);
    assert.match(html, /data-testid="review-pause-resume"/);
    assert.ok(html.includes(locale === "zh" ? "继续播放" : "Resume"));
  }
});
test("public evidence binds to the already-published source without private assets", () => {
  assert.equal(evidence.source_sha256, createHash("sha256").update(source).digest("hex"));
  assert.equal(evidence.manual_anchor_modified, false);
  assert.equal(evidence.independent_video_validation, false);
  assert.equal(evidence.sampling, "already_published_distance_grid");
  assert.doesNotMatch(JSON.stringify(evidence), /\/Users\/|\.xrk|GH010681|latitude|longitude/i);
  assert.equal(evidence.sections.length, 3);
});
test("the loader rejects stale evidence and restricts reads to public static resources", async () => {
  const original = globalThis.fetch, requests = [];
  let manifest = evidence;
  globalThis.fetch = async url => {
    requests.push(url);
    return new Response(url.endsWith("coach-evidence.json") ? JSON.stringify(manifest) : source);
  };
  try {
    assert.equal((await loadPublishedCoach()).evidence.version, 1);
    manifest = { ...evidence, source_sha256: "stale" };
    await assert.rejects(loadPublishedCoach(), /VERSION_MISMATCH/);
    assert.deepEqual([...new Set(requests)], ["/demo/reviewed-real-session.json", "/demo/coach-evidence.json"]);
  } finally { globalThis.fetch = original; }
});
test("demo interactions never write coach labels or saved anchors", () => {
  const component = readFileSync(`${root}/frontend/components/PublishedGuidedReview.tsx`, "utf8");
  assert.doesNotMatch(component, /localStorage|sessionStorage|submit.*Feedback|method:\s*["']POST|analyzeSelectedCorner/);
});
test("all six published steps render in both languages without anchor-writing controls", () => {
  for (const locale of ["zh", "en"]) for (let step = 0; step < 6; step++) {
    const html = render(step, locale);
    assert.match(html, /data-testid="published-guided-review"/);
    assert.match(html, /aria-current="step"/);
    assert.match(html, /±0.5/);
    assert.doesNotMatch(html, /type="file"|type="number"|确认这两个片段|Confirm both/);
  }
});
test("the summary uses exactly the same observation strings and numerical evidence", () => {
  for (const locale of ["zh", "en"]) {
    const html = render(5, locale);
    for (const section of evidence.sections) {
      const lines = coachObservation(publishedCoachEvidence(section, locale === "zh"), locale === "zh");
      for (const line of lines) assert.ok(html.includes(line.replaceAll("&", "&amp;").replaceAll("'", "&#x27;").replaceAll('"', "&quot;")), line);
    }
    const recommendation = render(3, locale);
    const marker = 'data-testid="published-recommendation-sector_1"';
    const text = recommendation.split(marker)[1].split("</div>")[0];
    assert.ok(html.split('data-testid="published-summary-sector_1"')[1].startsWith(text));
  }
});
test("candidate navigation, sound and per-side speed/RPM stay visible", () => {
  for (const step of [3, 4]) {
    const html = render(step);
    assert.equal((html.match(/<video/g) ?? []).length, 2);
    assert.match(html, /corner-candidate-navigation/);
    assert.match(html, /corner-chart-L4-speed/); assert.match(html, /corner-chart-L4-rpm/);
    assert.match(html, /corner-chart-L5-speed/); assert.match(html, /corner-chart-L5-rpm/);
    assert.match(html, /L6/); assert.match(html, /静音/);
    assert.match(html, /本片段已人工确认/);
    assert.match(html, /减速或出弯覆盖不完整/);
  }
});
test("shared controls occupy the row between both videos and both telemetry panels", () => {
  for (const locale of ["zh", "en"]) for (const step of [3, 4]) {
    const html = render(step, locale);
    assert.equal((html.match(/class="order-1 min-w-0" data-testid="review-media"/g) ?? []).length, 2);
    assert.equal((html.match(/class="order-3 min-w-0" data-testid="review-telemetry"/g) ?? []).length, 2);
    assert.equal((html.match(/data-testid="review-playback-controls"/g) ?? []).length, 1);
    assert.match(html, /class="order-2 col-span-full [^"]+" data-testid="review-playback-controls"/);
    assert.match(html, /aria-label="L4"/);
    assert.match(html, /aria-label="L5"/);
  }
});
test("live corner, fallback and two-driver reviews preserve the same control-row layout", () => {
  for (const file of ["SelectedCornerPanel", "ManualReviewVideo", "DualDriverVideo"]) {
    const source = readFileSync(`${root}/frontend/components/${file}.tsx`, "utf8");
    assert.match(source, /data-testid="review-media-grid"/);
    assert.match(source, /className="order-1 min-w-0" data-testid="review-media"/);
    assert.match(source, /className="order-2 col-span-full[^"]*" data-testid="review-playback-controls"/);
    assert.match(source, /className="order-3 min-w-0" data-testid="review-telemetry"/);
  }
});
test("spatial timing is inside each published clip, no five-second timing shortcut", () => {
  for (const section of evidence.sections) {
    for (const row of section.result.laps.filter(r => r.status === "candidate")) {
      const clip = data.review.clips.find(c => c.sector_id === section.id && c.lap === row.lap);
      assert.ok(row.start_session_s >= clip.telemetry_start_s);
      assert.ok(row.end_session_s <= clip.telemetry_start_s + clip.duration_s);
      assert.ok(Math.abs(row.elapsed_s - 5) > .1);
      assert.equal(row.spatial_profile.method, "shared_directed_spatial_gates");
      assert.ok(row.telemetry.every(p => Number.isFinite(p.speed) && Number.isFinite(p.rpm)));
    }
    const c = publishedCoachEvidence(section).comparison;
    assert.equal(c.status, "available");
    assert.ok(Math.abs(c.parts.reduce((sum, p) => sum + p.gain_s, 0) - c.gain_s) < 1e-8);
    assert.ok(Math.abs(c.gain_s + c.downstream_gain_s - c.combined_gain_s) < 1e-8);
    for (const lap of section.gps_flagged_laps) assert.notEqual(c.section.lap, lap);
  }
});
test("existing manual binding message requires the exact video and confirmed review", () => {
  const source = readFileSync(`${root}/frontend/components/XrkAnalysisWorkspace.tsx`, "utf8");
  const saved = source.slice(source.indexOf("saved={!!videoFile"), source.indexOf("onBind={bindManualLap}"));
  assert.match(saved, /matchesReviewVideo\(calibration.video, reviewVideoIdentity\(videoFile, videoDurationS\)\)/);
  assert.match(saved, /review\?\.verdict === "confirmed"/);
  assert.match(saved, /video_start_s === lapStart/);
  assert.match(saved, /video_end_s === lapEnd/);
});

test("all nine excerpt clocks map to their own speed/RPM samples and reject out-of-range frames", () => {
  let count = 0;
  for (const section of evidence.sections) for (const row of section.result.laps.filter(r => r.status === "candidate")) {
    const clip = data.review.clips.find(c => c.sector_id === section.id && c.lap === row.lap);
    const videoStart = row.start_session_s - clip.telemetry_start_s;
    for (const point of row.telemetry) {
      const time = cornerTelemetryTime(row, point.session_time_s - clip.telemetry_start_s, videoStart);
      assert.ok(Math.abs(time - point.session_time_s) < 1e-8);
      for (const channel of ["speed", "rpm"]) assert.ok(Math.abs(cornerChannelAt(row.telemetry, time, channel) - point[channel]) < 1e-6);
    }
    for (let elapsed = 0; elapsed <= row.elapsed_s; elapsed += 1 / 60) {
      const time = cornerTelemetryTime(row, videoStart + elapsed, videoStart);
      assert.ok(Math.abs(time - row.start_session_s - elapsed) < 1e-8);
      assert.ok(Number.isFinite(cornerChannelAt(row.telemetry, time, "speed")));
      assert.ok(Number.isFinite(cornerChannelAt(row.telemetry, time, "rpm")));
    }
    assert.equal(cornerTelemetryTime(row, videoStart - .01, videoStart), null);
    assert.equal(cornerTelemetryTime(row, videoStart + row.elapsed_s + .01, videoStart), null);
    count++;
  }
  assert.equal(count, 9);
});

test("published seeks stay inside exact gates despite browser clock truncation", () => {
  const before = JSON.stringify(data);
  for (const section of evidence.sections) for (const row of section.result.laps.filter(r => r.status === "candidate")) {
    const clip = data.review.clips.find(c => c.sector_id === section.id && c.lap === row.lap);
    const start = row.start_session_s - clip.telemetry_start_s, end = row.end_session_s - clip.telemetry_start_s;
    const bounds = publishedPlaybackBounds(start, end);
    assert.ok(bounds[0] >= start && bounds[0] - start <= .001 + 1e-9);
    assert.ok(bounds[1] <= end && end - bounds[1] <= .001 + 1e-9);
    for (const seek of bounds) {
      const browserTime = Math.floor(seek * 1e6) / 1e6;
      const time = cornerTelemetryTime(row, browserTime, start);
      assert.notEqual(time, null);
      assert.ok(Number.isFinite(cornerChannelAt(row.telemetry, time, "speed")));
      assert.ok(Number.isFinite(cornerChannelAt(row.telemetry, time, "rpm")));
    }
    assert.equal(cornerTelemetryTime(row, start - .01, start), null);
  }
  assert.equal(JSON.stringify(data), before);
});

test("changing either candidate remounts both paused players at their own entry", () => {
  const source = readFileSync(`${root}/frontend/components/PublishedGuidedReview.tsx`, "utf8");
  assert.ok(source.includes('key={`${left}-${right}-${i}`}'));
  assert.match(source, /function pair\(a: number, b: number\).*pause\(\).*setLeft\(a\).*setRight\(b\)/);
});

test("native mute updates the shared audio selection without reacting to controlled changes", () => {
  const component = readFileSync(`${root}/frontend/components/PublishedVideoReview.tsx`, "utf8");
  assert.match(component, /onAudio: \(index: number \| null\) => void/);
  assert.match(component, /if \(el && el\.muted !== muted\) onAudio\(el\.muted \? null : index\)/);
});

test("narrow phone steps leave space for labels before switching to three columns", () => {
  const html = render(0, "en");
  assert.match(html, /grid-cols-2/);
  assert.match(html, /min-\[380px\]:grid-cols-3/);
  assert.match(html, /lg:grid-cols-6/);
});
const {publishedGhost,ghostFrame,PublishedGhostReview,I18nProvider}=await import(pathToFileURL(`${dir}/entry.mjs`).href);
const {coachTrajectory,driverTrajectory,trajectoryAt}=await import(pathToFileURL(`${dir}/entry.mjs`).href);
test("all published recommendations use their own registered gates above speed, without selecting an excluded lap",()=>{
  const html=render(3);
  assert.ok(html.indexOf('data-testid="corner-trajectory"')>=0 && html.indexOf('data-testid="corner-trajectory"')<html.indexOf('data-testid="coach-overlay-speed"'));
  for(const s of evidence.sections){
    const pair=publishedCoachEvidence(s).comparison, model=coachTrajectory(analysis,pair);
    assert.equal(model.ok,true,s.id);
    assert.deepEqual(model.runs.map(r=>r.label),["L4","L5"]);
    assert.equal(model.gates.length,pair.samples.length);
    assert.equal(model.gates.at(-1).b-model.gates.at(-1).a,pair.gain_s);
    assert.equal(model.runs[0].points[0].time,0);
    assert.equal(trajectoryAt(model.runs[1].points,model.gates[5].b).time,model.gates[5].b);
    assert.equal(trajectoryAt(model.runs[0].points,model.runs[0].duration+.1),null);
    if(s.id==="sector_1")assert.ok(pair.excluded.includes(6));
  }
});
test("current GPS flags, coordinate holes and rejected registration withhold the map, not the timing evidence",()=>{
  const pair=publishedCoachEvidence(evidence.sections[1]).comparison, t=pair.section.start_session_s+2;
  assert.equal(coachTrajectory(analysis,pair,[{lap:4,start:t,end:t+.01}]).reason,"gps");
  const d=structuredClone(analysis), affected=d.top_laps_comparison.aligned.find(r=>r.lap_4_session_time_s>=t);
  affected.lap_4_local_x_m=null;
  assert.equal(coachTrajectory(d,pair).reason,"coverage");
  pair.section={...pair.section,registration:{status:"rejected",translation_m:[0,0]}};
  assert.equal(coachTrajectory(analysis,pair).reason,"registration");
  assert.equal(coachTrajectory(analysis,{status:"same_lap"}).reason,"pair");
});
test("two drivers use A's coordinate frame and independent gate clocks, never B's untranslated origin",()=>{
  const track=(offset,start)=>Array.from({length:31},(_,i)=>({session_time_s:start+i*.1,local_x_m:offset+i,local_y_m:2}));
  const session=(offset,start)=>({selected_lap:7,channel_provenance:{speed:{source:"gps_receiver"}},track:track(offset,start)});
  const corner={status:"candidate",a:{start_session_s:1,end_session_s:2},b:{start_session_s:11,end_session_s:12.2}};
  const result={corners:[corner],sessions:{a:session(0,0),b:session(13,10)},registration:{status:"accepted",translation_m:[-13,0]}};
  const model=driverTrajectory(result,corner,[[],[]]);
  assert.ok(model.ok);assert.equal(model.gates.length,0);
  assert.equal(model.runs[0].points[0].local_x_m,model.runs[1].points[0].local_x_m);
  assert.ok(model.runs[0].duration<model.runs[1].duration);
  assert.equal(driverTrajectory(result,corner,[[],[{lap:7,start:11.5,end:12}]]).reason,"gps");
  const split=driverTrajectory(result,corner,[[{lap:7,start:.4,end:.5}],[]]);
  assert.ok(split.ok);assert.equal(split.course.length,2);
  assert.equal(driverTrajectory({...result,registration:null},corner,[[],[]]).reason,"registration");
  assert.equal(driverTrajectory(result,{...corner},[[],[]]).reason,"pair");
  result.sessions.b.track=result.sessions.b.track.filter(p=>p.session_time_s<11.4 || p.session_time_s>11.8);
  assert.equal(driverTrajectory(result,corner,[[],[]]).reason,"coverage");
});
test("S2 replay uses only approved clips, independent clocks and shared spatial gates",()=>{
  const before=JSON.stringify(data),result=publishedGhost(data);assert.ok(result.ok);
  const m=result.model;
  assert.deepEqual(m.runs.map(r=>r.clip.url),["/demo/video/sector-2-lap-4.mp4","/demo/video/sector-2-lap-5.mp4"]);
  assert.equal(m.gates.length,16);assert.equal(m.gain.toFixed(3),"0.061");assert.equal(m.net.toFixed(3),"0.055");
  assert.equal(m.exitAngle.toFixed(1),"2.2");assert.equal(m.course.flat().length,817);
  assert.deepEqual(m.thirds.map(p=>[p.gate,p.gain.toFixed(3)]),[[5,"-0.002"],[10,"0.030"],[15,"0.033"]]);
  for(const [i,g] of m.gates.entries()){
    const {cars}=ghostFrame(m,"gate",i);
    assert.ok(Math.abs(cars[1].time-cars[0].time-g.gain)<1e-8);
    for(const [j,p] of cars.entries())assert.ok(p.clipTime===p.time+m.runs[j].videoOffset&&p.clipTime>=0&&p.clipTime<=5);
  }
  const {cars}=ghostFrame(m,"time",4.43);assert.ok(cars[0].finished&&!cars[1].finished);
  assert.equal(JSON.stringify(data),before);
});
test("S2 fails closed on flagged laps, missing coverage, or non-approved media",()=>{
  let d=structuredClone(data);d.evidence.sections[1].gps_flagged_laps=[4];assert.equal(publishedGhost(d).reason,"gps");
  d=structuredClone(data);const clip=d.review.clips.find(c=>c.lap===4&&c.sector_id==="sector_2");clip.url="/elsewhere.mp4";assert.equal(publishedGhost(d).reason,"media");
  d=structuredClone(data);d.analysis.top_laps_comparison.aligned=d.analysis.top_laps_comparison.aligned.filter(p=>p.lap_4_session_time_s<163||p.lap_4_session_time_s>164);assert.equal(publishedGhost(d).reason,"coverage");
  d=structuredClone(data);d.review.clips.push({...clip,lap:5,gps_warning:true,telemetry_start_s:208});assert.equal(publishedGhost(d).model.net,null);
});
test("public map and S2 entry render without private diagnostics, projections or writes",()=>{
  assert.match(render(3),/武汉全图 · S2 双圈叠影/);
  assert.doesNotMatch(render(4),/武汉全图 · S2 双圈叠影/);
  const html=renderToStaticMarkup(createElement(I18nProvider,{initialLocale:"zh"},createElement(PublishedGhostReview,{data})));
  assert.match(html,/published-s2-ghost/);assert.match(html,/159\.55s ±0\.5s/);
  assert.match(html,/sector-2-lap-4\.mp4/);assert.match(html,/sector-2-lap-5\.mp4/);
  assert.doesNotMatch(html,/__local|projection|\/qa\/|\/experiments\/|GH010681|type="file"/i);
});
