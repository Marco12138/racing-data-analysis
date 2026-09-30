"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleHelp, Play, Satellite, X } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { extractGoproTelemetry, type GoproAudit } from "../lib/gpmfTelemetry";
import { autoSyncVideoGnss, type VideoSyncGnssResult } from "../lib/xrkAnalysisApi";
import { rpmReviewPoints, type TelemetrySyncPoint } from "../lib/videoTelemetrySync";
import type { SyncReviewPoint, SyncReviewVerdict } from "./RpmSyncReview";

const REASONS: Record<string, [string, string]> = {
  AIM_TIME_VALIDITY_UNEXPOSED: ["AiM 时间有效性标志未由解析器提供", "AiM time-validity flags are not exposed by the parser"],
  AIM_TOW_QUANTIZED: ["AiM 时钟为阶梯记录，不能视为逐帧时间", "AiM clock messages are quantized, not frame timestamps"],
  SENSOR_VIDEO_LATENCY_UNCALIBRATED: ["传感器到画面的延迟尚未标定", "Sensor-to-frame latency is uncalibrated"],
  CLOCK_DRIFT_REQUIRES_ANCHORS: ["检测到时钟漂移，需要人工多点校准", "Clock drift needs multiple manual anchors"],
  GNSS_SPEED_DISAGREEMENT: ["独立时段的速度校验未通过", "Held-out speed windows disagree"],
  GNSS_SPEED_VALIDATION_INSUFFICIENT: ["速度变化或独立校验时段不足", "Insufficient speed variation or held-out windows"],
  GNSS_POSITION_DISAGREEMENT: ["两套 GPS 位置偏差较大", "The GPS positions differ materially"],
  GNSS_POSITION_VALIDATION_UNAVAILABLE: ["缺少可用于独立核对的位置数据", "Position cross-check unavailable"],
  AIM_GPS_FIX_UNAVAILABLE: ["AiM GPS 定位状态不可用", "AiM GPS fix state is unavailable"],
  GNSS_SESSION_DATE_MISMATCH: ["录像与 AiM 的日期不匹配，请换一节数据", "Recording and AiM dates do not match"],
  GNSS_LOCATION_MISMATCH: ["录像与 AiM 不在同一位置", "Recording and AiM locations do not match"],
  GNSS_NO_RECORDING_OVERLAP: ["两段记录没有足够的时间重叠", "Insufficient recording overlap"],
  AIM_TOW_UNAVAILABLE: ["AiM 缺少可用的 GNSS 时间通道，请用声音或人工校准", "AiM GNSS clock unavailable; use audio or manual anchors"],
  GPMF_TRACK_UNAVAILABLE: ["视频没有 GoPro 元数据，请选择保留元数据的原片", "No GoPro metadata; select a metadata-preserving original"],
  GPMF_DURATION_LIMIT: ["本版支持最长一小时的原始录像章节", "This version supports original chapters up to one hour"],
  GPMF_EDIT_LIST_UNSUPPORTED: ["此视频经过时间剪辑，请用原始 GoPro 章节或人工校准", "Edited video timeline is unsupported; use the original chapter or manual anchors"],
  GOPRO_GPS_UTC_UNAVAILABLE: ["没有有效的 GPS UTC，不能进行绝对时间匹配", "No valid GPS UTC; absolute-clock matching is unavailable"],
};

/** Separate verification UI: a result cannot change calibration on arrival. */
export function GnssSyncReview({ result, points, playbackUnavailable = false, onPreview, onDecision }: {
  result: VideoSyncGnssResult; points: SyncReviewPoint[];
  playbackUnavailable?: boolean;
  onPreview: (point: SyncReviewPoint) => void;
  onDecision: (verdict: SyncReviewVerdict, point?: SyncReviewPoint) => boolean;
}) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const [visited, setVisited] = useState<number[]>([]);
  const [checked, setChecked] = useState<number[]>([]);
  const [verdict, setVerdict] = useState<SyncReviewVerdict | null>(null);
  const e = result.evidence;
  const decide = (value: SyncReviewVerdict) => { if (onDecision(value, points[1])) setVerdict(value); };
  return <section className="mt-3 border-t border-slate-700 pt-3" aria-label={zh ? "GoPro 同步复核" : "GoPro sync review"}>
    <p className="text-xs text-amber-200">{result.status === "weak"
      ? (zh ? "证据不足，仅提供候选" : "Weak evidence; candidate only")
      : (zh ? "多信号吻合，等待人工确认" : "Signals agree; awaiting human confirmation")}</p>
    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
      <dt>{zh ? "候选偏移" : "Candidate offset"}</dt><dd>{(result.offset_ms / 1000).toFixed(3)} s</dd>
      <dt>{zh ? "仅时钟偏移" : "Clock-only offset"}</dt><dd>{(e.clock_offset_ms / 1000).toFixed(3)} s</dd>
      <dt>{zh ? "独立窗口最大偏差" : "Held-out maximum deviation"}</dt><dd>{e.speed_check.validation_max_residual_s == null ? "Unavailable" : `${e.speed_check.validation_max_residual_s.toFixed(3)} s`}</dd>
      <dt>{zh ? "位置差中位数" : "Median position difference"}</dt><dd>{e.spatial_check.median_error_m == null ? "Unavailable" : `${e.spatial_check.median_error_m.toFixed(2)} m`}</dd>
    </dl>
    <p className="mt-3 text-xs">{zh ? "覆盖整圈（待核对）" : "Full laps (unverified)"}: {e.lap_coverage.filter((p) => p.coverage === "full").map((p) => `L${p.lap}`).join(", ") || "—"}</p>
    <p className="mt-1 text-xs">{zh ? "视频重叠范围" : "Video overlap"}: {e.matched_video_range_s.map((v) => v.toFixed(2)).join(" - ")} s</p>
    <ul className="mt-3 space-y-1 text-xs text-amber-200">{e.reason_codes.map((r) => <li key={r}>{REASONS[r]?.[zh ? 0 : 1] ?? r}</li>)}</ul>
    {points.map((point, index) => <div key={index} className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <button type="button" disabled={verdict !== null} className="flex min-h-9 items-center gap-1 text-cyan-200 disabled:opacity-40"
        onClick={() => { onPreview(point); setVisited((old) => [...new Set([...old, index])]); }}>
        <Play size={14} />{(zh ? ["起点附近", "圈中", "终点附近"] : ["Near lap start", "Mid-lap", "Near lap end"])[index]} · {point.video_time_s.toFixed(2)} s
      </button>
      <label className="flex items-center gap-2"><input type="checkbox" disabled={verdict !== null || !visited.includes(index)} checked={checked.includes(index)}
        onChange={(event) => setChecked((old) => event.target.checked ? [...old, index] : old.filter((v) => v !== index))} />
        {zh ? "画面位置和圈号一致" : "Location and lap agree"}</label>
    </div>)}
    <p className="mt-3 text-xs leading-5 text-slate-400">{playbackUnavailable
      ? (zh ? "原片尚未能在当前浏览器播放。元数据检查有效，但需先解决播放问题才能确认画面同步。" : "The original is not playable yet. Metadata inspection remains valid; restore playback before confirming visual sync.")
      : points.length === 3
      ? (zh ? "确认后替换当前圈的校准。不代表帧级精度。" : "Confirmation replaces this lap's calibration. Not proof of frame accuracy.")
      : (zh ? "候选未覆盖当前完整圈，请选择覆盖列表中的圈后重新检查。" : "This lap is not fully covered. Select a covered lap and check again.")}</p>
    <div className="mt-2 flex flex-wrap gap-2 text-xs">
      <button type="button" onClick={() => decide("confirmed")} disabled={verdict !== null || points.length !== 3 || checked.length !== 3}
        className="flex min-h-10 items-center gap-1 rounded border border-emerald-600 px-2 text-emerald-200 disabled:opacity-40"><Check size={14} />{zh ? "确认并保存" : "Confirm and save"}</button>
      <button type="button" onClick={() => decide("rejected")} disabled={verdict !== null} className="flex min-h-10 items-center gap-1 disabled:opacity-40"><X size={14} />{zh ? "不吻合" : "Mismatch"}</button>
      <button type="button" onClick={() => decide("uncertain")} disabled={verdict !== null} className="flex min-h-10 items-center gap-1 disabled:opacity-40"><CircleHelp size={14} />{zh ? "不确定" : "Uncertain"}</button>
    </div>
    {verdict && <p role="status" className="mt-2 text-xs text-cyan-200">{verdict === "confirmed"
      ? (zh ? "已保存人工确认" : "Human confirmation saved")
      : (zh ? "已记录本地判断，原校准未改动" : "Local judgement recorded; prior calibration unchanged")}</p>}
  </section>;
}

/** Key this component by inspection, video fingerprint and target lap. */
export function GoproSyncPanel({ file, duration, inspectionId, points, disabled, onPreview, onDecision }: {
  file: File; duration: number; inspectionId: string; points: TelemetrySyncPoint[]; disabled: boolean;
  onPreview: (point: SyncReviewPoint) => void;
  onDecision: (result: VideoSyncGnssResult, verdict: SyncReviewVerdict, point?: SyncReviewPoint) => boolean;
}) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audit, setAudit] = useState<GoproAudit | null>(null);
  const [result, setResult] = useState<VideoSyncGnssResult | null>(null);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function run() {
    if (disabled || busy || inspectionId.startsWith("public-demo")) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); setResult(null); setError(""); setProgress(0);
    try {
      const data = audit ?? await extractGoproTelemetry(file, { signal: controller.signal, onProgress: setProgress });
      controller.signal.throwIfAborted();
      setAudit(data); setProgress(1);
      if (!data.video_clock.some((p) => p.fix >= 3)) throw new Error("GOPRO_GPS_UTC_UNAVAILABLE");
      const next = await autoSyncVideoGnss({ inspection_id: inspectionId, video_clock: data.video_clock, video_gps: data.video_gps }, controller.signal);
      controller.signal.throwIfAborted();
      setResult(next);
    } catch (cause) {
      if (!controller.signal.aborted) {
        const code = cause instanceof Error ? cause.message : "GPMF_PARSE_FAILED";
        const key = Object.keys(REASONS).find((r) => code.includes(r));
        setError(key ? REASONS[key][zh ? 0 : 1] : (zh ? "GoPro 时间检查未完成，现有声音及人工校准仍可使用。" : "GoPro timing check failed. Audio and manual alignment remain available."));
      }
    } finally { if (abort.current === controller) setBusy(false); }
  }
  return <section className="mt-4 border-t border-slate-700 pt-4" aria-label={zh ? "GoPro 时间校验" : "GoPro timing check"}>
    <h4 className="text-sm font-semibold">{zh ? "GoPro 时间校验" : "GoPro timing check"} <span className="text-xs text-slate-400">Beta</span></h4>
    <button type="button" onClick={run} disabled={disabled || busy || inspectionId.startsWith("public-demo")}
      className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded border border-emerald-600 px-3 text-sm text-emerald-200 disabled:opacity-40">
      <Satellite size={16} />{busy ? (progress < 1 ? `${zh ? "读取元数据" : "Reading metadata"} ${Math.round(progress * 100)}%` : (zh ? "核对 AiM" : "Checking AiM")) : (zh ? "检查 GPS 时间" : "Check GPS timing")}
    </button>
    {busy && <button type="button" onClick={() => abort.current?.abort()} className="mt-2 flex min-h-9 items-center gap-1 text-xs"><X size={14} />{zh ? "取消" : "Cancel"}</button>}
    <p className="mt-2 text-xs leading-5 text-slate-400">{zh ? "视频留在本机，仅发送 GPS 时间、速度与位置摘要。相机 IMU 不用于车体分析。" : "Video stays local. Only GPS time, speed and position summaries are sent. Camera IMU is not used for body dynamics."}</p>
    {audit && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th>{zh ? "原始通道" : "Recorded channel"}</th><th>{zh ? "样本数" : "Samples"}</th><th>Hz*</th></tr></thead>
      <tbody>{audit.summary.streams.map((s) => <tr key={s.key}><td className="py-1">{s.key}</td><td>{s.sample_count}</td><td>{s.sample_rate_hz.toFixed(1)}</td></tr>)}</tbody></table>
      <p className="mt-1 text-xs text-slate-400">{zh ? "*按元数据时长估算，不代表硬件带宽。" : "*Estimated from payload duration, not hardware bandwidth."}</p></div>}
    {error && <p role="alert" className="mt-3 text-xs text-amber-200">{error}</p>}
    {result && <GnssSyncReview result={result} playbackUnavailable={!Number.isFinite(duration) || duration <= 0}
      points={rpmReviewPoints(points, result.offset_ms, duration, result.evidence.matched_video_range_s)}
      onPreview={onPreview} onDecision={(verdict, point) => onDecision(result, verdict, point)} />}
  </section>;
}
