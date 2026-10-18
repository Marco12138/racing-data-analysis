"use client";

import { Video } from "lucide-react";
import { useI18n } from "../lib/i18n";
import type { XrkAnalysis } from "../lib/xrkAnalysisApi";

export function TopLapSegments({ analysis, selected, onSelect }: {
  analysis: XrkAnalysis; selected: string | null; onSelect: (id: string, lap: number) => void;
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  const summary = analysis.top_lap_segments;
  if (!summary || summary.status !== "calculated") return null;
  return <section className="min-w-0 border-b border-slate-700 pb-5" data-testid="top-lap-segments">
    <h3 className="mb-3 text-lg font-semibold text-white">{zh ? "真实快圈 · 优势建立在哪里" : "Real fast laps · Where each gains time"}</h3>
    <div className="divide-y divide-slate-800">{summary.segments.map(segment => <div key={segment.id} className="py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h4 className="font-semibold text-white">Sector {segment.number}</h4>
        <span className="text-sm text-emerald-300">{segment.winner_laps.length
          ? `${segment.winner_laps.map(l => `L${l}`).join(" / ")} · ${zh ? "本段最短用时" : "Shortest split"}`
          : zh ? "可比较圈不足" : "Insufficient comparable laps"}</span>
      </div>
      <div className="my-3 flex flex-wrap gap-x-6 gap-y-2 text-sm font-mono">{segment.rows.map(row =>
        <span key={row.lap} className={segment.winner_laps.includes(row.lap) ? "text-emerald-300" : "text-slate-300"}>
          L{row.lap} · {row.time_s.toFixed(3)}s
        </span>)}</div>
      {segment.comparisons.map(pair => {
        const key = `${segment.id}:${pair.target_lap}`, next = pair.next_sector_delta_s;
        return <div key={key} className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-sm leading-6 text-slate-300">
            {zh ? `L${pair.reference_lap} 比 L${pair.target_lap} 本段快 ${pair.local_gain_s.toFixed(3)}s。`
              : `L${pair.reference_lap} gains ${pair.local_gain_s.toFixed(3)}s here over L${pair.target_lap}.`}
            {next === null ? (zh ? " 下一段对比不可用。" : " Next-sector comparison unavailable.")
              : <>{zh ? ` 下一段${next < 0 ? "慢" : "快"} ${Math.abs(next).toFixed(3)}s，连同下一段${pair.net_gain_through_next_s! < 0 ? "反而慢" : "仍快"} ${Math.abs(pair.net_gain_through_next_s!).toFixed(3)}s。`
                : ` In the next sector it is ${Math.abs(next).toFixed(3)}s ${next < 0 ? "slower" : "faster"}; across both it is ${Math.abs(pair.net_gain_through_next_s!).toFixed(3)}s ${pair.net_gain_through_next_s! < 0 ? "slower" : "faster"}.`}</>}
          </p>
          <button className="inline-flex shrink-0 items-center gap-2 rounded-md border border-slate-600 px-3 py-2 text-sm text-cyan-200 hover:border-cyan-400" aria-pressed={selected === key} onClick={() => onSelect(segment.id, pair.target_lap)}>
            <Video size={16} />{zh ? `复盘 L${pair.reference_lap} / L${pair.target_lap}` : `Review L${pair.reference_lap} / L${pair.target_lap}`}
          </button>
        </div>;
      })}
    </div>)}</div>
    <p className="mt-3 text-xs leading-5 text-slate-400">{zh
      ? "GPS 等距分段，非官方计时点；小幅差异不等于显著提升。各段来自真实完成圈，不能拼成目标圈。GPS 与已确认同步负责定位，参照物仅用于解释画面。"
      : "GPS-distance splits, not official timing gates. Small differences do not establish improvement. Each split belongs to a real completed lap, not a composite target. GPS and confirmed sync locate the clip; landmarks only explain it."}</p>
  </section>;
}
