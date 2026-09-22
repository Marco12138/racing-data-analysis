"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Download, Flag, FolderOpen, MapPin, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { createTrackReference, matchTrackReference, nearestReferenceIndex, orderTrackCorners, parseTrackReference,
  referenceGate, type SpatialGate, type TrackMatch, type TrackReference, type XY } from "../lib/trackReference";

const STORAGE = "racing-track-reference-v1";
const inputStyle = "min-w-0 rounded border border-white/15 bg-black/20 px-2 py-1.5 text-sm";
const buttonStyle = "inline-flex min-h-9 items-center justify-center gap-2 rounded border border-white/15 px-3 py-1.5 text-sm disabled:opacity-40";
const pointsAttribute = (points: XY[]) => points.map(([x, y]) => `${x.toFixed(2)},${(-y).toFixed(2)}`).join(" ");
const metric = (value?: number | null) => value == null ? "--" : value.toFixed(2);
const REASONS: Record<string, [string, string]> = {
  nonmonotonic_or_gapped_GPS: ["GPS 时间不连续", "Discontinuous GPS timestamps"],
  incomplete_or_discontinuous_lap: ["圈轨迹不完整或存在跳点", "Incomplete lap or GPS jumps"],
  lap_length_mismatch: ["圈长差异超过阈值", "Lap length outside tolerance"],
  invalid_GPS_fix: ["GPS 定位无效", "Invalid GPS fix"],
  insufficient_native_GPS: ["原生 GPS 样本不足", "Insufficient native GPS samples"],
  holdout_geometry_or_shift_stability_failed: ["留出路段误差或平移稳定性未通过", "Holdout error or shift stability failed"],
  translation_exceeds_limit: ["平移量超过上限", "Translation exceeds limit"],
  existing_lap_quality_gate: ["原有圈质量门未通过", "Existing lap quality gate rejected"],
  wrong_direction: ["行驶方向不同", "Wrong driving direction"],
  missing_or_unordered_spatial_gates: ["空间门缺失、重复或次序不符", "Missing, repeated or unordered gates"],
  incomplete_or_gapped_gate_window: ["区间 GPS 不完整", "Incomplete GPS in this interval"],
  invalid_GPS_in_gate_window: ["区间 GPS 无效", "Invalid GPS in this interval"],
  stationary_GPS_in_gate_window: ["区间含静止或重复 GPS 点", "Stationary or duplicate GPS points"],
  GPS_speed_provenance_unconfirmed: ["GPS 速度来源未确认", "GPS speed source unconfirmed"],
  zone_thresholds_unavailable: ["固定区间阈值不可用", "Fixed zone thresholds unavailable"],
};
const PHASES: Record<string, [string, string]> = {
  deceleration_onset: ["减速起点", "Deceleration onset"], curvature_build_up: ["曲率建立", "Curvature build-up"],
  minimum_speed: ["最低速点", "Minimum speed"], acceleration_onset: ["加速建立", "Acceleration onset"],
  corner_exit: ["弯道出口", "Corner exit"],
};

export function TrackReferencePanel({ inspectionId, referenceLap, readOnly = false }: {
  inspectionId: string; referenceLap: number; readOnly?: boolean;
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  const reasonText = (code: string) => REASONS[code]?.[zh ? 0 : 1] ?? code;
  const [config, setConfig] = useState<TrackReference | null>(null);
  const [result, setResult] = useState<TrackMatch | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState("view"), [cornerId, setCornerId] = useState("");
  const [placementIndex, setPlacementIndex] = useState(0);
  const [lap, setLap] = useState(0), [platformLap, setPlatformLap] = useState(0);
  const [raw, setRaw] = useState(true), [registered, setRegistered] = useState(true);
  const controller = useRef<AbortController | null>(null), upload = useRef<HTMLInputElement>(null);
  const unavailable = readOnly || !/^[0-9a-f]{32}$/.test(inspectionId);

  useEffect(() => () => controller.current?.abort(), [inspectionId]);

  function commit(next: TrackReference) {
    const updated = { ...next, revision: next.revision + 1 };
    updated.corners = orderTrackCorners(updated);
    setConfig(updated); setResult(null); setNotice("");
  }

  async function run(action: "create" | "match") {
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    setBusy(true); setError(""); setNotice("");
    try {
      if (action === "create") {
        const draft = await createTrackReference(inspectionId, referenceLap, active.signal);
        setConfig(draft); setCornerId(draft.corners[0]?.id ?? ""); setResult(null);
      } else if (config) {
        const matched = await matchTrackReference(inspectionId, config, active.signal);
        setResult(matched); setLap(matched.laps.find(l => l.geometry_status === "accepted")?.logger_lap ?? matched.traces[0]?.logger_lap ?? 0);
        setPlatformLap(matched.platform_laps.find(l => l.status === "calculated")?.platform_lap ?? 0);
      }
    } catch (err) {
      if (!active.signal.aborted) setError(err instanceof Error ? err.message : "Track analysis failed");
    } finally { if (controller.current === active) setBusy(false); }
  }

  function open(text: string) {
    try { const next = parseTrackReference(text); setConfig(next); setCornerId(next.corners[0]?.id ?? ""); setResult(null); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Invalid map"); }
  }

  function download() {
    if (!config) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `${config.track_id}-v${config.revision}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function moveGate(index: number) {
    if (!config || busy || mode === "view") return;
    const gate = referenceGate(config.reference_path, index);
    if (mode === "finish") commit({ ...config, start_finish_gate: gate });
    else commit({ ...config, corners: config.corners.map(c => c.id === cornerId ? { ...c, confirmed: false,
      [mode === "entry" ? "entry_gate" : "exit_gate"]: gate } : c) });
    setMode("view");
  }

  const selected = config?.corners.find(c => c.id === cornerId);
  const trace = result?.traces.find(t => t.logger_lap === lap);
  const cycle = result?.platform_laps.find(l => l.platform_lap === platformLap);
  const allPoints = [...(config?.reference_path ?? []), ...(trace?.raw_xy ?? []), ...(trace?.registered_xy ?? [])];
  const xs = allPoints.map(p => p[0]), ys = allPoints.map(p => -p[1]);
  const minX = Math.min(...xs) - 25, minY = Math.min(...ys) - 25;
  const width = Math.max(...xs) - minX + 25, height = Math.max(...ys) - minY + 25;
  const gates: Array<{ id: string; gate: SpatialGate; color: string }> = config ? [
    { id: "S/F", gate: config.start_finish_gate, color: "#f5c969" },
    ...config.corners.flatMap(c => [{ id: `${c.id} in`, gate: c.entry_gate, color: c.id === cornerId ? "#67e8f9" : "#7f9baa" },
      { id: `${c.id} out`, gate: c.exit_gate, color: c.id === cornerId ? "#fda4af" : "#a78e95" }]),
  ] : [];

  return <section data-testid="track-reference-panel" className="min-w-0 space-y-5 border-t border-white/10 pt-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-base font-semibold">{zh ? "实测赛道参考图" : "Observed Track Reference"} <span className="text-xs font-normal text-amber-300">{zh ? "待验证" : "Provisional"}</span></h3>
      <div className="flex flex-wrap gap-2">
        <button className={buttonStyle} disabled={busy || unavailable} onClick={() => void run("create")}><Plus size={16} />{zh ? "由参考圈建图" : "Create from reference lap"}</button>
        <button className={buttonStyle} title={zh ? "导入赛道 JSON" : "Import track JSON"} disabled={busy || unavailable} onClick={() => upload.current?.click()}><FolderOpen size={16} /></button>
        <button className={buttonStyle} disabled={busy || unavailable} onClick={() => { try { const text = localStorage.getItem(STORAGE); if (text) open(text); else setNotice(zh ? "本机尚无保存的赛道图" : "No saved map on this browser"); } catch { setError(zh ? "浏览器存储不可用" : "Browser storage unavailable"); } }}><RefreshCw size={16} />{zh ? "恢复本机配置" : "Restore saved map"}</button>
        <input ref={upload} type="file" accept="application/json,.json" className="hidden" aria-label={zh ? "导入赛道配置" : "Import track configuration"}
          onChange={async e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) { if (file.size > 1_000_000) setError("Track configuration exceeds 1 MB"); else open(await file.text()); } }} />
      </div>
    </header>
    {unavailable && <p className="text-sm text-slate-400">{zh ? "演示 Session 为只读。导入真实 XRK 后可创建和验证参考图。" : "Demo sessions are read-only. Import a real XRK to create and test a reference map."}</p>}
    {error && <p role="alert" className="break-words text-sm text-rose-300">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
    {config && <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-slate-400">{zh ? "赛道 ID" : "Track ID"}<input aria-label="Track ID" className={inputStyle} value={config.track_id} maxLength={80} disabled={busy} onChange={e => commit({ ...config, track_id: e.target.value.replace(/[^A-Za-z0-9_-]/g, "") })} /></label>
        <span className="pb-2 text-xs text-slate-400">{config.direction} · Lap {config.source_lap} · v{config.revision}</span>
        <button className={buttonStyle} disabled={busy || !config.track_id} title={zh ? "保存到当前浏览器" : "Save in this browser"} onClick={() => { try { localStorage.setItem(STORAGE, JSON.stringify(config)); setNotice(zh ? "配置已保存到当前浏览器" : "Map saved in this browser"); } catch { setError(zh ? "保存失败" : "Save failed"); } }}><Save size={16} /></button>
        <button className={buttonStyle} title={zh ? "导出赛道配置" : "Export track configuration"} onClick={download}><Download size={16} /></button>
        <button className={`${buttonStyle} bg-emerald-700/30`} disabled={busy || unavailable || !config.track_id} onClick={() => void run("match")}><Check size={16} />{busy ? (zh ? "正在检验" : "Checking") : (zh ? "匹配当前 Session" : "Match this session")}</button>
        {busy && <button className={buttonStyle} title={zh ? "取消" : "Cancel"} onClick={() => controller.current?.abort()}><X size={16} /></button>}
      </div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-white">{zh ? "参考轨迹" : "Reference"}</span>
            <label className="text-rose-300"><input type="checkbox" checked={raw} onChange={e => setRaw(e.target.checked)} /> {zh ? "原始 GPS" : "Raw GPS"}</label>
            <label className="text-emerald-300"><input type="checkbox" checked={registered} onChange={e => setRegistered(e.target.checked)} /> {zh ? "平移配准" : "Registered"}</label>
            {result && <select aria-label={zh ? "查看记录仪圈" : "View logger lap"} className={inputStyle} value={lap} onChange={e => setLap(Number(e.target.value))}>{result.traces.map(t => <option key={t.logger_lap} value={t.logger_lap}>Lap {t.logger_lap}</option>)}</select>}
          </div>
          <svg aria-label={zh ? "固定参考轨迹及空间门" : "Fixed track reference and spatial gates"} role="img" viewBox={`${minX} ${minY} ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className={`mt-3 aspect-[3/4] w-full touch-manipulation sm:aspect-[3/2] ${mode !== "view" ? "cursor-crosshair" : ""}`}
            onClick={e => { if (mode === "view") return; const matrix = e.currentTarget.getScreenCTM(); if (!matrix) return;
              const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse()); moveGate(nearestReferenceIndex(config.reference_path, [point.x, -point.y])); }}>
            <polyline points={pointsAttribute(config.reference_path)} fill="none" stroke="#e2e8f0" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            {raw && trace && <polyline points={pointsAttribute(trace.raw_xy)} fill="none" stroke="#fb7185" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
            {registered && trace && <polyline points={pointsAttribute(trace.registered_xy)} fill="none" stroke="#34d399" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
            {gates.map(({ id, gate, color }) => <g key={id}><title>{id}</title><line x1={gate.a[0]} y1={-gate.a[1]} x2={gate.b[0]} y2={-gate.b[1]} stroke={color} strokeWidth={2} strokeDasharray={gate.confirmed ? undefined : "4 3"} vectorEffect="non-scaling-stroke" />{(!id.endsWith("out") || id.startsWith(`${cornerId} `)) && <text x={gate.b[0] + 2} y={-gate.b[1]} fontSize={6} fill={color}>{id.replace(" in", "")}</text>}</g>)}
          </svg>
        </div>
        <fieldset disabled={busy} className="min-w-0 space-y-4 border-l border-white/10 pl-4 text-sm">
          <legend className="sr-only">{zh ? "空间门编辑" : "Spatial gate editor"}</legend>
          <button className={`${buttonStyle} w-full ${mode === "finish" ? "bg-amber-600/30" : ""}`} onClick={() => setMode(mode === "finish" ? "view" : "finish")} title={zh ? "在轨迹上选择起终点" : "Select the timing line on the path"}><Flag size={16} />{zh ? "定位起终点" : "Place start / finish"}</button>
          {mode !== "view" && <div className="flex items-end gap-2">
            <label className="grid min-w-0 flex-1 gap-1 text-xs">{zh ? "参考点索引" : "Reference point index"}<input type="number" min={0} max={config.reference_path.length - 1} step={1} className={inputStyle} value={placementIndex}
              onChange={e => setPlacementIndex(Math.max(0, Math.min(config.reference_path.length - 1, Math.trunc(Number(e.target.value)))))} /></label>
            <button className={buttonStyle} title={zh ? "应用空间门位置" : "Apply gate position"} onClick={() => moveGate(placementIndex)}><Check size={16} /></button>
          </div>}
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={config.start_finish_gate.confirmed} onChange={e => commit({ ...config, start_finish_gate: { ...config.start_finish_gate, confirmed: e.target.checked } })} />{zh ? "已通过视频确认计时线" : "Timing line confirmed in video"}</label>
          <select aria-label={zh ? "弯道区间" : "Corner interval"} className={`${inputStyle} w-full`} value={cornerId} onChange={e => { setCornerId(e.target.value); setMode("view"); }}>{config.corners.map(c => <option key={c.id} value={c.id}>{c.id} · {c.name}</option>)}</select>
          {selected && <>
            <input aria-label={zh ? "弯道名称" : "Corner name"} className={`${inputStyle} w-full`} value={selected.name} maxLength={80} onChange={e => commit({ ...config, corners: config.corners.map(c => c.id === selected.id ? { ...c, name: e.target.value, confirmed: false } : c) })} />
            <div className="grid grid-cols-2 gap-2">{(["entry", "exit"] as const).map(id => <button key={id} className={`${buttonStyle} ${mode === id ? "bg-cyan-600/30" : ""}`} onClick={() => setMode(mode === id ? "view" : id)} title={zh ? "在轨迹上选择空间门" : "Select a gate on the path"}><MapPin size={14} />{id === "entry" ? (zh ? "入口门" : "Entry") : (zh ? "出口门" : "Exit")}</button>)}</div>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={selected.confirmed} onChange={e => commit({ ...config, corners: config.corners.map(c => c.id === selected.id ? { ...c, confirmed: e.target.checked, entry_gate: { ...c.entry_gate, confirmed: e.target.checked }, exit_gate: { ...c.exit_gate, confirmed: e.target.checked } } : c) })} />{zh ? "已核对编号与入口 / 出口" : "Name and both gates reviewed"}</label>
            <button className={buttonStyle} title={zh ? "删除此候选区间" : "Remove this candidate interval"} onClick={() => { commit({ ...config, corners: config.corners.filter(c => c.id !== selected.id) }); setCornerId(config.corners.find(c => c.id !== selected.id)?.id ?? ""); }}><Trash2 size={16} /></button>
          </>}
          <button className={buttonStyle} disabled={config.corners.length >= 30} onClick={() => { let index = 1; while (config.corners.some(c => c.id === `C${index}`)) index++;
            const id = `C${index}`; commit({ ...config, corners: [...config.corners, { id, name: zh ? "待命名" : "Unnamed", confirmed: false,
              entry_gate: referenceGate(config.reference_path, 30), exit_gate: referenceGate(config.reference_path, 60) }] }); setCornerId(id); }}><Plus size={16} />{zh ? "新增区间" : "Add interval"}</button>
          <p className="text-xs text-amber-200">{zh ? "候选区间不是官方弯道。配准不证明偏离来自 GPS 误差，原始走线始终保留。" : "Candidates are not official corners. Registration does not prove GPS error; original lines are retained."}</p>
        </fieldset>
      </div>
      {result && <>
        <div role="status" className="flex flex-wrap gap-4 border-y border-white/10 py-3 text-sm">
          <span>{zh ? "通过配准" : "Registration accepted"}: {result.coverage.geometry_accepted_laps} / {result.coverage.logger_laps}</span>
          <span>{zh ? "单次穿门" : "Exactly one crossing"}: {result.coverage.exactly_once_gate_lap_pairs} / {result.coverage.gate_lap_pairs}</span>
          <span>{zh ? "平台完整圈" : "Complete platform laps"}: {result.coverage.platform_laps}</span>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="text-slate-400"><tr>{["Lap", zh ? "记录仪圈时 (s)" : "Logger time (s)", zh ? "平移 (m)" : "Shift (m)", zh ? "留出中位 / P95 (m)" : "Holdout median / P95 (m)", zh ? "结果 / 原因" : "Status / reason"].map(s => <th key={s} className="whitespace-nowrap px-2 py-2">{s}</th>)}</tr></thead>
          <tbody>{result.laps.map(l => <tr key={l.logger_lap} className="border-t border-white/10"><td className="px-2 py-2">{l.logger_lap}</td><td>{l.logger_duration_s.toFixed(3)}</td><td>{metric(l.registration?.translation_norm_m)}</td><td>{metric(l.registration?.holdout_median_m)} / {metric(l.registration?.holdout_p95_m)}</td><td className="max-w-56 break-words" title={l.reasons.join(", ")}>{l.geometry_status === "accepted" ? (zh ? "通过" : "Accepted") : l.reasons.map(reasonText).join(", ")}</td></tr>)}</tbody></table></div>
        {cycle && <div className="space-y-3">
          <label className="flex flex-wrap items-center gap-3 text-sm">{zh ? "平台圈 / 逐弯检验" : "Platform lap / corner checks"}<select className={inputStyle} value={platformLap} onChange={e => setPlatformLap(Number(e.target.value))}>{result.platform_laps.map(l => <option key={l.platform_lap} value={l.platform_lap}>{l.platform_lap} · {l.status === "calculated" ? `${l.duration_s?.toFixed(3)}s` : "Unavailable"}</option>)}</select></label>
          <p className="text-xs text-slate-400">{zh ? "来源记录仪圈" : "Source logger laps"}: {cycle.source_logger_laps.join(", ")} · {zh ? "移动计时门可能改变单圈时长，不替换原始圈时。" : "A moved timing gate can change individual lap times; logger times are not replaced."}</p>
          <p className="text-xs text-amber-200">{zh ? "阶段为 GPS 运动学推断，未确认踏板或转向动作。" : "Phases are GPS kinematic inferences, not confirmed pedal or steering inputs."}</p>
          <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead><tr>{[zh ? "区间" : "Interval", zh ? "入口 / 出口次数" : "Entry / exit count", zh ? "区间时间 (s)" : "Interval time (s)", zh ? "运动学阶段" : "Kinematic phases"].map(s => <th className="whitespace-nowrap px-2 py-2" key={s}>{s}</th>)}</tr></thead><tbody>{cycle.corners.map(c => {
            const phase = result.gate_phases.corners.find(p => p.id === c.id)?.phases.find(p => p.lap === cycle.platform_lap);
            return <tr key={c.id} className="border-t border-white/10 align-top"><td className="px-2 py-2">{c.id} · {c.name}</td><td className="py-2">{c.entry_count} / {c.exit_count}</td><td className="py-2">{c.duration_s?.toFixed(3) ?? "--"}</td><td className="max-w-64 break-words py-2">{phase?.status === "calculated"
              ? <details><summary className="cursor-pointer">{5 - (phase.missing_phases?.length ?? 0)} / 5</summary><dl className="mt-2 space-y-2">{Object.entries(PHASES).map(([key, labels]) => { const e = phase.events?.[key]; return <div key={key}><dt>{labels[zh ? 0 : 1]}</dt><dd className="text-slate-400">{e ? `${e.session_time_s.toFixed(3)}s (Session) · ${e.speed_kmh.toFixed(2)} km/h` : (zh ? "未识别" : "Not detected")}</dd></div>; })}</dl></details>
              : reasonText(phase?.reason ?? result.gate_phases.reason ?? (zh ? "不可用" : "Unavailable"))}</td></tr>;
          })}</tbody></table></div>
        </div>}
      </>}
    </>}
  </section>;
}
