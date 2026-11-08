import { readTrajectoryFrames, type LandmarkFrame } from "./landmarkVideo";
import { BOUNDARY_RECTS } from "./reviewBoundaryVisual";
import { grayscalePatch, matchLandmarkFrame, type TrackLandmark } from "./trackLandmarks";
import type { ReadyTrajectory } from "./cornerTrajectory";

export type ClipPair = readonly [{ url:string; start:number }, { url:string; start:number }];
export type SceneCheck = { a:number; b:number; supported:boolean; visualB:number|null };
export function samplePlan(model:ReadyTrajectory) {
  const gs=model.gates;
  return gs.length ? [gs[0],gs[Math.floor(gs.length/2)],gs.at(-1)!].map(g=>({a:g.a,b:g.b}))
    : [{a:0,b:0},{a:model.runs[0].duration,b:model.runs[1].duration}];
}
// Both roadside regions must match the expected gate better than a different gate.
// This tests scene agreement, never camera pose, steering, or a revised time offset.
export function sceneCandidate(a:LandmarkFrame,target:LandmarkFrame[],expected:number) {
  const matches=BOUNDARY_RECTS.map(rect=>{
    const template={rect,patch:grayscalePatch(a.rgba,a.width,a.height,rect)} as TrackLandmark;
    const scores=target.map(b=>matchLandmarkFrame(template,b.rgba,b.width,b.height)?.score??null);
    const neighbors=target.flatMap((f,i)=>Math.abs(f.time-expected)<=.500001 && scores[i]!==null ? [{t:f.time,s:scores[i]!}] : []);
    const best=neighbors.sort((l,r)=>r.s-l.s || Math.abs(l.t-expected)-Math.abs(r.t-expected))[0];
    const rivals=scores.filter((s,i):s is number=>s!==null && Math.abs(target[i].time-expected)>1);
    return best && best.s>=.72 && rivals.length && best.s-Math.max(...rivals)>=.06 ? best.t : null;
  });
  const [left,right]=matches;
  return left!==null && right!==null && Math.abs(left-right)<=.25
    ? (Math.abs(left-expected)<=Math.abs(right-expected)?left:right) : null;
}
export async function sampleTrajectoryVideo(model:ReadyTrajectory,clips:ClipPair,signal:AbortSignal):Promise<SceneCheck[]> {
  const plan=samplePlan(model);
  const reference=await readTrajectoryFrames(clips[0].url,plan.map(g=>clips[0].start+g.a),signal);
  const localTimes=[...new Set(plan.flatMap(g=>[-.5,-.25,0,.25,.5].map(d=>Math.min(model.runs[1].duration,Math.max(0,g.b+d)))))].sort((a,b)=>a-b);
  const target=await readTrajectoryFrames(clips[1].url,localTimes.map(t=>clips[1].start+t),signal);
  return plan.map((g,i)=>{
    signal.throwIfAborted();
    const candidate=sceneCandidate(reference[i],target,clips[1].start+g.b);
    return {...g,supported:candidate!==null,visualB:candidate===null ? null : Math.max(0,Math.min(model.runs[1].duration,candidate-clips[1].start))};
  });
}
