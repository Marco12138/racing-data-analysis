"use client";

import { useState } from "react";
import { Check, CircleHelp, Play, X } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "../lib/i18n";
import type { VideoSyncRpmResult } from "../lib/xrkAnalysisApi";

export type SyncReviewPoint = { session_time_s: number; video_time_s: number; distance_m: number };
export type SyncReviewVerdict = "confirmed" | "rejected" | "uncertain";

const COPY = {
  zh: {
    title: "同步候选复核", candidate: "待人工确认", ambiguous: "存在错圈或声音歧义", weak: "证据不足",
    offset: "候选偏移", correlation: "相关系数（不是成功概率）", spread: "分段偏移极差",
    dominant_band: "主频峰值", harmonic_product: "谐波匹配", method: "选用方法",
    measured: "AiM RPM", proxy: "声音代理", points: ["起点附近", "圈中", "终点附近"],
    checked: "画面与遥测位置一致", confirm: "确认并保存同步", reject: "不吻合", uncertain: "不确定",
    caution: "候选不代表帧级精度；请同时核实圈号。确认会替换当前圈的人工校准。",
    missing: "该候选未完整覆盖当前圈，无法确认。请调整视频范围或选择正确圈。",
    confirmed: "已保存人工确认", rejected: "已记录不吻合，原校准未改动", unsure: "已记录不确定，原校准未改动",
    alternative: "其他时间候选", alternativeMethod: "另一种声音方法", noWindows: "分段检查不足",
  },
  en: {
    title: "Review synchronization candidate", candidate: "Awaiting human confirmation", ambiguous: "Lap or audio ambiguity", weak: "Insufficient evidence",
    offset: "Candidate offset", correlation: "Correlation (not a probability)", spread: "Window offset spread",
    dominant_band: "Dominant frequency", harmonic_product: "Harmonic product", method: "Selected method",
    measured: "AiM RPM", proxy: "Audio proxy", points: ["Near lap start", "Mid-lap", "Near lap end"],
    checked: "Video and telemetry location agree", confirm: "Confirm and save sync", reject: "Does not match", uncertain: "Uncertain",
    caution: "Not frame-accurate proof. Check the lap number. Confirmation replaces this lap's manual calibration.",
    missing: "This candidate does not cover the current lap. Adjust the video range or lap before confirming.",
    confirmed: "Human confirmation saved", rejected: "Mismatch recorded; prior calibration unchanged", unsure: "Uncertainty recorded; prior calibration unchanged",
    alternative: "Alternative timing", alternativeMethod: "Other audio method", noWindows: "Too few usable windows",
  },
};

const REASONS: Record<string, [string, string]> = {
  LOW_CORRELATION: ["声音与 RPM 对应偏弱", "Weak audio/RPM agreement"],
  INSUFFICIENT_WINDOWS: ["可复核时段不足", "Too few review windows"],
  WINDOW_DISAGREEMENT: ["分段声音或偏移不一致", "Window offsets or signals disagree"],
  REPEATED_LAP_AMBIGUITY: ["另一圈也可能匹配", "Another lap may match"],
  VIDEO_SPANS_MULTIPLE_LAPS: ["视频包含多圈：先用整节定位，或缩短到已知的单圈片段", "Multi-lap video: locate the session first, or select a known single-lap segment"],
  SEARCH_BOUNDARY: ["候选接近搜索边界", "Candidate near search boundary"],
  AUDIO_METHOD_DISAGREEMENT: ["两种声音方法给出不同位置", "Audio methods disagree on timing"],
  MULTIPLE_AUDIO_SOURCES: ["可能混有其他车辆声音", "Possible interfering engines"],
};

/** A review action records human judgement, never upgrades a heuristic silently. */
export function RpmSyncReview({ result, points, verdict, onPreview, onDecision }: {
  result: VideoSyncRpmResult;
  points: SyncReviewPoint[];
  verdict: SyncReviewVerdict | null;
  onPreview: (point: SyncReviewPoint) => void;
  onDecision: (verdict: SyncReviewVerdict, point?: SyncReviewPoint) => void;
}) {
  const { locale } = useI18n();
  const c = COPY[locale];
  const [visited, setVisited] = useState<number[]>([]);
  const [checked, setChecked] = useState<number[]>([]);
  const evidence = result.evidence;
  const method = evidence.selected_method === "dominant_band" ? c.dominant_band : c.harmonic_product;
  const done = verdict !== null;
  return <section aria-label={c.title} className="mt-4 min-w-0 border-t border-slate-700 pt-4">
    <h4 className="text-sm font-semibold text-white">{c.title}</h4>
    <p className="mt-1 text-xs text-amber-200">{c[result.status ?? "weak"]}</p>
    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
      <dt className="text-slate-400">{c.method}</dt><dd>{method}</dd>
      <dt className="text-slate-400">{c.offset}</dt><dd>{(result.offset_ms / 1000).toFixed(3)} s</dd>
      <dt className="text-slate-400">{c.correlation}</dt><dd>{evidence.best_correlation.toFixed(3)}</dd>
      <dt className="text-slate-400">{c.spread}</dt><dd>{evidence.window_offset_spread_s == null ? c.noWindows : `${evidence.window_offset_spread_s.toFixed(3)} s`}</dd>
    </dl>
    {!!evidence.preview?.length && <div className="mt-3 h-40 min-w-0" aria-label={`${c.measured} / ${c.proxy}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={evidence.preview} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
          <XAxis dataKey="session_time_s" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v.toFixed(0)}s`} />
          <YAxis tick={{ fontSize: 10 }} width={56} />
          <Tooltip />
          <Line dataKey="telemetry_rpm" name={c.measured} stroke="#35d6d0" dot={false} isAnimationActive={false} connectNulls={false} />
          <Line dataKey="audio_rpm" name={c.proxy} stroke="#f6c945" dot={false} isAnimationActive={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>}
    <ul className="mt-2 space-y-1 text-xs text-amber-200">
      {evidence.reason_codes?.map((reason) => <li key={reason}>{REASONS[reason]?.[locale === "zh" ? 0 : 1] ?? reason}</li>)}
    </ul>
    {evidence.distant_alternative && <p className="mt-2 text-xs text-slate-400">{c.alternative}: {evidence.distant_alternative.offset_s.toFixed(2)}s · r={evidence.distant_alternative.correlation.toFixed(3)}</p>}
    {evidence.alternatives?.map((item) => <p key={item.method} className="mt-1 text-xs text-slate-400">{c.alternativeMethod}: {(item.offset_ms/1000).toFixed(2)}s · r={item.correlation.toFixed(3)}</p>)}
    <div className="mt-3 space-y-3">
      {points.map((point, index) => <div key={index} className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" disabled={done} className="flex min-h-9 items-center gap-1 text-cyan-200 disabled:opacity-50"
          onClick={() => { onPreview(point); setVisited((v) => [...new Set([...v, index])]); }}>
          <Play size={14} />{c.points[index]} · {point.video_time_s.toFixed(2)}s
        </button>
        <label className="flex items-center gap-2 text-slate-300">
          <input type="checkbox" disabled={done || !visited.includes(index)} checked={checked.includes(index)}
            onChange={(e) => setChecked((v) => e.target.checked ? [...v, index] : v.filter((i) => i !== index))} />{c.checked}
        </label>
      </div>)}
    </div>
    <p className="mt-3 text-xs leading-5 text-slate-400">{points.length === 3 ? c.caution : c.missing}</p>
    <div className="mt-3 flex flex-wrap gap-2 text-xs">
      <button type="button" disabled={done || points.length !== 3 || checked.length !== 3}
        onClick={() => onDecision("confirmed", points[1])}
        className="flex min-h-10 items-center gap-1 rounded border border-emerald-600 px-3 text-emerald-200 disabled:opacity-40"><Check size={14} />{c.confirm}</button>
      <button type="button" disabled={done} onClick={() => onDecision("rejected")}
        className="flex min-h-10 items-center gap-1 px-2 text-slate-300 disabled:opacity-40"><X size={14} />{c.reject}</button>
      <button type="button" disabled={done} onClick={() => onDecision("uncertain")}
        className="flex min-h-10 items-center gap-1 px-2 text-slate-300 disabled:opacity-40"><CircleHelp size={14} />{c.uncertain}</button>
    </div>
    {verdict && <p role="status" className="mt-2 text-xs text-cyan-200">{verdict === "confirmed" ? c.confirmed : verdict === "rejected" ? c.rejected : c.unsure}</p>}
  </section>;
}
