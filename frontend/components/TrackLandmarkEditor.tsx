"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Camera, Check, Play, Search, Trash2, X } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { grayscalePatch, LANDMARK_EVENT, landmarkEventText, matchLandmarkFrame, parseLandmarks,
  patchCorrelation, rankLandmarkMatches, validLandmarkRect, type LandmarkRect, type TrackLandmark } from "../lib/trackLandmarks";

const btn = "inline-flex items-center gap-2 rounded border border-slate-700 px-3 py-2 text-xs text-slate-200 disabled:opacity-40";
const input = "min-w-0 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white";
type Frame = { url: string; width: number; height: number; rgba: Uint8ClampedArray; time: number };

function capture(video: HTMLVideoElement): Frame {
  if (video.readyState < 2 || !video.videoWidth) throw Error("frame_unavailable");
  const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = Math.round(320 * video.videoHeight / video.videoWidth);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw Error("canvas_unavailable");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return { url: canvas.toDataURL("image/jpeg", .8), width: canvas.width, height: canvas.height,
    rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data, time: video.currentTime };
}

async function seekFrame(video: HTMLVideoElement, time: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (Math.abs(video.currentTime - time) < .005 && video.readyState >= 2) return;
  await new Promise<void>((resolve, reject) => {
    const done = () => { cleanup(); resolve(); }, fail = () => { cleanup(); reject(Error("frame_unavailable")); };
    const timer = setTimeout(fail, 5000);
    function cleanup() { clearTimeout(timer); video.removeEventListener("seeked", done); video.removeEventListener("error", fail); signal.removeEventListener("abort", fail); }
    video.addEventListener("seeked", done, { once: true }); video.addEventListener("error", fail, { once: true }); signal.addEventListener("abort", fail, { once: true });
    video.currentTime = time;
  });
  signal.throwIfAborted();
}

/** A local template library: automatic sightings are always proposals requiring human confirmation. */
export function TrackLandmarkEditor({ video, videoUrl, scope, cornerId, lap, videoKey, syncKey, window,
  distanceAtTime, events, onSeek, readOnly = false }: {
  video: RefObject<HTMLVideoElement | null>; videoUrl: string; scope: string; cornerId: string; lap: number;
  videoKey: string; syncKey: string; window: { start_s: number; end_s: number };
  distanceAtTime: (time: number) => number | null; events: { recovery: number | null; rpm_drop: number | null }; readOnly?: boolean;
  onSeek: (time: number) => void;
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  const key = `racing-landmarks:v1:${scope}:${cornerId}`;
  const [library, setLibrary] = useState<TrackLandmark[]>([]), [frame, setFrame] = useState<Frame | null>(null);
  const [rect, setRect] = useState<LandmarkRect | null>(null), [name, setName] = useState(""), [nameEn, setNameEn] = useState("");
  const [selected, setSelected] = useState(""), [confirmed, setConfirmed] = useState(false), [passing, setPassing] = useState(false);
  const [searching, setSearching] = useState(false), [message, setMessage] = useState("");
  const [candidate, setCandidate] = useState<{ landmark: TrackLandmark; frame: Frame; rect: LandmarkRect; score: number; status: string } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const reload = () => { try { setLibrary(parseLandmarks(localStorage.getItem(key), scope, cornerId)); } catch { setLibrary([]); } };
    queueMicrotask(reload); globalThis.addEventListener(LANDMARK_EVENT, reload);
    return () => { globalThis.removeEventListener(LANDMARK_EVENT, reload); controller.current?.abort(); };
  }, [key, scope, cornerId]);
  function persist(rows: TrackLandmark[]): boolean {
    try { localStorage.setItem(key, JSON.stringify(rows)); setLibrary(rows); globalThis.dispatchEvent(new Event(LANDMARK_EVENT)); return true; }
    catch { setMessage(zh ? "浏览器未能保存参照物，请检查本地存储空间。" : "Could not save the landmark in browser storage."); return false; }
  }
  function takeFrame() {
    if (!video.current) return;
    controller.current?.abort(); video.current.pause();
    try { setFrame(capture(video.current)); setCandidate(null); setRect(null); setConfirmed(false); setPassing(false); setMessage(""); }
    catch { setMessage(zh ? "当前画面不可读取。" : "Frame unavailable."); }
  }
  async function search() {
    const landmark = library.find(l => l.id === selected);
    if (!landmark || searching || !videoUrl) return;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const probe = document.createElement("video"); probe.muted = true; probe.preload = "auto";
    setSearching(true); setMessage(""); setCandidate(null); setFrame(null); setConfirmed(false); setPassing(false);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(Error("load_timeout")); }, 10000);
        const loaded = () => { cleanup(); resolve(); }, failed = () => { cleanup(); reject(Error("load_failed")); };
        function cleanup() { clearTimeout(timer); probe.removeEventListener("loadeddata", loaded); probe.removeEventListener("error", failed); abort.signal.removeEventListener("abort", failed); }
        probe.addEventListener("loadeddata", loaded, { once: true }); probe.addEventListener("error", failed, { once: true }); abort.signal.addEventListener("abort", failed, { once: true });
        probe.src = videoUrl;
      });
      abort.signal.throwIfAborted();
      // Bound decoding to this review clip, never scan the session or upload frames.
      const duration = Math.min(window.end_s - window.start_s, 12);
      if (duration <= 0) throw Error("empty_window");
      const from = Math.max(window.start_s, Math.min((video.current?.currentTime ?? window.start_s) - duration / 2, window.end_s - duration));
      const matches: Array<{ time: number; score: number; rect: LandmarkRect }> = [];
      for (let i = 0; i < 25; i++) {
        await seekFrame(probe, from + duration * i / 25, abort.signal);
        const f = capture(probe), match = matchLandmarkFrame(landmark, f.rgba, f.width, f.height);
        if (match) matches.push({ time: f.time, ...match });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const result = rankLandmarkMatches(matches);
      if (!result.candidate) { setMessage(zh ? "未找到足够相似的画面。请手动框选，不要据此调整同步。" : "No useful match. Select the landmark manually; do not change sync."); return; }
      await seekFrame(probe, result.candidate.time, abort.signal);
      const f = capture(probe);
      setCandidate({ landmark, frame: f, rect: result.candidate.rect, score: result.candidate.score, status: result.status });
      setFrame(f); setRect(result.candidate.rect); setName(landmark.name); setNameEn(landmark.nameEn);
    } catch { if (!abort.signal.aborted) setMessage(zh ? "画面搜索未完成，请重新选择可播放的视频。" : "Frame search failed. Reselect a playable video."); }
    finally { probe.pause(); probe.removeAttribute("src"); probe.load(); if (controller.current === abort) setSearching(false); }
  }
  function save() {
    if (!frame || !rect || !confirmed || !name.trim() || readOnly || library.length >= 12 && !candidate) return;
    const patch = grayscalePatch(frame.rgba, frame.width, frame.height, rect);
    if (patchCorrelation(patch, patch) === null) { setMessage(zh ? "框选区域缺少纹理，请选择清晰、固定的标志。" : "This patch has too little texture. Select a clear fixed landmark."); return; }
    const source = document.createElement("canvas"); source.width = frame.width; source.height = frame.height;
    const sourceCtx = source.getContext("2d")!; sourceCtx.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
    const thumb = document.createElement("canvas"); thumb.width = 128; thumb.height = Math.max(24, Math.min(128, Math.round(128 * rect.h * frame.height / (rect.w * frame.width))));
    thumb.getContext("2d")!.drawImage(source, rect.x*frame.width, rect.y*frame.height, rect.w*frame.width, rect.h*frame.height, 0, 0, thumb.width, thumb.height);
    const sighting = { lap, videoKey, syncKey, videoTimeS: frame.time, distanceM: syncKey ? distanceAtTime(frame.time) : null,
      relation: passing ? "passing" as const : "visible" as const, confirmedAt: new Date().toISOString() };
    const next: TrackLandmark = candidate ? { ...candidate.landmark, sightings: [...candidate.landmark.sightings.filter(s => s.lap !== lap || s.videoKey !== videoKey), sighting].slice(-20) }
      : { version: 1, id: crypto.randomUUID(), scope, cornerId, name: name.trim(), nameEn: nameEn.trim(),
        thumbnail: thumb.toDataURL("image/jpeg", .75), rect, patch, sightings: [sighting] };
    if (persist([...library.filter(r => r.id !== next.id), next])) { setFrame(null); setCandidate(null); setConfirmed(false); setSelected(next.id); setMessage(zh ? "参照物已保存在本浏览器。" : "Landmark saved in this browser."); }
  }
  const display = candidate?.frame ?? frame;
  return <details className="mt-4 border-t border-slate-700 pt-3" data-testid="track-landmark-editor">
    <summary className="cursor-pointer text-sm text-teal-200">{zh ? "赛道边参照物 · 画面解释" : "Trackside landmarks · Visual explanation"}</summary>
    <p className="mt-2 text-xs leading-5 text-slate-400">{zh ? "位置来自 GPS 遥测与已确认的视频同步。参照物用于说明动作发生在哪里；相似画面不是位置真值，也不用于自动调整同步。" : "Location comes from GPS telemetry and confirmed video sync. Landmarks explain where an action occurs; visual similarity is not location truth and never adjusts sync automatically."}</p>
    <p className="mt-2 text-xs leading-5 text-slate-400">{zh ? "仅在相近机位中搜索相似画面；分数不是识别准确率。候选需人工确认，不修改视频同步。裁剪小图只保存在本浏览器。" : "Same-view template search only; scores are not accuracy. Confirm every candidate. Sync is unchanged; cropped thumbnails stay in this browser."}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button className={btn} disabled={readOnly || searching} onClick={takeFrame}><Camera size={14} />{zh ? "框选当前画面" : "Mark current frame"}</button>
      <select className={`${input} max-w-full sm:w-auto`} aria-label={zh ? "已学习的参照物" : "Learned landmarks"} value={selected} onChange={e => { controller.current?.abort(); setSelected(e.target.value); setFrame(null); setCandidate(null); setConfirmed(false); }}><option value="">{zh ? "选择参照物" : "Select landmark"}</option>{library.map(l => <option key={l.id} value={l.id}>{zh ? l.name : l.nameEn || l.name}</option>)}</select>
      <button className={btn} disabled={readOnly || !selected || searching} onClick={() => void search()}><Search size={14} />{zh ? "在此片段找相同标志" : "Find in this clip"}</button>
      {searching && <button className={btn} onClick={() => controller.current?.abort()}><X size={14} />{zh ? "取消搜索" : "Cancel search"}</button>}
    </div>
    {display && <div className="mt-3 space-y-3">
      {candidate && <div className="flex flex-wrap gap-2"><p className="text-xs text-amber-300">{zh ? "相似画面候选，未确认" : "Unconfirmed similar-frame candidate"} · {candidate.score.toFixed(2)} / 1{candidate.status === "ambiguous" ? (zh ? " · 多处相似" : " · Ambiguous matches") : ""}</p>
        <button className={btn} onClick={() => onSeek(candidate.frame.time)}><Play size={14} />{zh ? "查看候选画面" : "View candidate frame"}</button></div>}
      <div className="relative w-full touch-none overflow-hidden bg-black" style={{ aspectRatio: `${display.width}/${display.height}` }} role="group" aria-label={zh ? "拖动框选固定参照物" : "Drag to mark a fixed landmark"}
        onPointerDown={e => { if (candidate) return; const b = e.currentTarget.getBoundingClientRect(); start.current = { x: (e.clientX-b.left)/b.width, y: (e.clientY-b.top)/b.height }; e.currentTarget.setPointerCapture(e.pointerId); setConfirmed(false); }}
        onPointerMove={e => { if (!start.current || candidate) return; const b = e.currentTarget.getBoundingClientRect(), x = Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)), y = Math.max(0,Math.min(1,(e.clientY-b.top)/b.height)); setRect({ x: Math.min(x,start.current.x), y: Math.min(y,start.current.y), w: Math.abs(x-start.current.x), h: Math.abs(y-start.current.y) }); }}
        onPointerUp={() => { start.current = null; }} onPointerCancel={() => { start.current = null; }}>
        {/* A transient local frame cannot use the remote Next image optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={display.url} alt={zh ? "本地视频参照物" : "Local video landmark"} className="pointer-events-none h-full w-full" draggable={false} />
        {rect && <div className="pointer-events-none absolute border-2 border-yellow-300" style={{ left:`${rect.x*100}%`,top:`${rect.y*100}%`,width:`${rect.w*100}%`,height:`${rect.h*100}%` }} />}
      </div>
      <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs text-slate-400">{zh ? "参照物名称" : "Landmark name"}<input className={input} maxLength={60} value={name} disabled={!!candidate} onChange={e => setName(e.target.value)} placeholder={zh ? "例如：右侧红白路肩末端" : "e.g. End of right red-white kerb"} /></label>
        <label className="text-xs text-slate-400">{zh ? "英文名称（选填）" : "English name (optional)"}<input className={input} maxLength={80} value={nameEn} disabled={!!candidate} onChange={e => setNameEn(e.target.value)} /></label></div>
      <label className="flex gap-2 text-xs text-slate-300"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{zh ? "确认是固定赛道边标志，且对应此圈、此弯，不是车辆、人员或阴影" : "Confirmed fixed trackside landmark in this lap/corner, not a vehicle, person or shadow"}</label>
      <label className="flex gap-2 text-xs text-slate-300"><input type="checkbox" checked={passing} disabled={!syncKey || distanceAtTime(display.time) === null} onChange={e => setPassing(e.target.checked)} />{zh ? "已核对：此帧车头与参照物齐平（否则只记为可见）" : "Checked: the kart is alongside this landmark in this frame (otherwise visible only)"}</label>
      <div className="flex gap-2"><button className={btn} disabled={readOnly || !confirmed || !name.trim() || !rect || !validLandmarkRect(rect)} onClick={save}><Check size={14} />{zh ? "确认并记住" : "Confirm and remember"}</button><button className={btn} onClick={() => { setFrame(null); setCandidate(null); }}><X size={14} />{zh ? "放弃" : "Discard"}</button></div>
    </div>}
    <ul className="mt-3 space-y-3">{library.map(l => {
      const seen = l.sightings.find(s => s.lap === lap && s.videoKey === videoKey && s.syncKey === syncKey);
      return <li key={l.id} className="border-t border-slate-800 pt-2 text-xs text-slate-300">
        <div className="flex items-center justify-between gap-2"><span className="min-w-0 break-words">{zh ? l.name : l.nameEn || l.name}{seen ? (zh ? " · 此圈已确认" : " · Confirmed in this lap") : (zh ? " · 此圈待确认" : " · Unconfirmed in this lap")}</span>
          <button className={btn} title={zh ? "删除参照物" : "Delete landmark"} aria-label={zh ? "删除参照物" : "Delete landmark"} disabled={readOnly} onClick={() => persist(library.filter(r => r.id !== l.id))}><Trash2 size={13} /></button></div>
        {seen && Object.entries(events).map(([event, distance]) => {
          const text = distance === null ? null : landmarkEventText(l, seen, distance, event as "recovery" | "rpm_drop", locale);
          return text ? <p className="mt-2 leading-5" key={event}>{text}</p> : null;
        })}
      </li>;
    })}</ul>
    {message && <p role="status" className="mt-2 text-xs text-amber-200">{message}</p>}
  </details>;
}
