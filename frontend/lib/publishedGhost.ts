import type { PublishedCoachData } from "./publishedCoach";
import type { PublishedVideoReview } from "./publishedVideoReview";
import { compareCornerBest } from "./cornerCoach";
import { acceptedShift, TRAJECTORY_MAX_GAP_S } from "./cornerTrajectory";

export type XY = { x: number; z: number };
type Point = XY & { time: number; speed: number; rpm: number };
type Run = { lap: number; trace: Point[]; duration: number; videoOffset: number; clip: PublishedVideoReview["clips"][number] };
export type Ghost = { runs: [Run, Run]; course: XY[][]; gates: { distance: number; times: [number, number]; gain: number }[];
  duration: number; gain: number; net: number | null; exitAngle: number | null; thirds:{gate:number;gain:number}[] };
type Result = { ok: true; model: Ghost } | { ok: false; reason: "pair" | "gps" | "coverage" | "media" };
const GAP = TRAJECTORY_MAX_GAP_S, finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function sampleAt(points: Point[], time: number): Point | null {
  const i=points.findIndex(p=>p.time>=time);
  if(i<0) return null;
  const b=points[i]; if(b.time===time) return b;
  const a=points[i-1]; if(!a || b.time-a.time>GAP) return null;
  const u=(time-a.time)/(b.time-a.time), mix=(a:number,b:number)=>a+(b-a)*u;
  return {time,x:mix(a.x,b.x),z:mix(a.z,b.z),speed:mix(a.speed,b.speed),rpm:mix(a.rpm,b.rpm)};
}
function series(data:PublishedCoachData,lap:number):Point[] {
  const prefix="lap_"+lap+"_";
  return data.analysis.top_laps_comparison.aligned.flatMap(r=>{
    const [time,x,y,speed,rpm]=["session_time_s","local_x_m","local_y_m","speed","rpm"].map(k=>r[prefix+k]);
    return finite(time)&&finite(x)&&finite(y)&&finite(speed)&&finite(rpm)?[{time,x,z:-y,speed,rpm}]:[];
  });
}
const warnings=(data:PublishedCoachData,lap:number)=>data.review.clips.filter(c=>c.lap===lap&&c.gps_warning);
const flagged=(clips:PublishedVideoReview["clips"],a:number,b:number)=>clips.some(c=>c.telemetry_start_s<=b && c.telemetry_start_s+c.duration_s>=a);
export function publishedGhost(data:PublishedCoachData):Result {
  const section=data.evidence.sections.find(s=>s.id==="sector_2");
  if(!section || data.analysis.reference_lap!==5 || data.review.anchor_uncertainty_s!==.5 || data.review.whole_recording_verified!==false) return {ok:false,reason:"pair"};
  if(section.gps_flagged_laps.some(l=>l===4||l===5))return {ok:false,reason:"gps"};
  const pair=compareCornerBest(section.result.laps,section.gps_flagged_laps);
  if(pair.status!=="available")return {ok:false,reason:section.gps_flagged_laps.some(l=>l===4||l===5)?"gps":"pair"};
  if(pair.section.lap!==4 || pair.overall.lap!==5) return {ok:false,reason:"pair"};
  const runs:Run[]=[],course:XY[][]=[];
  let downstreamOK=true;
  for(const row of [pair.section,pair.overall]) {
    const start=row.start_session_s,end=row.end_session_s;
    if(!finite(start)||!finite(end)||end<=start)return {ok:false,reason:"coverage"};
    const shift=acceptedShift(row.registration);
    if(!shift)return {ok:false,reason:"coverage"};
    const raw=series(data,row.lap).map(p=>({...p,x:p.x+shift[0],z:p.z-shift[1]})), flags=warnings(data,row.lap);
    if(flagged(flags,start,end))return {ok:false,reason:"gps"};
    if(!finite(row.downstream_s)||flagged(flags,end,end+row.downstream_s))downstreamOK=false;
    if(raw.some((p,i)=>i>0&&p.time<=raw[i-1].time))return {ok:false,reason:"coverage"};
    const begin=sampleAt(raw,start),last=sampleAt(raw,end);
    if(!begin||!last)return {ok:false,reason:"coverage"};
    const trace=[begin,...raw.filter(p=>p.time>start&&p.time<end),last].map(p=>({...p,time:p.time-start}));
    if(trace.some((p,i)=>i>0&&p.time-trace[i-1].time>GAP))return {ok:false,reason:"coverage"};
    const clip=data.review.clips.find(c=>c.sector_id===section.id&&c.lap===row.lap);
    if(!clip || clip.url!=="/demo/video/sector-2-lap-"+row.lap+".mp4" || !finite(clip.telemetry_start_s) ||
       start<clip.telemetry_start_s || end>clip.telemetry_start_s+clip.duration_s)return {ok:false,reason:"media"};
    runs.push({lap:row.lap,trace,duration:end-start,videoOffset:start-clip.telemetry_start_s,clip});
    if(row.lap===data.analysis.reference_lap) {
      let segment:XY[]=[];
      for(const [i,p] of raw.entries()){
        if(i && (p.time-raw[i-1].time>GAP || flagged(flags,raw[i-1].time,p.time))){
          if(segment.length>1)course.push(segment); segment=[];
        }
        if(!flagged(flags,p.time,p.time))segment.push({x:p.x,z:p.z});
      }
      if(segment.length>1)course.push(segment);
    }
  }
  if(!course.length)return {ok:false,reason:"coverage"};
  const gates=pair.samples.map(s=>({distance:s.distance_m,gain:s.gain_s,
    times:[s.section_time-pair.section.start_session_s!,s.overall_time-pair.overall.start_session_s!] as [number,number]}));
  const dirs=runs.map((r,i)=>{
    const a=sampleAt(r.trace,gates.at(-2)!.times[i]),b=r.trace.at(-1)!;
    return a && Math.hypot(b.x-a.x,b.z-a.z)>=1 ? Math.atan2(b.z-a.z,b.x-a.x):null;
  });
  const angle=dirs[0]!==null&&dirs[1]!==null?dirs[0]-dirs[1]:null;
  return {ok:true,model:{runs:[runs[0],runs[1]],course,gates,gain:pair.gain_s,net:downstreamOK?pair.combined_gain_s:null,
    thirds:pair.parts.map(p=>({gate:gates.findIndex(g=>Math.abs(g.distance-p.end_m)<1e-6),gain:p.gain_s})),
    exitAngle:angle===null?null:Math.abs(Math.atan2(Math.sin(angle),Math.cos(angle))*180/Math.PI),duration:Math.max(...runs.map(r=>r.duration))}};
}
export function ghostFrame(model:Ghost,mode:"time"|"gate",cursor:number) {
  const last=model.gates.at(-1)!;
  const gate=mode==="gate"?model.gates[Math.min(model.gates.length-1,Math.max(0,Math.round(cursor)))]:
    model.gates.findLast(g=>g.times.every(t=>t<=cursor+1e-8))??model.gates[0];
  const cars=model.runs.map((r,i)=>{
    const t=Math.max(0,Math.min(r.duration,mode==="gate"?gate.times[i]:cursor));
    const p=sampleAt(r.trace,t)!,a=sampleAt(r.trace,Math.max(0,t-.09))!,b=sampleAt(r.trace,Math.min(r.duration,t+.09))!;
    const heading=Math.hypot(b.z-a.z,b.x-a.x)>1e-5?Math.atan2(b.z-a.z,b.x-a.x)*180/Math.PI:null;
    return {...p,heading,clipTime:t+r.videoOffset,finished:t>=r.duration};
  });
  return {cars,gate,atExit:gate===last};
}
