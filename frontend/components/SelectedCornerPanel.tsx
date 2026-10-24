"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Pause, Play, ScanEye, Scissors, X } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "../lib/i18n";
import type { XrkAnalysis } from "../lib/xrkAnalysisApi";
import type { VideoSyncCalibration } from "../lib/videoTelemetrySync";
import { matchesReviewVideo, reviewVideoIdentity } from "../lib/manualReview";
import { analyzeSelectedCorner, browsableCornerLaps, cornerTelemetryDomains, cornerVideoWindow, selectCornerWindow, type CornerLap, type CornerRequest, type SelectedCornerResult } from "../lib/selectedCorner";
import { checkSelectedCornerFrames } from "../lib/selectedCornerVisual";
import { parseReviewGpsEvidence, reviewGpsKey, reviewGpsOverlaps, REVIEW_GPS_EVENT } from "../lib/reviewGpsEvidence";
import { observeVideoClock } from "../lib/videoFrameClock";
import { GoproSpeedOverlay } from "./GoproSpeedOverlay";
import { ReviewGpsNotice } from "./ReviewGpsNotice";
import { ReviewAudioControl } from "./ReviewAudioControl";
import { CornerCandidateNavigation, SelectedCornerTelemetry } from "./SelectedCornerTelemetry";
import { CornerCoachComparison } from "./CornerCoachComparison";
import { compareCornerBest } from "../lib/cornerCoach";

type Visual = Awaited<ReturnType<typeof checkSelectedCornerFrames>>;
const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded border border-slate-600 px-3 py-2 text-sm hover:border-cyan-400 disabled:opacity-40";
const input = "min-w-0 rounded border border-slate-600 bg-slate-950 p-2 text-sm text-white";
const colors = ["#35d6d0", "#f6c945", "#ff5964"];
const num = (value: number | null | undefined, digits = 3) => typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
const reasonText = (reason: string | null, zh: boolean) => {
  const names: Record<string, [string, string]> = {
    lap_quality_gate: ["未通过圈质量门", "Lap quality gate"], gps_registration_rejected: ["GPS 配准未通过", "GPS registration rejected"],
    non_unique_or_missing_gate_crossing: ["起终位置缺失或重复", "Missing / repeated gate crossing"],
    corner_timing_gap: ["区段内计时缺口", "Timing gap"], corner_speed_or_distance_gap: ["速度或距离缺口", "Speed / distance gap"],
    gate_order_or_duration: ["起终顺序或时长异常", "Gate order / duration invalid"], session_review_limit: ["超出本次 60 圈限制", "60-lap review limit"],
    corner_path_gps_inconsistent: ["区间轨迹不一致，保留 GPS 异常", "Section paths disagree; GPS warning retained"],
  };
  return names[reason ?? ""]?.[zh ? 0 : 1] ?? (zh ? "区段数据不足" : "Insufficient section data");
};

export function SelectedCornerPanel({ analysis, file, url, duration, anchors, onSync, expanded = false, onResult, active = true }: {
  analysis: XrkAnalysis; file: File | null; url: string; duration: number;
  anchors: VideoSyncCalibration[]; onSync: () => void;
  expanded?: boolean; onResult?: (result: SelectedCornerResult | null) => void;
  active?: boolean;
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  const [open, setOpen] = useState(expanded);
  const video = file ? reviewVideoIdentity(file, duration) : null;
  const usable = anchors.filter(a => video && matchesReviewVideo(a.video, video)
    && analysis.lap_quality.laps.some(l => l.lap === a.target_lap && l.analysis_eligible));
  return <section className="min-w-0 border-y border-slate-700 py-5" data-testid="selected-corner-panel">
    <details open={expanded || undefined} onToggle={event => setOpen(event.currentTarget.open)}><summary className="flex cursor-pointer items-center gap-2 py-2 text-lg font-semibold text-white"><Scissors size={20} />{zh ? "自选弯道 · 各圈开法" : "Choose a corner · Driving patterns"}</summary>
      {!file || !url || !usable.length ? <div className="mt-3"><p className="mb-3 text-sm text-slate-400">{zh ? "需要本地视频和至少一圈已确认的人工同步。" : "A local video and a confirmed real-lap anchor are required."}</p><button className={button} onClick={onSync}>{zh ? "选择视频 / 确认同步" : "Choose video / Confirm sync"}</button></div>
        : <CornerWorkspace key={`${analysis.file_fingerprint}:${file.size}:${file.lastModified}:${usable.map(a => a.calibrated_at).join(":")}`}
          analysis={analysis} file={file} url={url} duration={duration} anchors={usable} onResult={onResult} active={active && (expanded || open)} />}
    </details>
  </section>;
}

function CornerWorkspace({ analysis, file, url, duration, anchors, onResult, active: visible }: {
  analysis: XrkAnalysis; file: File; url: string; duration: number; anchors: VideoSyncCalibration[];
  onResult?: (result: SelectedCornerResult | null) => void;
  active: boolean;
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  const [sourceLap, setSourceLap] = useState(anchors[0].target_lap);
  const anchor = anchors.find(a => a.target_lap === sourceLap)!;
  const [start, setStart] = useState(anchors[0].video_time_s + 1), [now, setNow] = useState(0);
  const [result, setResult] = useState<SelectedCornerResult | null>(null), [request, setRequest] = useState<CornerRequest | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [selectedLap, setSelectedLap] = useState<number | null>(null), [confirmed, setConfirmed] = useState<number[]>([]);
  const [reviewPair, setReviewPair] = useState<{ left: number; right: number } | null>(null);
  const [verdicts, setVerdicts] = useState<Record<number, "yes" | "no" | "uncertain">>({});
  const [visuals, setVisuals] = useState<Record<number, Visual>>({}), [progress, setProgress] = useState("");
  const [visualErrors, setVisualErrors] = useState<number[]>([]), [groupCurrent, setGroupCurrent] = useState(false);
  const [fullInterval, setFullInterval] = useState(true), [gpsRaw, setGpsRaw] = useState<string | null>(null);
  const [audio, setAudio] = useState<number | null>(0);
  useEffect(() => { onResult?.(groupCurrent ? result : null); }, [groupCurrent, result, onResult]);
  const sourcePlayer = useRef<HTMLVideoElement>(null), targetPlayer = useRef<HTMLVideoElement>(null);
  const abort = useRef<AbortController | null>(null), visualAbort = useRef<AbortController | null>(null);
  const identity = useMemo(() => reviewVideoIdentity(file, duration), [file, duration]);
  const gps = useMemo(() => parseReviewGpsEvidence(gpsRaw, identity), [gpsRaw, identity]);
  const window = selectCornerWindow(start, anchor, identity, analysis.video_sync.lap_video_ranges);
  const active = result?.laps.find(l => l.lap === selectedLap);
  const leftLap = reviewPair?.left ?? sourceLap;
  const sourceRow = result?.laps.find(l => l.lap === leftLap);
  const candidates = result ? browsableCornerLaps(result.laps, anchor, duration, anchors) : [];
  const domains = useMemo(() => cornerTelemetryDomains([sourceRow, active]), [sourceRow, active]);
  const elapsedLimit = Math.max(sourceRow?.elapsed_s ?? 0, active?.elapsed_s ?? 0, 1);
  const activeWindow = active ? cornerVideoWindow(active, anchor, duration, anchors) : null;
  const selectionWindow = useMemo(() => result ? { start: result.start_session_s + anchor.offset_ms / 1000, end: result.end_session_s + anchor.offset_ms / 1000 } : null, [result, anchor.offset_ms]);
  const sourceWindow = useMemo(() => sourceRow ? cornerVideoWindow(sourceRow, anchor, duration, anchors) : null, [sourceRow, anchor, duration, anchors]);
  const flagged = useCallback((row: CornerLap) => {
    const clip = cornerVideoWindow(row, anchor, duration, anchors);
    return clip && reviewGpsOverlaps(gps, clip.start - .5, clip.end + .5, clip.offset).some(s => s.status === "gps_inconsistent");
  }, [anchor, duration, anchors, gps]);
  const coach = useMemo(() => result ? compareCornerBest(result.laps, result.laps.filter(flagged).map(r => r.lap),
    result.laps.filter(r => verdicts[r.lap] === "no").map(r => r.lap), result.laps.filter(row => {
      const clip = cornerVideoWindow(row, anchor, duration, anchors);
      return clip && typeof row.downstream_s === "number" && reviewGpsOverlaps(gps, clip.end - .5, clip.end + row.downstream_s + .5, clip.offset)
        .some(s => s.status === "gps_inconsistent");
    }).map(r => r.lap)) : null, [result, flagged, verdicts, anchor, duration, anchors, gps]);
  useEffect(() => {
    const read = () => { setGroupCurrent(false); try { setGpsRaw(localStorage.getItem(reviewGpsKey(analysis.file_fingerprint))); } catch { setGpsRaw(null); } };
    queueMicrotask(read); globalThis.addEventListener(REVIEW_GPS_EVENT, read);
    return () => { globalThis.removeEventListener(REVIEW_GPS_EVENT, read); abort.current?.abort(); visualAbort.current?.abort(); };
  }, [analysis.file_fingerprint]);
  useEffect(() => {
    if (!sourcePlayer.current) return;
    return observeVideoClock(sourcePlayer.current, s => {
      setNow(s.time_s);
      if (sourceWindow && s.time_s >= (fullInterval ? sourceWindow.end : sourceWindow.start + 5)) sourcePlayer.current?.pause();
    });
  }, [sourceWindow, fullInterval, leftLap]);

  function resetSelection() {
    abort.current?.abort(); visualAbort.current?.abort();
    setResult(null); setRequest(null); setConfirmed([]); setVerdicts({}); setVisuals({}); setVisualErrors([]); setGroupCurrent(false); setError(""); setProgress(""); setBusy(false); setReviewPair(null);
    sourcePlayer.current?.pause(); targetPlayer.current?.pause();
  }
  function selectCandidate(lap: number) {
    if (!candidates.some(row => row.lap === lap)) return;
    sourcePlayer.current?.pause(); targetPlayer.current?.pause();
    if (sourcePlayer.current && selectionWindow) sourcePlayer.current.currentTime = selectionWindow.start;
    setReviewPair(null);
    setSelectedLap(lap);
  }
  const reviewCoachPair = useCallback((left: number, right: number) => {
    sourcePlayer.current?.pause(); targetPlayer.current?.pause();
    const row = result?.laps.find(r => r.lap === left);
    const clip = row ? cornerVideoWindow(row, anchor, duration, anchors) : null;
    const peer = result?.laps.find(r => r.lap === right);
    const peerClip = peer ? cornerVideoWindow(peer, anchor, duration, anchors) : null;
    if (sourcePlayer.current && clip) sourcePlayer.current.currentTime = clip.start;
    if (targetPlayer.current && peerClip) targetPlayer.current.currentTime = peerClip.start;
    sourcePlayer.current?.scrollIntoView({ behavior: "instant", block: "center" });
    setReviewPair({ left, right }); setSelectedLap(right);
  }, [result, anchor, duration, anchors, setReviewPair, setSelectedLap]);
  async function calculate(group = false) {
    const payload = group && request ? { ...request, confirmed_laps: confirmed.filter(lap => {
      const row = result?.laps.find(r => r.lap === lap); return row && !flagged(row);
    }) } : window ? { ...window, inspection_id: analysis.inspection_id, confirmed_laps: [], include_context: true } : null;
    if (!payload) return;
    if (!group) resetSelection();
    const controller = new AbortController(); abort.current?.abort();
    abort.current = controller;
    setBusy(true); setError("");
    try {
      const next = await analyzeSelectedCorner(payload, controller.signal);
      controller.signal.throwIfAborted(); setResult(next); setRequest(payload); setGroupCurrent(group);
      if (!group) {
        const playable = browsableCornerLaps(next.laps, anchor, duration, anchors);
        setSelectedLap(playable.find(r => r.lap !== sourceLap)?.lap ?? playable[0]?.lap ?? null);
        if (sourcePlayer.current) sourcePlayer.current.currentTime = next.start_session_s + anchor.offset_ms / 1000;
      }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "CORNER_SERVICE_UNAVAILABLE"); }
    finally { if (abort.current === controller) setBusy(false); }
  }
  async function scan() {
    if (!result || !selectionWindow) return;
    const controller = new AbortController(); visualAbort.current?.abort(); visualAbort.current = controller;
    const candidates = result.laps.filter(r => r.status === "candidate" && r.lap !== sourceLap && cornerVideoWindow(r, anchor, duration, anchors));
    setVisualErrors([]);
    try {
      for (const [i, row] of candidates.entries()) {
        controller.signal.throwIfAborted(); setProgress(`${i + 1}/${candidates.length} · L${row.lap}`);
        try {
          const check = await checkSelectedCornerFrames(url, selectionWindow, cornerVideoWindow(row, anchor, duration, anchors)!, duration, controller.signal);
          controller.signal.throwIfAborted(); setVisuals(old => ({ ...old, [row.lap]: check }));
        } catch { controller.signal.throwIfAborted(); setVisualErrors(old => [...old, row.lap]); }
      }
    } catch { /* Cancellation leaves all manual anchors and confirmations untouched. */ }
    finally { if (visualAbort.current === controller) setProgress(""); }
  }
  async function playPair() {
    if (!sourceWindow || !activeWindow || !sourcePlayer.current || !targetPlayer.current) return;
    const players = [sourcePlayer.current, targetPlayer.current];
    try {
      await Promise.all(players.map((player, i) => new Promise<void>((resolve, reject) => {
        player.pause(); player.playbackRate = 1;
        const time = i ? activeWindow.start : sourceWindow.start;
        if (Math.abs(player.currentTime - time) < .005 && player.readyState >= 2) { resolve(); return; }
        const timer = setTimeout(() => { cleanup(); reject(Error("VIDEO_SEEK_FAILED")); }, 5000);
        function cleanup() { clearTimeout(timer); player.removeEventListener("seeked", done); }
        function done() { cleanup(); resolve(); }
        player.addEventListener("seeked", done, { once: true }); player.currentTime = time;
      })));
      await Promise.all(players.map(p => p.play()));
    } catch { players.forEach(p => p.pause()); setError("VIDEO_PLAYBACK_UNAVAILABLE"); }
  }

  return <div className="mt-4 min-w-0 space-y-4" data-testid="selected-corner-workspace">
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-xs text-slate-400">{zh ? "已同步的选择圈" : "Confirmed source lap"}<select aria-label="Corner source lap" className={input} value={sourceLap} onChange={e => { resetSelection(); setSourceLap(Number(e.target.value)); const next = anchors.find(a => a.target_lap === Number(e.target.value))!; setStart(next.video_time_s + 1); }}>{anchors.map(a => <option key={a.target_lap} value={a.target_lap}>L{a.target_lap}</option>)}</select></label>
      <label className="grid gap-1 text-xs text-slate-400">{zh ? "起点（视频秒）" : "Start (video seconds)"}<input aria-label="Corner start" className={`${input} w-36`} type="number" min={0} max={duration - 5} step={.05} value={start} onChange={e => { resetSelection(); setStart(Number(e.target.value)); }} /></label>
      <button className={button} disabled={!!reviewPair} onClick={() => { const time = sourcePlayer.current?.currentTime; if (time !== undefined) { resetSelection(); setStart(time); } }}><Scissors size={16} />{zh ? "用当前帧作为起点" : "Use current frame"}</button>
      <button className={`${button} border-cyan-600 text-cyan-200`} disabled={!window || busy} onClick={() => void calculate()}>{zh ? "查找每圈的同一弯" : "Find this corner in every lap"}</button>
      {busy && <button className={button} onClick={() => abort.current?.abort()}><X size={16} />{zh ? "取消" : "Cancel"}</button>}
    </div>
    <p className="text-xs text-slate-400">{zh ? "以所选五秒定位弯道，再补入减速前段与出弯恢复段。不会自动修正同步，人工锚点及 ±0.5 秒不确定性不变。" : "Locate the corner from the five-second selection, then include approach and recovery. Checks never rewrite synchronization; manual anchors and ±0.5s uncertainty remain unchanged."}</p>
    {result?.context && <p className="text-xs text-amber-200">{result.context.status === "expanded"
      ? (zh ? "已扩展运动学上下文；完整刹车、转向与开油仍需视频或直接传感器确认。" : "Kinematic context expanded; braking, steering and throttle still need video or direct sensors.")
      : (zh ? "减速或出弯阶段证据不足，当前片段不能视为完整弯道。" : "Approach or exit unresolved; this clip cannot be treated as a complete corner.")}</p>}
    {!window && <p className="text-sm text-amber-200">{zh ? "请在这个已确认圈的内部选择完整五秒，避开圈起终点各半秒。" : "Select five complete seconds inside the confirmed lap, allowing half a second at both lap boundaries."}</p>}
    {error && <p role="alert" className="text-sm text-amber-200">{zh ? "无法完成此次操作。检查视频和连续遥测覆盖，或重新导入 Session。" : "Could not complete this operation. Check video and continuous telemetry coverage, or re-import the session."} [{error}]</p>}
    {result && <CornerCandidateNavigation laps={candidates} selectedLap={selectedLap} sourceLap={sourceLap} onSelect={selectCandidate} />}
    {reviewPair && <div className="flex flex-wrap items-center gap-3 text-sm"><span>{zh ? "教练对照" : "Coach pair"}: L{reviewPair.left} / L{reviewPair.right}</span><button className={button} onClick={() => selectCandidate(reviewPair.right)}>{zh ? "返回所选圈" : "Return to selected lap"} L{sourceLap}</button></div>}
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <div className="min-w-0"><h4 className="mb-2 text-sm text-cyan-200">L{leftLap} · {reviewPair ? (zh ? "区段最快圈" : "Section-best lap") : (zh ? "你选择的弯" : "Your selected corner")}</h4><div className="relative"><video key={leftLap} ref={sourcePlayer} src={url} muted={audio !== 0} controls playsInline preload="metadata" className="aspect-video w-full bg-black" onLoadedMetadata={e => { e.currentTarget.currentTime = sourceWindow?.start ?? start; }} /><GoproSpeedOverlay file={file} time={now} /></div>
        {sourceRow && sourceWindow && <>
          <ReviewGpsNotice fingerprint={analysis.file_fingerprint} video={identity} start={sourceWindow.start} end={sourceWindow.end} offset={sourceWindow.offset} />
          <SelectedCornerTelemetry row={sourceRow} videoTime={now} videoStart={sourceWindow.start} confirmed={leftLap === sourceLap || verdicts[leftLap] === "yes"} domains={domains} elapsedLimit={elapsedLimit} active={visible} />
        </>}
      </div>
      {activeWindow && active && <CornerPlayer key={`${selectedLap}:${activeWindow.start}:${fullInterval}`} audible={audio === 1} file={file} url={url} start={activeWindow.start} end={fullInterval ? activeWindow.end : activeWindow.start + 5} playerRef={targetPlayer} label={`L${selectedLap} · ${reviewPair ? (zh ? "整圈最快圈" : "Full-lap best") : (zh ? "同一区段候选" : "Same-section candidate")}`}
        row={active} confirmed={active.lap === sourceLap || verdicts[active.lap] === "yes"} domains={domains} elapsedLimit={elapsedLimit} visible={visible}>
        <ReviewGpsNotice fingerprint={analysis.file_fingerprint} video={identity} start={activeWindow.start} end={activeWindow.end} offset={activeWindow.offset} />
      </CornerPlayer>}
    </div>
    {activeWindow && <>
      <ReviewAudioControl value={audio} onChange={setAudio} labels={[`L${leftLap}`, `L${selectedLap}`]} />
      <div className="flex flex-wrap items-center gap-3"><button className={button} onClick={() => void playPair()}><Play size={16} />{zh ? "并排重播" : "Replay pair"}</button><button className={button} onClick={() => { sourcePlayer.current?.pause(); targetPlayer.current?.pause(); }}><Pause size={16} />{zh ? "暂停" : "Pause"}</button>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fullInterval} onChange={e => { sourcePlayer.current?.pause(); targetPlayer.current?.pause(); setFullInterval(e.target.checked); }} />{zh ? "播放完整相同空间区段" : "Play full common spatial interval"}</label></div>
      <p className="text-xs text-slate-400">{zh ? "默认播放完整相同空间区段。计时按同一对 GPS 空间门；两侧同时起播，不拉伸视频，也不保证逐帧处于同一位置。" : "Defaults to the full common spatial interval. Timing uses the same GPS gates; playback is simultaneous, not time-warped or position-locked."}</p>
    </>}
    {coach && <CornerCoachComparison comparison={coach} onReview={reviewCoachPair} active={visible}
      playable={coach.status !== "unavailable" && [coach.section, coach.overall].every(row => cornerVideoWindow(row, anchor, duration, anchors))} />}
    {result && <>
      <div className="flex flex-wrap items-center gap-3"><button className={button} disabled={!!progress || busy} onClick={() => void scan()}><ScanEye size={16} />{zh ? "首尾参照物二次核对（全部）" : "Check boundary landmarks (all)"}</button>{progress && <><span role="status" className="text-sm text-cyan-200">{progress}</span><button className={button} onClick={() => visualAbort.current?.abort()}><X size={16} />{zh ? "取消" : "Cancel"}</button></>}</div>
      <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="text-xs text-slate-400"><tr><th className="p-2">Lap</th><th>{zh ? "同区段用时" : "Section time"}</th><th>{zh ? "最低 / 出弯速度" : "Min / Exit speed"}</th><th>{zh ? "首尾画面" : "Boundary frames"}</th><th>{zh ? "是否对应同一弯？" : "Same corner?"}</th></tr></thead><tbody>{result.laps.map(row => {
        const clip = cornerVideoWindow(row, anchor, duration, anchors), visual = visuals[row.lap];
        return <tr key={row.lap} className={`border-t border-slate-800 ${selectedLap === row.lap ? "bg-cyan-400/5" : ""}`}><td className="p-2"><button disabled={!clip} className={`${button} text-cyan-200`} onClick={() => selectCandidate(row.lap)}><Play size={12} />L{row.lap}</button></td>
          <td className="font-mono">{num(row.elapsed_s)}s</td><td className="font-mono">{num(row.profile?.metrics.minimum_speed_kmh, 1)} / {num(row.profile?.metrics.exit_speed_kmh, 1)} km/h</td>
          <td className="max-w-52 p-2 text-xs text-slate-400" title={row.reason ?? undefined}>{row.status === "excluded" ? reasonText(row.reason, zh) : !clip ? (zh ? "视频未覆盖" : "Outside video") : flagged(row) ? (zh ? "GPS 异常，保留复盘 / 不进分组" : "GPS warning; review only") : visualErrors.includes(row.lap) ? (zh ? "读帧失败" : "Frame read failed") : visual ? visual.boundaries.map(b => b.status === "candidate" ? (zh ? "候选" : "Candidate") : b.status === "weak" ? (zh ? "证据弱" : "Weak") : (zh ? "不唯一" : "Ambiguous")).join(" / ") : (zh ? "待核对" : "Pending")}</td>
          <td><select aria-label={`Confirm corner L${row.lap}`} className={input} disabled={!clip || busy} value={verdicts[row.lap] ?? "uncertain"} onChange={e => {
            const verdict = e.target.value as "yes" | "no" | "uncertain"; setVerdicts(old => ({ ...old, [row.lap]: verdict }));
            setConfirmed(old => [...old.filter(l => l !== row.lap), ...(verdict === "yes" ? [row.lap] : [])]); setGroupCurrent(false);
          }}><option value="uncertain">{zh ? "不确定" : "Uncertain"}</option><option value="yes">{zh ? "已核对首尾，确认" : "Both boundaries checked"}</option><option value="no">{zh ? "不是这个弯" : "Wrong corner"}</option></select></td></tr>;
      })}</tbody></table></div>
      {active && visuals[active.lap] && <div className="grid gap-4 sm:grid-cols-2">{visuals[active.lap].boundaries.map((boundary, i) => <section key={i}>
        <h5 className="mb-2 text-sm">{i ? (zh ? "同一区段终点" : "Common section end") : (zh ? "同一区段起点" : "Common section start")}</h5><div className="grid grid-cols-2 gap-2">{[boundary.reference, boundary.expected].map((image, j) => <figure key={j}>
          {/* Local frames must not be sent to an image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={`${i ? "End" : "Start"} L${j ? active.lap : sourceLap}`} className="aspect-video w-full object-contain" /><figcaption className="text-xs text-slate-400">L{j ? active.lap : sourceLap}</figcaption></figure>)}</div>
        {boundary.proposed_time_s !== null && <button className={`${button} mt-2`} onClick={() => { if (targetPlayer.current) { targetPlayer.current.pause(); targetPlayer.current.currentTime = boundary.proposed_time_s!; } }}>{zh ? "只查看建议帧" : "Inspect suggested frame only"} {num(boundary.proposed_time_s)}s</button>}
      </section>)}</div>}
      <p className="text-xs text-slate-400">{zh ? "比较左右背景，不识别物体身份。画面相似度不是准确率；仍需核对圈号与首尾位置。确认仅对当前选区有效，不修改全局同步。" : "Compares background appearance, not object identity. Similarity is not accuracy. Check the lap and both locations; confirmation applies only to this selection, never global sync."}</p>
      <button className={`${button} text-cyan-200`} disabled={busy} onClick={() => void calculate(true)}><Check size={16} />{zh ? "比较已确认圈的开法" : "Compare confirmed driving patterns"} ({confirmed.filter(l => { const row = result.laps.find(r => r.lap === l); return row && !flagged(row); }).length})</button>
      {groupCurrent && <CornerPatterns result={result} onLap={selectCandidate} active={visible} />}
    </>}
  </div>;
}

function CornerPlayer({ file, url, start, end, label, playerRef, audible, row, confirmed, domains, elapsedLimit, visible, children }: {
  file: File; url: string; start: number; end: number; label: string; playerRef: React.RefObject<HTMLVideoElement | null>; audible: boolean;
  row: CornerLap; confirmed: boolean; domains: Record<"speed" | "rpm", [number, number]>; elapsedLimit: number; visible: boolean; children: React.ReactNode;
}) {
  const [time, setTime] = useState(start);
  useEffect(() => { const player = playerRef.current; if (!player) return; return observeVideoClock(player, s => { setTime(s.time_s); if (s.time_s >= end) player.pause(); }); }, [playerRef, end]);
  return <div className="min-w-0"><h4 className="mb-2 text-sm text-amber-200">{label}</h4><div className="relative"><video ref={playerRef} src={url} muted={!audible} controls playsInline preload="metadata" className="aspect-video w-full bg-black" onLoadedMetadata={e => { e.currentTarget.currentTime = start; }} /><GoproSpeedOverlay file={file} time={time} /></div>
    {children}<SelectedCornerTelemetry row={row} videoTime={time} videoStart={start} confirmed={confirmed} domains={domains} elapsedLimit={elapsedLimit} active={visible} />
  </div>;
}

function CornerPatterns({ result, onLap, active }: { result: SelectedCornerResult; onLap: (lap: number) => void; active: boolean }) {
  const { locale } = useI18n(), zh = locale === "zh", patterns = result.patterns;
  const [channel, setChannel] = useState<"speed" | "rpm">("speed");
  const common = patterns.most_common_group_ids.length === 1 ? patterns.groups.find(g => g.id === patterns.most_common_group_ids[0]) : null;
  const fastest = patterns.fastest_observed_group_ids.length === 1 ? patterns.groups.find(g => g.id === patterns.fastest_observed_group_ids[0]) : null;
  const net = common && fastest && common.median_combined_s != null && fastest.median_combined_s != null
    ? common.median_combined_s - fastest.median_combined_s : null;
  const chart = Array.from({ length: 41 }, (_, i) => ({ progress: i * 2.5, ...Object.fromEntries(patterns.groups.map(g => {
    const profile = result.laps.find(l => l.lap === g.representative_lap)?.profile; return [`lap_${g.representative_lap}`, profile?.[channel]?.[i] ?? null];
  })) }));
  return <section className="min-w-0 space-y-3 border-t border-slate-700 pt-4" data-testid="corner-patterns">
    <h4 className="font-semibold text-white">{zh ? "这段弯的开法 · 探索性分组" : "Corner patterns · Exploratory groups"}</h4>
    {patterns.status === "insufficient_confirmed_laps" ? <p className="text-sm text-amber-200">{zh ? "不足四圈可用的人工确认片段，暂不分类。逐圈遥测和视频仍可对比。" : "Fewer than four usable confirmed clips: no clustering. Per-lap video and telemetry remain available."}</p> : <>
      <p className="text-sm text-cyan-200">{patterns.status === "no_clear_separation" ? (zh ? "未发现清晰分开的开法，不强行分类。" : "No clearly separated patterns; groups are not forced.")
        : patterns.common_is_fastest === true ? (zh ? "最常见的开法，也是本次已确认样本中区段中位用时最短的一组。" : "The most common pattern also has the lowest observed median section time.")
        : patterns.common_is_fastest === false ? (zh ? "最常见的开法，不是本次已确认样本中区段中位用时最短的一组。" : "The most common pattern does not have the lowest observed median section time.")
        : (zh ? "频次或用时并列，不能指定唯一的最常用 / 最快模式。" : "Frequency or timing is tied; there is no unique most-common / fastest pattern.")}</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-slate-400"><tr><th className="p-2">{zh ? "模式 / 真实圈" : "Pattern / Real laps"}</th><th>{zh ? "次数" : "Count"}</th><th>{zh ? "中位用时 / 范围" : "Median / Range"}</th><th>{zh ? "出弯速度" : "Exit speed"}</th><th>{zh ? "下游用时" : "Downstream time"}</th></tr></thead><tbody>{patterns.groups.map((g, i) => <tr key={g.id} className="border-t border-slate-800"><td className="p-2" style={{ color: colors[i] }}><button className={button} onClick={() => onLap(g.representative_lap)}><Play size={14} />{zh ? "模式" : "Pattern"} {g.id} · L{g.representative_lap}</button><p className="mt-1 text-xs">{g.laps.map(l => `L${l}`).join(", ")}</p></td><td>{g.count}</td><td>{num(g.median_time_s)}s<br /><span className="text-xs text-slate-400">{g.time_range_s.map(t => num(t)).join("–")}s</span></td><td>{num(g.metrics.exit_speed_kmh, 1)} km/h</td><td>{num(g.median_downstream_s)}s</td></tr>)}</tbody></table></div>
      <div className="flex gap-2" role="group" aria-label={zh ? "代表圈通道" : "Representative lap channel"}>{(["speed", "rpm"] as const).map(key => <button key={key} className={button} aria-pressed={key === channel} disabled={key === "rpm" && !patterns.channels?.includes("rpm")} onClick={() => setChannel(key)}>{key === channel && <Check size={14} />}{key === "speed" ? (zh ? "速度 km/h" : "Speed km/h") : "RPM"}</button>)}</div>
      {active && <div className="h-56 min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><CartesianGrid stroke="#26313d" /><XAxis dataKey="progress" unit="%" tick={{ fontSize: 10 }} /><YAxis width={48} unit="" tick={{ fontSize: 10 }} /><Tooltip contentStyle={{ background: "#111820", borderColor: "#334155" }} />{patterns.groups.map((g, i) => <Line key={g.id} name={`L${g.representative_lap} ${channel === "speed" ? "km/h" : "rpm"}`} dataKey={`lap_${g.representative_lap}`} stroke={colors[i]} dot={false} isAnimationActive={false} />)}</LineChart></ResponsiveContainer></div>}
      <p className="text-xs text-slate-400">{zh ? "曲线为每组一条真实代表圈，横轴为区段内行驶距离比例；不是合成曲线或精确逐位置配准。" : "Curves show one real representative lap per group over within-section distance percentage, not synthetic curves or exact pointwise registration."}</p>
      {patterns.status === "exploratory_groups" && common && fastest && common.id !== fastest.id && <p className="text-sm text-slate-200">{zh
        ? `优先并排复盘 L${common.representative_lap} 与 L${fastest.representative_lap}：较快组的最低速度相差 ${num(fastest.metrics.minimum_speed_kmh - common.metrics.minimum_speed_kmh, 1)} km/h，出弯速度相差 ${num(fastest.metrics.exit_speed_kmh - common.metrics.exit_speed_kmh, 1)} km/h。结合参照物观察减速结束和速度恢复的位置；这不是已确认的刹车或油门原因。`
        : `Review L${common.representative_lap} beside L${fastest.representative_lap}: the faster group's minimum speed differs by ${num(fastest.metrics.minimum_speed_kmh - common.metrics.minimum_speed_kmh, 1)} km/h and exit speed by ${num(fastest.metrics.exit_speed_kmh - common.metrics.exit_speed_kmh, 1)} km/h. Use landmarks to inspect where deceleration ends and speed recovers; pedal causes are unconfirmed.`}</p>}
      {patterns.status === "exploratory_groups" && common && fastest && common.id !== fastest.id && <p className="text-sm text-amber-200">{net === null
        ? (zh ? "下游证据不足，暂不能说较快组的优势延续到出弯之后。" : "Downstream coverage is incomplete; the section advantage may not persist after exit.")
        : net <= 0 ? (zh ? `把下游用时也计入后，较快组的局部优势不再保留（完整区间中位用时差 ${num(net)}s）。不要只模仿弯中的快。` : `Including downstream time removes the local advantage (combined-interval median difference ${num(net)}s). Do not copy the local gain alone.`)
        : (zh ? `连同下游的完整区间，较快组的中位用时少 ${num(net)}s。这只是本次样本的描述性差异；先复核视频中的恢复过程是否更连续，再由教练决定是否值得尝试。` : `Combined section-and-downstream median time is ${num(net)}s lower in the faster group. This is descriptive only: review continuity of speed recovery before a coach chooses a change.`)}</p>}
      <p className="text-sm text-slate-300">{zh ? "下一次只尝试教练确认的一项调整，复核同一区段和下游的用时及稳定性；出现不稳定就停止。本次分组不能证明某种动作导致提速。" : "Test one coach-confirmed change next time; check section/downstream time and consistency. Stop if unstable. These groups cannot establish why a lap was faster."}</p>
    </>}
    <details className="text-xs text-slate-400"><summary className="cursor-pointer py-2">{zh ? "方法与边界" : "Method and limits"}</summary><p>{zh ? "SciPy Ward 层次聚类，仅使用真实速度及可用 RPM 的距离域曲线，用时不参与分组。每组至少两圈，最多三组；分离度不足合并为一组。仅描述本次通过质量门且人工确认的样本，不代表全部圈或长期风格，不给统计显著性或保证提升。GPS 异常片段可观看，但不进入分组。" : "SciPy Ward clustering uses observed distance-domain speed and available RPM, never elapsed time. At least two laps per group, up to three groups; poor separation collapses to one group. This describes only quality-gated, human-confirmed samples, not all laps or long-term style. No significance or guaranteed gain is claimed. GPS-flagged clips remain review-only."}</p></details>
  </section>;
}
