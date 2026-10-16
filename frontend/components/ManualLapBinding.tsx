"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { useI18n } from "../lib/i18n";
import type { ManualLapBounds } from "../lib/videoTelemetrySync";

/** Human lap identity and boundary review, independent of automatic proxy scores. */
export function ManualLapBinding({ lap, bounds, marked, disabled, saved, onBind }: {
  lap: number; bounds: ManualLapBounds | null; marked: boolean; disabled: boolean;
  saved: boolean; onBind: () => void;
}) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const [confirmed, setConfirmed] = useState(false);
  return <section className="mt-4 border-y border-slate-700 py-3" aria-label={zh ? "人工单圈绑定" : "Manual lap binding"}>
    <h4 className="text-sm font-semibold">{zh ? `绑定到 AiM 第 ${lap} 圈` : `Bind to AiM Lap ${lap}`}</h4>
    {marked && bounds ? <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
      <dt>{zh ? "视频圈时" : "Video lap duration"}</dt><dd>{bounds.video_duration_s.toFixed(3)} s</dd>
      <dt>{zh ? "AiM 圈时" : "AiM lap duration"}</dt><dd>{bounds.telemetry_duration_s.toFixed(3)} s</dd>
      <dt>{zh ? "起点绑定后的末端差" : "End residual after start binding"}</dt><dd>{bounds.end_residual_s >= 0 ? "+" : ""}{bounds.end_residual_s.toFixed(3)} s</dd>
    </dl> : <p className="mt-2 text-xs text-amber-200">{zh ? "请分别标记视频圈起点和终点，并选择对应的真实 AiM 圈。" : "Mark both video lap boundaries and select the corresponding real AiM lap."}</p>}
    <label className="mt-3 flex items-start gap-2 text-xs leading-5"><input type="checkbox" className="mt-1" checked={confirmed}
      disabled={!marked || !bounds || disabled} onChange={e => setConfirmed(e.target.checked)} />
      {zh ? "我确认圈号对应，视频起点和终点均为通过 AiM 计时线的时刻。" : "I confirm the lap identity and both video marks crossing the AiM timing line."}</label>
    <p className="mt-2 text-xs leading-5 text-slate-400">{zh
      ? "使用起点建立偏移，终点用于核对，不拉伸视频。圈时相近不证明圈号正确；请再检查圈中位置。自动匹配低分不否定人工标记。"
      : "The start sets the offset; the end checks it without stretching video. Similar durations do not prove lap identity. Review a mid-lap location. A low automatic score does not invalidate manual marks."}</p>
    <button type="button" disabled={disabled || !marked || !bounds || !confirmed} onClick={onBind}
      className="mt-3 flex min-h-10 items-center gap-2 rounded border border-emerald-600 px-3 text-sm text-emerald-200 disabled:opacity-40"><Link2 size={16} />{zh ? "绑定此视频圈" : "Bind this video lap"}</button>
    {saved && <p role="status" className="mt-2 text-xs text-emerald-200">{zh ? "已保存人工单圈绑定；自动候选不会覆盖。" : "Manual lap binding saved; automatic candidates cannot overwrite it."}</p>}
  </section>;
}
