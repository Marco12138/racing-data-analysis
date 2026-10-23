"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Pause, Play } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { observeVideoClock } from "../lib/videoFrameClock";
import { seekComparisonVideo } from "../lib/videoComparison";
import { inspectManualLapBounds } from "../lib/videoTelemetrySync";
import { bindingKey, channelAt, parseDriverBinding, type DriverBinding, type DriverSession } from "../lib/dualDriverReview";
import { ManualLapBinding } from "./ManualLapBinding";
import { GoproSpeedOverlay } from "./GoproSpeedOverlay";
import { ReviewBoundaryCheck } from "./ReviewBoundaryCheck";

export const dualButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded border border-slate-600 px-3 py-2 text-sm disabled:opacity-40";
export const dualInput = "min-w-0 w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm";
export type LocalDriverVideo = { file: File; url: string; fileKey: string; duration: number };

export function DriverLapPairing({ label, video, session, inspectionId, binding, onBind }: {
  label: string; video: LocalDriverVideo; session: DriverSession; inspectionId: string;
  binding: DriverBinding | null; onBind: (value: DriverBinding) => void;
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  const player = useRef<HTMLVideoElement>(null);
  const [start, setStart] = useState(""), [end, setEnd] = useState(""), [time, setTime] = useState(0), [error, setError] = useState("");
  const key = bindingKey(inspectionId, video.fileKey, session.selected_lap);
  useEffect(() => {
    try {
      const saved = parseDriverBinding(localStorage.getItem(key), inspectionId, video.fileKey, session.selected_lap,
        video.duration, session.timing.start_time_ms / 1000);
      if (saved) { queueMicrotask(() => { setStart(String(saved.video_start_s)); setEnd(String(saved.video_end_s)); onBind(saved); }); }
    } catch { /* A local storage failure does not prevent manual pairing. */ }
    // Identity changes remount this editor. Parent callbacks must not reload saved anchors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => player.current ? observeVideoClock(player.current, t => setTime(t.time_s)) : undefined, []);
  const bounds = start !== "" && end !== "" ? inspectManualLapBounds(Number(start), Number(end),
    session.timing.start_time_ms / 1000, session.timing.end_time_ms / 1000, video.duration) : null;
  function save() {
    if (!bounds) return;
    const value: DriverBinding = { version: 1, fileKey: video.fileKey, inspectionId, lap: session.selected_lap,
      video_start_s: bounds.video_start_s, video_end_s: bounds.video_end_s,
      offset_s: bounds.video_start_s - bounds.telemetry_start_s, uncertainty_s: .5, confirmed: true };
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { setError(zh ? "仅本次有效，浏览器未能保存。" : "Active for this visit; browser storage unavailable."); }
    onBind(value);
  }
  return <section className="min-w-0 space-y-3" aria-label={`${label} ${zh ? "单圈配对" : "lap pairing"}`}>
    <h2 className="font-semibold">{label} · L{session.selected_lap}</h2>
    <div className="relative"><video ref={player} src={video.url} controls playsInline muted className="aspect-video w-full bg-black" /><GoproSpeedOverlay file={video.file} time={time} /></div>
    <output className="font-mono text-xs">{time.toFixed(3)}s</output>
    <div className="grid grid-cols-2 gap-3">{[[start, setStart, zh ? "圈起点" : "Lap start"], [end, setEnd, zh ? "圈终点" : "Lap end"]].map(([value, setter, title], i) => <label className="min-w-0 text-xs" key={i}>{String(title)} (s)
      <input className={`${dualInput} my-1`} type="number" min={0} max={video.duration} step={.01} value={value as string} onChange={e => (setter as (s: string) => void)(e.target.value)} />
      <button className={dualButton} onClick={() => (setter as (s: string) => void)(String(player.current?.currentTime ?? 0))}><Camera size={14} />{zh ? "当前帧" : "Current frame"}</button></label>)}</div>
    <ManualLapBinding key={`${start}:${end}`} lap={session.selected_lap} bounds={bounds} marked={!!bounds} disabled={false}
      saved={!!binding && Number(start) === binding.video_start_s && Number(end) === binding.video_end_s} onBind={save} />
    {binding && <p className="text-xs text-emerald-300">{zh ? "人工锚点已保留 · ±0.5 秒 · 自动候选不会覆盖" : "Manual anchor retained · ±0.5s · Automatic candidates cannot overwrite it"}</p>}
    {error && <p role="status">{error}</p>}
  </section>;
}

/** Both sides keep real playback speed; video confirmation is separate from telemetry calculations. */
export function DualCornerVideo({ videos, sessions, bindings, starts, confirmed, onConfirm }: {
  videos: [LocalDriverVideo, LocalDriverVideo]; sessions: [DriverSession, DriverSession];
  bindings: [DriverBinding, DriverBinding]; starts: [number, number]; confirmed: boolean; onConfirm: (confirmed: boolean) => void;
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  const a = useRef<HTMLVideoElement>(null), b = useRef<HTMLVideoElement>(null);
  const [times, setTimes] = useState<[number, number]>(starts), [playing, setPlaying] = useState(false), [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null), running = useRef(false);
  function stop() { running.current = false; abort.current?.abort(); a.current?.pause(); b.current?.pause(); setPlaying(false); }
  useEffect(() => {
    const elements = [a.current, b.current];
    const clean = elements.map((v, i) => v ? observeVideoClock(v, sample => {
      setTimes(t => i === 0 ? [sample.time_s, t[1]] : [t[0], sample.time_s]);
      if (running.current && sample.time_s >= starts[i] + 5 - .015) { running.current = false; elements.forEach(e => e?.pause()); setPlaying(false); }
    }) : () => {});
    elements.forEach((v, i) => { if (v) v.currentTime = starts[i]; });
    return () => { abort.current?.abort(); clean.forEach(c => c()); elements.forEach(v => v?.pause()); };
    // The parent remounts when the immutable corner/binding identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function play() {
    stop(); setError(""); const c = new AbortController(); abort.current = c;
    try {
      if (!a.current || !b.current) return;
      await Promise.all([a.current, b.current].map((v, i) => seekComparisonVideo(v, starts[i], c.signal)));
      c.signal.throwIfAborted(); running.current = true;
      await Promise.all([a.current.play(), b.current.play()]); c.signal.throwIfAborted(); setPlaying(true);
    } catch { const cancelled = c.signal.aborted; stop(); if (!cancelled) setError(zh ? "未能同时播放，请重试。" : "Paired playback failed. Please retry."); }
  }
  return <div className="space-y-3">
    <button className={`${dualButton} border-yellow-400 text-yellow-300`} onClick={() => playing ? stop() : void play()}>{playing ? <Pause size={16} /> : <Play size={16} />}{zh ? "两侧播放 / 暂停 · 5秒" : "Play / pause both · 5s"}</button>
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">{videos.map((v, i) => <div key={i} className="min-w-0">
      <h3 className="mb-2 font-semibold">{i === 0 ? "A" : "B"} · L{sessions[i].selected_lap}</h3>
      <div className="relative"><video ref={i === 0 ? a : b} src={v.url} controls muted playsInline className="aspect-video w-full bg-black" onPause={() => { if (running.current) stop(); }} />
        <GoproSpeedOverlay file={v.file} time={times[i]} /></div>
      <div className="flex flex-wrap gap-4 py-2 font-mono text-xs"><span>{starts[i].toFixed(2)}–{(starts[i] + 5).toFixed(2)}s</span>
        <span>AiM RPM: {channelAt(sessions[i].track, times[i] - bindings[i].offset_s, "rpm")?.toFixed(0) ?? "—"}</span>
        <span>AiM GPS: {channelAt(sessions[i].track, times[i] - bindings[i].offset_s, "speed")?.toFixed(1) ?? "—"} km/h</span></div>
    </div>)}</div>
    <ReviewBoundaryCheck reference={{ url: videos[0].url, start: starts[0], duration: videos[0].duration, lap: sessions[0].selected_lap, label: "A", confirmed: true }}
      target={{ url: videos[1].url, start: starts[1], duration: videos[1].duration, lap: sessions[1].selected_lap, label: "B", confirmed: true }}
      onSeek={time => { stop(); if (b.current) b.current.currentTime = time; }} />
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={e => onConfirm(e.target.checked)} />
      {zh ? "已核对两侧起点是同一位置、同一行驶方向；将此对照加入总结" : "Both starts are the same location and direction; include this comparison in the debrief"}</label>
    <p className="text-xs text-slate-400">{zh ? "人工起点保留 ±0.5 秒不确定性；GPS 配准通过不等于视频帧已同步。5秒末端可能处于不同位置。" : "Manual starts retain ±0.5s uncertainty. GPS registration does not verify video-frame timing. Five-second endpoints may differ."}</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
