"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "../lib/i18n";
import { cornerChannelAt, cornerTelemetryTime, type CornerLap } from "../lib/selectedCorner";

const number = (n: number | null | undefined, digits = 1) => typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "—";

export function CornerCandidateNavigation({ laps, selectedLap, sourceLap, onSelect }: {
  laps: CornerLap[]; selectedLap: number | null; sourceLap: number; onSelect: (lap: number) => void;
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  const index = laps.findIndex(l => l.lap === selectedLap);
  const button = "flex h-10 w-10 shrink-0 items-center justify-center rounded border border-slate-600 hover:border-cyan-400 disabled:opacity-40";
  return <nav aria-label={zh ? "浏览候选圈" : "Browse candidate laps"} className="flex flex-wrap items-end gap-2" data-testid="corner-candidate-navigation">
    <button className={button} disabled={index <= 0} title={zh ? "上一候选圈" : "Previous candidate lap"} aria-label={zh ? "上一候选圈" : "Previous candidate lap"} onClick={() => onSelect(laps[index - 1].lap)}><ChevronLeft size={18} /></button>
    <label className="grid min-w-0 gap-1 text-xs text-slate-400">{zh ? "右侧对照圈" : "Right-side comparison lap"}
      <select aria-label={zh ? "右侧对照圈" : "Right-side comparison lap"} className="h-10 min-w-40 max-w-full rounded border border-slate-600 bg-slate-950 px-3 text-sm text-white" value={selectedLap ?? ""} onChange={e => onSelect(Number(e.target.value))} disabled={!laps.length}>
        {!laps.length && <option value="">{zh ? "无可播放候选圈" : "No playable candidate laps"}</option>}
        {laps.map(row => <option key={row.lap} value={row.lap}>L{row.lap}{row.lap === sourceLap ? (zh ? " · 选择圈" : " · Source lap") : ""} · {number(row.elapsed_s, 3)}s</option>)}
      </select>
    </label>
    <button className={button} disabled={index < 0 || index >= laps.length - 1} title={zh ? "下一候选圈" : "Next candidate lap"} aria-label={zh ? "下一候选圈" : "Next candidate lap"} onClick={() => onSelect(laps[index + 1].lap)}><ChevronRight size={18} /></button>
    <span className="py-3 text-xs text-slate-400">{index >= 0 ? index + 1 : 0} / {laps.length}</span>
  </nav>;
}

export function SelectedCornerTelemetry({ row, videoTime, videoStart, confirmed, domains, elapsedLimit, active = true }: {
  row: CornerLap; videoTime: number; videoStart: number; confirmed: boolean;
  domains: Record<"speed" | "rpm", [number, number]>; elapsedLimit: number; active?: boolean;
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  const points = row.telemetry ?? [], metrics = row.profile?.metrics;
  const time = confirmed ? cornerTelemetryTime(row, videoTime, videoStart) : null;
  return <section className="mt-3 min-w-0 space-y-3 border-t border-slate-700 pt-3" data-testid={`corner-telemetry-L${row.lap}`}>
    <h5 className="text-sm font-semibold">L{row.lap} · {zh ? "片段遥测 · AiM" : "Clip telemetry · AiM"}</h5>
    <p className="text-xs text-amber-200">{confirmed ? (zh ? "本圈人工配对 · ±0.5秒；GPS异常提示仍有效" : "Human-paired lap · ±0.5s; GPS warnings remain")
      : (zh ? "下方是本圈实测遥测；视频位置待确认，实时读数暂不绑定画面" : "Recorded telemetry for this lap; frame-linked readings await video confirmation")}</p>
    <output className="block min-h-6 font-mono text-sm" data-testid={`corner-live-L${row.lap}`} data-session-time={time ?? ""}>
      {zh ? "速度" : "Speed"}: {time === null ? "—" : number(cornerChannelAt(points, time, "speed"))} km/h · RPM: {time === null ? "—" : number(cornerChannelAt(points, time, "rpm"), 0)}
    </output>
    <dl className="grid grid-cols-2 gap-2 text-xs text-slate-400">
      {[[zh ? "入口速度" : "Entry speed", metrics?.entry_speed_kmh, "km/h"], [zh ? "最低速度" : "Minimum speed", metrics?.minimum_speed_kmh, "km/h"],
        [zh ? "出口速度" : "Exit speed", metrics?.exit_speed_kmh, "km/h"], [zh ? "最低转速" : "Minimum RPM", metrics?.minimum_rpm, "rpm"]].map(([label, value, unit]) =>
        <div key={String(label)}><dt>{label}</dt><dd className="mt-1 font-mono text-white">{number(value as number | null | undefined, unit === "rpm" ? 0 : 1)} {unit}</dd></div>)}
    </dl>
    {(["speed", "rpm"] as const).map(channel => <div key={channel} className="min-w-0" data-testid={`corner-chart-L${row.lap}-${channel}`}>
      <h6 className="text-xs text-slate-400">{channel === "speed" ? (zh ? "GPS 速度 · km/h" : "GPS speed · km/h") : "RPM · rpm"}</h6>
      {!points.some(p => typeof p[channel] === "number" && Number.isFinite(p[channel]))
        ? <p role="status" className="flex h-32 items-center text-xs text-slate-400">{!row.telemetry ? (zh ? "本次结果未包含逐时刻遥测，请重新查找候选圈。" : "This result has no time-series telemetry. Find the candidate laps again.") : (zh ? "该通道未提供有效数据" : "No valid samples for this channel")}</p>
        : <div className="h-36 min-w-0">{active && <ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#26313d" /><XAxis type="number" dataKey="elapsed_s" domain={[0, elapsedLimit]} tick={{ fontSize: 10 }} tickFormatter={v => Number(v).toFixed(1)} unit="s" minTickGap={24} />
          <YAxis width={52} domain={domains[channel]} tick={{ fontSize: 10 }} tickFormatter={v => Number(v).toFixed(0)} />
          <Tooltip contentStyle={{ background: "#111820", borderColor: "#64748b", fontSize: 12 }} labelFormatter={v => `${Number(v).toFixed(2)}s`}
            formatter={v => [typeof v === "number" ? v.toFixed(channel === "rpm" ? 0 : 1) : "—", channel === "rpm" ? "RPM" : (zh ? "GPS 速度" : "GPS speed")]} />
          <Line dataKey={channel} stroke={channel === "speed" ? "#35d6d0" : "#f6c945"} dot={false} connectNulls={false} isAnimationActive={false} />
          {time !== null && <ReferenceLine x={time - row.start_session_s!} stroke="#f8fafc" strokeDasharray="4 3" />}
        </LineChart></ResponsiveContainer>}</div>}
    </div>)}
    <p className="text-xs text-slate-400">{zh ? "本圈通过同一空间区段的实际经过时间；两侧同尺度，游标各随本侧视频。" : "Actual elapsed time through the shared section. Equal scales; each cursor follows its own video."}</p>
  </section>;
}
