"use client";

import { memo, useMemo, useEffect, useRef, useState } from "react";
import { ghostFrame, type Ghost, type XY } from "../lib/publishedGhost";
import { KartMarker } from "./KartMarker";
import { GpsTrackSurface } from "./GpsTrackSurface";

export type Extent="track"|"section"|"follow";
type Car=ReturnType<typeof ghostFrame>["cars"][number];
const colors=["#68e2cd","#ffbf59"];
export const GhostMap=memo(function GhostMap({model,extent,cars,zh}:{model:Ghost;extent:Extent;cars:Car[];zh:boolean}){
  const [view,setView]=useState({whole:Number(extent==="track"),follow:Number(extent==="follow")});
  const lastView=useRef(view);
  useEffect(()=>{
    const from=lastView.current,to={whole:Number(extent==="track"),follow:Number(extent==="follow")};
    if(from.whole===to.whole && from.follow===to.follow)return;
    const begin=performance.now(), reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf=requestAnimationFrame(function tick(now){
      const u=reduced?1:Math.min(1,(now-begin)/420), t=u*u*(3-2*u);
      lastView.current={whole:from.whole+(to.whole-from.whole)*t,follow:from.follow+(to.follow-from.follow)*t};
      setView(lastView.current);if(u<1)raf=requestAnimationFrame(tick);
    });
    return ()=>cancelAnimationFrame(raf);
  },[extent]);
  const map=useMemo(()=>{
    const fit=(pts:XY[],whole:boolean)=>{
      const xs=pts.map(p=>p.x),zs=pts.map(p=>p.z), minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
      const dx=maxX-minX,dz=maxZ-minZ,rotate=whole&&dz>dx;
      return {x:(maxX+minX)/2,z:(maxZ+minZ)/2,angle:rotate ? -90 : 0,scale:Math.min(500/Math.max(1,rotate?dz:dx),230/Math.max(1,rotate?dx:dz))};
    };
    const a=fit(model.runs.flatMap(r=>r.trace),false), b=fit(model.course.flat(),true),u=view.whole;
    const angle=b.angle*u,c=Math.cos(angle*Math.PI/180),s=Math.sin(angle*Math.PI/180), scale=a.scale*(b.scale/a.scale)**u;
    const project=(p:XY)=>{const x=p.x-(a.x+(b.x-a.x)*u),z=p.z-(a.z+(b.z-a.z)*u);
      return [300+scale*(c*x-s*z),150+scale*(s*x+c*z)];};
    const line=(pts:XY[])=>pts.map(p=>project(p).join(",")).join(" ");
    const before=ghostFrame(model,"gate",model.gates.length-2).cars;
    const arrows=model.runs.map((r,i)=>{const [ax,ay]=project(before[i]),[bx,by]=project(r.trace.at(-1)!);
      return `translate(${bx} ${by}) rotate(${Math.atan2(by-ay,bx-ax)*180/Math.PI})`;});
    return {project,scale,angle,arrows,roads:model.course.map(line),traces:model.runs.map(r=>line(r.trace)),
      ends:[model.runs[0].trace[0],model.runs[0].trace.at(-1)!].map(project)};
  },[model,view.whole]);
  const centers=cars.map(map.project),factor=2.6**view.follow,w=600/factor,h=310/factor;
  const x=300+view.follow*((centers[0][0]+centers[1][0])/2-300)-w/2,y=155+view.follow*((centers[0][1]+centers[1][1])/2-155)-h/2;
  const ruler=extent==="track"?25:5;
  return <svg className="block aspect-[600/310] w-full bg-[#151d20]" viewBox={[x,y,w,h].join(" ")} role="img" aria-label={zh?"武汉赛道 GPS 全图与 S2 双圈轨迹":"Wuhan GPS circuit and S2 lap traces"}>
    <GpsTrackSurface segments={map.roads} unitsPerMetre={map.scale}/>
    {map.traces.map((p,i)=><polyline key={i} points={p} stroke={colors[i]} strokeWidth="2.8" strokeDasharray={i?"7 4":undefined} fill="none"/>)}
    {extent!=="track" && model.exitAngle!==null && map.arrows.map((transform,i)=><path key={i} transform={transform} d="M-18 0 H0 M-6 -4 L0 0 L-6 4" fill="none" stroke={colors[i]} strokeWidth="2.5"/>)}
    {map.ends.map(([cx,cy],i)=><g key={i}><circle cx={cx} cy={cy} r="3" fill="white"/><text x={cx} y={cy+(i?19:-10)} fill="#e5e7eb" fontSize="14" textAnchor="middle">{i?(zh?"出口":"Exit"):(zh?"入口":"Entry")}</text></g>)}
    {centers.map(([x,y],i)=><KartMarker key={i} x={x} y={y} heading={cars[i].heading===null?null:cars[i].heading!+map.angle}
      color={colors[i]} outline={i===1} size={i?1.1:.9}/>)}
    <g transform={`translate(${x+17/factor} ${y+h-16/factor})`}><path d={`M0 -3 V0 h${ruler*map.scale} v-3`} stroke="#c5cfd0" fill="none"/><text y={-5} fontSize={12/factor} fill="#c5cfd0">{ruler} m</text></g>
  </svg>;
});
