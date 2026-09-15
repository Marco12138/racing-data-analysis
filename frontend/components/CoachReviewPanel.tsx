"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, MapPin, Send, Video } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "../lib/i18n";
import { resolveApiConfig } from "../lib/config";
import { submitClipFeedback, type ClipFeedbackInput } from "../lib/feedbackApi";
import { REVIEW_VERSION, reviewValue, selectCoachReviews,
  type ReviewPoint, type ReviewSelection, type ReviewWindow } from "../lib/coachReview";
import type { VideoSyncCalibration } from "../lib/videoTelemetrySync";
import { parseVideoSyncCalibration } from "../lib/videoTelemetrySync";
import type { XrkAnalysis, XrkAnalyzeOptions } from "../lib/xrkAnalysisApi";
import { ManualReviewVideo } from "./ManualReviewVideo";

const COPY = {
  zh: {
    title: "自动复盘片段", sectors: "前三快圈 · Sector 优势", delta: "前三快圈 · 累计时间差", official: "官方 Sector",
    target: "目标圈", reference: "真实快圈", lap: "圈", virtual: "虚拟 Sector · 非官方计时点",
    empty: "当前数据不足以选择可比较的弯道片段。需要真实有效快圈和连续的距离计时数据。",
    noVideo: "尚未选择本地视频", noSync: "此圈视频尚未确认同步，暂不展示对应片段。",
    sync: "选择视频 / 确认同步", context: "完整弯道与下游", preview: "4 秒预览",
    local: "弯内时间差", downstream: "下游时间差", net: "合计时间差", loss: "目标圈 − 对照圈；正数表示目标圈更慢。",
    measured: "真实圈计时对比，不保证提升；自动参考来自 Top 3，手动参考须通过质量门，不拼接参考圈。",
    pairTiming: "两侧从各自片段起点同时播放，不代表每一帧都处于同一赛道位置。",
    review: "重点核对两圈的减速、最低速度和恢复加速过程。先观看画面，再判断动作差异。",
    drill: "下次只测试一处经教练确认的调整，观察出弯后的时间优势是否保留；不稳定时停止尝试。",
    repeated: "Top 3 原有共识支持圈", notConfirmed: "这是规则筛选的复盘候选，不是已确认的驾驶原因。",
    question: "系统挑选的复盘片段是否精准？", accurate: "准确", partly_accurate: "部分准确", inaccurate: "不准确", uncertain: "无法判断",
    manualQuestion: "人工修正后的片段是否对应这个弯？", unlinked: "同步未确认时只能选择无法判断。", automaticReference: "自动选择真实 Top 3 对照圈",
    lapChangeError: "切换圈失败，请重试。", changeNote: "切换圈将重新计算对应遥测；原片段修正仍按原圈号保留。",
    reason: "主要问题（选填）", none: "不补充", too_early: "片段偏早", too_late: "片段偏晚", wrong_corner: "不是这个弯", too_short: "片段太短", not_relevant: "与建议无关", sync_uncertain: "同步不确定",
    submit: "提交反馈", saving: "正在保存", saved: "反馈已保存，感谢核对。", failed: "反馈未保存，请重试。", watch: "播放片段后即可评价。",
    privacy: "只保存选择、圈号及片段时间，不上传视频。反馈用于后续评估，不自动训练模型或确认驾驶行为。",
    play: "播放", pause: "暂停", replay: "重播", loop: "循环", speed: "播放速度", details: "遥测证据", unavailable: "暂无可用数据",
    videoError: "浏览器无法播放此视频。请尝试兼容浏览器或 H.264 视频。", scope: "当前选择", partial: "没有该圈已确认的视频，保留遥测对照。",
  },
  en: {
    title: "Automatically selected review clips", sectors: "Top 3 · Sector advantages", delta: "Top 3 · Cumulative time delta", official: "Official sectors",
    target: "Selected lap", reference: "Real fast lap", lap: "Lap", virtual: "Virtual sectors · Unofficial timing boundaries",
    empty: "Comparable corner clips are unavailable. Real eligible fast laps and continuous distance/timing data are required.",
    noVideo: "No local video selected", noSync: "Video synchronization for this lap is unconfirmed. No corresponding clip is shown.",
    sync: "Choose video / Confirm sync", context: "Full corner and downstream", preview: "4-second preview",
    local: "Corner time delta", downstream: "Downstream time delta", net: "Combined time delta", loss: "Selected minus reference; positive means the selected lap is slower.",
    measured: "Observed comparison, not promised improvement. Automatic references use real Top 3 laps; manual references must pass the quality gate. No stitched curves.",
    pairTiming: "Both clips play from their own start; corresponding frames are not necessarily at the same track position.",
    review: "Compare deceleration, minimum speed and acceleration recovery. Watch the footage before judging differences in driver inputs.",
    drill: "Test one coach-confirmed adjustment next time. Check whether the exit advantage persists downstream; stop if the kart becomes unstable.",
    repeated: "Existing Top 3 consensus supporting laps", notConfirmed: "Rule-selected review candidate, not a confirmed driving cause.",
    question: "Did the system select the right review clip?", accurate: "Accurate", partly_accurate: "Partly accurate", inaccurate: "Inaccurate", uncertain: "Cannot judge",
    manualQuestion: "Does the manually corrected clip match this corner?", unlinked: "Choose Cannot judge until synchronization is confirmed.", automaticReference: "Automatically select a real Top 3 reference",
    lapChangeError: "Could not change laps. Please retry.", changeNote: "Changing laps reloads their telemetry; saved corrections remain bound to their original lap.",
    reason: "Main issue (optional)", none: "No additional reason", too_early: "Too early", too_late: "Too late", wrong_corner: "Wrong corner", too_short: "Too short", not_relevant: "Unrelated to advice", sync_uncertain: "Sync uncertain",
    submit: "Submit feedback", saving: "Saving", saved: "Feedback saved. Thank you for checking.", failed: "Feedback was not saved. Please retry.", watch: "Play the clip before rating it.",
    privacy: "Only the choice, lap numbers and clip times are stored. Video is not uploaded. Feedback is for later evaluation, not automatic training or driving confirmation.",
    play: "Play", pause: "Pause", replay: "Replay", loop: "Loop", speed: "Playback speed", details: "Telemetry evidence", unavailable: "Not available",
    videoError: "This browser could not play the video. Try a compatible browser or H.264 video.", scope: "Current selection", partial: "No confirmed video for this lap; telemetry comparison remains available.",
  },
};
type Copy = typeof COPY["en"];
const COLORS = ["#f6c945", "#35d6d0", "#ff5964"];
const button = "inline-flex items-center justify-center gap-2 rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-cyan-400 disabled:opacity-40";
const fmt = (n: unknown) => typeof n === "number" && Number.isFinite(n) ? n.toFixed(3) : "—";

export function CoachReviewPanel({ analysis, videoUrl, videoFile, videoDurationS, calibration, onSync, onCursor, onAnalyze, analyzing = false, readOnly = false }: {
  analysis: XrkAnalysis; videoUrl: string; videoFile: File | null; videoDurationS: number;
  calibration: VideoSyncCalibration | null; onSync: () => void; onCursor: (distance: number) => void;
  onAnalyze?: (options: Partial<XrkAnalyzeOptions>) => Promise<void>; analyzing?: boolean; readOnly?: boolean;
}) {
  const { locale } = useI18n(), c = COPY[locale];
  const [chosenReference, setChosenReference] = useState<number | null>(null), [lapError, setLapError] = useState(false);
  const [changing, setChanging] = useState(false);
  const reviews = useMemo(() => selectCoachReviews(analysis, chosenReference), [analysis, chosenReference]);
  async function changeLap(side: "reference" | "target", value: string) {
    if (!onAnalyze || changing || analyzing) return;
    setLapError(false);
    if (side === "reference" && value === "auto") { setChosenReference(null); return; }
    const lap = Number(value);
    setChanging(true);
    try {
      await onAnalyze(side === "reference" ? { reference_lap: lap } : { target_lap: lap });
      if (side === "reference") setChosenReference(lap);
      else if (lap === chosenReference) setChosenReference(null);
    } catch { setLapError(true); }
    finally { setChanging(false); }
  }
  const historyKey = `racing-review-calibrations:${analysis.file_fingerprint}`;
  const [history, setHistory] = useState<Record<string, VideoSyncCalibration>>({});
  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(historyKey) ?? "{}");
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const valid = Object.fromEntries(Object.entries(value).flatMap(([lap, raw]) => {
          const parsed = parseVideoSyncCalibration(JSON.stringify(raw));
          return parsed && String(parsed.target_lap) === lap ? [[lap, parsed]] : [];
        }));
        queueMicrotask(() => setHistory(valid));
      }
    } catch { /* Storage is optional. */ }
  }, [historyKey, calibration?.calibrated_at]);
  const mappings: Record<string, VideoSyncCalibration> = { ...history, ...(calibration ? { [calibration.target_lap]: calibration } : {}) };
  return <div className="min-w-0 space-y-6" data-testid="coach-review-panel">
    <TopThreeCharts analysis={analysis} c={c} />
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-xs text-slate-400">{c.reference}<select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm" aria-label={c.reference} value={chosenReference ?? "auto"} disabled={!onAnalyze || analyzing || changing || readOnly} onChange={e => void changeLap("reference", e.target.value)}>
        <option value="auto">{c.automaticReference}</option>
        {analysis.lap_quality.laps.filter(l => l.analysis_eligible && l.lap !== analysis.target_lap).map(l => <option key={l.lap} value={l.lap}>L{l.lap} · {fmt(l.lap_time)}s</option>)}
      </select></label>
      <label className="min-w-0 text-xs text-slate-400">{c.target}<select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm" aria-label={c.target} value={analysis.target_lap} disabled={!onAnalyze || analyzing || changing || readOnly} onChange={e => void changeLap("target", e.target.value)}>
        {analysis.lap_quality.laps.map(l => <option key={l.lap} value={l.lap}>L{l.lap} · {fmt(l.lap_time)}s</option>)}
      </select></label>
    </div>
    <p className="text-xs text-slate-400">{c.changeNote}</p>
    {lapError && <p role="alert" className="text-sm text-red-300">{c.lapChangeError}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-lg font-semibold text-white">{c.title}</h3>
      <button className={button} onClick={onSync}><Video size={16} />{c.sync}</button>
    </div>
    <p className="text-xs text-slate-400">{c.measured}</p>
    {!reviews.length && <p className="text-sm text-slate-400">{c.empty}</p>}
    {reviews.map(review => <ReviewCard key={`${analysis.file_fingerprint}:${review.id}`}
      review={review} analysis={analysis} videoUrl={videoUrl} file={videoFile} duration={videoDurationS}
      targetCalibration={mappings[review.targetLap] ?? null} referenceCalibration={mappings[review.referenceLap] ?? null}
      onCursor={onCursor} c={c} />)}
  </div>;
}

function TopThreeCharts({ analysis, c }: { analysis: XrkAnalysis; c: Copy }) {
  const laps = useMemo(() => analysis.lap_quality.top_valid_laps.filter(p => p.analysis_eligible).slice(0, 3), [analysis.lap_quality.top_valid_laps]);
  const sectors = Object.keys(analysis.sectors?.sector_best ?? {}).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const data = useMemo(() => analysis.top_laps_comparison.aligned.map(row => {
    const reference = row[`lap_${laps[0]?.lap}_lap_time_s`];
    return { distance_m: row.distance_m, ...Object.fromEntries(laps.map(lap => {
      const value = row[`lap_${lap.lap}_lap_time_s`];
      return [`lap_${lap.lap}`, typeof reference === "number" && typeof value === "number" ? value - reference : null];
    })) };
  }), [analysis.top_laps_comparison.aligned, laps]);
  return <div className="grid min-w-0 gap-6 xl:grid-cols-2">
    <section className="min-w-0"><h3 className="mb-3 font-semibold text-white">{c.sectors}</h3>
      {laps.length && sectors.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr className="border-b border-slate-700 text-xs text-slate-400"><th className="p-2">{c.lap}</th>{sectors.map(s => <th className="p-2" key={s}>{s.replace("sector_", "S")} (s)</th>)}</tr></thead>
        <tbody>{laps.map((lap, i) => <tr key={lap.lap} className="border-b border-slate-800"><th className="p-2" style={{ color: COLORS[i] }}>L{lap.lap} · {fmt(lap.lap_time)}s</th>{sectors.map(s => {
          const value = analysis.sectors?.lap_rows.find(r => Number(r.lap) === lap.lap)?.[s];
          const values = laps.map(l => analysis.sectors?.lap_rows.find(r => Number(r.lap) === l.lap)?.[s]).filter((n): n is number => typeof n === "number" && Number.isFinite(n));
          const winner = typeof value === "number" && values.length > 1 && value === Math.min(...values);
          return <td key={s} className={`p-2 font-mono ${winner ? "bg-emerald-400/10 text-emerald-300" : "text-slate-300"}`}>{fmt(value)}{winner ? " *" : ""}</td>;
        })}</tr>)}</tbody></table></div> : <p className="text-sm text-slate-400">{c.unavailable}</p>}
      <p className="mt-2 text-xs text-slate-500">{analysis.sectors?.official ? c.official : c.virtual}</p>
    </section>
    <section className="min-w-0"><h3 className="mb-3 font-semibold text-white">{c.delta} (s)</h3>
      <div className="h-52 min-w-0">{data.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={data}>
        <CartesianGrid stroke="#26313d" /><XAxis dataKey="distance_m" tick={{ fontSize: 10 }} unit="m" minTickGap={40} /><YAxis width={42} tick={{ fontSize: 10 }} />
        <Tooltip contentStyle={{ background: "#111820", borderColor: "#334155" }} /><ReferenceLine y={0} stroke="#64748b" />
        {laps.map((lap, i) => <Line key={lap.lap} name={`L${lap.lap} − L${laps[0].lap}`} dataKey={`lap_${lap.lap}`} stroke={COLORS[i]} dot={false} isAnimationActive={false} />)}
      </LineChart></ResponsiveContainer> : <p className="text-sm text-slate-400">{c.unavailable}</p>}</div>
    </section>
  </div>;
}

function ReviewCard({ review, analysis, videoUrl, file, duration, targetCalibration, referenceCalibration, onCursor, c }: {
  review: ReviewSelection; analysis: XrkAnalysis; videoUrl: string; file: File | null; duration: number;
  targetCalibration: VideoSyncCalibration | null; referenceCalibration: VideoSyncCalibration | null;
  onCursor: (distance: number) => void; c: Copy;
}) {
  const { locale } = useI18n();
  const [context, setContext] = useState(false), [cursor, setCursor] = useState(review.focus);
  const name = locale === "zh" ? review.name.replace(/^Suggested Zone\s+/i, "建议区间 ").replace(/^Zone\s+/i, "区间 ") : review.name;
  const chart = useMemo(() => review.target.filter(p => p.distance_m >= review.entry && p.distance_m <= review.downstreamEnd).map(p => ({
    distance: p.distance_m, target_speed: p.speed, target_rpm: p.rpm,
    reference_speed: reviewValue(review.reference, p.distance_m, "speed"), reference_rpm: reviewValue(review.reference, p.distance_m, "rpm"),
  })), [review]);
  return <article className="min-w-0 rounded-md border border-slate-700 p-4 sm:p-5" data-testid="coach-review-card">
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3"><h4 className="text-base font-semibold text-white">{name} · L{review.targetLap} / L{review.referenceLap}</h4>
      <button className={button} onClick={() => { setCursor(review.focus); onCursor(review.focus); }}><MapPin size={14} />{c.scope}</button></header>
    <div className="mb-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">{[[c.local, review.localLoss], [c.downstream, review.downstreamDelta], [c.net, review.netLoss]].map(([label, value]) =>
      <div key={String(label)}><span className="text-xs text-slate-400">{label}</span><p className="font-mono text-lg text-white">{fmt(value)}s</p></div>)}</div>
    <p className="mb-4 text-xs text-slate-400">{c.loss}</p>
    <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={c.context}>
      {[false, true].map(v => <button key={String(v)} className={button} aria-pressed={context === v} onClick={() => setContext(v)}>{context === v && <Check size={14} />}{v ? c.context : c.preview}</button>)}
    </div>
    <ManualReviewVideo review={review} fingerprint={analysis.file_fingerprint} defaultFile={file} defaultUrl={videoUrl}
      defaultDuration={duration} targetCalibration={targetCalibration} referenceCalibration={referenceCalibration} context={context}
      onCursor={distance => { setCursor(distance); onCursor(distance); }}
      feedback={state => <ClipAccuracyFeedback key={state.clipId || state.side} clipId={state.clipId} analysis={analysis} review={review}
        clip={state.clip} enabled={state.enabled} c={c} source={state.source} side={state.side} syncConfirmed={state.syncConfirmed} correction={state.correction} />} />
    <p className="mt-4 text-sm leading-6 text-slate-200">{c.review}</p>
    <p className="mt-2 text-sm leading-6 text-slate-300">{c.drill}</p>
    <p className="mt-2 text-xs text-slate-500">{c.repeated}: {review.sourceLaps.map(l => `L${l}`).join(", ") || "—"}. {c.notConfirmed}</p>
    <details className="mt-5 border-t border-slate-800 pt-3"><summary className="cursor-pointer text-sm text-slate-300">{c.details}</summary>
      <div className="mt-3 grid min-w-0 gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
        <ReviewMap trace={review.target} review={review} cursor={cursor} onCursor={d => { setCursor(d); onCursor(d); }} />
        <div className="grid min-w-0 gap-3">{["speed", "rpm"].map(channel => <div className="h-44 min-w-0" key={channel}><ResponsiveContainer width="100%" height="100%"><LineChart data={chart}>
          <CartesianGrid stroke="#26313d" /><XAxis dataKey="distance" type="number" domain={[review.entry, review.downstreamEnd]} tick={{ fontSize: 10 }} unit="m" minTickGap={30} />
          <YAxis width={55} tick={{ fontSize: 10 }} domain={["auto", "auto"]} /><Tooltip contentStyle={{ background: "#111820" }} />
          <ReferenceLine x={cursor} stroke="#f6c945" /><Line name={`L${review.targetLap} ${channel === "speed" ? "km/h" : "RPM"}`} dataKey={`target_${channel}`} stroke="#35d6d0" dot={false} isAnimationActive={false} />
          <Line name={`L${review.referenceLap} ${channel === "speed" ? "km/h" : "RPM"}`} dataKey={`reference_${channel}`} stroke="#f6c945" dot={false} isAnimationActive={false} />
        </LineChart></ResponsiveContainer></div>)}</div>
      </div>
    </details>
  </article>;
}

function ReviewMap({ trace, review, cursor, onCursor }: { trace: ReviewPoint[]; review: ReviewSelection; cursor: number; onCursor: (d: number) => void }) {
  const valid = trace.filter((p): p is ReviewPoint & { local_x_m: number; local_y_m: number } => p.local_x_m !== null && p.local_y_m !== null);
  if (!valid.length) return null;
  const xs = valid.map(p => p.local_x_m), ys = valid.map(p => -p.local_y_m);
  const x = Math.min(...xs) - 10, y = Math.min(...ys) - 10, w = Math.max(...xs) - x + 10, h = Math.max(...ys) - y + 10;
  const points = (ps: typeof valid) => ps.map(p => `${p.local_x_m},${-p.local_y_m}`).join(" ");
  const selected = valid.reduce((a, b) => Math.abs(a.distance_m - cursor) < Math.abs(b.distance_m - cursor) ? a : b);
  return <svg className="h-48 w-full" viewBox={`${x} ${y} ${w} ${h}`} aria-label={review.name}>
    <polyline points={points(valid)} fill="none" stroke="#475569" strokeWidth={3} />
    <polyline points={points(valid.filter(p => p.distance_m >= review.entry && p.distance_m <= review.exit))} fill="none" stroke="#35d6d0" strokeWidth={5} />
    {valid.filter((_, i) => i % 8 === 0).map(p => <circle key={p.distance_m} cx={p.local_x_m} cy={-p.local_y_m} r={5} fill="transparent" onClick={() => onCursor(p.distance_m)}><title>{`${p.distance_m.toFixed(1)} m`}</title></circle>)}
    <circle cx={selected.local_x_m} cy={-selected.local_y_m} r={5} fill="#f6c945" />
  </svg>;
}


function ClipAccuracyFeedback({ clipId, analysis, review, clip, enabled, c, source, side, syncConfirmed, correction }: {
  clipId: string; analysis: XrkAnalysis; review: ReviewSelection; clip: ReviewWindow | null; enabled: boolean; c: Copy;
  source: "automatic" | "manual"; side: "reference" | "target"; syncConfirmed: boolean; correction: ClipFeedbackInput["correction"];
}) {
  const { locale } = useI18n();
  const key = `racing-clip-feedback:${clipId}`;
  const [verdict, setVerdict] = useState<ClipFeedbackInput["verdict"] | "">("");
  const [reason, setReason] = useState<ClipFeedbackInput["reason"]>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const id = useRef("");
  useEffect(() => {
    id.current = crypto.randomUUID().replaceAll("-", "");
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null") as ClipFeedbackInput | null;
      if (saved?.clip_id === clipId && ["accurate", "partly_accurate", "inaccurate", "uncertain"].includes(saved.verdict)) {
        id.current = saved.feedback_id;
        queueMicrotask(() => { setVerdict(saved.verdict); setReason(saved.reason); setStatus("saved"); });
      }
    } catch { /* A server acknowledgement is still shown when local storage is blocked. */ }
  }, [key, clipId]);
  async function submit() {
    if (!verdict || !clip || !clipId || !enabled || status === "saving") return;
    setStatus("saving");
    const payload: ClipFeedbackInput = { feedback_id: id.current, clip_id: clipId, session_fingerprint: analysis.file_fingerprint,
      zone_id: review.id, reference_lap: review.referenceLap, target_lap: review.targetLap, start_s: clip.start_s, end_s: clip.end_s,
      verdict, reason, locale, selection_version: REVIEW_VERSION, selection_source: source, side, sync_confirmed: syncConfirmed, correction };
    try {
      const config = await resolveApiConfig();
      const ok = await submitClipFeedback(config.apiOrigin, config.apiPrefix, payload);
      setStatus(ok ? "saved" : "failed");
      if (ok) { try { localStorage.setItem(key, JSON.stringify(payload)); } catch { /* Optional receipt cache. */ } }
    } catch { setStatus("failed"); }
  }
  return <form className="mt-5 border-t border-slate-700 pt-4" onSubmit={e => { e.preventDefault(); void submit(); }}>
    <fieldset disabled={!enabled || status === "saving"}>
      <legend className="mb-3 text-sm font-semibold text-white">{source === "manual" ? c.manualQuestion : c.question}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{(["accurate", "partly_accurate", "inaccurate", "uncertain"] as const).map(v =>
        <label key={v} className="flex cursor-pointer items-center gap-2 text-sm text-slate-300"><input type="radio" name={clipId} value={v} disabled={source === "manual" && !syncConfirmed && v !== "uncertain"} checked={verdict === v} onChange={() => { setVerdict(v); if (v === "accurate") setReason(null); setStatus("idle"); }} />{c[v]}</label>)}</div>
      {source === "manual" && !syncConfirmed && <p className="mt-2 text-xs text-amber-300">{c.unlinked}</p>}
      {verdict && verdict !== "accurate" && <label className="mt-3 block text-xs text-slate-400">{c.reason}<select className="ml-3 max-w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm" value={reason ?? ""} onChange={e => { setReason((e.target.value || null) as ClipFeedbackInput["reason"]); setStatus("idle"); }}>
        <option value="">{c.none}</option>{(["too_early", "too_late", "wrong_corner", "too_short", "not_relevant", "sync_uncertain"] as const).map(r => <option key={r} value={r}>{c[r]}</option>)}
      </select></label>}
      <button className={`${button} mt-3`} type="submit" disabled={!verdict || status === "saved"}><Send size={14} />{status === "saving" ? c.saving : c.submit}</button>
    </fieldset>
    <p className={`mt-2 text-xs ${status === "failed" ? "text-red-300" : "text-emerald-300"}`} role="status">{status === "saved" ? c.saved : status === "failed" ? c.failed : !enabled ? c.watch : ""}</p>
    <p className="mt-2 text-[11px] leading-5 text-slate-500">{c.privacy}</p>
  </form>;
}
