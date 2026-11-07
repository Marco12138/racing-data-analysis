"use client";

import { memo, useMemo } from "react";
import { ghostFrame, type Ghost, type XY } from "../lib/publishedGhost";

export type Extent="track"|"section"|"follow";
type Car=ReturnType<typeof ghostFrame>["cars"][number];
const colors=["#68e2cd","#ffbf59"];
export const GhostMap=memo(function GhostMap({model,extent,cars,zh}:{model:Ghost;extent:Extent;cars:Car[];zh:boolean}){
  const map=useMemo(()=>{
    const whole=extent==="track", points=whole?model.course.flat():model.runs.flatMap(r=>r.trace);
    const xs=points.map(p=>p.x),zs=points.map(p=>p.z),xlo=Math.min(...xs),xhi=Math.max(...xs),zlo=Math.min(...zs),zhi=Math.max(...zs);
    const dx=xhi-xlo,dz=zhi-zlo, rotate=whole&&dz>dx;
    const scale=Math.min(500/Math.max(1,rotate?dz:dx),230/Math.max(1,rotate?dx:dz));
    const project=(p:XY)=>{const x=p.x-(xhi+xlo)/2,z=p.z-(zhi+zlo)/2;
      return [300+scale*(rotate?z:x),150+scale*(rotate?-x:z)];};
    const line=(pts:XY[])=>pts.map(p=>project(p).join(",")).join(" ");
    const before=ghostFrame(model,"gate",model.gates.length-2).cars;
    const arrows=model.runs.map((r,i)=>{const [ax,ay]=project(before[i]),[bx,by]=project(r.trace.at(-1)!);
      return `translate(${bx} ${by}) rotate(${Math.atan2(by-ay,bx-ax)*180/Math.PI})`;});
    return {project,scale,rotate,arrows,roads:model.course.map(line),traces:model.runs.map(r=>line(r.trace)),
      ends:[model.runs[0].trace[0],model.runs[0].trace.at(-1)!].map(project)};
  },[model,extent]);
  const centers=cars.map(map.project),factor=extent==="follow"?2.6:1,w=600/factor,h=310/factor;
  const x=factor===1?0:(centers[0][0]+centers[1][0]-w)/2,y=factor===1?0:(centers[0][1]+centers[1][1]-h)/2;
  const ruler=extent==="track"?25:5;
  return <svg className="block aspect-[600/310] w-full bg-[#151d20]" viewBox={[x,y,w,h].join(" ")} role="img" aria-label={zh?"武汉赛道 GPS 全图与 S2 双圈轨迹":"Wuhan GPS circuit and S2 lap traces"}>
    {map.roads.map((p,i)=><g key={i}><polyline points={p} stroke="#859593" strokeWidth={8.4*map.scale} strokeLinejoin="round" fill="none"/><polyline points={p} stroke="#354247" strokeWidth={8*map.scale} strokeLinejoin="round" fill="none"/></g>)}
    {map.traces.map((p,i)=><polyline key={i} points={p} stroke={colors[i]} strokeWidth="2.8" strokeDasharray={i?"7 4":undefined} fill="none"/>)}
    {extent!=="track" && model.exitAngle!==null && map.arrows.map((transform,i)=><path key={i} transform={transform} d="M-18 0 H0 M-6 -4 L0 0 L-6 4" fill="none" stroke={colors[i]} strokeWidth="2.5"/>)}
    {map.ends.map(([cx,cy],i)=><g key={i}><circle cx={cx} cy={cy} r="3" fill="white"/><text x={cx} y={cy+(i?19:-10)} fill="#e5e7eb" fontSize="14" textAnchor="middle">{i?(zh?"出口":"Exit"):(zh?"入口":"Entry")}</text></g>)}
    {centers.map(([cx,cy],i)=><g key={i} transform={`translate(${cx} ${cy}) rotate(${(cars[i].heading??0)-(map.rotate?90:0)})`} stroke={colors[i]}>
      <circle r={i?14:11} fill="none" strokeDasharray={i?"4 3":undefined}/>
      {cars[i].heading!==null && <g fill={i?"none":colors[i]} strokeWidth="1.5"><path d="M-8 -2 L3 -2 L9 -3 L10 0 L9 3 L3 2 L-8 2Z"/>
        {[-8,4].flatMap(ax=>[-6,3].map(ay=><rect key={ax+":"+ay} x={ax} y={ay} width="4" height="3" rx="1"/>))}</g>}</g>)}
    <g transform={`translate(${x+17/factor} ${y+h-16/factor})`}><path d={`M0 -3 V0 h${ruler*map.scale} v-3`} stroke="#c5cfd0" fill="none"/><text y={-5} fontSize={12/factor} fill="#c5cfd0">{ruler} m</text></g>
  </svg>;
});
