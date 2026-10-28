"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Pause, Play } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { observeVideoClock } from "../lib/videoFrameClock";
import { seekComparisonVideo } from "../lib/videoComparison";
import { inspectManualLapBounds } from "../lib/videoTelemetrySync";
import { bindingKey, channelAt, clipTelemetryTime, parseDriverBinding, type CornerObservation, type DriverBinding, type DriverSession } from "../lib/dualDriverReview";
import { ManualLapBinding } from "./ManualLapBinding";
import { GoproSpeedOverlay } from "./GoproSpeedOverlay";
import { ReviewBoundaryCheck } from "./ReviewBoundaryCheck";
import { ReviewAudioControl } from "./ReviewAudioControl";
import { reviewVideoIdentity } from "../lib/manualReview";
import { parseReviewGpsEvidence, REVIEW_GPS_EVENT, reviewGpsKey, type ReviewGpsEvidence } from "../lib/reviewGpsEvidence";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";

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
export function DualCornerVideo({ videos, sessions, bindings, starts, observations, confirmed, onConfirm, onStartsChange }: {
  videos: [LocalDriverVideo, LocalDriverVideo]; sessions: [DriverSession, DriverSession];
  bindings: [DriverBinding, DriverBinding]; starts: [number, number]; confirmed: boolean; onConfirm: (confirmed: boolean) => void;
  observations: [CornerObservation, CornerObservation];
  onStartsChange: (starts: [number, number]) => void;
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  const a = useRef<HTMLVideoElement>(null), b = useRef<HTMLVideoElement>(null);
  const [times, setTimes] = useState<[number, number]>(starts), [playing, setPlaying] = useState(false), [error, setError] = useState("");
  const [audio, setAudio] = useState<number | null>(0);
  const [draftStarts, setDraftStarts] = useState(() => starts.map(String));
  const startA = starts[0], startB = starts[1], lengthA = observations[0].elapsed_s, lengthB = observations[1].elapsed_s;
  const ends = starts.map((s, i) => s + observations[i].elapsed_s);
  const domains = useMemo(() => {
    const points = sessions.flatMap((s, i) => s.track.filter(p => p.session_time_s >= observations[i].start_session_s && p.session_time_s <= observations[i].end_session_s));
    return Object.fromEntries((["speed", "rpm"] as const).map(channel => {
      const values = points.map(p => p[channel]).filter((v): v is number => v !== null && Number.isFinite(v));
      const min = Math.min(...values), max = Math.max(...values), pad = Math.max(1, (max - min) * .05);
      return [channel, values.length ? [Math.max(0, min - pad), max + pad] : [0, 1]];
    })) as Record<"speed" | "rpm", [number, number]>;
  }, [sessions, observations]);
  const abort = useRef<AbortController | null>(null), running = useRef(false);
  function stop() { running.current = false; abort.current?.abort(); a.current?.pause(); b.current?.pause(); setPlaying(false); }
  useEffect(() => {
    const starts = [startA, startB], lengths = [lengthA, lengthB];
    const elements = [a.current, b.current];
    const clean = elements.map((v, i) => v ? observeVideoClock(v, sample => {
      setTimes(t => i === 0 ? [sample.time_s, t[1]] : [t[0], sample.time_s]);
      if (running.current && sample.time_s >= starts[i] + lengths[i] - .015) {
        v!.pause();
        if (elements.every(e => !e || e.paused)) { running.current = false; setPlaying(false); }
      }
    }) : () => {});
    elements.forEach((v, i) => { if (v) v.currentTime = starts[i]; });
    return () => { running.current = false; abort.current?.abort(); clean.forEach(c => c()); elements.forEach(v => v?.pause()); };
  }, [startA, startB, lengthA, lengthB]);
  function commitStart(i: number) {
    const n = Number(draftStarts[i]);
    if (draftStarts[i] === "" || !Number.isFinite(n) || n < bindings[i].video_start_s || n + observations[i].elapsed_s > Math.min(videos[i].duration, bindings[i].video_end_s)) {
      setDraftStarts(starts.map(String)); return;
    }
    stop(); onStartsChange(i === 0 ? [n, starts[1]] : [starts[0], n]);
  }
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
    <div className="grid min-w-0 gap-4 lg:grid-cols-2" data-testid="review-media-grid">
    <div className="order-2 col-span-full flex flex-wrap items-center gap-3" data-testid="review-playback-controls">
      <button className={`${dualButton} border-yellow-400 text-yellow-300`} onClick={() => playing ? stop() : void play()}>{playing ? <Pause size={16} /> : <Play size={16} />}{zh ? "两侧播放 / 暂停 · 同一空间区间" : "Play / pause both · shared interval"}</button>
      <ReviewAudioControl value={audio} onChange={setAudio} />
    </div>
    {videos.map((v, i) => <div key={i} className="contents">
      <div className="order-1 min-w-0" data-testid="review-media">
      <h3 className="mb-2 font-semibold">{i === 0 ? "A" : "B"} · L{sessions[i].selected_lap}</h3>
      <div className="relative"><video ref={i === 0 ? a : b} src={v.url} controls muted={audio !== i} playsInline className="aspect-video w-full bg-black"
        onLoadedMetadata={e => { e.currentTarget.currentTime = starts[i]; }} />
        <GoproSpeedOverlay file={v.file} time={times[i]} /></div>
      <div className="flex flex-wrap gap-4 py-2 font-mono text-xs"><span>{starts[i].toFixed(2)}–{ends[i].toFixed(2)}s</span></div>
      <label className="block text-xs">{i === 0 ? "A" : "B"} · {zh ? "本片段起点（不改整圈锚点）" : "Clip start (lap anchor unchanged)"}
        <input className={dualInput} type="number" step={.01} min={bindings[i].video_start_s} max={bindings[i].video_end_s - observations[i].elapsed_s}
          value={draftStarts[i]} onChange={e => setDraftStarts(d => d.map((s, j) => i === j ? e.target.value : s))}
          onBlur={() => commitStart(i)} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /></label>
      {Math.abs(starts[i] - observations[i].start_session_s - bindings[i].offset_s) > .5 && <p className="text-xs text-amber-200">{zh ? "调整已超出人工 ±0.5 秒范围，请重新核对圈号与参照物。GPS 警告未解除。" : "Adjustment exceeds ±0.5s. Recheck lap and landmarks; GPS warnings remain."}</p>}
      <DriverGpsNotice video={v} fingerprint={sessions[i].file_fingerprint} observation={observations[i]} />
      </div>
      <div className="order-3 min-w-0" data-testid="review-telemetry"><h4 className="text-sm font-semibold">{i === 0 ? "A" : "B"} · L{sessions[i].selected_lap}</h4><DriverClipTelemetry session={sessions[i]} observation={observations[i]} videoTime={times[i]} videoStart={starts[i]} confirmed={confirmed} domains={domains} /></div>
    </div>)}</div>
    <ReviewBoundaryCheck key={starts.join(":")} reference={{ url: videos[0].url, start: starts[0], end: ends[0], duration: videos[0].duration, lap: sessions[0].selected_lap, label: "A", confirmed }}
      target={{ url: videos[1].url, start: starts[1], end: ends[1], duration: videos[1].duration, lap: sessions[1].selected_lap, label: "B", confirmed }}
      onSeek={time => { stop(); if (b.current) b.current.currentTime = time; }} />
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={e => onConfirm(e.target.checked)} />
      {zh ? "已核对两侧起点是同一位置、同一行驶方向；将此对照加入总结" : "Both starts are the same location and direction; include this comparison in the debrief"}</label>
    <p className="text-xs text-slate-400">{zh ? "人工起点保留 ±0.5 秒不确定性；两侧各播到同一出口，不拉伸时间。GPS 配准不等于视频同步。未确认位置时，不显示与画面绑定的 AiM 读数。" : "Manual starts retain ±0.5s uncertainty. Both clips reach the same exit at real playback speed. GPS registration is not video synchronization; frame-linked AiM readings require location confirmation."}</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}

function DriverClipTelemetry({ session, observation, videoTime, videoStart, confirmed, domains }: {
  session: DriverSession; observation: CornerObservation; videoTime: number; videoStart: number; confirmed: boolean;
  domains: Record<"speed" | "rpm", [number, number]>;
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  const time = confirmed ? clipTelemetryTime(videoTime, videoStart, observation) : null;
  const data = useMemo(() => session.track.filter(p => p.session_time_s >= observation.start_session_s && p.session_time_s <= observation.end_session_s)
    .map(p => ({ ...p, elapsed: p.session_time_s - observation.start_session_s })), [session.track, observation.start_session_s, observation.end_session_s]);
  return <section className="mt-3 min-w-0" data-testid="driver-clip-telemetry">
    <p className="text-xs text-amber-200">{confirmed ? (zh ? "AiM · 按本片段已确认起点同步 · ±0.5s" : "AiM · confirmed clip start · ±0.5s") : (zh ? "AiM 候选区间，尚未确认与画面对应" : "Candidate AiM interval; video location unconfirmed")}</p>
    <output className="block py-2 font-mono text-sm" data-session-time={time ?? ""}>AiM GPS: {time === null ? "—" : channelAt(session.track, time, "speed")?.toFixed(1) ?? "—"} km/h · RPM: {time === null ? "—" : channelAt(session.track, time, "rpm")?.toFixed(0) ?? "—"}</output>
    {(["speed", "rpm"] as const).map(channel => <div className="h-32 min-w-0" key={channel} aria-label={`AiM ${channel}`}>
      <ResponsiveContainer width="100%" height="100%"><LineChart data={data}><CartesianGrid stroke="#263341" />
        <XAxis type="number" dataKey="elapsed" domain={[0, observation.elapsed_s]} tickFormatter={v => Number(v).toFixed(1)} unit="s" /><YAxis width={55} domain={domains[channel]} tickFormatter={v => Number(v).toFixed(0)} />
        <Line dataKey={channel} stroke={channel === "speed" ? "#2dd4bf" : "#facc15"} dot={false} connectNulls={false} isAnimationActive={false} />
        {time !== null && <ReferenceLine x={time - observation.start_session_s} stroke="#fff" />}</LineChart></ResponsiveContainer>
    </div>)}
  </section>;
}

export function DriverGpsNotice({ video, fingerprint, observation }: {
  video: LocalDriverVideo; fingerprint?: string; observation: CornerObservation;
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  const [evidence, setEvidence] = useState<ReviewGpsEvidence | null>(null);
  useEffect(() => {
    const read = () => {
      try { setEvidence(fingerprint ? parseReviewGpsEvidence(localStorage.getItem(reviewGpsKey(fingerprint)), reviewVideoIdentity(video.file, video.duration)) : null); }
      catch { setEvidence(null); }
    };
    queueMicrotask(read); window.addEventListener(REVIEW_GPS_EVENT, read);
    return () => window.removeEventListener(REVIEW_GPS_EVENT, read);
  }, [video.file, video.duration, fingerprint]);
  const bad = evidence?.segments.filter(s => s.status === "gps_inconsistent" && s.session_range_s[0] < observation.end_session_s && s.session_range_s[1] > observation.start_session_s) ?? [];
  return <p className="mt-2 text-xs text-amber-200" data-testid="driver-gps-warning">{bad.length
    ? (zh ? "GPS 异常区间：两路信号不一致。人工确认和参照物相似不会解除该警告。" : "GPS anomaly: the two signals disagree. Manual confirmation and similar scenery do not clear this warning.")
    : (zh ? "GPS 与画面延迟仍有不确定性，人工位置确认不代表自动同步通过。" : "GPS-to-video latency remains uncertain; manual location confirmation is not an automatic synchronization pass.")}
    {bad.map((s, i) => <span key={i} className="block">AiM {s.session_range_s.map(t => t.toFixed(2)).join("–")}s</span>)}</p>;
}
