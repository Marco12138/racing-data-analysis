"use client";

import { Play } from "lucide-react";
import { memo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "../lib/i18n";
import type { CornerCoachComparison as Comparison } from "../lib/cornerCoach";

const fmt = (value: number | null | undefined, digits = 3) => typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(3)}s`;

export const CornerCoachComparison = memo(function CornerCoachComparison({ comparison, onReview, playable, active = true }: {
  comparison: Comparison; onReview: (left: number, right: number) => void; playable: boolean; active?: boolean;
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  const names = zh ? ["前段", "中段", "后段"] : ["First third", "Middle third", "Final third"];
  const unavailable: Record<string, string> = {
    no_valid_lap_time: zh ? "缺少有效的整圈计时。" : "Valid full-lap timing is missing.",
    overall_gps_warning: zh ? "整圈最快圈在本区段存在 GPS 异常，暂不作最快开法对照。" : "The fastest full lap has a GPS warning here; the comparison is withheld.",
    overall_video_rejected: zh ? "整圈最快圈的视频被标为不同弯道，保留原判定，暂不对照。" : "The fastest lap's video was marked as a different corner; that verdict is retained.",
    overall_section_unavailable: zh ? "整圈最快圈未通过本区段的空间匹配，不以其他圈冒充。" : "The fastest full lap lacks a valid section match. Another lap is not substituted.",
    insufficient_candidates: zh ? "本区段不足两圈可比较数据。" : "Fewer than two comparable laps cover this section.",
    shared_checkpoints_unavailable: zh ? "中间位置未能可靠配对，暂不绘制叠加曲线。" : "Shared intermediate positions could not be matched reliably; overlay unavailable.",
  };
  return <section className="min-w-0 space-y-4 border-y border-slate-700 py-5" data-testid="corner-coach-comparison">
    <h4 className="text-base font-semibold">{zh ? "教练对照 · 区段最快与整圈最快" : "Coach comparison · Section best vs full-lap best"}</h4>
    {comparison.status === "unavailable" ? <p role="status" className="text-sm text-amber-200">{unavailable[comparison.reason]}</p> : <>
      <p className="text-xs text-slate-400">{zh ? "范围：本次通过圈质量门与区段空间匹配的真实圈；不拼接理论圈。计时排序仅描述本次观测，不代表差异超出测量误差或具有统计显著性。" : "Scope: real laps passing lap quality and section matching; no stitched theoretical lap. Rankings describe these observations, not differences proven beyond measurement error or statistical significance."}</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-xs text-slate-400"><th className="py-2">{zh ? "同一弯道区段" : "Same physical section"}</th><th className="px-3 text-cyan-200">{zh ? "区段最快" : "Section best"} L{comparison.section.lap}</th><th className="px-3 text-amber-200">{zh ? "整圈最快" : "Full-lap best"} L{comparison.overall.lap}</th></tr></thead>
        <tbody>{[
          [zh ? "整圈用时" : "Full lap", comparison.section.quality.lap_time, comparison.overall.quality.lap_time, "s", 3],
          [zh ? "本区段用时" : "Section time", comparison.section.elapsed_s, comparison.overall.elapsed_s, "s", 3],
          [zh ? "入口速度" : "Entry speed", comparison.section.profile?.metrics.entry_speed_kmh, comparison.overall.profile?.metrics.entry_speed_kmh, "km/h", 1],
          [zh ? "最低速度" : "Minimum speed", comparison.section.profile?.metrics.minimum_speed_kmh, comparison.overall.profile?.metrics.minimum_speed_kmh, "km/h", 1],
          [zh ? "出口速度" : "Exit speed", comparison.section.profile?.metrics.exit_speed_kmh, comparison.overall.profile?.metrics.exit_speed_kmh, "km/h", 1],
          [zh ? "最低转速" : "Minimum RPM", comparison.section.profile?.metrics.minimum_rpm, comparison.overall.profile?.metrics.minimum_rpm, "rpm", 0],
        ].map(([label, a, b, unit, digits]) => <tr key={String(label)} className="border-t border-slate-800"><th className="py-2 font-normal">{label}</th>{[a, b].map((n, i) => <td key={i} className="px-3 font-mono">{fmt(n as number | null, Number(digits))} {unit}</td>)}</tr>)}</tbody>
      </table></div>
      {(comparison.sectionTies.length > 1 || comparison.overallTies.length > 1) && <p className="text-xs text-slate-400">{zh ? "计时并列圈（不代表差异显著）" : "Timing ties (not a significance claim)"}: {comparison.sectionTies.map(l => `L${l}`).join(", ")} / {comparison.overallTies.map(l => `L${l}`).join(", ")}</p>}
      {comparison.excluded.length > 0 && <p className="text-xs text-amber-200">{zh ? "GPS 异常或已否定视频，不参与最快对照" : "GPS warnings or rejected videos excluded"}: {comparison.excluded.map(l => `L${l}`).join(", ")}</p>}
      {comparison.status === "same_lap" ? <p className="text-sm text-cyan-200">{zh ? `L${comparison.overall.lap} 同时是本区段和整圈最快，不制造另一种“更快开法”。仍可浏览其他候选圈。` : `L${comparison.overall.lap} is best both here and over the full lap. No alternate "faster style" is invented; other candidates remain browsable.`}</p> : <>
        <p className="text-sm">{zh ? `L${comparison.section.lap} 在本区段快 ${fmt(comparison.gain_s)}s。` : `L${comparison.section.lap} gains ${fmt(comparison.gain_s)}s in this section.`} {comparison.combined_gain_s === null
          ? (comparison.downstream_gps_warning
            ? (zh ? "后续区段存在 GPS 异常，只展示本区段差异，不判断优势是否保持。" : "The downstream section has a GPS warning. Only this section is compared; gain retention is withheld.")
            : (zh ? "缺少连续下游计时，不能判断优势是否保持。" : "Continuous downstream timing is missing; gain retention is unknown."))
          : (zh ? `下游约50m${comparison.downstream_gain_s! >= 0 ? "再快" : "损失"} ${fmt(Math.abs(comparison.downstream_gain_s!))}s，合计${comparison.combined_gain_s >= 0 ? "快" : "慢"} ${fmt(Math.abs(comparison.combined_gain_s))}s。` : `Over the next ~50m it ${comparison.downstream_gain_s! >= 0 ? "gains" : "loses"} ${fmt(Math.abs(comparison.downstream_gain_s!))}s; combined ${comparison.combined_gain_s >= 0 ? "gain" : "loss"}: ${fmt(Math.abs(comparison.combined_gain_s))}s.`)}</p>
        <button className="inline-flex min-h-10 items-center gap-2 rounded border border-cyan-600 px-3 py-2 text-sm text-cyan-200 disabled:opacity-40" disabled={!playable} onClick={() => onReview(comparison.section.lap, comparison.overall.lap)}><Play size={16} />{zh ? "并排查看" : "Review pair"} L{comparison.section.lap} / L{comparison.overall.lap}</button>
        {!playable && <p className="text-xs text-amber-200">{zh ? "视频未覆盖这两圈，保留遥测对照。" : "The video does not cover both laps; telemetry comparison remains available."}</p>}
        <div className="flex flex-wrap gap-5 text-xs"><span className="text-cyan-200">L{comparison.section.lap} · {zh ? "区段最快" : "Section best"}</span><span className="text-amber-200">L{comparison.overall.lap} · {zh ? "整圈最快" : "Full-lap best"}</span></div>
        {(["speed", "rpm", "gain_s"] as const).map(channel => <div key={channel} data-testid={`coach-overlay-${channel}`}>
          <h5 className="text-xs text-slate-400">{channel === "speed" ? (zh ? "速度叠加 · km/h" : "Speed overlay · km/h") : channel === "rpm" ? "RPM" : (zh ? "累计时间优势 · 秒（正值：区段最快圈更快）" : "Cumulative gain · s (positive: section best is faster)")}</h5>
          {channel === "rpm" && !comparison.samples.some(p => p.section_rpm !== null || p.overall_rpm !== null) ? <p className="py-5 text-xs text-amber-200">{zh ? "RPM 数据不可用，不从音频或速度补造。" : "RPM unavailable; not fabricated from audio or speed."}</p> : <div className="h-44 min-w-0">{active && <ResponsiveContainer width="100%" height="100%"><LineChart data={comparison.samples} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#26313d" /><XAxis dataKey="distance_m" type="number" domain={[0, comparison.samples.at(-1)!.distance_m]} tick={{ fontSize: 10 }} tickFormatter={v => Number(v).toFixed(0)} unit="m" />
            <YAxis width={58} domain={["auto", "auto"]} tick={{ fontSize: 10 }} tickFormatter={v => Number(v).toFixed(channel === "gain_s" ? 2 : 0)} />
            <Tooltip contentStyle={{ background: "#111820", borderColor: "#64748b", fontSize: 12 }} labelFormatter={v => `${zh ? "距共同入口" : "From common entry"} ${fmt(Number(v), 1)}m`} formatter={v => typeof v === "number" ? v.toFixed(channel === "rpm" ? 0 : channel === "speed" ? 1 : 3) : "—"} />
            {comparison.parts.map(p => <ReferenceArea key={p.index} x1={p.start_m} x2={p.end_m} fill={p.gain_s > 0 ? "#35d6d0" : "#f6c945"} fillOpacity={.04} />)}
            {channel === "gain_s" ? <><ReferenceLine y={0} stroke="#94a3b8" /><Line dataKey="gain_s" name={zh ? "累计优势" : "Cumulative gain"} stroke="#f8fafc" dot={false} isAnimationActive={false} /></>
              : (["section", "overall"] as const).map(side => <Line key={side} dataKey={`${side}_${channel}`} name={`L${comparison[side].lap}`} stroke={side === "section" ? "#35d6d0" : "#f6c945"} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />)}
          </LineChart></ResponsiveContainer>}</div>}
        </div>)}
        <div className="grid grid-cols-3 gap-3 text-sm">{comparison.parts.map(p => <div key={p.index}><span className="text-slate-400">{names[p.index]}</span><p className="font-mono">{signed(p.gain_s)}</p></div>)}</div>
        <p className="text-xs text-slate-400">{zh ? "横轴为同一参考路径的位置，前中后按距离等分，并非已确认的刹车／弯心／出弯阶段。时间差来自共同位置的过点时刻，不以速度曲线面积代替，也不拉伸对齐。" : "Shared reference-path positions; thirds are distance splits, not confirmed braking/apex/exit phases. Deltas use crossing timestamps, not speed-curve area or time warping."}</p>
        <p className="text-sm text-cyan-200">{zh ? `优先复核${names[comparison.parts.reduce((best, p) => p.gain_s > best.gain_s ? p : best).index]}的视频：对照减速、RPM恢复与车载姿态，再检查出口结果；局部最快不等于已验证的最佳动作。` : `Review the ${names[comparison.parts.reduce((best, p) => p.gain_s > best.gain_s ? p : best).index].toLowerCase()} first: compare deceleration, RPM recovery and visible posture, then check the exit outcome. Local best is not a validated best technique.`}</p>
      </>}
      <p className="text-xs text-amber-200">{zh ? "GPS定位仍是推定；视频未确认时只作候选。人工锚点 ±0.5秒与 GPS 异常提示不变。RPM下降不是刹车压力，较高RPM不能单独证明更好的出弯动作。" : "GPS positions remain inferred; unconfirmed video stays a candidate. Manual ±0.5s anchors and GPS warnings remain. RPM decline is not brake pressure, and higher RPM alone cannot establish better exit technique."}</p>
    </>}
  </section>;
});
