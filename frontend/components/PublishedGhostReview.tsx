"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Flag, Layers, Map, Pause, Play, RotateCcw, Timer } from "lucide-react";
import { useI18n } from "../lib/i18n";
import type { PublishedCoachData } from "../lib/publishedCoach";
import { ghostFrame, publishedGhost, type Ghost } from "../lib/publishedGhost";
import { GhostMap, type Extent } from "./PublishedGhostMap";

const control="inline-flex min-h-10 items-center justify-center gap-1.5 rounded border px-2.5 text-sm";
const button=(active:boolean)=>control+(active?" border-cyan-400 bg-cyan-950 text-cyan-100":" border-slate-600 text-slate-200");
const signed=(v:number)=>(v>=0?"+":"−")+Math.abs(v).toFixed(3)+"s";

export function PublishedGhostReview({data}:{data:PublishedCoachData}){
  const {locale}=useI18n(),zh=locale==="zh", result=useMemo(()=>publishedGhost(data),[data]);
  if(!result.ok)return <p role="status" className="border-y border-amber-700 py-4 text-amber-200">{result.reason==="gps"?
    (zh?"GPS 异常：不生成本区段叠影。":"GPS warning: the section replay is withheld."):
    (zh?"公开样例缺少可验证的区段、轨迹或已审核短片，暂不生成叠影。":"Verified gates, GPS coverage or approved footage are unavailable. Replay withheld.")}</p>;
  return <Replay model={result.model} anchor={data.review.anchor_video_start_s} uncertainty={data.review.anchor_uncertainty_s} zh={zh}/>;
}
function Replay({model,anchor,uncertainty,zh}:{model:Ghost;anchor:number;uncertainty:number;zh:boolean}){
  const t=(cn:string,en:string)=>zh?cn:en, [mode,setMode]=useState<"time"|"gate">("gate");
  const [extent,setExtent]=useState<Extent>("track"),[cursor,setCursor]=useState(Math.round((model.gates.length-1)*2/3));
  const [playing,setPlaying]=useState(false),[rate,setRate]=useState(1),[mix,setMix]=useState(45),[split,setSplit]=useState(false),[audio,setAudio]=useState(-1);
  const videos=useRef<Array<HTMLVideoElement|null>>([]),clock=useRef({value:0,wall:0});
  const [failed,setFailed]=useState<[boolean,boolean]>([false,false]);
  const f=ghostFrame(model,mode,cursor);
  function stop(){setPlaying(false);videos.current.forEach(v=>v?.pause());}
  function freeze(i:number){stop();setMode("gate");setCursor(i);}
  function seek(value:number){stop();setCursor(value);}
  function markFailed(i:number){setFailed(prev=>prev[i]?prev:i?[prev[0],true]:[true,prev[1]]);}
  function race(restart:boolean){
    const start=restart||mode==="gate"||cursor>=model.duration?0:cursor;
    const entry=ghostFrame(model,"time",start);
    clock.current={value:start,wall:performance.now()};setCursor(start);setMode("time");setPlaying(true);
    videos.current.forEach((v,i)=>{if(!v||failed[i]||entry.cars[i].finished)return;
      v.currentTime=entry.cars[i].clipTime;v.playbackRate=rate;
      void v.play().catch(e=>{if(e.name!=="AbortError")markFailed(i);});});
  }
  useEffect(()=>{
    if(!playing)return;
    let raf=0;
    const tick=(now:number)=>{const c=clock.current,value=Math.min(model.duration,c.value+(now-c.wall)*rate/1000);
      setCursor(value);if(value>=model.duration){setPlaying(false);return;}raf=requestAnimationFrame(tick);};
    raf=requestAnimationFrame(tick);return ()=>cancelAnimationFrame(raf);
  },[playing,rate,model.duration]);
  function sync(i:number){
    const v=videos.current[i],p=f.cars[i];if(!v||v.readyState===0||failed[i])return;
    const running=playing&&!p.finished;
    if(!running&&!v.paused)v.pause();
    if(Math.abs(v.currentTime-p.clipTime)>(running?.12:.008) && (!running||!v.seeking))v.currentTime=p.clipTime;
    v.playbackRate=rate;
  }
  // Both media clocks are mapped independently. No stretching or offset writes.
  useEffect(()=>{sync(0);sync(1);});
  useEffect(()=>{
    const elems=videos.current.slice();
    const hidden=()=>{if(document.hidden){setPlaying(false);elems.forEach(v=>v?.pause());}};
    document.addEventListener("visibilitychange",hidden);
    return ()=>{document.removeEventListener("visibilitychange",hidden);elems.forEach(v=>v?.pause());};
  },[]);
  return <section data-testid="published-s2-ghost" className="min-w-0 space-y-4 border-y border-slate-700 py-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">{t("武汉赛道 · S2 双圈叠影","Wuhan circuit · S2 ghost replay")}</h3>
      <span className="text-sm"><b className="text-cyan-300">{t("L4 区段最快","L4 section best")}</b> · <b className="text-amber-300">{t("L5 整圈最快","L5 full-lap best")}</b></span></header>
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      <div className="min-w-0 space-y-2"><div className="flex flex-wrap gap-1" aria-label={t("地图范围","Map extent")}>{([["track",Map,t("赛道全图","Circuit")],["section",Flag,t("S2 局部","S2 detail")],["follow",Crosshair,t("局部跟随","Follow")]] as const).map(([v,Icon,label])=><button key={v} aria-pressed={extent===v} onClick={()=>setExtent(v)} className={button(extent===v)}><Icon size={15}/>{label}</button>)}</div>
        <GhostMap model={model} cars={f.cars} extent={extent} zh={zh}/>
        <p className="text-sm font-semibold text-cyan-200">{t("最近共同门","Last shared gate")} {f.gate.distance.toFixed(1)} m · {t("L4 优势","L4 gain")} {signed(f.gate.gain)}</p>
        <p className="text-xs leading-5 text-slate-400">{t("底图取自 L5 的公开 GPS 走线。8 米路带为示意，不是实测路缘。车标指向行进方向，不是车身偏航。","Map from L5's published GPS line. The 8 m road is illustrative, not surveyed edges. Symbols follow travel direction, not body yaw.")} {model.exitAngle!==null && t("出口方向相差 "+model.exitAngle.toFixed(1)+"°（末两门）。","Exit directions differ by "+model.exitAngle.toFixed(1)+"° (last two gates).")}</p></div>
      <div className="min-w-0 space-y-2"><div className="flex gap-1">{[false,true].map(v=><button key={String(v)} className={button(split===v)} aria-pressed={split===v} onClick={()=>setSplit(v)}><Layers size={15}/>{v?t("并排","Side by side"):t("原片叠放","Onboard overlay")}</button>)}</div>
        <div className={"relative grid aspect-video items-center overflow-hidden bg-black "+(split?"grid-cols-2 gap-1":"grid-cols-1")} data-testid="ghost-films">{model.runs.map((r,i)=><div key={r.lap} className={"relative min-w-0 "+(!split?"col-start-1 row-start-1":"")} style={{opacity:i&&!split?mix/100:1}}>
          <video ref={v=>{videos.current[i]=v;}} src={r.clip.url} poster={r.clip.poster} playsInline preload="auto" muted={audio!==i} onLoadedData={()=>sync(i)} onError={()=>markFailed(i)} aria-label={`L${r.lap} S2`} className="block aspect-video w-full object-contain"/>
          <span className={"absolute top-1 bg-black/75 px-1 font-mono text-xs "+(i?"right-1 text-amber-200":"left-1 text-cyan-200")}>L{r.lap}</span></div>)}</div>
        <label className="flex items-center gap-2 text-xs">{t("L5 画面占比","L5 image mix")}<input className="min-w-0 flex-1" type="range" min="0" max="100" value={mix} disabled={split} onChange={e=>setMix(+e.target.value)}/>{mix}%</label>
        <p className="text-xs text-amber-200">{t("原人工锚点","Original L4 anchor")} {anchor.toFixed(2)}s ±{uncertainty}s · {t("未验证整段同步；叠片只供目视对照。","Whole-recording sync unverified; overlay is for visual review.")}</p>
        {failed.some(Boolean)&&<p role="status" className="text-xs text-amber-200">{failed.map((bad,i)=>bad?"L"+model.runs[i].lap+" ":"")}{t("视频不可用，保留遥测。","video unavailable; telemetry retained.")}</p>}</div></div>
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-700 pt-3">
      <button aria-pressed={mode==="time"} className={button(mode==="time")} onClick={()=>race(true)}><Timer size={16}/>{t("同时起跑","Same clock")}</button>
      <button aria-pressed={mode==="gate"} className={button(mode==="gate")} onClick={()=>freeze(model.gates.indexOf(f.gate))}><Crosshair size={16}/>{t("同位置定格","Freeze at gate")}</button>
      <button className={control} onClick={()=>playing?stop():race(false)}>{playing?<Pause size={16}/>:<Play size={16}/>} {playing?t("暂停","Pause"):mode==="time"&&cursor>0&&cursor<model.duration?t("继续播放","Resume"):t("播放","Play")}</button>
      <button className={control} title={t("回到入口","Rewind")} aria-label={t("回到入口","Rewind")} onClick={()=>{stop();setMode("time");setCursor(0);}}><RotateCcw size={16}/></button>
      <select aria-label={t("播放速率","Playback rate")} value={rate} onChange={e=>{clock.current={value:cursor,wall:performance.now()};setRate(+e.target.value);}} className="min-h-10 rounded border border-slate-600 bg-slate-950 px-1">{[.25,.5,1].map(v=><option key={v}>{v}</option>)}</select>
      <select aria-label={t("音轨","Audio")} value={audio} onChange={e=>setAudio(+e.target.value)} className="min-h-10 rounded border border-slate-600 bg-slate-950 px-1"><option value={-1}>{t("静音","Mute")}</option><option value={0}>L4</option><option value={1}>L5</option></select>
    </div>
    <div className="flex items-center gap-3"><output className="min-w-16 font-mono text-xs">{mode==="gate"?f.gate.distance.toFixed(1)+" m":cursor.toFixed(3)+" s"}</output>
      <input className="min-w-0 flex-1" type="range" aria-label={t("叠影进度","Ghost position")} min="0" max={mode==="gate"?model.gates.length-1:model.duration} step={mode==="gate"?1:.001} value={cursor} onChange={e=>seek(+e.target.value)}/></div>
    <table className="w-full text-left text-sm"><thead className="text-xs text-slate-400"><tr><th>{t("单圈","Lap")}</th><th>{t("距入口用时","From entry")}</th><th>AiM km/h</th><th>AiM RPM</th></tr></thead>
      <tbody className="font-mono">{f.cars.map((p,i)=><tr key={i} className="border-t border-slate-800"><th className={i?"text-amber-200":"text-cyan-200"}>L{model.runs[i].lap}</th><td>{p.time.toFixed(3)}s</td><td>{p.speed.toFixed(1)}</td><td>{Math.round(p.rpm)}</td></tr>)}</tbody></table>
    <div className="grid grid-cols-3 gap-1">{model.thirds.map((v,i)=><button key={v.gate} className={button(mode==="gate" && cursor===v.gate)+" flex-wrap"} onClick={()=>freeze(v.gate)}>
      {zh?["前段","中段","后段"][i]:["First third","Middle third","Final third"][i]} <b className={v.gain>=0?"font-mono text-cyan-200":"font-mono text-amber-200"}>{signed(v.gain)}</b></button>)}</div>
    <p className="text-sm">{t("区段出口 L4 领先 ","At the exit L4 leads by ")}{model.gain.toFixed(3)}s{model.net===null?t("；下游证据不足。","; downstream unavailable."):t("；下游累计优势 ","; cumulative downstream gain ")+signed(model.net)+t("。",".")}</p>
    </section>;
}
