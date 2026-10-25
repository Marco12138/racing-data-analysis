import { reviewTrace, reviewValue, type ReviewSelection } from "./coachReview";
import type { CornerCoachComparison } from "./cornerCoach";
import { matchesReviewVideo, type VideoIdentity } from "./manualReview";
import { selectCornerWindow } from "./selectedCorner";
import type { VideoSyncCalibration } from "./videoTelemetrySync";
import type { XrkAnalysis } from "./xrkAnalysisApi";

export type RecommendedSeed = { id: string; name: string; sourceLap: number; videoStart: number; key: string };
export type RecommendedCoachEvidence = {
  id: string; name: string; comparison: CornerCoachComparison | null;
  videoConfirmed: boolean; contextComplete: boolean;
};

/** Seed the existing context detector inside a known real lap; never create an anchor. */
export function recommendedCoachSeed(analysis: XrkAnalysis, review: ReviewSelection,
  anchors: VideoSyncCalibration[], video: VideoIdentity): RecommendedSeed | null {
  const preferred = [...anchors].sort((a, b) => Number(b.target_lap === analysis.target_lap) - Number(a.target_lap === analysis.target_lap));
  for (const anchor of preferred) {
    if (!matchesReviewVideo(anchor.video, video) || anchor.review?.verdict !== "confirmed"
      || !analysis.lap_quality.laps.some(l => l.lap === anchor.target_lap && l.analysis_eligible)) continue;
    const trace = reviewTrace(analysis, anchor.target_lap);
    const focus = reviewValue(trace, review.focus, "session_time_s");
    const range = analysis.video_sync.lap_video_ranges.find(l => l.lap === anchor.target_lap);
    if (focus === null || !range) continue;
    const start = Math.max(range.telemetry_start_s + .5, Math.min(focus - 2, range.telemetry_end_s - 5.5));
    if (focus < start || focus > start + 5) continue;
    const videoStart = start + anchor.offset_ms / 1000;
    if (!selectCornerWindow(videoStart, anchor, video, analysis.video_sync.lap_video_ranges)) continue;
    return { id: review.id, name: review.name, sourceLap: anchor.target_lap, videoStart,
      key: JSON.stringify([analysis.inspection_id, review.id, review.entry, review.exit, review.focus, start, anchors, video]) };
  }
  return null;
}

/** Shared wording for recommendation, final debrief and download; no LLM arithmetic. */
export function coachObservation(evidence: RecommendedCoachEvidence, zh: boolean): string[] {
  const c = evidence.comparison;
  const name = zh ? evidence.name.replace(/^(Suggested )?Zone\s+/i, "区间 ") : evidence.name;
  const prefix = `${name}：`;
  if (!c) return [prefix + (zh ? "尚未完成教练对照。" : "Coach comparison has not been calculated.")];
  if (c.status === "unavailable") {
    const reasons: Record<string, [string, string]> = {
      overall_gps_warning: ["整圈最快圈在这里有 GPS 异常，暂不比较。", "The full-lap best has a GPS warning here; comparison withheld."],
      overall_video_rejected: ["整圈最快圈的视频已被否定，暂不比较。", "The full-lap best video was rejected; comparison withheld."],
      overall_section_unavailable: ["整圈最快圈未通过区段匹配，不用其他圈替代。", "The full-lap best has no valid section match; no substitute lap is used."],
    };
    return [prefix + (reasons[c.reason]?.[zh ? 0 : 1] ?? (zh ? "同一区段的可比证据不足，暂不判断优势。" : "Insufficient comparable section evidence to judge an advantage."))];
  }
  const limits = [evidence.contextComplete
    ? (zh ? "已补入减速前段与速度恢复，但完整驾驶动作仍需核对。" : "Approach and speed recovery are included; driving actions still need review.")
    : (zh ? "减速或出弯覆盖不完整，只能解释这段区间，不能称为完整弯道。" : "Approach or exit coverage is incomplete; this is a section, not a complete corner."),
  evidence.videoConfirmed ? (zh ? "两圈首尾画面已人工核对；不代表动作因果已确认。" : "Both videos' boundaries were checked manually, not causal driving claims.")
    : (zh ? "视频仍待首尾核对；以下仅为遥测观测。" : "Video boundaries remain unconfirmed; these are telemetry observations only.")];
  if (c.status === "same_lap") return [prefix + (zh ? `L${c.overall.lap} 同时是区段与整圈最快，不另造一种更快开法。` : `L${c.overall.lap} is both section and full-lap best; no alternate faster style is invented.`), ...limits];
  const parts = zh ? ["前段", "中段", "后段"] : ["first third", "middle third", "final third"];
  const best = c.parts.reduce((a, b) => b.gain_s > a.gain_s ? b : a);
  const fmt = (n: number) => Math.abs(n).toFixed(3);
  const timing = zh ? `L${c.section.lap} 相比整圈最快 L${c.overall.lap}，本段快 ${fmt(c.gain_s)} 秒；最多优势建立在${parts[best.index]}（${fmt(best.gain_s)} 秒）。`
    : `L${c.section.lap} gains ${fmt(c.gain_s)}s over full-lap best L${c.overall.lap}; the largest contribution is in the ${parts[best.index]} (${fmt(best.gain_s)}s).`;
  const retention = c.combined_gain_s === null
    ? (c.downstream_gps_warning ? (zh ? "下游有 GPS 异常，不能判断优势是否保持。" : "Downstream GPS is flagged; gain retention is unknown.")
      : (zh ? "缺少连续下游计时，不能判断优势是否保持。" : "Continuous downstream timing is missing; gain retention is unknown."))
    : (zh ? `再看${evidence.contextComplete ? "出口" : "这段区间"}后的约50米：${c.downstream_gain_s! >= 0 ? "又快" : "损失"} ${fmt(c.downstream_gain_s!)} 秒；到下游终点${c.combined_gain_s > 0 ? "仍快" : c.combined_gain_s < 0 ? "反而慢" : "持平"}${c.combined_gain_s === 0 ? "。" : ` ${fmt(c.combined_gain_s)} 秒。`}`
      : `Over the next ~50m it ${c.downstream_gain_s! >= 0 ? "gains" : "loses"} ${fmt(c.downstream_gain_s!)}s; at the downstream end it is ${fmt(c.combined_gain_s)}s ${c.combined_gain_s >= 0 ? "ahead" : "behind"}.`);
  return [prefix + timing, retention, ...limits,
    zh ? `先回看${parts[best.index]}的速度、RPM和车载姿态，再看出口结果；前中后按距离等分，不等同于已确认的刹车、弯心、开油阶段。`
      : `Review speed, RPM and visible posture in the ${parts[best.index]}, then the exit. Distance thirds are not confirmed braking, apex or throttle phases.`];
}
