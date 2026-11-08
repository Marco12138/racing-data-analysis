"use client";
import { createContext,useContext,useEffect,useState,useSyncExternalStore,type ReactNode } from "react";
import { ReferenceLine } from "recharts";

type Cursor = readonly (number|null)[];
const empty: Cursor = [];
function newCursor() {
  let value = empty;
  const listeners = new Set<()=>void>();
  return {read:()=>value, listen:(cb:()=>void)=>{listeners.add(cb);return ()=>{listeners.delete(cb);};},
    write:(next:Cursor)=>{if(next.length===value.length && next.every((x,i)=>x===value[i]))return;value=next;listeners.forEach(fn=>fn());}};
}
const Context = createContext<ReturnType<typeof newCursor>|null>(null);
export function TrajectoryChartScope({children}:{children:ReactNode}) {
  const [store]=useState(newCursor);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useTrajectoryChartCursor(a:number|null,b:number|null) {
  const store=useContext(Context);
  useEffect(()=>{store?.write([a,b]);},[store,a,b]);
  useEffect(()=>()=>store?.write(empty),[store]);
}
const noopListen = () => () => {};
const initial = () => empty;
export function TrajectoryCursorLines() {
  const store=useContext(Context);
  const xs=useSyncExternalStore(store?.listen??noopListen,store?.read??initial,initial);
  return <>{xs.map((x,i)=>x!==null && <ReferenceLine key={i} x={x} stroke={i?"#f6c945":"#35d6d0"} strokeDasharray={i?"4 3":undefined}
    className={`trajectory-cursor-${i}`}/>)}</>;
}
