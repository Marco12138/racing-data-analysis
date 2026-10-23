"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "../lib/i18n";
import type { ClipComparison } from "../lib/clipTelemetry";
import type { ReviewSide } from "../lib/manualReview";

const color = { reference: "#f6c945", target: "#35d6d0" };
const tooltipStyle = { background: "#111820", borderColor: "#64748b", fontSize: 12 };
const number = (n: number | null, digits = 1) => n === null ? "—" : n.toFixed(digits);
const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(3)}s`;

function Unavailable({ comparison }: { comparison: ClipComparison }) {
  const { locale } = useI18n(), zh = locale === "zh";
  if (comparison.status === "available") return null;
  const messages = {
    unconfirmed: zh ? "两侧确认视频配对后显示片段遥测。计时推算候选不视为已确认。" : "Confirm both video pairings to view clip telemetry. Timing candidates are not confirmed anchors.",
    outside_telemetry: zh ? "片段边界没有对应的连续遥测，不外推数据。" : "Clip boundaries lack continuous telemetry. Values are not extrapolated.",
    no_overlap: zh ? "两侧没有足够的共同赛道区间，请核对片段起点。" : "Insufficient shared track coverage. Check both clip starts.",
    telemetry_gap: zh ? "共同区间存在遥测缺口或时间异常，时间差暂不可用。" : "A gap or invalid timeline crosses the shared interval. Time delta is unavailable.",
  };
  return <p className="py-3 text-xs text-slate-400" role="status">{messages[comparison.reason]}</p>;
}

/** The two video panels use exactly the same distance and channel scales. */
export function ClipTelemetrySide({ comparison, side, distance }: { comparison: ClipComparison; side: ReviewSide; distance: number | null }) {
  const { locale } = useI18n(), zh = locale === "zh";
  const cursor = comparison.status === "available" && distance !== null && distance >= comparison.start && distance <= comparison.end ? distance - comparison.start : null;
  return <div className="mt-4 min-w-0 border-t border-slate-700 pt-3" data-testid={`clip-telemetry-${side}`}>
    <h6 className="text-sm font-semibold">{zh ? "片段遥测 · AiM" : "Clip telemetry · AiM"}</h6>
    {comparison.status !== "available" ? <Unavailable comparison={comparison} /> : <>
      <dl className="my-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
        {[[zh ? "区间入口速度" : "Interval entry", comparison[side].entrySpeed, "km/h"], [zh ? "区间最低速度" : "Interval minimum", comparison[side].minimumSpeed, "km/h"],
          [zh ? "区间出口速度" : "Interval exit", comparison[side].exitSpeed, "km/h"], [zh ? "区间最低转速" : "Minimum RPM", comparison[side].minimumRpm, "rpm"]]
          .map(([label, value, unit]) => <div className="min-w-0" key={String(label)}><dt>{label}</dt><dd className="mt-1 font-mono text-white">{number(value as number | null, unit === "rpm" ? 0 : 1)} <span className="text-slate-400">{unit}</span></dd></div>)}
      </dl>
      {(["speed", "rpm"] as const).map(channel => <div key={channel} className="mb-3 min-w-0">
        <div className="text-xs text-slate-400">{channel === "speed" ? (zh ? "GPS 速度 · km/h" : "GPS speed · km/h") : "RPM · rpm"}</div>
        {!comparison.samples.some(p => p[`${side}_${channel}`] !== null) ? <p className="flex h-36 items-center text-xs text-slate-400">{zh ? "该通道不可用" : "Telemetry channel unavailable"}</p>
          : <div className="h-36 min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={comparison.samples} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#26313d" /><XAxis dataKey="distance" type="number" domain={[0, comparison.end - comparison.start]} tick={{ fontSize: 10 }} tickFormatter={v => Number(v).toFixed(0)} unit="m" minTickGap={24} />
            <YAxis width={52} domain={comparison.domains[channel]} tick={{ fontSize: 10 }} tickFormatter={v => Number(v).toFixed(0)} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={v => `${zh ? "距共同起点" : "From shared start"} ${Number(v).toFixed(1)}m`}
              formatter={v => [typeof v === "number" ? v.toFixed(channel === "rpm" ? 0 : 1) : "—", channel === "rpm" ? "RPM" : (zh ? "GPS 速度" : "GPS speed")]} />
            {cursor !== null && <ReferenceLine x={cursor} stroke="#f8fafc" strokeDasharray="4 3" />}
            <Line dataKey={`${side}_${channel}`} stroke={color[side]} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart></ResponsiveContainer></div>}
      </div>)}
      <p className="text-xs text-slate-400">{zh ? "横轴：距共同起点 · 两侧同尺度，游标各随本侧视频" : "Distance from shared start · Equal scales, each cursor follows its own video"}</p>
    </>}
  </div>;
}

/** Deltas describe real common-distance crossings, not causation or a promised improvement. */
export function ClipTelemetryDelta({ comparison, cursors }: { comparison: ClipComparison; cursors: Record<ReviewSide, number | null> }) {
  const { locale } = useI18n(), zh = locale === "zh";
  return <section className="mt-5 min-w-0 border-y border-slate-700 py-4" data-testid="clip-time-delta">
    <h5 className="text-sm font-semibold">{zh ? "这段时间差在哪里形成" : "Where this interval's time difference builds"}</h5>
    {comparison.status !== "available" ? <Unavailable comparison={comparison} /> : <>
      <div className="my-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <span>{zh ? "共同赛道区间" : "Shared track interval"}: {number(comparison.end - comparison.start)}m</span>
        <span className="text-amber-300">{zh ? "参考圈用时" : "Reference time"}: {number(comparison.reference.elapsed, 3)}s</span>
        <span className="text-cyan-300">{zh ? "目标圈用时" : "Selected time"}: {number(comparison.target.elapsed, 3)}s</span>
        <strong>{zh ? "目标减参考" : "Selected minus reference"}: {signed(comparison.delta)}</strong>
      </div>
      <div className="h-44 min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={comparison.samples} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#26313d" /><XAxis type="number" dataKey="distance" domain={[0, comparison.end - comparison.start]} unit="m" tick={{ fontSize: 10 }} tickFormatter={v => Number(v).toFixed(0)} />
        <YAxis width={60} tick={{ fontSize: 10 }} tickFormatter={v => Number(v).toFixed(2)} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={v => `${zh ? "距共同起点" : "From shared start"} ${Number(v).toFixed(1)}m`} formatter={v => [typeof v === "number" ? signed(v) : "—", zh ? "累计时间差" : "Cumulative delta"]} />
        <ReferenceLine y={0} stroke="#94a3b8" />
        {(["reference", "target"] as const).map(side => cursors[side] !== null && cursors[side]! >= comparison.start && cursors[side]! <= comparison.end
          ? <ReferenceLine key={side} x={cursors[side]! - comparison.start} stroke={color[side]} strokeDasharray="4 3" /> : null)}
        <Line dataKey="delta" stroke="#f8fafc" dot={false} isAnimationActive={false} connectNulls={false} />
      </LineChart></ResponsiveContainer></div>
      <div className="mt-3 grid grid-cols-3 gap-3 text-xs">{comparison.thirds.map((part, i) => <div key={i}>
        <span className="text-slate-400">{(zh ? ["前段", "中段", "后段"] : ["First third", "Middle third", "Final third"])[i]}</span>
        <p className="mt-1 font-mono text-sm">{signed(part.delta)}</p>
      </div>)}</div>
      <p className="mt-3 text-xs text-slate-400">{zh ? "正值表示目标圈更慢；三段按共同距离等分，不是自动确认的入弯/弯心/出弯阶段。这里只统计两段视频共同覆盖的部分，不代替完整弯道成绩。" : "Positive means the selected lap is slower. Thirds split shared distance, not confirmed entry/apex/exit phases. Only coverage shared by both clips is timed, not the full corner."}</p>
      <p className="mt-2 text-xs text-amber-200">{zh ? "人工选点仍有 ±0.5 秒不确定性，GPS 异常提示仍有效。曲线与时间差是观察结果；RPM 下降不等于确认刹车，也不能单独说明制动效率或更快的原因。" : "Manual picking retains ±0.5s uncertainty and GPS warnings still apply. Curves and deltas are observations; RPM reduction does not confirm braking or establish braking efficiency or the cause of a gain."}</p>
    </>}
  </section>;
}
