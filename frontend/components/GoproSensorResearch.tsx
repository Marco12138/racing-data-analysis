"use client";

import { memo, useMemo, useState } from "react";
import { useI18n } from "../lib/i18n";
import { cameraSpectrum } from "../lib/cameraSpectrum";
import type { GoproAudit } from "../lib/gpmfTelemetry";

/** Local-only camera signals, isolated from the server and coach evidence. */
export const GoproSensorResearch = memo(function GoproSensorResearch({ audit }: { audit: GoproAudit }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const [channel, setChannel] = useState<"ACCL" | "GYRO">("ACCL");
  const [axis, setAxis] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(20);
  const source = audit.camera_imu?.[channel];
  const metadata = audit.summary.streams.find(s => s.key === channel);
  const allowed = !!metadata?.orientation_consistent && !!metadata.input_orientation && !!metadata.output_orientation;
  const result = useMemo(() => source && allowed ? cameraSpectrum(source, axis, start, end) : null, [source, allowed, axis, start, end]);
  const points = useMemo(() => {
    if (!source || !allowed || end <= start || end-start > 60) return [];
    // Full observed samples in this bounded interval: no display downsampling.
    return source.time_s.flatMap((t, i) => t >= start && t <= end ? [[t, source.columns[axis][i]]] : []);
  }, [source, allowed, axis, start, end]);
  const input = "min-h-9 min-w-0 rounded border border-slate-700 bg-slate-950 px-2 text-xs";
  const rmsUnit = source?.unit ?? "";
  const why: Record<string, [string, string]> = {
    TIMING_GAPS_OR_IRREGULARITY: ["有时间缺口或不规则采样，不计算频谱", "Timing gaps or irregularity; spectrum unavailable"],
    INTERVAL_6_TO_60_SECONDS_REQUIRED: ["请选择 6–60 秒区间", "Select a 6–60 second interval"],
    INSUFFICIENT_SAMPLES: ["有效样本不足", "Insufficient samples"],
    INSUFFICIENT_WELCH_WINDOWS: ["连续窗口不足", "Insufficient continuous windows"],
    INVALID_VALUES_OR_TIME: ["数值或时间轴无效", "Invalid values or timebase"],
    UNIT_UNSUPPORTED: ["单位未验证", "Units unverified"],
    SAMPLE_RATE_UNSUPPORTED: ["采样率不在支持范围内", "Sample rate unsupported"],
  };
  return <section className="mt-4 border-t border-slate-700 pt-3" aria-label={zh ? "相机传感器实验区" : "Camera sensor research"}>
    <h5 className="text-sm font-semibold">{zh ? "相机传感器" : "Camera sensors"} <span className="text-xs text-amber-200">{zh ? "实验" : "Experimental"}</span></h5>
    <p className="mt-2 text-xs leading-5 text-amber-200">{zh ? "仅相机轴，不是车体轴。包内时间为估计值；支架振动、混叠与硬件滤波未标定。以下结果不进入 AI 教练摘要。" : "Camera axes, not vehicle axes. Within-payload times are estimated; mount vibration, aliasing and hardware filtering are uncalibrated. Results never enter AI coaching."}</p>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <label className="grid gap-1 text-xs">{zh ? "通道" : "Channel"}<select className={input} value={channel} onChange={e => setChannel(e.target.value as "ACCL" | "GYRO")}><option>ACCL</option><option>GYRO</option></select></label>
      <label className="grid gap-1 text-xs">{zh ? "原始列" : "Recorded column"}<select className={input} value={axis} onChange={e => setAxis(Number(e.target.value))}>{[0,1,2].map(i => <option key={i} value={i}>{i+1}</option>)}</select></label>
      <label className="grid gap-1 text-xs">{zh ? "视频起点 (s)" : "Video start (s)"}<input className={input} type="number" min={0} max={audit.summary.duration_s} step={.1} value={start} onChange={e => setStart(Number(e.target.value))} /></label>
      <label className="grid gap-1 text-xs">{zh ? "视频终点 (s)" : "Video end (s)"}<input className={input} type="number" min={0} max={audit.summary.duration_s} step={.1} value={end} onChange={e => setEnd(Number(e.target.value))} /></label>
    </div>
    {!source || !allowed ? <p className="mt-3 text-xs text-amber-200">{zh ? "通道或轴向来源不足，无法展示。" : "Channel or axis provenance unavailable."}</p> : <>
      <ResearchPlot points={points} label={`${channel} · ${zh ? "原始列" : "column"} ${axis+1} · ${source.unit}`} xUnit="s" />
      {result?.status === "calculated" ? <>
        <ResearchPlot points={result.frequencies_hz.flatMap((f, i) => f <= 80 ? [[f, result.density[i]]] : [])} label={`PSD · ${result.unit}`} xUnit="Hz" />
        <p className="mt-2 text-xs">10–80 Hz RMS: {result.band_10_80_rms?.toFixed(4) ?? "Unavailable"} {rmsUnit}</p>
        <details className="mt-2 text-xs text-slate-400"><summary className="cursor-pointer">{zh ? "计算方法" : "Processing"}</summary><p className="mt-2 leading-5">{zh ? "线性上采样，不降采样；Hann 窗 1024 点、50% 重叠、每窗去均值、单边物理单位功率谱密度。该曲线不代表传感器硬件带宽。" : "Linear upsampling, no rate reduction; 1024-point Hann, 50% overlap, per-window mean removal, one-sided physical density. This is not a sensor hardware-bandwidth measurement."}</p><p>{result.source_rate_hz.toFixed(2)} → {result.grid_rate_hz.toFixed(2)} Hz · {result.windows} {zh ? "窗口" : "windows"}</p></details>
      </> : <p role="status" className="mt-2 text-xs text-amber-200">{result?.status === "unavailable" ? (why[result.reason]?.[zh ? 0 : 1] ?? result.reason) : "Unavailable"}</p>}
    </>}
  </section>;
});

/** Render the bounded raw interval without interpolation over missing points. */
function ResearchPlot({ points, label, xUnit }: { points: number[][]; label: string; xUnit: string }) {
  if (!points.length) return null;
  let low = Infinity, high = -Infinity;
  for (const p of points) if (Number.isFinite(p[1])) { low = Math.min(low, p[1]); high = Math.max(high, p[1]); }
  if (!Number.isFinite(low)) return null;
  const a = points[0][0], b = points.at(-1)![0], range = high-low || 1;
  const segments: string[][] = [[]];
  for (const [i, p] of points.entries()) {
    if (!Number.isFinite(p[1])) { segments.push([]); continue; }
    if (xUnit === "s" && i && p[0]-points[i-1][0] > .1) segments.push([]);
    segments.at(-1)!.push(`${(40+560*(p[0]-a)/(b-a || 1)).toFixed(2)},${(150-125*(p[1]-low)/range).toFixed(2)}`);
  }
  return <figure className="mt-3"><figcaption className="text-xs">{label}</figcaption><svg viewBox="0 0 640 180" className="aspect-[32/9] w-full" role="img" aria-label={label}>
    {segments.map((segment, i) => <polyline key={i} points={segment.join(" ")} stroke="#35d6d0" fill="none" strokeWidth="1" />)}
    <g fill="#94a3b8" fontSize="12"><text x="0" y="30">{high.toPrecision(3)}</text><text x="0" y="150">{low.toPrecision(3)}</text><text x="40" y="174">{a.toFixed(1)}</text><text x="600" y="174" textAnchor="end">{b.toFixed(1)} {xUnit}</text></g>
  </svg></figure>;
}
