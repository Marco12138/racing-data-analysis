"use client";

import { useState } from "react";
import { useI18n } from "../lib/i18n";
import type { GnssSegmentedCheck, GnssSegmentStatus, GnssWindowDiagnostic } from "../lib/xrkAnalysisApi";

const STATES: Record<GnssSegmentStatus, { zh: string; en: string; color: string }> = {
  passed: { zh: "留出速度验证通过", en: "Held-out speed check passed", color: "bg-emerald-700" },
  gps_inconsistent: { zh: "GPS 信号不一致，待排查", en: "GPS signal disagreement", color: "bg-rose-700" },
  fit_only: { zh: "用于拟合，非独立验证", en: "Fit only, not held out", color: "bg-sky-800" },
  insufficient: { zh: "证据不足", en: "Insufficient evidence", color: "bg-amber-700" },
  untested: { zh: "未检查", en: "Not checked", color: "bg-slate-700" },
};
const REASONS: Record<string, [string, string]> = {
  NOT_SAMPLED_BY_WINDOW_CHECK: ["窗口之间及边缘不作验证结论", "No conclusion between windows or at recording edges"],
  NO_FROZEN_FIT_OFFSET: ["没有足够证据确定固定候选偏移", "Insufficient evidence to freeze a candidate offset"],
  GPS_SAMPLE_GAPS: ["存在无定位或数据缺口，未填补", "Missing fixes or samples; gaps are not filled"],
  INSUFFICIENT_SPEED_VARIATION_OR_SAMPLES: ["有效样本或速度变化不足", "Insufficient valid samples or speed variation"],
  NO_LOCAL_MATCH: ["无法计算局部匹配", "Local matching unavailable"],
  OFFSET_SPREAD_EXCEEDS_LIMIT: ["局部匹配偏移差超出原门槛", "Local offset spread exceeds the unchanged limit"],
  SPEED_CORRELATION_BELOW_LIMIT: ["速度相关性未达到原门槛", "Speed correlation falls below the unchanged limit"],
  SPEED_CLOCK_DISAGREEMENT: ["速度与时钟候选不一致", "Speed and clock candidates disagree"],
};

/** Segments inspect evidence only: no calibration or coach-review state is written. */
export function GnssSegmentReview({ check, renderDiagnostic }: {
  check: GnssSegmentedCheck;
  renderDiagnostic: (diagnostic: GnssWindowDiagnostic) => React.ReactNode;
}) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const [selected, setSelected] = useState(() => Math.max(0, check.segments.findIndex(s => s.status === "gps_inconsistent")));
  const current = check.segments[selected];
  const range = (values: number[]) => `${values.map(v => v.toFixed(2)).join(" - ")} s`;
  const title = (status: GnssSegmentStatus) => STATES[status][zh ? "zh" : "en"];
  return <section className="mt-3 min-w-0 border-t border-slate-700 pt-3 text-xs" data-testid="gnss-segments">
    <h5 className="font-semibold">{zh ? "分段 GPS 速度校验" : "Segmented GPS speed checks"}</h5>
    <p className="mt-2 leading-5 text-slate-300">{zh
      ? "分段通过不代表整段通过或逐帧准确。红色标出信号不一致，并未认定哪台 GPS 故障。已人工确认的圈仍可按原锚点进行前三快圈视频复盘。"
      : "A segment pass does not verify the full recording or frame accuracy. Red marks signal disagreement, not a proven faulty receiver. Manually confirmed laps remain available for real Top 3 video review with their saved anchors."}</p>
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">{Object.entries(STATES).map(([key, state]) => <li key={key} className="flex items-center gap-1.5">
      <span aria-hidden="true" className={`h-2.5 w-2.5 ${state.color}`} />{title(key as GnssSegmentStatus)}: {check.counts[key as GnssSegmentStatus]}
    </li>)}</ul>
    <div className="mt-3 flex h-9 w-full overflow-hidden" aria-label={zh ? "遥测时间分段" : "Telemetry time segments"}>
      {check.segments.map((s, i) => <button type="button" key={i} onClick={() => setSelected(i)}
        aria-label={`${title(s.status)} · ${range(s.session_range_s)}`} aria-pressed={selected === i}
        title={`${title(s.status)} · ${range(s.session_range_s)}`}
        style={{ flex: `${Math.max(.001, s.session_range_s[1]-s.session_range_s[0])} 1 0` }}
        className={`min-w-0 border-r border-slate-950 ${STATES[s.status].color} ${selected === i ? "ring-2 ring-inset ring-white" : "hover:brightness-125"}`} />)}
    </div>
    <p className="mt-2 leading-5 text-slate-400">{zh
      ? `检查候选偏移 ${check.evaluation_offset_s.toFixed(3)} s（未应用）；偏移差门槛 ${check.residual_limit_s.toFixed(3)} s，相关性门槛 ${check.correlation_minimum.toFixed(2)}。仅验证速度信号，位置及画面仍需核对。`
      : `Evaluation offset ${check.evaluation_offset_s.toFixed(3)} s (not applied); spread limit ${check.residual_limit_s.toFixed(3)} s, correlation minimum ${check.correlation_minimum.toFixed(2)}. Speed signals only; positions and footage still need review.`}</p>
    <div className="mt-3 max-h-64 overflow-auto"><table className="w-full text-left text-xs">
      <thead className="sticky top-0 bg-slate-950"><tr><th className="p-2">{zh ? "遥测 / 视频候选时间" : "Telemetry / candidate video"}</th><th className="p-2">{zh ? "圈 / 状态" : "Lap / status"}</th></tr></thead>
      <tbody>{check.segments.map((s, i) => <tr key={i} className={selected === i ? "bg-slate-800" : "border-t border-slate-800"}>
        <td className="p-2"><button type="button" className="min-h-10 text-left text-cyan-200" onClick={() => setSelected(i)} aria-pressed={selected === i}>
          <span className="block">{range(s.session_range_s)}</span><span className="block text-slate-400">{range(s.video_range_s)}</span>
        </button></td><td className="p-2"><span className="block">{s.laps.map(l => `L${l}`).join(", ") || (zh ? "圈外" : "Outside laps")}</span>
          <span className="block">{title(s.status)}</span></td>
      </tr>)}</tbody>
    </table></div>
    {current && <div className="mt-3 border-t border-slate-800 pt-3" data-testid="gnss-selected-segment">
      <p className="font-semibold">{title(current.status)} · {range(current.session_range_s)}</p>
      <p className="mt-1">{zh ? "视频候选" : "Candidate video"}: {range(current.video_range_s)}</p>
      {current.role !== "none" && <p className="mt-1">{current.role === "fit" ? (zh ? "拟合时段，不计入独立通过数" : "Fitting interval, not counted as a held-out pass") : (zh ? "留出验证时段" : "Held-out validation interval")}</p>}
      {current.sample_count != null && <p className="mt-1">{zh ? "有效样本" : "Valid samples"}: {current.sample_count} / {current.query_sample_count}
        {" · "}{zh ? "偏移差" : "Offset spread"}: {current.offset_spread_s?.toFixed(3) ?? "—"} s
        {" · "}r: {current.correlation_at_fit_offset?.toFixed(3) ?? "—"}</p>}
      <ul className="mt-2 space-y-1 text-amber-200">{current.reason_codes.map(reason => <li key={reason}>{REASONS[reason]?.[zh ? 0 : 1] ?? reason}</li>)}</ul>
      {current.diagnostic && renderDiagnostic(current.diagnostic)}
    </div>}
  </section>;
}
