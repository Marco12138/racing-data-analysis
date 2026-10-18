"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { candidateLandmarkCheck, type ReviewCandidate } from "../lib/reviewCandidate";
import type { ReviewPoint } from "../lib/coachReview";
import { LANDMARK_EVENT, parseLandmarks, type TrackLandmark } from "../lib/trackLandmarks";
import { searchLandmarkVideo } from "../lib/landmarkVideo";

const btn = "inline-flex items-center gap-2 rounded border border-amber-400/40 px-3 py-2 text-xs text-amber-200";

/** Optional visual evidence never promotes timing, mutates anchors or creates feedback labels. */
export function ReviewCandidateNotice({ candidate, trace, scope, cornerId, videoKey, videoUrl, onReview, onSeek }: {
  candidate: ReviewCandidate; trace: ReviewPoint[]; scope: string; cornerId: string; videoKey: string; videoUrl: string;
  onReview: () => void; onSeek: (time: number) => void;
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  const [library, setLibrary] = useState<TrackLandmark[]>([]);
  const [cancelled, setCancelled] = useState(false);
  const [result, setResult] = useState<{ plan: string; status: string; time: number | null; delta: number | null } | null>(null);
  useEffect(() => {
    const reload = () => {
      try { setLibrary(parseLandmarks(localStorage.getItem(`racing-landmarks:v1:${scope}:${cornerId}`), scope, cornerId)); }
      catch { setLibrary([]); }
    };
    queueMicrotask(reload); globalThis.addEventListener(LANDMARK_EVENT, reload);
    return () => globalThis.removeEventListener(LANDMARK_EVENT, reload);
  }, [scope, cornerId]);
  const plan = useMemo(() => candidateLandmarkCheck(library, candidate, trace, videoKey), [library, candidate, trace, videoKey]);
  const planKey = JSON.stringify([plan?.landmark.id, plan?.expected, plan?.window, videoKey]);
  useEffect(() => {
    if (!plan || cancelled) return;
    const abort = new AbortController();
    void searchLandmarkVideo(videoUrl, plan.landmark, plan.window, abort.signal).then(next => {
      if (!abort.signal.aborted) setResult({ plan: planKey, status: next.status, time: next.candidate?.time ?? null,
        delta: next.candidate ? next.candidate.time - plan.expected : null });
    }).catch(() => { if (!abort.signal.aborted) setResult({ plan: planKey, status: "failed", time: null, delta: null }); });
    return () => abort.abort();
  }, [plan, planKey, videoUrl, cancelled]);
  const current = result?.plan === planKey ? result : null;
  const status = cancelled ? "cancelled" : !plan ? "no_landmark" : current?.status ?? "searching";
  const messages: Record<string, [string, string]> = {
    no_landmark: ["暂无该位置已确认的参照物，先核对候选视频。", "No confirmed landmark at this location; review the candidate footage first."],
    searching: ["正在预计位置附近核对参照物…", "Checking a landmark near the predicted position…"],
    candidate: ["找到相似画面，仍需人工核对；未调整同步。", "Similar frame found; human review is still required. Sync is unchanged."],
    ambiguous: ["多处画面相似，不能确认位置。", "Several frames look alike; location is unconfirmed."],
    weak: ["画面证据不足，候选仍保留供人工核对。", "Visual evidence is weak; the timing candidate remains available for review."],
    failed: ["画面核对未完成，可手动核对。", "Visual check could not finish; review manually."],
    cancelled: ["已停止画面核对。", "Visual check stopped."],
  };
  return <div className="my-3 space-y-2 border-l-2 border-amber-400 pl-3 text-xs text-amber-200" data-testid="review-timing-candidate">
    <p className="font-semibold">{zh ? `由已确认 L${candidate.source.target_lap} 锚点推算 · 待确认` : `Estimated from confirmed L${candidate.source.target_lap} anchor · Unconfirmed`}</p>
    <p>{zh ? "两圈起点的实际计时差" : "Actual time between lap starts"}: {candidate.lap_start_delta_s > 0 ? "+" : ""}{candidate.lap_start_delta_s.toFixed(3)}s</p>
    <p className="text-slate-400">{zh ? "假设同一视频连续录制；剪辑或中断后请人工重新标定。不会覆盖已确认锚点。" : "Assumes continuous recording in this file. Re-anchor after cuts or interruptions. Confirmed anchors are unchanged."}</p>
    <p role="status">{messages[status][zh ? 0 : 1]}</p>
    {current?.delta !== null && current?.delta !== undefined && !cancelled && <p className="text-slate-400">
      {zh ? "相似画面与预计时刻相差" : "Similar-frame difference from prediction"}: {current.delta > 0 ? "+" : ""}{current.delta.toFixed(2)}s
      {zh ? "（不是测得的同步误差）" : " (not a measured sync error)"}
    </p>}
    <div className="flex flex-wrap gap-2">
      <button className={btn} onClick={onReview}><Check size={14} />{zh ? "核对 / 微调此片段" : "Review / Adjust candidate"}</button>
      {current?.time != null && !cancelled && <button className={btn} onClick={() => onSeek(current.time!)}><Search size={14} />{zh ? "查看相似画面" : "View similar frame"}</button>}
      {status === "searching" && <button className={btn} onClick={() => setCancelled(true)}><X size={14} />{zh ? "停止核对" : "Stop check"}</button>}
    </div>
  </div>;
}
