"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Pause, Play, RotateCcw, Scissors, Upload, X } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { calibratedReviewWindow, reviewIdentity, reviewValue, type ReviewSelection, type ReviewWindow } from "../lib/coachReview";
import { createVideoSyncCalibration, type VideoSyncCalibration } from "../lib/videoTelemetrySync";
import { manualReviewWindow, restoreManualReview, reviewDistanceAtTime, reviewVideoIdentity, validateManualReview,
  type ManualReviewClip, type ReviewSide } from "../lib/manualReview";
import type { ClipFeedbackInput } from "../lib/feedbackApi";

const TEXT = {
  zh: {
    reference: "参考快圈", target: "目标圈", add: "添加 / 调整片段", choose: "选择本地视频", current: "使用已载入视频",
    auto: "自动片段", manual: "人工片段", play: "播放", pause: "暂停", replay: "重播", loop: "循环", rate: "播放速度",
    pair: "两侧从起点播放", stop: "暂停两侧", pairNote: "两侧按各自真实时间播放，不拉伸视频；不是逐帧同距离锁定。",
    missing: "无可用自动片段，可直接人工添加。", noVideo: "尚未选择本地视频", error: "视频暂时无法播放，请重新选择可读的本地视频。",
    timeline: "视频时间轴", now: "当前时间", start: "片段起点（秒）", end: "片段终点（秒）", markStart: "设为起点", markEnd: "设为终点",
    earlier: "后退 0.1 秒", later: "前进 0.1 秒", sync: "遥测位置", entry: "弯道入口", minimum: "最低速度位置", exit: "弯道出口", downstream: "下游终点",
    anchor: "绑定当前画面与所选位置", checked: "已核对圈号与画面对应位置", linked: "人工核对同步", unlinked: "仅视频预览 · 遥测同步未确认",
    apply: "应用人工片段", cancel: "取消调整", reset: "恢复自动片段", saved: "人工片段已保存到本浏览器；原自动片段保留。",
    windowError: "请选择视频范围内的有效起点、终点，时长须为 0.1–120 秒。", linkError: "此片段无法完整对应本圈连续遥测，请调整范围或重新核对锚点。",
    anchorMissing: "请先绑定一个可确认的位置，再勾选同步。", localOnly: "视频不上传。时间差来自相同赛道区间的遥测，不是剪辑时长之差。",
    cropNote: "裁剪不会自动完成同步；没有可靠锚点时可以先保存预览。", boundaryNote: "人工片段仅覆盖该弯的一部分；上方时间差仍对应完整公共区间。",
    scope: "对应遥测圈", history: "已恢复该视频的人工片段", anchorAt: "已绑定", revision: "修正时间", speed: "GPS 速度", rpm: "RPM",
  },
  en: {
    reference: "Reference fast lap", target: "Selected lap", add: "Add / Adjust clip", choose: "Choose local video", current: "Use loaded video",
    auto: "Automatic clip", manual: "Manual clip", play: "Play", pause: "Pause", replay: "Replay", loop: "Loop", rate: "Playback speed",
    pair: "Play both from start", stop: "Pause both", pairNote: "Each clip keeps its real timing, without time stretching or frame-by-frame distance locking.",
    missing: "No automatic clip available. Add a manual clip here.", noVideo: "No local video selected", error: "The video could not be played. Reselect a readable local file.",
    timeline: "Video timeline", now: "Current time", start: "Clip start (s)", end: "Clip end (s)", markStart: "Set start", markEnd: "Set end",
    earlier: "Back 0.1 second", later: "Forward 0.1 second", sync: "Telemetry location", entry: "Corner entry", minimum: "Minimum speed location", exit: "Corner exit", downstream: "Downstream end",
    anchor: "Bind current frame to selected location", checked: "I checked the lap and matching video location", linked: "Manually checked sync", unlinked: "Video preview only · Sync unconfirmed",
    apply: "Apply manual clip", cancel: "Cancel edit", reset: "Restore automatic clip", saved: "Manual clip saved in this browser; the automatic clip is retained.",
    windowError: "Select valid start/end times within the video, spanning 0.1–120 seconds.", linkError: "This clip does not map to continuous telemetry in this lap. Adjust its range or anchor.",
    anchorMissing: "Bind an identifiable location before confirming synchronization.", localOnly: "Video stays local. Deltas use the same track interval, not the difference between crop durations.",
    cropNote: "Cropping does not establish synchronization. Save a preview first if no reliable anchor is available.", boundaryNote: "This manual clip covers only part of the corner; the deltas above still use the complete shared interval.",
    scope: "Bound telemetry lap", history: "Restored the manual clip for this video", anchorAt: "Anchor", revision: "Revision", speed: "GPS speed", rpm: "RPM",
  },
};
const btn = "inline-flex items-center justify-center gap-2 rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-cyan-400 disabled:opacity-40";
const input = "w-full min-w-0 rounded border border-slate-700 bg-slate-950 p-2 text-sm text-slate-200";
type PairCommand = { type: "play" | "pause"; sequence: number };
export type ReviewFeedbackState = {
  clipId: string; side: ReviewSide; source: "automatic" | "manual"; clip: ReviewWindow | null;
  enabled: boolean; syncConfirmed: boolean; correction: ClipFeedbackInput["correction"];
};
type Props = {
  review: ReviewSelection; fingerprint: string; defaultFile: File | null; defaultUrl: string; defaultDuration: number;
  targetCalibration: VideoSyncCalibration | null; referenceCalibration: VideoSyncCalibration | null;
  context: boolean; onCursor: (distance: number) => void; feedback: (state: ReviewFeedbackState) => ReactNode;
};

export function ManualReviewVideo(props: Props) {
  const { locale } = useI18n(), c = TEXT[locale];
  const [command, setCommand] = useState<PairCommand>({ type: "pause", sequence: 0 });
  const [ready, setReady] = useState({ reference: false, target: false });
  const onReady = useCallback((side: ReviewSide, value: boolean) => setReady(p => p[side] === value ? p : { ...p, [side]: value }), []);
  return <div>
    <div className="grid min-w-0 gap-5 xl:grid-cols-2">
      {(["reference", "target"] as const).map(side => <ReviewVideoSide key={`${side}:${side === "reference" ? props.review.referenceLap : props.review.targetLap}`} {...props} side={side} command={command} onReady={onReady} />)}
    </div>
    <div className="mt-4 flex flex-wrap gap-3">
      <button className={btn} disabled={!ready.reference || !ready.target} onClick={() => setCommand(p => ({ type: "play", sequence: p.sequence + 1 }))}><Play size={15} />{c.pair}</button>
      <button className={btn} onClick={() => setCommand(p => ({ type: "pause", sequence: p.sequence + 1 }))}><Pause size={15} />{c.stop}</button>
    </div>
    <p className="mt-2 text-xs text-slate-400">{c.pairNote}</p>
    <p className="mt-2 text-xs text-slate-500">{c.localOnly}</p>
  </div>;
}

function ReviewVideoSide({ review, fingerprint, defaultFile, defaultUrl, defaultDuration, targetCalibration, referenceCalibration,
  context, onCursor, feedback, side, command, onReady }: Props & { side: ReviewSide; command: PairCommand; onReady: (side: ReviewSide, ready: boolean) => void }) {
  const { locale } = useI18n(), c = TEXT[locale];
  const lap = side === "reference" ? review.referenceLap : review.targetLap;
  const trace = side === "reference" ? review.reference : review.target;
  const calibration = side === "reference" ? referenceCalibration : targetCalibration;
  const key = `racing-manual-review:v1:${fingerprint}:${review.id}:${side}:${lap}`;
  const video = useRef<HTMLVideoElement>(null);
  const [ownFile, setOwnFile] = useState<File | null>(null), [ownResource, setOwnResource] = useState<{ file: File; url: string } | null>(null);
  const [ownDuration, setOwnDuration] = useState(0);
  const file = ownFile ?? defaultFile, duration = ownFile ? ownDuration : defaultDuration;
  const url = ownFile ? ownResource?.file === ownFile ? ownResource.url : "" : defaultUrl;
  const identity = useMemo(() => file ? reviewVideoIdentity(file, duration) : null, [file, duration]);
  const [mode, setMode] = useState<"automatic" | "manual">("automatic"), [editing, setEditing] = useState(false);
  const [manual, setManual] = useState<ManualReviewClip | null>(null);
  const [start, setStart] = useState(0), [end, setEnd] = useState(4), [now, setNow] = useState(0);
  const [anchorDistance, setAnchorDistance] = useState(review.focus);
  const [draftAnchor, setDraftAnchor] = useState<VideoSyncCalibration | null>(null), [confirmed, setConfirmed] = useState(false);
  const [playing, setPlaying] = useState(false), [loop, setLoop] = useState(false), [rate, setRate] = useState(1);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const auto = calibratedReviewWindow(trace, lap, review.focus, calibration, file, duration, context ? { entry: review.entry, exit: review.downstreamEnd } : undefined);
  const original = calibratedReviewWindow(trace, lap, review.focus, calibration, defaultFile, defaultDuration, context ? { entry: review.entry, exit: review.downstreamEnd } : undefined);
  const validManual = manual && identity && !validateManualReview(manual, trace, lap, identity) ? manual : null;
  const clip = mode === "manual" ? validManual ? manualReviewWindow(validManual, trace, review.focus) : null : auto;
  const activeAnchor = mode === "manual" ? validManual?.sync_confirmed ? validManual.calibration : null : auto ? calibration : null;
  const signature = JSON.stringify(["manual-review-v1", fingerprint, review.id, side, lap, mode, clip, identity, activeAnchor, review.entry, review.exit, review.downstreamEnd, review.referenceLap, review.targetLap]);
  const originalSignature = JSON.stringify(["manual-review-v1", fingerprint, review.id, side, lap, "automatic", original,
    defaultFile ? reviewVideoIdentity(defaultFile, defaultDuration) : null, original ? calibration : null, review.entry, review.exit, review.downstreamEnd, review.referenceLap, review.targetLap]);
  const [hash, setHash] = useState<{ signature: string; id: string; originalSignature: string; original: string } | null>(null);
  const [watched, setWatched] = useState("");
  const lastCommand = useRef(command.sequence);
  const clipStart = clip?.start_s;

  useEffect(() => {
    if (!ownFile) return;
    const localUrl = URL.createObjectURL(ownFile);
    queueMicrotask(() => setOwnResource({ file: ownFile, url: localUrl }));
    return () => URL.revokeObjectURL(localUrl);
  }, [ownFile]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const id = await reviewIdentity(signature), originalId = await reviewIdentity(originalSignature);
      if (alive) setHash({ signature, id, originalSignature, original: originalId });
    })();
    return () => { alive = false; };
  }, [signature, originalSignature]);
  useEffect(() => {
    if (!identity || duration <= 0) return;
    try {
      const restored = restoreManualReview(localStorage.getItem(key), trace, lap, identity);
      if (restored) queueMicrotask(() => { setManual(restored); setMode("manual"); setStart(restored.start_s); setEnd(restored.end_s); setDraftAnchor(restored.calibration); setConfirmed(restored.sync_confirmed); setNotice("history"); });
    } catch { /* Private browsing can disable optional storage. */ }
  }, [key, trace, lap, identity, duration]);
  const playable = Boolean(url && clip && !editing);
  useEffect(() => { onReady(side, playable); return () => onReady(side, false); }, [side, playable, onReady]);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.pause();
    if (clipStart !== undefined && !editing) element.currentTime = clipStart;
    queueMicrotask(() => setPlaying(false));
    return () => element.pause();
  }, [signature, clipStart, editing]); // A different crop must never inherit the old play head.
  useEffect(() => {
    const element = video.current;
    if (!element || !command.sequence || lastCommand.current === command.sequence) return;
    lastCommand.current = command.sequence;
    if (command.type === "pause") { element.pause(); return; }
    if (clipStart === undefined || editing) return;
    element.currentTime = clipStart;
    void element.play().catch(() => setError("error"));
  }, [command, clipStart, editing]); // Pair commands are explicit user actions, not render-driven playback.

  function seek(time: number) {
    if (!video.current || !Number.isFinite(time)) return;
    video.current.currentTime = Math.max(0, Math.min(duration, time));
    setNow(video.current.currentTime);
  }
  function openEditor() {
    video.current?.pause(); setError(""); setNotice("");
    setStart(clip?.start_s ?? 0); setEnd(clip?.end_s ?? Math.min(duration || 4, 4));
    setDraftAnchor(activeAnchor); setConfirmed(Boolean(activeAnchor)); setEditing(true);
  }
  function loadFile(next: File) {
    video.current?.pause(); setOwnFile(next); setOwnDuration(0); setManual(null); setMode("automatic");
    setDraftAnchor(null); setConfirmed(false); setStart(0); setEnd(4); setNow(0); setError(""); setNotice(""); setEditing(true);
  }
  function bindAnchor() {
    const time = reviewValue(trace, anchorDistance, "session_time_s");
    if (!file || !video.current || time === null || duration <= 0) { setError("anchorMissing"); return; }
    setDraftAnchor(createVideoSyncCalibration({ videoTimeS: video.current.currentTime,
      telemetryPoint: { distance_m: anchorDistance, session_time_s: time }, targetLap: lap, videoDurationS: duration,
      fileSizeBytes: file.size, fileLastModifiedMs: file.lastModified, fileMimeType: file.type }));
    setConfirmed(false); setError("");
  }
  function applyManual() {
    if (!identity) return;
    const next: ManualReviewClip = { version: 1, lap, start_s: start, end_s: end, video: identity,
      calibration: confirmed ? draftAnchor : null, sync_confirmed: confirmed, saved_at: new Date().toISOString() };
    const problem = validateManualReview(next, trace, lap, identity);
    if (problem) { setError(problem === "invalid_window" ? "windowError" : problem === "anchor_required" ? "anchorMissing" : "linkError"); return; }
    setManual(next); setMode("manual"); setEditing(false); setWatched(""); setError(""); setNotice("saved");
    try {
      const history = JSON.parse(localStorage.getItem(key) ?? "[]");
      // Keep bounded revision metadata; feedback on the original is never overwritten.
      localStorage.setItem(key, JSON.stringify([next, ...(Array.isArray(history) ? history.slice(0, 9) : [])]));
    } catch { /* The active clip remains usable without local storage. */ }
  }
  function togglePlay(restart = false) {
    const element = video.current;
    if (!element) return;
    if (!element.paused && !restart) { element.pause(); return; }
    if (restart || (!editing && clip && (element.currentTime < clip.start_s || element.currentTime >= clip.end_s))) seek(editing ? start : clip!.start_s);
    void element.play().catch(() => setError("error"));
  }
  const correction: ClipFeedbackInput["correction"] = mode === "manual" ? {
    original_clip_id: original && hash?.originalSignature === originalSignature ? hash.original : null,
    original_start_s: original?.start_s ?? null, original_end_s: original?.end_s ?? null,
    anchor_video_s: activeAnchor?.video_time_s ?? null, anchor_session_s: activeAnchor?.telemetry_session_time_s ?? null,
    anchor_distance_m: activeAnchor?.telemetry_distance_m ?? null,
  } : null;
  const manualCoversZone = !validManual?.sync_confirmed || !activeAnchor || (() => {
    const a = reviewValue(trace, review.entry, "session_time_s"), b = reviewValue(trace, review.exit, "session_time_s");
    return a !== null && b !== null && validManual.start_s <= a + activeAnchor.offset_ms / 1000 && validManual.end_s >= b + activeAnchor.offset_ms / 1000;
  })();
  const currentDistance = activeAnchor && !editing ? reviewDistanceAtTime(trace, now - activeAnchor.offset_ms / 1000) : null;
  const speed = currentDistance === null ? null : reviewValue(trace, currentDistance, "speed");
  const rpm = currentDistance === null ? null : reviewValue(trace, currentDistance, "rpm");
  return <section className="min-w-0" aria-label={`${c[side]} L${lap}`} data-testid={`review-video-${side}`}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h5 className={`font-semibold ${side === "reference" ? "text-amber-300" : "text-cyan-300"}`}>{c[side]} L{lap}</h5>
      <button className={btn} onClick={openEditor}><Scissors size={15} />{c.add}</button>
    </div>
    <p className="mb-2 text-xs text-slate-400">{c.scope}: L{lap}</p>
    {url && (editing || clip) ? <video ref={video} src={url} muted playsInline preload="metadata" className="aspect-video w-full bg-black object-contain" aria-label={`${c[side]} L${lap}`}
      onError={() => setError("error")} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onLoadedMetadata={event => { const el = event.currentTarget; if (ownFile && Number.isFinite(el.duration)) { setOwnDuration(el.duration); setEnd(p => Math.min(p, el.duration)); } el.playbackRate = rate; if (!editing && clip) el.currentTime = clip.start_s; }}
      onTimeUpdate={event => {
        const el = event.currentTarget; setNow(el.currentTime);
        if (!editing && clip && !el.paused) setWatched(signature);
        if (!editing && activeAnchor) { const d = reviewDistanceAtTime(trace, el.currentTime - activeAnchor.offset_ms / 1000); if (d !== null) onCursor(d); }
        if (!editing && clip && el.currentTime >= clip.end_s) { el.pause(); el.currentTime = clip.start_s; if (loop) void el.play().catch(() => setError("error")); }
      }} /> : <div className="flex aspect-video items-center justify-center bg-slate-950 p-4 text-center text-sm text-slate-400">{!url ? c.noVideo : c.missing}</div>}
    {editing && <div className="mt-3 space-y-3 border-y border-slate-700 py-3">
      <label className={`${btn} cursor-pointer`}><Upload size={15} />{c.choose}<input type="file" className="hidden" accept="video/mp4,video/quicktime,.mp4,.mov" onChange={e => { const next = e.target.files?.[0]; if (next) loadFile(next); e.target.value = ""; }} /></label>
      {ownFile && defaultFile && <button className={`${btn} ml-2`} onClick={() => { setOwnFile(null); setManual(null); setDraftAnchor(null); setConfirmed(false); setStart(0); setEnd(Math.min(defaultDuration, 4)); }}>{c.current}</button>}
      <input className="w-full accent-cyan-400" type="range" aria-label={c.timeline} min={0} max={duration || 1} step={.01} value={Math.min(now, duration || 1)} disabled={!duration} onChange={e => seek(Number(e.target.value))} />
      <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-slate-300">{c.now}: {now.toFixed(2)}s</span>
        <button className={btn} title={c.earlier} aria-label={c.earlier} disabled={!duration} onClick={() => seek(now - .1)}><ChevronLeft size={16} /></button>
        <button className={btn} title={c.later} aria-label={c.later} disabled={!duration} onClick={() => seek(now + .1)}><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="min-w-0 text-xs text-slate-400">{c.start}<input className={input} type="number" step={.01} min={0} max={duration} value={start} onChange={e => setStart(Number(e.target.value))} /></label>
        <label className="min-w-0 text-xs text-slate-400">{c.end}<input className={input} type="number" step={.01} min={0} max={duration} value={end} onChange={e => setEnd(Number(e.target.value))} /></label>
        <button className={btn} disabled={!duration} onClick={() => setStart(Number(now.toFixed(3)))}>{c.markStart}</button>
        <button className={btn} disabled={!duration} onClick={() => setEnd(Number(now.toFixed(3)))}>{c.markEnd}</button>
      </div>
      <label className="block text-xs text-slate-400">{c.sync}<select className={input} value={anchorDistance} onChange={e => { setAnchorDistance(Number(e.target.value)); setConfirmed(false); setDraftAnchor(null); }}>
        {([["entry", review.entry], ["minimum", review.focus], ["exit", review.exit], ["downstream", review.downstreamEnd]] as const).map(([label, d]) => <option key={label} value={d}>{c[label]} · {d.toFixed(1)}m</option>)}
      </select></label>
      <button className={btn} disabled={!duration} onClick={bindAnchor}>{c.anchor}</button>
      {draftAnchor && <p className="text-xs text-slate-400">{c.anchorAt}: {draftAnchor.video_time_s.toFixed(2)}s = {draftAnchor.telemetry_distance_m.toFixed(1)}m · L{lap}</p>}
      <label className="flex items-start gap-2 text-xs text-slate-300"><input type="checkbox" disabled={!draftAnchor} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{c.checked}</label>
      <p className="text-xs text-slate-400">{c.cropNote}</p>
      <div className="flex flex-wrap gap-2"><button className={btn} disabled={!duration} onClick={applyManual}><Check size={15} />{c.apply}</button><button className={btn} onClick={() => { setEditing(false); setError(""); }}><X size={15} />{c.cancel}</button></div>
    </div>}
    {url && (editing || clip) && <div className="mt-3 flex flex-wrap items-center gap-2">
      <button className={btn} onClick={() => togglePlay()} aria-label={playing ? c.pause : c.play}>{playing ? <Pause size={15} /> : <Play size={15} />}{playing ? c.pause : c.play}</button>
      <button className={btn} title={c.replay} aria-label={c.replay} onClick={() => togglePlay(true)}><RotateCcw size={15} /></button>
      <label className="flex items-center gap-1 text-xs text-slate-300"><input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} />{c.loop}</label>
      <select className="rounded border border-slate-700 bg-slate-950 p-2 text-xs" aria-label={c.rate} value={rate} onChange={e => { const next = Number(e.target.value); setRate(next); if (video.current) video.current.playbackRate = next; }}>{[.25, .5, 1].map(r => <option key={r} value={r}>{r}×</option>)}</select>
    </div>}
    {!editing && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400"><span>{c[mode === "manual" ? "manual" : "auto"]}{clip ? ` · ${clip.start_s.toFixed(2)}–${clip.end_s.toFixed(2)}s` : ""}</span>
      {validManual && <button className={btn} onClick={() => { setMode(p => p === "manual" ? "automatic" : "manual"); setError(""); setNotice(""); }}>{mode === "manual" ? c.reset : c.manual}</button>}
    </div>}
    {clip && !editing && <p className={`mt-2 text-xs ${activeAnchor ? "text-emerald-300" : "text-amber-300"}`}>{activeAnchor ? c.linked : c.unlinked}</p>}
    {clip && !editing && <dl className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-400" aria-label={`${c[side]} ${c.sync}`}>
      <div><dt>{c.speed}</dt><dd className="mt-1 font-mono text-sm text-white">{speed === null ? "—" : speed.toFixed(1)} km/h</dd></div>
      <div><dt>{c.rpm}</dt><dd className="mt-1 font-mono text-sm text-white">{rpm === null ? "—" : Math.round(rpm)} rpm</dd></div>
    </dl>}
    {!manualCoversZone && mode === "manual" && <p className="mt-2 text-xs text-amber-300">{c.boundaryNote}</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-300">{c[error as keyof typeof c]}</p>}
    {notice && <p role="status" className="mt-2 text-xs text-slate-400">{c[notice as keyof typeof c]}</p>}
    {mode === "manual" && validManual && <p className="mt-1 text-xs text-slate-500">{c.revision}: {validManual.saved_at.replace("T", " ").slice(0, 19)} UTC</p>}
    {feedback({ clipId: hash?.signature === signature ? hash.id : "", side, source: mode, clip,
      enabled: Boolean(!editing && clip && hash?.signature === signature && hash.originalSignature === originalSignature && watched === signature), syncConfirmed: Boolean(activeAnchor), correction })}
  </section>;
}
