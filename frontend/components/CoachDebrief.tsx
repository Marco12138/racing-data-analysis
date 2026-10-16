"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
import type { XrkAnalysis } from "../lib/xrkAnalysisApi";
import type { VideoSyncCalibration } from "../lib/videoTelemetrySync";
import { reviewVideoIdentity } from "../lib/manualReview";
import { confirmedLandmarkSighting, LANDMARK_EVENT, landmarkEventText, parseLandmarks } from "../lib/trackLandmarks";

const REASONS: Record<string, [string, string]> = {
  not_configured: ["模型未配置，显示结构化事实", "Model not configured; showing structured facts"],
  timeout: ["AI 请求超时，显示结构化事实", "AI timed out; showing structured facts"],
  provider_unavailable: ["AI 服务暂不可用，显示结构化事实", "AI service unavailable; showing structured facts"],
  policy_rejected: ["AI 文本未通过证据检查，显示结构化事实", "AI text failed evidence checks; showing structured facts"],
  numbers_rejected: ["AI 数字未通过核对，显示结构化事实", "AI numbers failed checks; showing structured facts"],
  language_rejected: ["AI 语言未通过检查，显示结构化事实", "AI language failed checks; showing structured facts"],
};

/** Capability is not generation success; useful facts remain visible without an LLM. */
export function CoachDebrief({ analysis, calibration, videoFile, videoDurationS = 0 }: {
  analysis: XrkAnalysis; calibration?: VideoSyncCalibration | null; videoFile?: File | null; videoDurationS?: number;
}) {
  const { locale } = useI18n();
  const zh = locale === "zh", result = analysis.coach_debrief;
  const status = analysis.narrative_status;
  const generated = Boolean(analysis.narrative && status?.status === "generated" && status.language === locale);
  const reason = REASONS[status?.reason ?? ""];
  const [landmarkNotes, setLandmarkNotes] = useState<Record<string, string[]>>({});
  useEffect(() => {
    const load = () => {
      const notes: Record<string, string[]> = {};
      if (videoFile && calibration?.target_lap === analysis.target_lap) {
        const videoKey = JSON.stringify(reviewVideoIdentity(videoFile, videoDurationS)), syncKey = JSON.stringify(calibration);
        for (const corner of analysis.consensus_benchmark.corners) {
          const scope = `${analysis.file_fingerprint}:${corner.entry_distance_m}:${corner.exit_distance_m}`;
          try {
            const landmarks = parseLandmarks(localStorage.getItem(`racing-landmarks:v1:${scope}:${corner.corner_id}`), scope, corner.corner_id);
            const zone = analysis.zones.comparisons.find(z => z.id === corner.corner_id);
            for (const landmark of landmarks) {
              const seen = confirmedLandmarkSighting(landmark, analysis.target_lap, videoKey, syncKey);
              if (!seen) continue;
              const text = [(zh ? "人工核对的参照物：" : "Human-checked landmark: ") + (zh ? landmark.name : landmark.nameEn || landmark.name)];
              for (const [metric, event] of [["lift_distance_m", "rpm_drop"], ["reacceleration_distance_m", "recovery"]] as const) {
                const distance = zone?.target[metric];
                if (typeof distance !== "number") continue;
                const sentence = landmarkEventText(landmark, seen, distance, event, locale);
                if (sentence) text.push(sentence);
              }
              notes[corner.corner_id] = [...(notes[corner.corner_id] ?? []), ...text];
            }
          } catch { /* Optional local evidence never blocks the telemetry review. */ }
        }
      }
      setLandmarkNotes(notes);
    };
    queueMicrotask(load); globalThis.addEventListener(LANDMARK_EVENT, load);
    return () => globalThis.removeEventListener(LANDMARK_EVENT, load);
  }, [analysis, calibration, videoFile, videoDurationS, zh, locale]);
  return <section aria-label={zh ? "分层教练复盘" : "Layered coach review"} className="space-y-5">
    <p role="status" className={`text-xs ${generated ? "text-teal-300" : "text-slate-400"}`}>
      {generated ? (zh ? "本次 AI 叙事已生成 · AI 生成，请与教练核实" : "AI narrative generated · Validate with your coach")
        : status?.language && status.language !== locale ? (zh ? "语言切换中，显示当前可用事实" : "Language changed; showing available facts")
        : reason?.[zh ? 0 : 1] ?? (zh ? "本次没有可用的 AI 叙事，显示结构化事实" : "No AI narrative for this review; showing structured facts")}
    </p>
    {generated && <details><summary className="cursor-pointer text-sm text-teal-200">{zh ? "AI 复盘解说" : "AI review commentary"}</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-200">{analysis.narrative}</p></details>}
    {result?.language === locale ? <>
      {(["observations", "reviews", "training"] as const).map((tier, index) => <section key={tier} className="border-t border-slate-700 pt-4">
        <h3 className="mb-3 text-base font-semibold text-white">{(zh ? ["已观察到的事实", "值得复盘的片段", "有依据的训练建议"] : ["Observed facts", "Clips worth reviewing", "Evidence-backed training"])[index]}</h3>
        {result[tier].length ? result[tier].map(row => <div className="mb-3" key={row.id}>
          <p className="whitespace-pre-wrap text-sm leading-7 text-slate-300">{row.text}</p>
          {"corner_id" in row && row.corner_id && landmarkNotes[row.corner_id]?.map((text, i) => <p className="text-sm leading-6 text-teal-200" key={i}>{text}</p>)}
        </div>) :
          <p className="text-sm leading-7 text-slate-400">{tier === "training" ? result.no_training_reason : zh ? "当前没有足够数据生成这部分对比。" : "Not enough data for this comparison."}</p>}
      </section>)}
      <p className="text-xs leading-6 text-slate-500">{result.limitations.join(" ")}</p>
    </> : <p className="text-sm leading-7 text-slate-300">{zh
      ? "下方保留真实前三快圈的 Sector 对比和复盘片段。尚无通过验证的训练调整，不等于没有可观察的圈间差异。重新分析后可查看完整分层摘要。"
      : "Real Top 3 sector comparisons and review clips remain below. No validated training adjustment does not mean no observable differences. Reanalyze for the full layered summary."}</p>}
  </section>;
}
