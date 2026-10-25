"use client";

import { useEffect, useMemo } from "react";
import { useI18n } from "../lib/i18n";
import { recommendedCoachSeed, type RecommendedCoachEvidence } from "../lib/recommendedCoach";
import { matchesReviewVideo, reviewVideoIdentity } from "../lib/manualReview";
import type { ReviewSelection } from "../lib/coachReview";
import type { VideoSyncCalibration } from "../lib/videoTelemetrySync";
import type { XrkAnalysis } from "../lib/xrkAnalysisApi";
import { CornerWorkspace } from "./SelectedCornerPanel";

export function RecommendedCoachReview({ analysis, review, file, url, duration, anchors, active, onEvidence }: {
  analysis: XrkAnalysis; review: ReviewSelection; file: File | null; url: string; duration: number;
  anchors: VideoSyncCalibration[]; active: boolean; onEvidence?: (row: RecommendedCoachEvidence) => void;
}) {
  const { locale } = useI18n();
  const video = useMemo(() => file ? reviewVideoIdentity(file, duration) : null, [file, duration]);
  const usable = useMemo(() => anchors.filter(a => video && matchesReviewVideo(a.video, video)
    && a.review?.verdict === "confirmed" && analysis.lap_quality.laps.some(l => l.lap === a.target_lap && l.analysis_eligible)), [anchors, video, analysis]);
  const seed = useMemo(() => video ? recommendedCoachSeed(analysis, review, usable, video) : null, [analysis, review, usable, video]);
  useEffect(() => {
    if (!seed) onEvidence?.({ id: review.id, name: review.name, comparison: null, videoConfirmed: false, contextComplete: false });
  }, [seed, review.id, review.name, onEvidence]);
  return <section className="min-w-0 border-t border-slate-700 py-4" data-testid="recommended-coach-review">
    {seed && file && url ? <CornerWorkspace key={seed.key} analysis={analysis} file={file} url={url} duration={duration}
      anchors={usable} active={active} preset={seed} onCoachEvidence={onEvidence} />
      : <p className="text-sm text-amber-200">{locale === "zh" ? "教练对照需要本地视频、已确认的单圈锚点及连续区段遥测。原目标圈对照仍可查看，不会自动新建或修改锚点。" : "Coach comparison needs a local video, a confirmed lap anchor and continuous section telemetry. The original target-lap comparison remains available; anchors are never created or changed automatically."}</p>}
  </section>;
}
