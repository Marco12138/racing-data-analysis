"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, GitCompareArrows, Trash2, Upload, X } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "../lib/i18n";
import { inspectXrkFile, deleteXrkInspection, type XrkInspection } from "../lib/xrkAnalysisApi";
import { comparisonVideoKey } from "../lib/videoComparison";
import { createTrackProjection } from "../lib/driverComparison";
import { driverClipWindow, requestDriverReview, type DriverBinding, type DriverCorner, type DriverSession, type DualDriverResult } from "../lib/dualDriverReview";
import { SiteNavigation } from "./SiteNavigation";
import { DriverGpsNotice, DriverLapPairing, DualCornerVideo, dualButton, dualInput, type LocalDriverVideo } from "./DualDriverVideo";

type Side = { inspection: XrkInspection | null; video: LocalDriverVideo | null; busy: boolean; error: string };
const emptySide = (): Side => ({ inspection: null, video: null, busy: false, error: "" });
const steps = [["导入两组素材", "Import pairs"], ["数据概览", "Overview"], ["单圈配对", "Pair laps"],
  ["推荐复盘", "Review"], ["自选弯道", "Your corner"], ["本节总结", "Debrief"]];
const metricNames = [
  ["entry_speed_kmh", "入口速度", "Entry speed", "km/h"], ["minimum_speed_kmh", "最低速度", "Minimum speed", "km/h"],
  ["minimum_rpm", "最低转速", "Minimum RPM", "rpm"], ["exit_speed_kmh", "出口速度", "Exit speed", "km/h"],
] as const;
const actionNames: Record<string, [string, string]> = {
  LIFTING: ["转速下降迹象", "RPM decline pattern"], COASTING: ["低减速度阶段", "Low-deceleration phase"],
  BRAKING_LIKELY: ["疑似制动（未确认）", "Likely braking (unconfirmed)"], BRAKING_CONFIRMED: ["直接刹车通道活动", "Direct brake-channel activity"],
  REACCELERATION: ["转速与速度恢复", "RPM / speed recovery"], THROTTLE_HESITATION: ["转速二次回落", "Secondary RPM drop"],
  MINIMUM_RPM: ["局部最低转速", "Local minimum RPM"], ACCELERATING: ["加速迹象", "Acceleration pattern"],
  SUSTAINED_ACCELERATION: ["持续加速迹象", "Sustained acceleration pattern"], UNKNOWN: ["证据不足", "Insufficient evidence"],
};

/** Independent import/binding identities; shared spatial gates link the review, not array indexes. */
export function DualDriverReview() {
  const { locale } = useI18n(), zh = locale === "zh";
  const [step, setStep] = useState(0), [interactive, setInteractive] = useState(false);
  const [sides, setSides] = useState<[Side, Side]>([emptySide(), emptySide()]);
  const [result, setResult] = useState<DualDriverResult | null>(null), [custom, setCustom] = useState<DualDriverResult | null>(null);
  const [laps, setLaps] = useState<[number | null, number | null]>([null, null]);
  const [bindings, setBindings] = useState<[DriverBinding | null, DriverBinding | null]>([null, null]);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [clipStarts, setClipStarts] = useState<Record<string, [number, number]>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [customStart, setCustomStart] = useState("");
  const [activeCorner, setActiveCorner] = useState("");
  const uploads = useRef<[AbortController | null, AbortController | null]>([null, null]);
  const request = useRef<AbortController | null>(null), urls = useRef(["", ""]), generation = useRef([0, 0]);
  const sourcePlayer = useRef<HTMLVideoElement>(null);
  useEffect(() => { const pending = uploads.current, localUrls = urls.current; queueMicrotask(() => setInteractive(true)); return () => {
    request.current?.abort(); pending.forEach(c => c?.abort()); localUrls.forEach(u => { if (u) URL.revokeObjectURL(u); });
    generation.current = generation.current.map(n => n + 1);
  }; }, []);
  function patch(i: number, data: Partial<Side>) { setSides(s => s.map((r, j) => i === j ? { ...r, ...data } : r) as [Side, Side]); }
  function moveStep(value: number) { document.querySelectorAll("video").forEach(v => v.pause()); setStep(value); window.scrollTo({ top: 0, behavior: "instant" }); }
  function invalidate() { request.current?.abort(); setBusy(false); setResult(null); setCustom(null); setConfirmed({}); setClipStarts({}); setStep(0); }
  async function upload(i: number, file: File) {
    uploads.current[i]?.abort(); const c = new AbortController(); uploads.current[i] = c;
    invalidate(); patch(i, { busy: true, error: "" });
    try {
      const inspection = await inspectXrkFile(file, c.signal, 52428800);
      if (c.signal.aborted) { void deleteXrkInspection(inspection.inspection_id).catch(() => {}); return; }
      patch(i, { inspection }); setLaps(l => i === 0 ? [null, l[1]] : [l[0], null]);
      setBindings(b => i === 0 ? [null, b[1]] : [b[0], null]);
    } catch (e) { if (!c.signal.aborted) patch(i, { error: (e as Error).message }); }
    finally { if (uploads.current[i] === c) patch(i, { busy: false }); }
  }
  async function video(i: number, file: File) {
    const g = ++generation.current[i]; request.current?.abort(); setBusy(false); setConfirmed({}); setClipStarts({});
    if (urls.current[i]) URL.revokeObjectURL(urls.current[i]);
    const url = URL.createObjectURL(file); urls.current[i] = url;
    patch(i, { video: null, error: "" }); setBindings(b => i === 0 ? [null, b[1]] : [b[0], null]);
    try {
      const fileKey = await comparisonVideoKey(file);
      if (generation.current[i] !== g) return;
      patch(i, { video: { file, fileKey, url, duration: 0 } });
    } catch { if (generation.current[i] === g) patch(i, { error: zh ? "本地视频读取失败" : "Local video could not be read" }); }
  }
  async function analyze(customTime?: number) {
    if (!sides[0].inspection || !sides[1].inspection) return;
    request.current?.abort(); const c = new AbortController(); request.current = c; setBusy(true); setError("");
    try {
      const response = await requestDriverReview([sides[0].inspection.inspection_id, sides[1].inspection.inspection_id], laps, c.signal, customTime);
      if (c.signal.aborted) return;
      if (customTime === undefined) {
        setResult(response); setCustom(null); setConfirmed({}); setClipStarts({});
        setLaps([response.sessions.a.selected_lap, response.sessions.b.selected_lap]); setActiveCorner(response.corners[0]?.id ?? ""); moveStep(1);
      } else { setCustom(response); setConfirmed(r => ({ ...r, custom: false })); setClipStarts(r => { const next = { ...r }; delete next.custom; return next; }); }
    } catch (e) { if (!c.signal.aborted) setError((e as Error).message); }
    finally { if (request.current === c) setBusy(false); }
  }
  const selectionCurrent = !!result && result.sessions.a.selected_lap === laps[0] && result.sessions.b.selected_lap === laps[1];
  const paired = selectionCurrent && bindings.every((b, i) => b && b.lap === laps[i] && b.inspectionId === sides[i].inspection?.inspection_id && b.fileKey === sides[i].video?.fileKey)
    && sides.every(s => s.video && s.video.duration > 0);
  const canNext = step === 0 ? sides.every(s => s.inspection && s.video && s.video.duration > 0 && !s.busy)
    : step === 1 ? !!result : step === 2 ? paired : true;
  const sessions = result ? [result.sessions.a, result.sessions.b] as [DriverSession, DriverSession] : null;
  const corners = [...(result?.corners ?? []), ...(custom?.corners ?? [])];
  function renderCorner(corner: DriverCorner) {
    if (!sessions || !paired) return null;
    const starts = clipStarts[corner.id] ?? (corner.a && corner.b ? [driverClipWindow(corner.a, bindings[0]!, sides[0].video!.duration)?.start ?? null, driverClipWindow(corner.b, bindings[1]!, sides[1].video!.duration)?.start ?? null] : []);
    return <section key={corner.id} className="space-y-4 border-b border-slate-700 py-6">
      <h2 className="text-lg font-semibold">{corner.id === "custom" ? (zh ? "自选弯道" : "Your corner") : `${zh ? "候选弯道" : "Suggested corner"} · ${corner.id}`}</h2>
      {corner.context && <p className="text-xs text-amber-200">{corner.context.status === "expanded"
        ? (zh ? "已补入减速前和速度恢复段；是否覆盖完整刹车与出弯仍需视频确认。" : "Approach and speed recovery included; confirm complete braking and exit coverage in video.")
        : (zh ? "完整入弯 / 出弯证据不足，当前仅为局部区段。" : "Full approach / exit unresolved; this remains a partial interval.")}</p>}
      {corner.status !== "candidate" || starts.length !== 2 || starts.some(s => s === null) ? <p className="text-amber-200">{zh ? "此区间暂不能联动播放：" : "Linked playback unavailable: "}{corner.reason || (zh ? "完整片段超出已配对单圈，请核对配对范围或选择另一区间。" : "The interval extends beyond a paired lap. Check pairing or choose another interval.")}</p> : <>
        <DualCornerVideo key={`${corner.id}:${corner.a?.start_session_s}:${corner.a?.end_session_s}:${bindings.map(b => b?.offset_s).join(":")}`}
          videos={[sides[0].video!, sides[1].video!]} sessions={sessions} bindings={bindings as [DriverBinding, DriverBinding]}
          starts={starts as [number, number]} observations={[corner.a!, corner.b!]} confirmed={!!confirmed[corner.id]} onConfirm={value => setConfirmed(r => ({ ...r, [corner.id]: value }))}
          onStartsChange={value => { setClipStarts(r => ({ ...r, [corner.id]: value })); setConfirmed(r => ({ ...r, [corner.id]: false })); }} />
        <CornerEvidence corner={corner} />
      </>}
    </section>;
  }
  return <><SiteNavigation /><main className="mx-auto min-w-0 max-w-[1440px] space-y-6 px-4 py-6 sm:px-8">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="flex items-center gap-2 text-2xl font-semibold"><GitCompareArrows />{zh ? "双车手遥测复盘" : "Two-driver telemetry review"}</h1>
      <Link className="text-sm text-cyan-300" href="/workspace">{zh ? "自由工作台" : "Free workspace"}</Link></header>
    <nav className="grid grid-cols-3 gap-2 lg:grid-cols-6" aria-label={zh ? "双车手六步复盘" : "Six-step driver comparison"}>{steps.map((s, i) => <button className={`${dualButton} ${step === i ? "border-yellow-400 text-yellow-300" : "text-slate-400"}`} key={i}
      aria-current={step === i ? "step" : undefined} disabled={busy || i > 0 && !result || i > 1 && !selectionCurrent || i > 2 && !paired} onClick={() => moveStep(i)}>{i + 1}. {s[zh ? 0 : 1]}</button>)}</nav>
    <section hidden={step !== 0} className="space-y-4">
      <p className="text-sm text-slate-400">{zh ? "同一赛道的两组 XRK 与车载视频。视频仅在浏览器处理；XRK 临时解析，不永久保留。" : "Two XRK/onboard-video pairs from the same track. Video stays local; XRK is processed temporarily."}</p>
      <div className="grid min-w-0 gap-6 lg:grid-cols-2">{sides.map((side, i) => <section key={i} className="min-w-0 space-y-3 border-t border-slate-700 pt-4">
        <h2 className="text-lg font-semibold">{zh ? "车手" : "Driver"} {i === 0 ? "A" : "B"}</h2>
        <label className={`${dualButton} w-full cursor-pointer justify-start`}><Upload size={16} /><span className="min-w-0 break-all">{side.inspection?.filename || "AiM XRK / XRZ"}</span>
          <input type="file" className="sr-only" accept=".xrk,.xrz" disabled={!interactive || side.busy} aria-label={`${i === 0 ? "A" : "B"} XRK`} onChange={e => { const f = e.target.files?.[0]; if (f) void upload(i, f); e.target.value = ""; }} /></label>
        <label className={`${dualButton} w-full cursor-pointer justify-start`}><Upload size={16} /><span className="min-w-0 break-all">{side.video?.file.name || (zh ? "选择配套视频" : "Choose paired video")}</span>
          <input type="file" className="sr-only" accept="video/mp4,video/quicktime,.mp4,.mov" disabled={!interactive} aria-label={`${i === 0 ? "A" : "B"} video`} onChange={e => { const f = e.target.files?.[0]; if (f) void video(i, f); e.target.value = ""; }} /></label>
        {side.video && <video key={side.video.url} src={side.video.url} controls playsInline muted preload="metadata" className="aspect-video w-full bg-black"
          onLoadedMetadata={e => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) patch(i, { video: { ...side.video!, duration: d } }); }}
          onError={() => patch(i, { error: zh ? "视频解码失败，请使用兼容的 MP4。" : "Video decoding failed. Use a compatible MP4." })} />}
        {side.busy && <button className={dualButton} onClick={() => { uploads.current[i]?.abort(); patch(i, { busy: false }); }}><X size={14} />{zh ? "解析中…取消" : "Parsing… cancel"}</button>}
        {side.inspection && <div className="flex flex-wrap items-center gap-3 text-xs"><span>{side.inspection.laps} {zh ? "计时圈" : "timed laps"} · GPS {side.inspection.has_gps ? "✓" : "—"} · RPM {side.inspection.has_rpm ? "✓" : "—"}</span>
          <button className={dualButton} aria-label={zh ? "移除临时 Session" : "Remove temporary session"} onClick={() => { const id = side.inspection!.inspection_id; void deleteXrkInspection(id).catch(e => setError(e.message)); patch(i, { inspection: null }); invalidate(); }}><Trash2 size={14} /></button></div>}
        {side.error && <p role="alert" className="break-words text-sm text-amber-200">{side.error}</p>}
      </section>)}</div>
    </section>
    {sessions && step === 1 && <>
      <div className="grid min-w-0 gap-6 lg:grid-cols-2">{sessions.map((s, i) => <section className="min-w-0 border-t border-slate-700 pt-4" key={i}>
        <h2 className="font-semibold">{i === 0 ? "A" : "B"} · {String(s.metadata.Driver ?? (zh ? "车手" : "Driver"))}</h2>
        <p className="mt-2 text-xs text-slate-400">{String(s.metadata.Venue ?? "—")} · {String(s.metadata.Vehicle ?? "—")}</p>
        <DriverTrack session={s} label={i === 0 ? "A" : "B"} />
        <dl className="my-4 grid grid-cols-2 gap-3 text-sm"><dt>{zh ? "最快有效圈" : "Fastest valid lap"}</dt><dd className="font-mono">L{s.fastest_five.fastest?.lap} · {s.fastest_five.fastest?.lap_time.toFixed(3)}s</dd>
          <dt>{zh ? "前五快方差" : "Fastest-five variance"}</dt><dd className="font-mono">{s.fastest_five.variance_s2 === null ? (zh ? `有效圈不足五圈（${s.fastest_five.count}）` : `Fewer than five valid laps (${s.fastest_five.count})`) : `${s.fastest_five.variance_s2.toFixed(6)} s²`}</dd></dl>
        <p className="mb-3 text-xs text-slate-400">{zh ? "所选前五圈总体方差（除以5），不代表全部圈的一致性或传感器噪声。" : "Population variance of the selected fastest five (divide by 5), not all-lap consistency or sensor noise."}</p>
        <ul className="divide-y divide-slate-800 text-sm">{s.fastest_five.laps.map(r => <li className="flex justify-between py-2" key={r.lap}><span>L{r.lap}</span><span className="font-mono">{r.lap_time.toFixed(3)}s</span></li>)}</ul>
        <label className="mt-4 block text-xs">{zh ? "配对 / 比较的真实圈" : "Real lap to pair / compare"}<select aria-label={zh ? "配对 / 比较的真实圈" : "Real lap to pair / compare"} className={`${dualInput} mt-1`} value={laps[i] ?? ""} disabled={busy} onChange={e => { setLaps(l => i === 0 ? [Number(e.target.value), l[1]] : [l[0], Number(e.target.value)]); setBindings(b => i === 0 ? [null, b[1]] : [b[0], null]); setConfirmed({}); }}>
          {s.lap_quality.laps.filter(r => r.analysis_eligible).map(r => <option key={r.lap} value={r.lap}>L{r.lap} · {r.lap_time.toFixed(3)}s</option>)}</select></label>
      </section>)}</div>
      {sessions.some((s, i) => s.selected_lap !== laps[i]) && <button className={dualButton} disabled={busy} onClick={() => void analyze()}>{zh ? "更新比较圈" : "Update compared laps"}</button>}
    </>}
    {sessions && step === 2 && <div className="grid min-w-0 gap-6 lg:grid-cols-2">{sessions.map((s, i) => sides[i].video && <DriverLapPairing
      key={`${sides[i].inspection!.inspection_id}:${sides[i].video!.fileKey}:${s.selected_lap}`} label={i === 0 ? "A" : "B"} video={sides[i].video!} session={s}
      inspectionId={sides[i].inspection!.inspection_id} binding={bindings[i]} onBind={value => {
        if (JSON.stringify(bindings[i]) === JSON.stringify(value)) return;
        setBindings(b => i === 0 ? [value, b[1]] : [b[0], value]); setConfirmed({}); setClipStarts({});
      }} />)}</div>}
    {step === 3 && paired && <>{!result!.corners.length && <p>{zh ? "没有可靠的推荐区间；可继续自选弯道。" : "No reliable suggested intervals. Continue to choose your corner."}</p>}
      <div className="flex flex-wrap gap-2" role="group" aria-label={zh ? "推荐弯道" : "Suggested corners"}>{result!.corners.map((c, i) => <button key={c.id} className={`${dualButton} ${activeCorner === c.id ? "border-cyan-300 text-cyan-200" : ""}`} onClick={() => setActiveCorner(c.id)} aria-pressed={activeCorner === c.id}>
        {zh ? "候选" : "Candidate"} {i + 1} · {confirmed[c.id] ? (zh ? "已核对" : "Reviewed") : (zh ? "待核对" : "Pending")}</button>)}</div>
      {result!.corners.filter(c => c.id === activeCorner).map(renderCorner)}</>}
    {step === 4 && paired && <section className="space-y-4">
      <h2 className="font-semibold">{zh ? "在 A 视频选一个起点，联动查找 B 的同一弯道" : "Choose a start in A; find the same physical corner in B"}</h2>
      <video ref={sourcePlayer} src={sides[0].video!.url} controls playsInline className="aspect-video w-full max-w-2xl bg-black"
        onLoadedMetadata={e => { e.currentTarget.currentTime = bindings[0]!.video_start_s; }} />
      <div className="flex flex-wrap gap-3"><label className="text-xs">{zh ? "A 视频起点（秒）" : "A video start (seconds)"}<input type="number" min={0} step={.01} className={`${dualInput} mt-1`} value={customStart} onChange={e => setCustomStart(e.target.value)} /></label>
        <button className={dualButton} onClick={() => setCustomStart(String(sourcePlayer.current?.currentTime ?? 0))}>{zh ? "使用当前帧" : "Use current frame"}</button>
        <button className={dualButton} disabled={busy || customStart === "" || !Number.isFinite(Number(customStart)) || Number(customStart) < bindings[0]!.video_start_s || Number(customStart) + 5 > bindings[0]!.video_end_s}
          onClick={() => void analyze(Number(customStart) - bindings[0]!.offset_s)}>{zh ? "查找两侧同一弯道" : "Find shared corner"}</button></div>
      {custom?.corners.map(renderCorner)}
      {custom && !custom.corners.length && <p className="text-amber-200">{zh ? "没有通过质量检查的对应区间。GPS 未通过时不会强行关联，可改用视频分析的独立起点对照。" : "No interval passed the shared-location checks. Use independent starts in video-only comparison; failed GPS is not forced into a match."}</p>}
    </section>}
    {step === 5 && sessions && <section className="space-y-6"><h2 className="text-xl font-semibold">{zh ? "本次双车手复盘" : "Two-driver debrief"}</h2>
      <p>{zh ? "真实最快圈" : "Real fastest laps"}: A L{sessions[0].fastest_five.fastest?.lap} {sessions[0].fastest_five.fastest?.lap_time.toFixed(3)}s · B L{sessions[1].fastest_five.fastest?.lap} {sessions[1].fastest_five.fastest?.lap_time.toFixed(3)}s</p>
      {corners.filter(c => confirmed[c.id]).map(c => <section key={c.id} className="border-t border-slate-700 pt-4"><h3>{c.id} · {zh ? "已核对视频位置" : "Video location reviewed"}</h3><CornerEvidence corner={c} compact />
        {[c.a, c.b].map((observation, i) => observation && sides[i].video && <div key={i}><span className="text-xs">{i === 0 ? "A" : "B"}</span><DriverGpsNotice video={sides[i].video!} fingerprint={sessions[i].file_fingerprint} observation={observation} /></div>)}
      </section>)}
      {!corners.some(c => confirmed[c.id]) && <p className="text-amber-200">{zh ? "还没有人工核对通过的双视频区间。先回到推荐复盘或自选弯道确认同一位置。" : "No paired clip has been reviewed yet. Confirm a shared location in Review or Your corner."}</p>}
      <p className="text-sm text-slate-400">{zh ? "下一次练习：优先复看已确认区间的入口和出口，保持其他条件不变，单独测试一种动作，再看同一空间区间的用时与出口速度。转速下降不等于已确认刹车；未标定 GoPro 横向 G 不能证明转向时刻。" : "Next test: review the confirmed entry and exit, hold other conditions steady and test one action at a time. Recheck shared-gate time and exit speed. RPM decline does not confirm braking; uncalibrated GoPro lateral G does not establish steering onset."}</p>
    </section>}
    {result?.warnings.length ? <details className="border-t border-slate-700 pt-3 text-xs text-amber-200"><summary>{zh ? "数据边界与警告" : "Data limits and warnings"} ({result.warnings.length})</summary><ul className="mt-2 space-y-1">{result.warnings.map(w => <li key={w}>{w}</li>)}</ul></details> : null}
    {error && <p role="alert" className="break-words text-amber-200">{error}</p>}
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-700 pt-4"><button className={dualButton} disabled={!step || busy} onClick={() => moveStep(step - 1)}><ArrowLeft size={16} />{zh ? "上一步" : "Back"}</button>
      {busy && <button className={dualButton} onClick={() => { request.current?.abort(); setBusy(false); }}>{zh ? "分析中…取消" : "Analyzing… cancel"}</button>}
      {step < 5 && <button className={`${dualButton} border-yellow-400 text-yellow-300`} disabled={busy || !canNext || step === 1 && sessions!.some((s, i) => s.selected_lap !== laps[i])}
        onClick={() => step === 0 ? void analyze() : moveStep(step + 1)}>{zh ? "下一步" : "Next"}<ArrowRight size={16} /></button>}</footer>
  </main></>;
}

export function CornerEvidence({ corner, compact = false }: { corner: DriverCorner; compact?: boolean }) {
  const { locale } = useI18n(), zh = locale === "zh";
  if (!corner.a || !corner.b) return null;
  const { a, b } = corner;
  const data = a.profile.progress.map((p, i) => ({ progress: p * 100, a: a.profile.speed[i], b: b.profile.speed[i], rpmA: a.profile.rpm?.[i], rpmB: b.profile.rpm?.[i] }));
  const faster = b.elapsed_s < a.elapsed_s ? "B" : "A", gain = Math.abs(b.elapsed_s - a.elapsed_s);
  const exit = corner.differences?.exit_speed_kmh;
  return <div className="space-y-3">
    <p className="text-sm text-cyan-200">{gain < .001 ? (zh ? "这两次通过的区间用时接近。" : "The observed interval times are close.") : zh
      ? `${faster} 在同一入口到出口间少用 ${gain.toFixed(3)} 秒。这是本次观测差值，不代表统计显著或驾驶因果。`
      : `${faster} took ${gain.toFixed(3)}s less between the shared gates. This is an observed difference, not statistical significance or driving causality.`}
      {exit != null && (zh ? ` B 的出口速度比 A ${exit >= 0 ? "高" : "低"} ${Math.abs(exit).toFixed(2)} km/h。` : ` B's exit speed was ${Math.abs(exit).toFixed(2)} km/h ${exit >= 0 ? "higher" : "lower"} than A's.`)}</p>
    <p className="text-sm">{zh ? "同一入口到出口的用时（不是各取5秒的时长）" : "Time between shared gates (not fixed clip length)"}: A {a.elapsed_s.toFixed(3)}s · B {b.elapsed_s.toFixed(3)}s · B−A {(b.elapsed_s - a.elapsed_s).toFixed(3)}s</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="py-2">{zh ? "观测量" : "Observation"}</th><th>A</th><th>B</th><th>B−A</th></tr></thead><tbody>{metricNames.map(([key, cn, en, unit]) => <tr key={key} className="border-t border-slate-800"><th className="py-2 font-normal">{zh ? cn : en} ({unit})</th>
      {[a.metrics[key], b.metrics[key], corner.differences?.[key]].map((v, i) => <td className="font-mono" key={i}>{v == null ? "—" : v.toFixed(key === "minimum_rpm" ? 0 : 2)}</td>)}</tr>)}</tbody></table></div>
    {!compact && <div className="grid min-w-0 gap-4 lg:grid-cols-2">{["speed", "rpm"].map(channel => <div className="min-w-0" key={channel}><h4 className="text-sm">{channel === "speed" ? (zh ? "速度 · km/h" : "Speed · km/h") : "RPM"}</h4>
      {channel === "rpm" && (!a.profile.rpm || !b.profile.rpm) ? <p className="py-8 text-sm text-slate-400">{zh ? "RPM 通道不可用" : "RPM channel unavailable"}</p> : <div className="h-52"><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><CartesianGrid stroke="#263341" /><XAxis dataKey="progress" unit="%" /><YAxis domain={["auto", "auto"]} /><Tooltip /><Line name="A" dataKey={channel === "speed" ? "a" : "rpmA"} stroke="#2dd4bf" dot={false} isAnimationActive={false} /><Line name="B" dataKey={channel === "speed" ? "b" : "rpmB"} stroke="#facc15" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>}</div>)}</div>}
    <p className="text-xs text-slate-400">{zh ? "横轴是两道共享空间门之间各自的距离进度，不是强行对齐时间。更高的弯中 RPM 不必然带来更快出弯；车辆传动、线路和入口速度都可能影响结果。" : "The x-axis is each trajectory's distance progress between shared gates, not warped time. Higher mid-corner RPM does not prove a better exit; gearing, line and entry speed can confound the result."}</p>
    {[a, b].map((obs, i) => <details key={i} className="text-xs text-slate-400"><summary>{i === 0 ? "A" : "B"} · {zh ? "信号事件（推断，非踏板测量）" : "Signal events (inferred, not pedal measurements)"}</summary>
      {obs.events.length ? obs.events.map((e, j) => <p key={j}>{actionNames[e.type]?.[zh ? 0 : 1] ?? e.type} · {zh ? "经过入口后" : "after entry"} {e.from_entry_s.toFixed(2)}s · {e.confidence}</p>) : <p>{zh ? "此段无可靠事件" : "No reliable event in this interval"}</p>}</details>)}
  </div>;
}

function DriverTrack({ session, label }: { session: DriverSession; label: string }) {
  const { locale } = useI18n();
  const projection = createTrackProjection(session.track, 600, 240, 16);
  if (!projection) return <p className="py-6 text-sm text-slate-400">{locale === "zh" ? "GPS 轨迹不可用" : "GPS track unavailable"}</p>;
  const points = session.track.map(p => { const q = projection.project(p); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(" ");
  return <svg viewBox="0 0 600 240" role="img" aria-label={`${label} GPS`} className="my-3 aspect-[5/2] w-full border border-slate-800 bg-black/20"><polyline points={points} fill="none" stroke={label === "A" ? "#2dd4bf" : "#facc15"} strokeWidth={2} /></svg>;
}
