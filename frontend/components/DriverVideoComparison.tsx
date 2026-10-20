"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Camera, Check, ChevronLeft, ChevronRight, Pause, Play, RotateCcw, Save, Trash2, Upload } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { observeVideoClock } from "../lib/videoFrameClock";
import { comparisonStart, comparisonVideoKey, parseVideoComparisons, seekComparisonVideo,
  type ComparisonStart, type SavedVideoComparison } from "../lib/videoComparison";
import { ReviewBoundaryCheck } from "./ReviewBoundaryCheck";
import { TrackLandmarkEditor } from "./TrackLandmarkEditor";
import { GoproSpeedOverlay } from "./GoproSpeedOverlay";

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded border border-slate-600 px-3 py-2 text-sm text-slate-200 disabled:opacity-40";
const input = "min-w-0 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white";
type Side = { file: File | null; url: string; fileKey: string; name: string; driver: string; duration: number; start: ComparisonStart | null; error: string };
const emptySide = (): Side => ({ file: null, url: "", fileKey: "", name: "", driver: "", duration: 0, start: null, error: "" });
const noDistance = () => null;
const noEvents = { recovery: null, rpm_drop: null };

/** Independent local files and manual marks. No XRK calibration or cloud video API is involved. */
export function DriverVideoComparison() {
  const { locale } = useI18n(), zh = locale === "zh";
  const a = useRef<HTMLVideoElement>(null), b = useRef<HTMLVideoElement>(null);
  const [sides, setSides] = useState<[Side, Side]>([emptySide(), emptySide()]);
  const [interactive, setInteractive] = useState(false);
  const [sameLocation, setSameLocation] = useState(false), [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [name, setName] = useState(""), [saved, setSaved] = useState<SavedVideoComparison[]>([]);
  const [reviewId, setReviewId] = useState("draft");
  const urls = useRef(["", ""]), generations = useRef([0, 0]);
  const playback = useRef<AbortController | null>(null), running = useRef(false);
  const pairKey = sides.every(s => s.fileKey) ? sides.map(s => s.fileKey).join("|") : "";
  const storageKey = `racing-video-comparison:v1:${pairKey}`;
  const ready = sides.every(s => s.start && !s.error);
  const durationA = sides[0].duration, durationB = sides[1].duration;
  const labels = sides.map((s, i) => s.driver.trim() || (zh ? `车手 ${i === 0 ? "A" : "B"}` : `Driver ${i === 0 ? "A" : "B"}`));
  const checkKey = JSON.stringify(sides.map(s => [s.url, s.start?.start_s]));

  // SSR can paint a file picker before its handler hydrates; do not accept a lost file selection.
  useEffect(() => { queueMicrotask(() => setInteractive(true)); }, []);

  useEffect(() => {
    queueMicrotask(() => {
      try { setSaved(parseVideoComparisons(localStorage.getItem(storageKey), pairKey, [durationA, durationB])); }
      catch { setSaved([]); }
    });
  }, [storageKey, pairKey, durationA, durationB]);
  useEffect(() => () => {
    playback.current?.abort(); generations.current = generations.current.map(n => n + 1);
    for (const url of urls.current) if (url) URL.revokeObjectURL(url);
  }, []);

  function stop() {
    running.current = false; playback.current?.abort(); playback.current = null;
    a.current?.pause(); b.current?.pause(); setPlaying(false); setBusy(false);
  }
  function patch(index: number, value: Partial<Side>) {
    setSides(rows => rows.map((s, i) => i === index ? { ...s, ...value } : s) as [Side, Side]);
  }
  function selectFile(index: number, file: File | null) {
    if (!file) return;
    stop(); const generation = ++generations.current[index];
    if (urls.current[index]) URL.revokeObjectURL(urls.current[index]);
    const url = URL.createObjectURL(file); urls.current[index] = url;
    patch(index, { ...emptySide(), file, url, name: file.name, driver: sides[index].driver });
    setSameLocation(false); setMessage(""); setReviewId("draft");
    void comparisonVideoKey(file).then(fileKey => {
      if (generations.current[index] === generation) patch(index, { fileKey });
    }).catch(() => {
      if (generations.current[index] === generation) setMessage(zh ? "无法创建本地文件标识；可以播放，但暂不能保存对照或参照物。" : "Local file identity unavailable. Playback works, but saving comparisons and landmarks is unavailable.");
    });
  }
  function confirmStart(index: number) {
    stop(); const video = index === 0 ? a.current : b.current;
    const start = video && comparisonStart(video.currentTime, sides[index].duration);
    if (!start) { setMessage(zh ? "此处后续不足 5 秒，请选择更早的起点。" : "Fewer than 5 seconds remain. Choose an earlier start."); return; }
    patch(index, { start }); setSameLocation(false); setMessage("");
    if (reviewId === "draft") setReviewId(crypto.randomUUID());
  }
  function seek(index: number, time: number) {
    stop(); const video = index === 0 ? a.current : b.current;
    if (video && Number.isFinite(time)) video.currentTime = Math.max(0, Math.min(sides[index].duration, time));
  }
  async function playBoth() {
    stop(); if (!ready || !sameLocation || !a.current || !b.current) return;
    const controller = new AbortController(); playback.current = controller;
    setBusy(true); setMessage("");
    try {
      const videos = [a.current, b.current];
      for (const [index, video] of videos.entries()) {
        video.playbackRate = 1; await seekComparisonVideo(video, sides[index].start!.start_s, controller.signal);
      }
      controller.signal.throwIfAborted(); running.current = true;
      await Promise.all(videos.map(video => video.play()));
      controller.signal.throwIfAborted(); setPlaying(true);
    } catch {
      if (!controller.signal.aborted) { stop(); setMessage(zh ? "未能同时播放，请检查两侧视频后重试。" : "Paired playback failed. Check both videos and retry."); }
      else if (!playback.current || playback.current === controller) { a.current?.pause(); b.current?.pause(); }
    } finally { if (playback.current === controller) setBusy(false); }
  }
  function persist(rows: SavedVideoComparison[]) {
    try { localStorage.setItem(storageKey, JSON.stringify(rows)); setSaved(rows); return true; }
    catch { setMessage(zh ? "浏览器未能保存，请检查本地存储空间。" : "Browser storage could not save this review."); return false; }
  }
  function save() {
    if (!pairKey || !ready || !sameLocation || !name.trim()) return;
    const id = reviewId === "draft" ? crypto.randomUUID() : reviewId;
    if (saved.length >= 10 && !saved.some(r => r.id === id)) { setMessage(zh ? "最多保存 10 组，请先删除一组。" : "Limit of 10 reviews. Delete a review first."); return; }
    const row: SavedVideoComparison = { version: 1, id, pair_key: pairKey, name: name.trim(),
      drivers: [sides[0].driver, sides[1].driver], starts: [sides[0].start!, sides[1].start!], same_location_confirmed: true };
    if (persist([...saved.filter(s => s.id !== id), row])) { setReviewId(id); setMessage(zh ? "已保存在本浏览器。刷新后重新选择这两个视频即可恢复。" : "Saved in this browser. Reselect these two files after refresh to restore."); }
  }
  function restore(row: SavedVideoComparison) {
    stop(); setSides(current => current.map((s, i) => ({ ...s, start: row.starts[i], driver: row.drivers[i] })) as [Side, Side]);
    setName(row.name); setReviewId(row.id); setSameLocation(true); setMessage("");
    if (a.current) a.current.currentTime = row.starts[0].start_s;
    if (b.current) b.current.currentTime = row.starts[1].start_s;
  }

  return <section className="min-w-0 space-y-5" data-testid="driver-video-comparison" aria-busy={!interactive}>
    {!interactive && <p role="status" className="text-sm text-slate-400">{zh ? "视频控件加载中…" : "Loading video controls…"}</p>}
    <div className="grid min-w-0 gap-6 lg:grid-cols-2">{sides.map((side, index) => <div key={index} className="min-w-0 space-y-3" data-testid={`video-side-${index}`}>
      <label className="block text-xs text-slate-400">{zh ? `车手 ${index === 0 ? "A" : "B"}` : `Driver ${index === 0 ? "A" : "B"}`}
        <input className={`${input} mt-1`} maxLength={60} value={side.driver} placeholder={zh ? "姓名（选填）" : "Name (optional)"} onChange={e => patch(index, { driver: e.target.value })} /></label>
      <label className="flex min-h-12 min-w-0 cursor-pointer items-center gap-2 rounded border border-dashed border-slate-600 p-3 text-sm text-cyan-200">
        <Upload size={16} className="shrink-0" /><span className="min-w-0 flex-1 break-all whitespace-normal">{side.name || (zh ? "选择本地车载视频" : "Choose onboard video")}</span>
        <input className="sr-only" type="file" disabled={!interactive} accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" aria-label={zh ? `车手 ${index === 0 ? "A" : "B"} 视频` : `Driver ${index === 0 ? "A" : "B"} video`}
          onChange={e => { selectFile(index, e.target.files?.[0] ?? null); e.target.value = ""; }} /></label>
      {side.url ? <>
        <VideoSidePlayer key={side.url} side={side} video={index === 0 ? a : b} label={labels[index]} onLoaded={duration => patch(index, { duration, error: "" })}
          onError={() => { stop(); patch(index, { error: zh ? "视频无法解码，请换用兼容浏览器或 H.264 MP4。起点不会自动迁移。" : "Video could not decode. Try a compatible browser or H.264 MP4; starts are never transferred automatically." }); }}
          onSeek={time => seek(index, time)} onStop={() => { if (running.current) stop(); }} onEnd={() => { if (running.current) stop(); }} />
        {side.error && <p role="alert" className="text-sm text-amber-200">{side.error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button className={button} disabled={!side.duration || !!side.error} onClick={() => confirmStart(index)}><Camera size={16} />{zh ? "确认当前帧为起点" : "Confirm current frame as start"}</button>
          {side.start && <button className={button} title={zh ? "回到已确认起点" : "Return to confirmed start"} onClick={() => seek(index, side.start!.start_s)}><RotateCcw size={16} /><span className="font-mono text-xs">{side.start.start_s.toFixed(2)}–{side.start.end_s.toFixed(2)}s</span></button>}
        </div>
        {side.start && <p className="text-xs text-slate-400">{zh ? "人工起点 ±0.5 秒 · 自动取后 5 秒" : "Manual start ±0.5s · Next 5 seconds"}</p>}
        {pairKey && side.start && !side.error && <TrackLandmarkEditor key={`${pairKey}:${reviewId}:${index}:${side.start.start_s}`} video={index === 0 ? a : b} videoUrl={side.url}
          scope={`video-pair:${pairKey}`} cornerId={reviewId} lap={index + 1} videoKey={side.fileKey} syncKey={`video-only:${side.start.start_s}`} window={side.start}
          distanceAtTime={noDistance} events={noEvents} onSeek={time => seek(index, time)} videoOnly />}
      </> : <div className="flex aspect-video items-center justify-center border border-slate-800 bg-black/40 text-sm text-slate-500">{zh ? "未选择视频" : "No video selected"}</div>}
    </div>)}
    </div>
    {ready && <>
      <div className="space-y-3 border-y border-slate-700 py-4">
        <label className="flex items-start gap-2 text-sm text-slate-200"><input className="mt-1" type="checkbox" checked={sameLocation} onChange={e => { stop(); setSameLocation(e.target.checked); }} />
          {zh ? "已人工核对：同一赛道、同一行驶方向，两侧起点经过同一参照物位置" : "Checked: same track and direction; both starts pass the same landmark position"}</label>
        <div className="flex flex-wrap gap-3">
          <button className={`${button} border-yellow-400 bg-yellow-400 !text-black`} disabled={!sameLocation || busy} onClick={() => playing ? stop() : void playBoth()}>{playing ? <Pause size={16} /> : <Play size={16} />}{playing ? (zh ? "暂停两侧" : "Pause both") : busy ? (zh ? "准备画面中…" : "Preparing frames…") : (zh ? "并排播放 5 秒" : "Play both · 5 seconds")}</button>
          {busy && <button className={button} onClick={stop}>{zh ? "取消" : "Cancel"}</button>}
        </div>
        <p className="text-xs leading-5 text-slate-400">{zh ? "按各自起点后的时间播放，不拉伸速度。不同车速会使五秒后的车辆位置不同；仅凭视频不判断谁更快，也不确认刹车、油门或走线优劣。" : "Playback uses elapsed time from each start, without time warping. Different speeds lead to different endpoints. Video alone does not establish who is faster or confirm pedal inputs or a better line."}</p>
      </div>
      <ReviewBoundaryCheck key={checkKey} reference={{ url: sides[0].url, start: sides[0].start!.start_s, duration: durationA, lap: 1, label: labels[0], confirmed: true }}
        target={{ url: sides[1].url, start: sides[1].start!.start_s, duration: durationB, lap: 2, label: labels[1], confirmed: true }} onSeek={time => seek(1, time)} />
      <div className="flex flex-wrap items-end gap-3 border-t border-slate-700 pt-4">
        <label className="min-w-0 flex-1 text-xs text-slate-400">{zh ? "弯道 / 参照物名称" : "Corner / landmark name"}<input className={`${input} mt-1`} maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder={zh ? "例如：红白路肩后的右弯" : "e.g. Right turn after red-white kerb"} /></label>
        <button className={button} disabled={!pairKey || !sameLocation || !name.trim()} onClick={save}><Save size={16} />{zh ? "保存这组对照" : "Save comparison"}</button>
        <button className={button} onClick={() => { stop(); setSides(rows => rows.map(s => ({ ...s, start: null })) as [Side, Side]); setSameLocation(false); setName(""); setReviewId("draft"); setMessage(""); }}>{zh ? "标记另一处" : "Mark another location"}</button>
      </div>
    </>}
    {saved.length > 0 && <section className="border-t border-slate-700 pt-4"><h3 className="mb-2 text-sm font-semibold text-white">{zh ? "已保存的对照" : "Saved comparisons"}</h3>
      <ul className="divide-y divide-slate-800">{saved.map(row => <li key={row.id} className="flex items-center justify-between gap-3 py-2">
        <button className="min-w-0 break-words py-2 text-left text-sm text-cyan-200" onClick={() => restore(row)}><Check className="mr-2 inline" size={14} />{row.name}</button>
        <button className={button} aria-label={`${zh ? "删除" : "Delete"} ${row.name}`} onClick={() => { persist(saved.filter(r => r.id !== row.id)); if (reviewId === row.id) setReviewId("draft"); }}><Trash2 size={14} /></button>
      </li>)}</ul></section>}
    {message && <p role="status" className="text-sm text-amber-200">{message}</p>}
  </section>;
}

function VideoSidePlayer({ side, video, label, onLoaded, onError, onSeek, onStop, onEnd }: {
  side: Side; video: RefObject<HTMLVideoElement | null>; label: string;
  onLoaded: (duration: number) => void; onError: () => void; onSeek: (time: number) => void; onStop: () => void; onEnd: () => void;
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  const [time, setTime] = useState(0), [draftTime, setDraftTime] = useState("");
  const latest = useRef({ side, onEnd });
  useEffect(() => { latest.current = { side, onEnd }; });
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    return observeVideoClock(element, sample => {
      setTime(sample.time_s);
      const start = latest.current.side.start;
      if (start && !element.paused && sample.time_s >= start.end_s - .015) latest.current.onEnd();
    });
  }, [video]);
  return <>
    <div className="relative min-w-0"><video ref={video} src={side.url} controls playsInline muted preload="metadata" aria-label={`${label} ${zh ? "播放器" : "player"}`}
      className="aspect-video w-full bg-black object-contain" onLoadedMetadata={e => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) onLoaded(d); else onError(); }}
      onPause={onStop} onSeeking={onStop} onError={onError} />
      <GoproSpeedOverlay file={side.file} time={time} />
    </div>
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-slate-400">
      <output className="font-mono" aria-label={`${label} ${zh ? "当前时间" : "current time"}`}>{time.toFixed(3)} / {side.duration.toFixed(2)}s</output>
      <button className={button} disabled={!side.duration} title={zh ? "后退 0.04 秒" : "Back 0.04s"} aria-label={`${label} ${zh ? "后退" : "back"}`} onClick={() => onSeek(time - .04)}><ChevronLeft size={16} /></button>
      <button className={button} disabled={!side.duration} title={zh ? "前进 0.04 秒" : "Forward 0.04s"} aria-label={`${label} ${zh ? "前进" : "forward"}`} onClick={() => onSeek(time + .04)}><ChevronRight size={16} /></button>
      <input type="number" min="0" max={side.duration || undefined} step="0.01" className={`${input} !w-28`} aria-label={`${label} ${zh ? "跳转秒数" : "seek seconds"}`} value={draftTime} placeholder={zh ? "秒数" : "Seconds"} onChange={e => setDraftTime(e.target.value)} />
      <button className={button} disabled={!side.duration || draftTime === "" || !Number.isFinite(Number(draftTime))} onClick={() => onSeek(Number(draftTime))}>{zh ? "跳转" : "Seek"}</button>
    </div>
  </>;
}
