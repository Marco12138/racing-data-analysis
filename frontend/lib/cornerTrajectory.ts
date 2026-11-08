import type { CornerCoachComparison } from "./cornerCoach";
import type { DriverCorner, DualDriverResult } from "./dualDriverReview";
import type { CornerLap } from "./selectedCorner";
import type { XrkAnalysis } from "./xrkAnalysisApi";

type Channels = { speed?: number | null; rpm?: number | null; distance_m?: number | null };
type Raw = Channels & { session_time_s: number | null; local_x_m: number | null; local_y_m: number | null };
type Point = Channels & { time: number; local_x_m: number; local_y_m: number };
export type GPSWindow = { start: number; end: number; lap: number };
type Run = { label: string; points: Point[]; duration: number };
type Gate = { distance: number; a: number; b: number };
export type Trajectory = { ok: false; reason: "gps" | "registration" | "coverage" | "pair" }
  | { ok: true; runs: [Run, Run]; gates: Gate[]; course: Point[][]; courseLabel: string };
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const mix = (a: unknown,b: unknown,u: number) => finite(a) && finite(b) ? a+(b-a)*u : null;
export const TRAJECTORY_MAX_GAP_S = .25;
export function acceptedShift(reg?: CornerLap["registration"] | null) {
  const shift = reg?.translation_m;
  return reg?.status === "accepted" && shift?.length === 2 && shift.every(finite) ? shift : null;
}
export function trajectoryAt(points: Point[], time: number): Point | null {
  const i = points.findIndex(p => p.time >= time), b = points[i], a = points[i - 1];
  if (!b) return null;
  if (b.time === time) return b;
  if (!a || b.time - a.time > TRAJECTORY_MAX_GAP_S || b.time <= a.time) return null;
  const u = (time - a.time) / (b.time - a.time);
  return { time, local_x_m: a.local_x_m + u * (b.local_x_m - a.local_x_m), local_y_m: a.local_y_m + u * (b.local_y_m - a.local_y_m),
    speed:mix(a.speed,b.speed,u), rpm:mix(a.rpm,b.rpm,u), distance_m:mix(a.distance_m,b.distance_m,u) };
}
// Match crossings in one continuous GPS segment. Missing coordinates split the
// segment even when the missing sample would otherwise fit inside the time limit.
function continuousPath(raw: Raw[], shift: number[], flags: GPSWindow[]): Point[][] {
  const segments: Point[][] = [];
  let segment: Point[] = [];
  const finish = () => { if (segment.length >= 2) segments.push(segment); segment = []; };
  let lastTime: number | null = null;
  for (const row of raw) {
    const { session_time_s: t, local_x_m: x, local_y_m: y } = row;
    if (!finite(t)) { finish(); continue; }
    if (lastTime !== null && t <= lastTime) return [];
    const crossesWarning = flags.some(f => f.start <= t && f.end >= (lastTime ?? t));
    lastTime = t;
    if (!finite(x) || !finite(y) || flags.some(f => f.start <= t && f.end >= t)) { finish(); continue; }
    if (crossesWarning || (segment.length && t - segment.at(-1)!.time > TRAJECTORY_MAX_GAP_S)) finish();
    segment.push({time: t, local_x_m: x + shift[0], local_y_m: y + shift[1], speed:row.speed, rpm:row.rpm, distance_m:row.distance_m});
  }
  finish();
  return segments;
}
function windowRun(segments: Point[][], start: number, end: number, label: string): Run | null {
  if (!finite(start) || !finite(end) || end <= start) return null;
  const segment = segments.find(s => s[0].time <= start && s.at(-1)!.time >= end);
  if (!segment) return null;
  const a = trajectoryAt(segment,start), b = trajectoryAt(segment,end);
  return a && b ? { label, duration: end-start, points: [a,...segment.filter(p=>p.time>start && p.time<end),b].map(p=>({...p,time:p.time-start})) } : null;
}
function lapTrace(analysis: XrkAnalysis, lap: number): Raw[] {
  const prefix = `lap_${lap}_`, aligned = analysis.top_laps_comparison.aligned;
  if (aligned.some(r => finite(r[prefix + "session_time_s"]))) return aligned.map(r => ({
    session_time_s: r[prefix + "session_time_s"], local_x_m: r[prefix + "local_x_m"], local_y_m: r[prefix + "local_y_m"],
    speed:r[prefix+"speed"], rpm:r[prefix+"rpm"], distance_m:r.distance_m,
  }));
  const track = analysis.track;
  return !track ? [] : track.reference_lap === lap ? track.reference : track.target_lap === lap ? track.target : [];
}
export function coachTrajectory(analysis: XrkAnalysis, pair: CornerCoachComparison, flags: GPSWindow[] = []): Trajectory {
  if (pair.status !== "available") return {ok: false, reason: "pair"};
  if (!analysis.capabilities.gps || analysis.channel_provenance?.speed?.source !== "gps_receiver") return {ok: false, reason: "gps"};
  const runs: Run[] = [];
  let course: Point[][] = [];
  for (const row of [pair.section, pair.overall]) {
    const start = row.start_session_s, end = row.end_session_s;
    if (!finite(start) || !finite(end)) return {ok: false, reason: "coverage"};
    if (flags.some(f => f.lap === row.lap && f.start <= end && f.end >= start)) return {ok: false, reason: "gps"};
    const shift = acceptedShift(row.registration);
    if (!shift) return {ok: false, reason: "registration"};
    const segments = continuousPath(lapTrace(analysis,row.lap),shift,flags.filter(f=>f.lap===row.lap));
    const run = windowRun(segments, start, end, `L${row.lap}`);
    if (!run) return {ok: false, reason: "coverage"};
    runs.push(run);
    if (row === pair.overall) course = segments;
  }
  const gates = pair.samples.map(s => ({ distance: s.distance_m, a: s.section_time - pair.section.start_session_s!, b: s.overall_time - pair.overall.start_session_s! }));
  if (gates.some((g,i) => !trajectoryAt(runs[0].points,g.a) || !trajectoryAt(runs[1].points,g.b)
    || (i > 0 && (g.a <= gates[i-1].a || g.b <= gates[i-1].b)))) return {ok: false, reason: "coverage"};
  return {ok: true, runs: [runs[0], runs[1]], gates, course, courseLabel:runs[1].label};
}
export function driverTrajectory(result: DualDriverResult, corner: DriverCorner, flags: [GPSWindow[], GPSWindow[]]): Trajectory {
  if (!result.corners.includes(corner) || corner.status !== "candidate" || !corner.a || !corner.b) return {ok: false, reason: "pair"};
  const shift = acceptedShift(result.registration);
  if (!shift) return {ok: false, reason: "registration"};
  const runs: Run[] = [];
  let course: Point[][] = [];
  for (const key of ["a", "b"] as const) {
    const s = result.sessions[key], obs = corner[key]!;
    if (s.channel_provenance.speed?.source !== "gps_receiver") return {ok: false, reason: "gps"};
    const warnings = flags[key==="a"?0:1].filter(f=>f.lap===s.selected_lap);
    if (warnings.some(f=>f.start<=obs.end_session_s && f.end>=obs.start_session_s)) return {ok:false,reason:"gps"};
    const segments=continuousPath(s.track,key==="a"?[0,0]:shift,warnings);
    const run = windowRun(segments, obs.start_session_s, obs.end_session_s, `${key.toUpperCase()} · L${s.selected_lap}`);
    if (!run) return {ok: false, reason: "coverage"};
    runs.push(run);
    if(key==="a")course=segments;
  }
  // Two-driver review has verified entrance/exit gates, not shared interior gates.
  return {ok: true, runs: [runs[0], runs[1]], gates: [], course, courseLabel:runs[0].label};
}

export type ReadyTrajectory = Extract<Trajectory,{ok:true}>;
/** Each car uses its own elapsed clock. Only compare time at gates both cars reached. */
export function replayFrame(model: ReadyTrajectory, mode: "time"|"gate", cursor: number) {
  const gates = model.gates;
  const selected = mode==="gate" && gates.length ? gates[Math.min(gates.length-1,Math.max(0,Math.round(cursor)))] : null;
  const cars = model.runs.map((run,i) => {
    const t = selected ? (i ? selected.b : selected.a) : Math.min(run.duration,Math.max(0,cursor));
    const p = trajectoryAt(run.points,t)!;
    const before = trajectoryAt(run.points,Math.max(0,t-.12))!, after = trajectoryAt(run.points,Math.min(run.duration,t+.12))!;
    const dx=after.local_x_m-before.local_x_m, dy=after.local_y_m-before.local_y_m;
    const heading = Math.hypot(dx,dy)>=.3 ? Math.atan2(-dy,dx)*180/Math.PI : null;
    const clock = i ? "b" : "a";
    const hi=gates.findIndex(g=>g[clock]>=t), g=gates[hi], prev=gates[hi-1];
    const distance = selected ? selected.distance : g?.[clock]===t ? g.distance : prev && g
      ? mix(prev.distance,g.distance,(t-prev[clock])/(g[clock]-prev[clock])) : null;
    const first=run.points[0].distance_m,last=run.points.at(-1)!.distance_m;
    const progress = finite(p.distance_m)&&finite(first)&&finite(last)&&last>first ? 100*(p.distance_m-first)/(last-first) : null;
    return {...p,heading,chartX:gates.length ? distance : progress,finished:t===run.duration};
  });
  const lastGate = selected ?? gates.findLast(g=>g.a<=cars[0].time && g.b<=cars[1].time);
  const gap = lastGate ? lastGate.b-lastGate.a : cars.every(c=>c.finished) ? model.runs[1].duration-model.runs[0].duration : null;
  return {cars,gap,lastGate};
}
