"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleHelp, Play, Satellite, X } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "../lib/i18n";
import { extractGoproTelemetry, type GoproAudit } from "../lib/gpmfTelemetry";
import { autoSyncVideoGnss, type GnssWindowDiagnostic, type VideoSyncGnssResult } from "../lib/xrkAnalysisApi";
import { rpmReviewPoints, type TelemetrySyncPoint } from "../lib/videoTelemetrySync";
import type { SyncReviewPoint, SyncReviewVerdict } from "./RpmSyncReview";
import { GoproGpsOverlay } from "./GoproGpsOverlay";
import { GoproSensorResearch } from "./GoproSensorResearch";
import { GnssSegmentReview } from "./GnssSegmentReview";

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
  GNSS_GEOMETRY_UNAVAILABLE: ["轨迹核对缺少 GPS 坐标", "GPS coordinates unavailable for geometry checks"],
  GNSS_GEOMETRY_TIMING_INVALID: ["轨迹时间轴不足或不单调", "Insufficient or nonmonotonic geometry timestamps"],
  GNSS_GEOMETRY_HOLDOUT_INSUFFICIENT: ["轨迹长度不足，无法分离拟合与验证", "Recording too short for separate geometry fit and validation"],
  GNSS_GEOMETRY_COVERAGE_INSUFFICIENT: ["共同有效定位覆盖不足，未跨缺口补值", "Insufficient shared GPS coverage; gaps are not filled"],
  GNSS_GEOMETRY_LOW_EXCITATION: ["路径变化不足，无法区分位置平移和时间偏移", "Too little path variation to separate translation and timing"],
  GNSS_GEOMETRY_TRANSLATION_EXCESSIVE: ["拟合的位置平移超出允许范围", "Position translation exceeds the supported range"],
  GNSS_GEOMETRY_HOLDOUT_DISAGREEMENT: ["留出轨迹未通过一致性核对", "Held-out geometry does not agree"],
  GNSS_GEOMETRY_OFFSET_DISAGREEMENT: ["轨迹与速度/时钟偏移不一致，请人工核对", "Geometry and speed/clock offsets disagree; review manually"],
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
      <dt>{zh ? "速度匹配偏移差（非实测延迟）" : "Speed-match offset spread (not measured delay)"}</dt><dd>{e.speed_check.validation_max_residual_s == null ? "Unavailable" : `${e.speed_check.validation_max_residual_s.toFixed(3)} s`}</dd>
      <dt>{zh ? "位置差中位数" : "Median position difference"}</dt><dd>{e.spatial_check.median_error_m == null ? "Unavailable" : `${e.spatial_check.median_error_m.toFixed(2)} m`}</dd>
      {e.geometry_check && <>
        <dt>{zh ? "轨迹候选偏移" : "Geometry candidate offset"}</dt><dd>{e.geometry_check.proposed_offset_s?.toFixed(3) ?? "Unavailable"} {e.geometry_check.proposed_offset_s != null && "s"}</dd>
        <dt>{zh ? "留出位置差 / P95" : "Held-out median / P95"}</dt><dd>{e.geometry_check.validation_median_m == null ? "Unavailable" : `${e.geometry_check.validation_median_m.toFixed(2)} / ${e.geometry_check.validation_p95_m?.toFixed(2)} m`}</dd>
      </>}
    </dl>
    {e.offset_diagnostics && <details className="mt-3 border-t border-slate-800 pt-3 text-xs" data-testid="gnss-offset-diagnostics">
      <summary className="cursor-pointer text-cyan-200">{zh ? "为什么几个偏移值不同？" : "Why do the offset estimates differ?"}</summary>
      <dl className="mt-3 grid grid-cols-2 gap-2">{e.offset_diagnostics.estimators.map(row => <div key={row.method} className="contents">
        <dt>{({ clock_sample_median: zh ? "时钟样本中位数" : "Clock sample median", clock_linear_intercept: zh ? "时钟直线拟合" : "Clock linear fit",
          speed_windows: zh ? "速度窗口匹配" : "Speed-window match", gps_geometry: zh ? "GPS 轨迹匹配" : "GPS geometry match" } as Record<string, string>)[row.method] ?? row.method}
          {row.method === e.offset_diagnostics!.selected_method && (zh ? "（当前候选）" : " (current candidate)")}</dt>
        <dd>{row.offset_s.toFixed(3)} s</dd>
      </div>)}</dl>
      {e.offset_diagnostics.tow_is_held && <p className="mt-3 leading-5 text-amber-200">{zh
        ? "记录仪的周内时钟以阶梯值保存；中位数与直线拟合会受采样相位影响。估计值不同，不等于实际时钟发生漂移。"
        : "The logger time-of-week is held in steps. Sampling phase affects median and linear-fit estimates; different estimates do not establish clock drift."}</p>}
      {e.speed_check.worst_validation_window && <p className="mt-2 leading-5">{zh
        ? `最不一致的速度窗口位于遥测 ${e.speed_check.worst_validation_window.session_center_s.toFixed(2)}s 附近；最大偏差 ${e.speed_check.validation_max_residual_s?.toFixed(3)}s，门槛 ${e.speed_check.residual_limit_s?.toFixed(3)}s。未剔除该窗口。`
        : `The least consistent speed window is near telemetry ${e.speed_check.worst_validation_window.session_center_s.toFixed(2)}s; maximum deviation ${e.speed_check.validation_max_residual_s?.toFixed(3)}s, limit ${e.speed_check.residual_limit_s?.toFixed(3)}s. This window was not discarded.`}</p>}
      <p className="mt-2 leading-5 text-slate-400">{zh
        ? "这些方法共享 GNSS 数据，不是独立的帧级真值，也不是同步准确率。自动结果不会覆盖人工锚点；保留已核对的圈号与起终点，逐段看画面确认。"
        : "These methods share GNSS data, not independent frame-level truth or an accuracy percentage. Automatic results do not overwrite manual anchors. Retain checked lap/start/end anchors and verify the footage."}</p>
    </details>}
    {e.segmented_check ? <GnssSegmentReview check={e.segmented_check} renderDiagnostic={d => <GnssWindowReview diagnostic={d} />} />
      : e.speed_check.window_diagnostic && <GnssWindowReview diagnostic={e.speed_check.window_diagnostic} />}
    {e.geometry_check && <GoproGpsOverlay check={e.geometry_check} />}
    <p className="mt-3 text-xs">{zh ? "覆盖整圈（待核对）" : "Full laps (unverified)"}: {e.lap_coverage.filter((p) => p.coverage === "full").map((p) => `L${p.lap}`).join(", ") || "—"}</p>
    <p className="mt-1 text-xs">{zh ? "视频重叠范围" : "Video overlap"}: {e.matched_video_range_s.map((v) => v.toFixed(2)).join(" - ")} s</p>
    <ul className="mt-3 space-y-1 text-xs text-amber-200">{e.reason_codes.map((r) => <li key={r}>{REASONS[r]?.[zh ? 0 : 1] ?? r}</li>)}</ul>
    {points.map((point, index) => <div key={index} className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <button type="button" disabled={verdict !== null || playbackUnavailable} className="flex min-h-9 items-center gap-1 text-cyan-200 disabled:opacity-40"
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
      <button type="button" onClick={() => decide("confirmed")} disabled={verdict !== null || playbackUnavailable || points.length !== 3 || checked.length !== 3}
        className="flex min-h-10 items-center gap-1 rounded border border-emerald-600 px-2 text-emerald-200 disabled:opacity-40"><Check size={14} />{zh ? "确认并保存" : "Confirm and save"}</button>
      <button type="button" onClick={() => decide("rejected")} disabled={verdict !== null} className="flex min-h-10 items-center gap-1 disabled:opacity-40"><X size={14} />{zh ? "不吻合" : "Mismatch"}</button>
      <button type="button" onClick={() => decide("uncertain")} disabled={verdict !== null} className="flex min-h-10 items-center gap-1 disabled:opacity-40"><CircleHelp size={14} />{zh ? "不确定" : "Uncertain"}</button>
    </div>
    {verdict && <p role="status" className="mt-2 text-xs text-cyan-200">{verdict === "confirmed"
      ? (zh ? "已保存人工确认" : "Human confirmation saved")
      : (zh ? "已记录本地判断，原校准未改动" : "Local judgement recorded; prior calibration unchanged")}</p>}
  </section>;
}

/** Failed matches remain visible; a local correlation optimum is not a clock correction. */
function GnssWindowReview({ diagnostic: d }: { diagnostic: GnssWindowDiagnostic }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const number = (v: number | null | undefined, digits = 2) => v == null ? (zh ? "不可用" : "Unavailable") : v.toFixed(digits);
  return <details className="mt-3 min-w-0 border-t border-slate-800 pt-3 text-xs" data-testid="gnss-window-diagnostic">
    <summary className="cursor-pointer text-amber-200">{zh ? "查看未通过窗口：GPS 信号还是时间问题？" : "Inspect failed window: GPS signals or timing?"}</summary>
    <p className="mt-3 leading-5">{zh
      ? "局部速度匹配会被曲线变形影响，不能据此断言视频晚了相同秒数。此窗口仍未通过，未删除样本或放宽门槛。"
      : "A distorted speed curve can move the local matching peak. This does not prove the video is delayed by that amount. The window still fails; no samples were removed or limits relaxed."}</p>
    <dl className="mt-3 grid grid-cols-2 gap-2">
      <dt>{zh ? "遥测时间范围" : "Telemetry range"}</dt><dd>{d.session_range_s.map(v => v.toFixed(2)).join(" - ")} s</dd>
      <dt>{zh ? "视频候选范围" : "Candidate video range"}</dt><dd>{d.video_range_s.map(v => v.toFixed(2)).join(" - ")} s</dd>
      <dt>{zh ? "当前候选的最大速度差" : "Maximum speed difference at candidate"}</dt><dd>{number(d.at_fit_offset.max_absolute_difference_kmh)} km/h</dd>
      <dt>{zh ? "局部最佳平移后仍差" : "Difference remaining at local best shift"}</dt><dd>{number(d.at_local_best_offset.max_absolute_difference_kmh)} km/h</dd>
      <dt>{zh ? "位置差 P95（未平移）" : "Position difference P95 (unshifted)"}</dt><dd>{number(d.position_at_fit_offset?.p95_m)} m</dd>
      <dt>{zh ? "相机时钟残差跨度" : "Camera clock residual span"}</dt><dd>{number(d.camera_clock_epoch_span_s, 3)} s</dd>
    </dl>
    {d.at_fit_offset.peak && <p className="mt-2 leading-5">{zh
      ? `差异最大处：遥测 ${d.at_fit_offset.peak.session_time_s.toFixed(2)}s，AiM ${d.at_fit_offset.peak.aim_speed_kmh.toFixed(1)} km/h，GoPro ${d.at_fit_offset.peak.camera_speed_kmh.toFixed(1)} km/h。`
      : `Largest difference: telemetry ${d.at_fit_offset.peak.session_time_s.toFixed(2)}s, AiM ${d.at_fit_offset.peak.aim_speed_kmh.toFixed(1)} km/h, GoPro ${d.at_fit_offset.peak.camera_speed_kmh.toFixed(1)} km/h.`}</p>}
    <div className="mt-3 h-64 min-w-0" role="img" aria-label={zh ? "失败窗口两路 GPS 速度对照" : "GPS speed comparison in the failed window"}>
      <ResponsiveContainer width="100%" height="100%"><LineChart data={d.trace} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
        <XAxis dataKey="session_time_s" type="number" domain={["dataMin", "dataMax"]} tickFormatter={v => `${Number(v).toFixed(0)}s`} />
        <YAxis width={40} unit="" />
        <Tooltip labelFormatter={v => `${Number(v).toFixed(2)} s`} formatter={v => [`${Number(v).toFixed(2)} km/h`]} />
        <Legend />
        <Line dataKey="aim_speed_kmh" name="AiM GPS" stroke="#22d3ee" dot={false} isAnimationActive={false} connectNulls={false} />
        <Line dataKey="camera_at_fit_kmh" name={zh ? "GoPro · 当前候选" : "GoPro · candidate"} stroke="#fbbf24" dot={false} isAnimationActive={false} connectNulls={false} />
        <Line dataKey="camera_at_local_best_kmh" name={zh ? "GoPro · 局部最佳平移" : "GoPro · local best shift"} stroke="#f472b6" strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls={false} />
      </LineChart></ResponsiveContainer>
    </div>
    <p className="mt-2 leading-5 text-slate-400">{zh
      ? "局部平移仅用于排查，未用于校准。两套 GPS 都不是独立真值；时钟连续也不能证明逐帧精度。请保留已确认的人工锚点，并核对上述视频区间。"
      : "The local shift is diagnostic only, not applied to calibration. Neither GPS is independent ground truth; continuous clocks do not prove frame accuracy. Keep confirmed manual anchors and review this video interval."}</p>
  </details>;
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
      const data = audit ?? await extractGoproTelemetry(file, { signal: controller.signal, onProgress: setProgress, includeCameraImu: true });
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
    {audit && <GoproChannelSummary audit={audit} />}
    {audit?.camera_imu && <details className="mt-3 text-xs"><summary className="min-h-8 cursor-pointer">{zh ? "相机通道与频谱 · 实验" : "Camera channels and spectrum · Experimental"}</summary><GoproSensorResearch audit={audit} /></details>}
    {error && <p role="alert" className="mt-3 text-xs text-amber-200">{error}</p>}
    {result && <GnssSyncReview result={result} playbackUnavailable={!Number.isFinite(duration) || duration <= 0}
      points={rpmReviewPoints(points, result.offset_ms, duration, result.evidence.matched_video_range_s)}
      onPreview={onPreview} onDecision={(verdict, point) => onDecision(result, verdict, point)} />}
  </section>;
}

/** Source declarations are auditable without relabelling camera axes as vehicle motion. */
export function GoproChannelSummary({ audit }: { audit: GoproAudit }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  return <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>
    <th>{zh ? "原始通道" : "Recorded channel"}</th><th>{zh ? "单位" : "Units"}</th><th>{zh ? "样本数" : "Samples"}</th><th>Hz*</th>
  </tr></thead><tbody>{audit.summary.streams.map(s => <tr key={s.key}><td className="py-1">{s.key}</td><td>{s.unit}</td><td>{s.sample_count}</td><td>{s.sample_rate_hz.toFixed(1)}</td></tr>)}</tbody></table>
    <p className="mt-1 text-xs text-slate-400">{zh ? "*按元数据时长估算，不代表硬件带宽。" : "*Estimated from payload duration, not hardware bandwidth."}</p>
    <details className="mt-2 text-xs"><summary className="min-h-8 cursor-pointer">{zh ? "轴向与时间来源" : "Axis and timing provenance"}</summary>
      {audit.summary.streams.filter(s => s.source === "camera_imu").map(s => <dl key={s.key} className="mb-3 grid grid-cols-2 gap-1">
        <dt>{s.key} ORIN / ORIO</dt><dd>{s.input_orientation ?? "Unavailable"} / {s.output_orientation ?? "Unavailable"}</dd>
        <dt>{zh ? "元数据一致" : "Metadata consistent"}</dt><dd>{s.orientation_consistent ? (zh ? "是" : "Yes") : (zh ? "否" : "No")}</dd>
        <dt>{zh ? "车体轴标定" : "Body-frame calibration"}</dt><dd>{zh ? "未完成" : "Unavailable"}</dd>
        <dt>SCAL</dt><dd className="break-words">{s.scale?.join(", ") ?? "Unavailable"}</dd>
        <dt>MTRX</dt><dd className="break-words">{s.calibration_matrix?.join(", ") ?? "Unavailable"}</dd>
        <dt>{zh ? "原生计时字段" : "Recorded timing fields"}</dt><dd>{s.timing_fields?.join(", ") || "Unavailable"}</dd>
      </dl>)}
      <p className="leading-5 text-slate-400">{zh ? "帧包 CTS 确定时间范围，包内样本按均匀时刻估计；不等于硬件逐样本时间。相机轴不解释为车体偏航、侧倾或俯仰。" : "Payload CTS sets the interval; within-payload sample times are uniform estimates, not hardware timestamps. Camera axes are not vehicle yaw, roll or pitch."}</p>
    </details>
  </div>;
}
