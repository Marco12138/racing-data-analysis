"use client";

import { Pause, Play, Route } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { trajectoryAt, type Trajectory } from "../lib/cornerTrajectory";
import { createTrackProjection } from "../lib/driverComparison";
import { useI18n } from "../lib/i18n";

const colors = ["#35d6d0", "#f6c945"];
export function CornerTrajectoryOverlay({ model }: { model: Trajectory }) {
  const { locale } = useI18n(), zh = locale === "zh";
  const errors = {
    gps: zh ? "本区段 GPS 异常或来源未确认，不绘制双圈走线。" : "GPS warning or unverified source; trajectories withheld.",
    pair: zh ? "没有两条可对照的真实走线。" : "No comparable pair of real laps.",
    registration: zh ? "两圈没有通过同一坐标系的配准，不叠加走线。" : "No accepted common coordinate frame; trajectories withheld.",
    coverage: zh ? "缺少从入口到出口的连续 GPS 坐标，不跨缺口连线。" : "Continuous GPS positions do not cover both gates; gaps are not bridged.",
  };
  return <section className="min-w-0 space-y-2 border-t border-slate-700 pt-3" data-testid="corner-trajectory">
    <h5 className="flex items-center gap-2 text-sm font-semibold"><Route size={16} className="text-cyan-300"/>{zh ? "弯道轨迹叠影" : "Corner trajectory overlay"}</h5>
    {model.ok ? <TracePlot key={model.runs.map(r => r.label + ":" + r.points[0].local_x_m + ":" + r.duration).join("|")} model={model} zh={zh}/>
      : <p className="text-sm text-amber-200" role="status">{errors[model.reason]}</p>}
  </section>;
}
type Ready = Extract<Trajectory, {ok:true}>;
function TracePlot({model, zh}: {model:Ready; zh:boolean}) {
  const [timeMode,setTimeMode] = useState(!model.gates.length), [cursor,setCursor] = useState(0), [playing,setPlaying] = useState(false);
  const [whole,setWhole] = useState(false);
  const map = useMemo(() => {
    const runPoints = model.runs.flatMap(r => r.points);
    const projection = createTrackProjection(whole ? runPoints.concat(model.course.flat()) : runPoints,600,234,36)!;
    const line = (points: typeof runPoints) => points.map(p => { const q=projection.project(p); return q.x.toFixed(2)+","+q.y.toFixed(2); }).join(" ");
    return {...projection, paths:model.runs.map(r=>line(r.points)), course:model.course.map(line)};
  },[model,whole]);
  const duration = Math.max(...model.runs.map(r=>r.duration));
  const max = timeMode ? duration : model.gates.length - 1;
  const playbackStart = useRef(0);
  useEffect(() => {
    if (!playing) return;
    const began = performance.now(), initial = playbackStart.current;
    let frame = 0;
    const tick = (now:number) => {
      const next = Math.min(duration, initial + (now-began)/1000);
      setCursor(next);
      if (next < duration) frame = requestAnimationFrame(tick); else setPlaying(false);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  },[playing,duration]);
  const gate = !timeMode && model.gates[Math.min(max, Math.round(cursor))];
  const times = model.runs.map((r,i)=>gate ? (i ? gate.b : gate.a) : Math.min(cursor,r.duration));
  const markers = model.runs.map((r,i)=>map.project(trajectoryAt(r.points,times[i])!));
  const endpoints = [model.runs[0].points[0], model.runs[0].points.at(-1)!].map(map.project);
  const btn = "inline-flex min-h-9 items-center gap-1 rounded border border-slate-600 px-2 text-xs aria-pressed:border-cyan-400 aria-pressed:text-cyan-200";
  function mode(time:boolean) {setPlaying(false);setTimeMode(time);setCursor(0);}
  return <>
    <div className="flex flex-wrap items-center gap-2">
      <button className={btn} aria-pressed={!whole} onClick={()=>setWhole(false)}>{zh?"本弯":"Corner"}</button>
      <button className={btn} aria-pressed={whole} onClick={()=>setWhole(true)}>{zh?"赛道全图":"Full circuit"}</button>
      {model.gates.length > 0 && <button className={btn} aria-pressed={!timeMode} onClick={()=>mode(false)}>{zh ? "同一位置" : "Same gate"}</button>}
      <button className={btn} aria-pressed={timeMode} onClick={()=>mode(true)}>{zh ? "同一用时" : "Same elapsed time"}</button>
      <button className={btn} aria-label={playing ? (zh?"暂停轨迹":"Pause trajectories") : (zh?"播放轨迹":"Play trajectories")} onClick={()=>{
        if(playing){setPlaying(false);return;}
        playbackStart.current = timeMode && cursor < duration ? cursor : 0;
        setCursor(playbackStart.current);setTimeMode(true);setPlaying(true);
      }}>{playing?<Pause size={15}/>:<Play size={15}/>}</button>
      <span className="text-xs text-slate-400">{gate ? `${zh?"距入口":"From entry"} ${gate.distance.toFixed(1)} m` : `${cursor.toFixed(2)} s`}</span>
    </div>
    <svg className="block aspect-[600/234] w-full bg-[#121c20]" role="img" aria-label={zh ? "共同坐标系内两条 GPS 走线" : "Two GPS traces in one coordinate frame"} viewBox="0 0 600 234">
      {map.course.map((p,i)=><polyline key={i} points={p} fill="none" stroke="#56676c" strokeWidth="5" strokeLinejoin="round"/>)}
      {map.paths.map((path,i)=><polyline key={i} points={path} fill="none" stroke={colors[i]} strokeWidth="2.6" strokeDasharray={i ? "6 3" : undefined}/>)}
      {endpoints.map((p,i)=><text key={i} x={p.x} y={p.y+(i?18:-11)} textAnchor="middle" fontSize="13" fill="#e2e8f0">{i?(zh?"出口":"Exit"):(zh?"入口":"Entry")}</text>)}
      {markers.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={i?8:4} strokeWidth="2" stroke={colors[i]} fill={i?"none":colors[i]}/>)}
      <path d={`M12 219 v4 h${map.scale*5} v-4`} stroke="#cbd5e1" fill="none"/><text x="12" y="216" fontSize="12" fill="#cbd5e1">5 m</text>
    </svg>
    <input className="block w-full accent-cyan-400" type="range" aria-label={zh ? "轨迹位置" : "Trajectory position"} min={0} max={max} step={timeMode ? .01 : 1} value={Math.min(max,cursor)} onChange={e=>{setPlaying(false);setCursor(Number(e.target.value));}}/>
    <div className="flex flex-wrap gap-x-5 font-mono text-xs">{model.runs.map((r,i)=><span key={r.label} style={{color:colors[i]}}>{r.label} · {times[i].toFixed(3)}s</span>)}
      {gate && <span>{zh?"此处时间差":"Gap at gate"} {(gate.b-gate.a).toFixed(3)}s</span>}</div>
    <p className="text-xs text-slate-400">{zh ? "同一入口和出口，按各圈实际过点时间绘制。走线表示 GPS 行进路径，不代表车身朝向或实测路缘。" : "Same entry and exit, each lap on its own clock. GPS shows its path, not body heading or surveyed track edges."}</p>
  </>;
}
