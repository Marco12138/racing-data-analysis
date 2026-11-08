"use client";

import { Pause, Play, Route } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { replayFrame, trajectoryAt, type Trajectory } from "../lib/cornerTrajectory";
import { blendCamera,fitCamera,screenPoint,PLOT_WIDTH,PLOT_HEIGHT } from "../lib/trajectoryCamera";
import { sampleTrajectoryVideo,type ClipPair,type SceneCheck } from "../lib/trajectoryVideo";
import { KartMarker } from "./KartMarker";
import { GpsTrackSurface } from "./GpsTrackSurface";
import { useTrajectoryChartCursor } from "./TrajectoryChartCursor";
import { useI18n } from "../lib/i18n";

const colors = ["#35d6d0", "#f6c945"];
export function CornerTrajectoryOverlay({ model, clips }: { model: Trajectory; clips?:ClipPair }) {
  const { locale } = useI18n(), zh = locale === "zh";
  const errors = {
    gps: zh ? "本区段 GPS 异常或来源未确认，不绘制双圈走线。" : "GPS warning or unverified source; trajectories withheld.",
    pair: zh ? "没有两条可对照的真实走线。" : "No comparable pair of real laps.",
    registration: zh ? "两圈没有通过同一坐标系的配准，不叠加走线。" : "No accepted common coordinate frame; trajectories withheld.",
    coverage: zh ? "缺少从入口到出口的连续 GPS 坐标，不跨缺口连线。" : "Continuous GPS positions do not cover both gates; gaps are not bridged.",
  };
  return <section className="min-w-0 space-y-2 border-t border-slate-700 pt-3" data-testid="corner-trajectory">
    <h5 className="flex items-center gap-2 text-sm font-semibold"><Route size={16} className="text-cyan-300"/>{zh ? "弯道轨迹叠影" : "Corner trajectory overlay"}</h5>
    {model.ok ? <TracePlot key={model.runs.map(r => r.label + ":" + r.points[0].local_x_m + ":" + r.duration).join("|")} model={model} zh={zh} clips={clips}/>
      : <p className="text-sm text-amber-200" role="status">{errors[model.reason]}</p>}
  </section>;
}
type Ready = Extract<Trajectory, {ok:true}>;
function TracePlot({model, zh, clips}: {model:Ready; zh:boolean; clips?:ClipPair}) {
  const [timeMode,setTimeMode] = useState(!model.gates.length), [cursor,setCursor] = useState(0), [playing,setPlaying] = useState(false);
  const [whole,setWhole] = useState(false);
  const map = useMemo(() => {
    const runPoints = model.runs.flatMap(r => r.points);
    const line = (points: typeof runPoints) => points.map(p => p.local_x_m.toFixed(3)+","+p.local_y_m.toFixed(3)).join(" ");
    return {local:fitCamera(runPoints),full:fitCamera(runPoints.concat(model.course.flat()),true),paths:model.runs.map(r=>line(r.points)),course:model.course.map(line)};
  },[model]);
  const [camera,setCamera]=useState(map.local), lastCamera=useRef(map.local);
  useEffect(()=>{
    const from=lastCamera.current, to=whole?map.full:map.local, begin=performance.now();
    const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf=requestAnimationFrame(function tick(now){
      const u=reduced || from===to ? 1 : Math.min(1,(now-begin)/420);
      lastCamera.current=u===1 ? to : blendCamera(from,to,u);
      setCamera(lastCamera.current);
      if(u<1)raf=requestAnimationFrame(tick);
    });
    return ()=>cancelAnimationFrame(raf);
  },[map,whole]);
  const [visual,setVisual]=useState<{model:Ready; clips:ClipPair; checks:SceneCheck[]|null}>();
  useEffect(()=>{
    if(!clips)return;
    const c=new AbortController();
    void sampleTrajectoryVideo(model,clips,c.signal).then(checks=>{if(!c.signal.aborted)setVisual({model,clips,checks});})
      .catch(()=>{if(!c.signal.aborted)setVisual({model,clips,checks:null});});
    return ()=>c.abort();
  },[model,clips]);
  const checks=visual?.model===model && visual.clips===clips ? visual.checks : undefined;
  const duration = Math.max(...model.runs.map(r=>r.duration));
  const max = timeMode ? duration : model.gates.length - 1;
  const playbackStart = useRef(0);
  useEffect(() => {
    if (!playing) return;
    const began = performance.now(), initial = playbackStart.current;
    let frame = 0, previous = -Infinity;
    const tick = (now:number) => {
      const next = Math.min(duration, initial + (now-began)/1000);
      if(now-previous>=50 || next===duration){setCursor(next);previous=now;}
      if (next < duration) frame = requestAnimationFrame(tick); else setPlaying(false);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  },[playing,duration]);
  const gate = !timeMode && model.gates[Math.min(max, Math.round(cursor))];
  const {cars,gap,lastGate} = replayFrame(model,timeMode?"time":"gate",cursor);
  useTrajectoryChartCursor(cars[0].chartX,cars[1].chartX);
  const project=(p:typeof cars[0]|Ready["runs"][0]["points"][0])=>screenPoint(camera,p);
  const endpoints = [model.runs[0].points[0], model.runs[0].points.at(-1)!].map(project);
  const ruler=camera.scale*5<18?25:5;
  const fmt=(n:number|null|undefined,d:number)=>typeof n==="number" && Number.isFinite(n)?n.toFixed(d):"—";
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
    <svg className="block h-auto w-full bg-[#151d20]" role="img" aria-label={zh ? "共同坐标系内两条 GPS 走线" : "Two GPS traces in one coordinate frame"} viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}>
      <g transform={`translate(${PLOT_WIDTH/2} ${PLOT_HEIGHT/2}) rotate(${camera.angle}) scale(${camera.scale} ${-camera.scale}) translate(${-camera.x} ${-camera.y})`}>
        <GpsTrackSurface segments={map.course}/>
        {map.paths.map((path,i)=><polyline key={i} points={path} fill="none" stroke={colors[i]} strokeWidth="2.6" strokeDasharray={i ? "6 3" : undefined} vectorEffect="non-scaling-stroke"/>)}
      </g>
      {checks?.filter(s=>s.supported && s.visualB!==null).map(s=>{
        const a=project(trajectoryAt(model.runs[0].points,s.a)!),b=project(trajectoryAt(model.runs[1].points,s.visualB!)!);
        return <g key={s.a} fill="none" strokeWidth="1"><title>{zh?"视频参照物相符的 GPS 候选位置（±0.5s）":"GPS candidates supported by video landmarks (±0.5s)"}</title>
          <circle cx={a.x} cy={a.y} r="3.5" stroke={colors[0]}/><circle cx={b.x} cy={b.y} r="4.5" stroke={colors[1]} strokeDasharray="3 2"/></g>;})}
      {endpoints.map((p,i)=><text key={i} x={p.x} y={p.y+(i?18:-11)} textAnchor="middle" fontSize="13" fill="#e2e8f0">{i?(zh?"出口":"Exit"):(zh?"入口":"Entry")}</text>)}
      {cars.map((car,i)=><KartMarker key={i} {...project(car)} heading={car.heading===null?null:car.heading+camera.angle} color={colors[i]} outline={i===1} size={(i?1.24:.97)*Math.min(1,Math.max(.55,camera.scale/map.local.scale))}/>)}
      <g transform={`translate(12 ${PLOT_HEIGHT-15})`}><path d={`M0 -4 v4 h${camera.scale*ruler} v-4`} stroke="#cbd5e1" fill="none"/><text y="-7" fontSize="12" fill="#cbd5e1">{ruler} m</text></g>
    </svg>
    <p className="text-xs text-slate-400">{zh ? `灰色路面沿 ${model.courseLabel} 的 GPS 走线绘制。8 米宽度为示意，不是实测路缘。`
      : `The grey surface follows the GPS line of ${model.courseLabel}. Its 8 m width is illustrative, not a surveyed track boundary.`}</p>
    <input className="block w-full accent-cyan-400" type="range" aria-label={zh ? "轨迹位置" : "Trajectory position"} min={0} max={max} step={timeMode ? .01 : 1} value={Math.min(max,cursor)} onChange={e=>{setPlaying(false);setCursor(Number(e.target.value));}}/>
    <table className="w-full text-left text-xs tabular-nums" data-testid="trajectory-readout"><thead className="text-slate-400"><tr>
      {[zh?"单圈":"Lap",zh?"距入口用时":"Elapsed","AiM km/h","AiM RPM"].map(s=><th key={s} className="py-1">{s}</th>)}</tr></thead>
      <tbody>{cars.map((car,i)=><tr key={model.runs[i].label} className="border-t border-slate-800"><th className="py-1" style={{color:colors[i]}}>{model.runs[i].label}</th>
        <td>{fmt(car.time,3)}s</td><td>{fmt(car.speed,1)}</td><td>{fmt(car.rpm,0)}</td></tr>)}</tbody></table>
    {gap!==null && <p className="text-xs">{zh?(gate?"此处时间差":lastGate?"最近共同门时间差":"出口时间差"):(gate?"Gap here":lastGate?"Last shared gate gap":"Exit gap")} · {Math.abs(gap)<.0005 ? (zh?"持平":"Level") : `${model.runs[gap<0?1:0].label} ${zh?"领先":"ahead by"} ${fmt(Math.abs(gap),3)}s`}</p>}
    {clips && <p className="text-xs text-slate-400" data-testid="trajectory-scenes">{zh?"视频参照物核对":"Video landmark check"}: {checks===undefined?(zh?"采样中":"Sampling"):checks===null?(zh?"不可用 · 仅 GPS":"Unavailable · GPS only"):`${checks.filter(s=>s.supported).length}/${checks.length} ${zh?"处画面相符":"matching scenes"}`}</p>}
    <p className="text-xs text-slate-400">{zh ? "车形示意 GPS 行进方向，不是实测车身朝向。视频参照物只辅助核对位置，不修正走线或人工锚点。" : "Kart symbols follow GPS travel direction, not measured body heading. Landmarks only check locations; they do not move paths or manual anchors."}</p>
  </>;
}
