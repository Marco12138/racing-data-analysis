"use client";

import { ArrowLeft, ArrowRight, Check, Download, FileCheck2, Video } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { REVIEW_STEPS, buildGuidedDebrief, type ReviewStep, type ReviewReceipt } from "../lib/guidedReview";
import { selectCoachReviews } from "../lib/coachReview";
import type { SelectedCornerResult } from "../lib/selectedCorner";
import type { XrkAnalysis } from "../lib/xrkAnalysisApi";
import { coachObservation, type RecommendedCoachEvidence } from "../lib/recommendedCoach";

export const guideButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:border-cyan-400 disabled:opacity-40";

export function ReviewSteps({ step, hasData, onStep }: { step: ReviewStep; hasData: boolean; onStep?: (step: ReviewStep) => void }) {
  const { locale } = useI18n();
  return <nav aria-label={locale === "zh" ? "复盘步骤" : "Review steps"} className="grid grid-cols-3 gap-1 border-y border-slate-700 py-3 lg:grid-cols-6">
    {REVIEW_STEPS.map(([zh, en], i) => <button key={en} aria-current={step === i ? "step" : undefined}
      disabled={!onStep || (!hasData && i > 0)} onClick={() => onStep?.(i as ReviewStep)}
      className={`flex min-h-14 min-w-0 items-center gap-2 rounded px-2 py-2 text-left text-sm disabled:cursor-default ${step === i ? "bg-[#f6c945] font-semibold text-black" : "text-slate-400 hover:bg-white/5"}`}>
      <span className="shrink-0 font-mono text-xs">{String(i + 1).padStart(2, "0")}</span><span className="min-w-0 break-words">{locale === "zh" ? zh : en}</span>
    </button>)}
  </nav>;
}

export function ReviewFooter({ step, onStep, paired, busy }: { step: ReviewStep; onStep: (step: ReviewStep) => void; paired: boolean; busy: boolean }) {
  const { locale } = useI18n(), zh = locale === "zh";
  return <footer className="sticky bottom-0 z-30 -mx-1 mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-600 bg-[#0b1015]/95 px-3 py-3 backdrop-blur">
    <button className={guideButton} disabled={step === 0 || busy} onClick={() => onStep((step - 1) as ReviewStep)}><ArrowLeft size={16} />{zh ? "上一步" : "Back"}</button>
    <span className="text-xs text-slate-400">{step + 1} / {REVIEW_STEPS.length}{step === 2 && !paired ? (zh ? " · 尚未确认视频配对" : " · Video pairing unconfirmed") : ""}</span>
    {step < 5 ? <button className={`${guideButton} border-[#f6c945] bg-[#f6c945] font-semibold !text-black`} disabled={busy} onClick={() => onStep((step + 1) as ReviewStep)}>
      {step === 2 && !paired ? (zh ? "暂不配对，查看遥测" : "Continue with telemetry") : step === 4 ? (zh ? "查看本节总结" : "Open debrief") : (zh ? `下一步：${REVIEW_STEPS[step + 1][0]}` : `Next: ${REVIEW_STEPS[step + 1][1]}`)}<ArrowRight size={16} />
    </button> : <button className={guideButton} onClick={() => onStep(3)}>{zh ? "返回复盘证据" : "Return to evidence"}<ArrowRight size={16} /></button>}
  </footer>;
}

export function GuidedOverview({ analysis, videoName, videoDuration }: { analysis: XrkAnalysis; videoName: string; videoDuration: number }) {
  const { locale } = useI18n(), zh = locale === "zh";
  const best = analysis.lap_quality.top_valid_laps[0];
  const points = analysis.track?.reference.filter(p => Number.isFinite(p.local_x_m) && Number.isFinite(p.local_y_m)) ?? [];
  const xs = points.map(p => p.local_x_m!), ys = points.map(p => -p.local_y_m!);
  const left = Math.min(...xs) - 12, top = Math.min(...ys) - 12;
  const width = Math.max(...xs) - left + 12, height = Math.max(...ys) - top + 12;
  return <div className="space-y-6" data-testid="guided-overview">
    <div className="grid grid-cols-2 gap-4 border-b border-slate-700 pb-5 lg:grid-cols-4">
      {[[zh ? "记录圈数" : "Recorded laps", analysis.lap_rows.length], [zh ? "有效参考圈" : "Valid reference laps", analysis.lap_quality.reference_eligible_count],
        [zh ? "最快有效圈" : "Fastest valid lap", best ? `L${best.lap} · ${best.lap_time.toFixed(3)}s` : "—"],
        [zh ? "赛道长度 · GPS" : "Track length · GPS", analysis.track ? `${analysis.track.lap_length_m.toFixed(1)} m` : "—"]].map(([label, value]) =>
        <div key={label}><p className="text-xs text-slate-400">{label}</p><p className="mt-2 font-mono text-xl text-white">{value}</p></div>)}
    </div>
    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
      <section className="min-w-0"><h3 className="mb-3 font-semibold">{zh ? "这一节的赛道" : "This session's track"}</h3>
        {points.length > 2 ? <svg viewBox={`${left} ${top} ${width} ${height}`} role="img" aria-label={zh ? "真实 GPS 轨迹" : "Recorded GPS trace"} className="h-72 w-full bg-black/20"><polyline points={points.map(p => `${p.local_x_m},${-p.local_y_m!}`).join(" ")} fill="none" stroke="#35d6d0" strokeWidth={3} /><circle cx={points[0].local_x_m!} cy={-points[0].local_y_m!} r={5} fill="#f6c945" /></svg> : <p className="py-12 text-slate-400">{zh ? "GPS 轨迹不可用" : "GPS track unavailable"}</p>}
        <div className="mt-4 flex flex-wrap gap-4 text-xs">{[["GPS", analysis.capabilities.gps], ["RPM", analysis.capabilities.rpm], [zh ? "直接刹车通道" : "Direct brake", analysis.capabilities.direct_brake]].map(([label, available]) => <span key={String(label)} className={available ? "text-cyan-200" : "text-slate-500"}>{label} · {available ? (zh ? "可用" : "Available") : (zh ? "未提供" : "Unavailable")}</span>)}</div>
      </section>
      <section className="min-w-0"><h3 className="mb-3 font-semibold">{zh ? "真实单圈" : "Recorded laps"}</h3><div className="max-h-80 overflow-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-[#111820] text-xs text-slate-400"><tr><th className="py-2">Lap</th><th>{zh ? "圈速" : "Time"}</th><th>{zh ? "参考资格" : "Reference eligibility"}</th></tr></thead><tbody>{analysis.lap_quality.laps.map(l => <tr key={l.lap} className="border-t border-slate-800"><td className="py-2">L{l.lap}{l.lap === best?.lap ? " ★" : ""}</td><td className="font-mono">{l.lap_time.toFixed(3)}s</td><td className={l.analysis_eligible ? "text-cyan-200" : "text-slate-500"}>{l.analysis_eligible ? (zh ? "有效" : "Eligible") : (zh ? "不作参考" : "Excluded")}</td></tr>)}</tbody></table></div></section>
    </div>
    <div className="flex min-w-0 items-center gap-3 border-y border-slate-700 py-4"><Video size={20} className="shrink-0 text-[#f6c945]" /><div className="min-w-0"><p className="break-all text-sm">{videoName || (zh ? "未选择视频，可在下一步添加" : "No video selected; add it in the next step")}</p><p className="mt-1 text-xs text-slate-400">{videoDuration > 0 ? `${videoDuration.toFixed(1)} s · ` : ""}{zh ? "本地视频不上传；GPS / RPM 等通道按实际素材提供。" : "Video stays local; GPS / RPM depend on the recorded channels."}</p></div></div>
  </div>;
}

export function GuidedDebrief({ analysis, receipts, corner, coachEvidence = [], onReview }: { analysis: XrkAnalysis; receipts: ReviewReceipt[]; corner: SelectedCornerResult | null; coachEvidence?: RecommendedCoachEvidence[]; onReview: () => void }) {
  const { locale } = useI18n(), zh = locale === "zh";
  const result = buildGuidedDebrief(selectCoachReviews(analysis), receipts);
  const coachRows = selectCoachReviews(analysis).map(review => coachEvidence.find(e => e.id === review.id)
    ?? { id: review.id, name: review.name, comparison: null, videoConfirmed: false, contextComplete: false });
  const coachText = coachRows.map(row => ({ id: row.id, lines: coachObservation(row, zh) }));
  const coachCaution = zh ? "这些区段采用各自同一组空间门计时，不与原共识成绩混算，也不相加成目标圈速。人工锚点和 ±0.5 秒范围保持不变，GPS 异常不能通过人工确认解除。RPM差异不等于刹车或油门原因。" : "Each section uses its own shared spatial gates. These deltas are separate from consensus scores and are not summed into a target lap. Manual anchors and ±0.5s remain; confirmation cannot clear GPS warnings. RPM differences do not establish pedal causes.";
  const name = (s: string) => zh ? s.replace(/^Suggested Zone\s+/i, "建议区间 ").replace(/^Zone\s+/i, "区间 ") : s;
  const topLaps = analysis.lap_quality.top_valid_laps.filter(l => l.analysis_eligible).slice(0, 3)
    .map(l => `L${l.lap} · ${l.lap_time.toFixed(3)}s`).join(" / ");
  const lapSummary = (zh ? "真实有效快圈：" : "Real eligible fast laps: ") + (topLaps || (zh ? "暂无" : "Unavailable"));
  const observation = (r: typeof result.strengths[number]) => zh
    ? `${name(r.name)}：目标圈 L${r.targetLap} 相比 L${r.referenceLap}，连同下游${r.netLoss > 0 ? "慢" : "快"} ${Math.abs(r.netLoss).toFixed(3)} 秒。`
    : `${r.name}: L${r.targetLap} is ${Math.abs(r.netLoss).toFixed(3)}s ${r.netLoss > 0 ? "slower" : "faster"} than L${r.referenceLap} including downstream.`;
  const sections = [
    { title: zh ? "这次做得好的地方" : "What went well", rows: result.strengths.map(observation), empty: zh ? "还没有两侧均确认的优势片段。" : "No advantage clip has both sides confirmed yet." },
    { title: zh ? "值得继续核对的提升机会" : "Opportunities to investigate", rows: result.opportunities.map(observation), empty: zh ? "尚无两侧均确认的提升片段，不生成确定建议。" : "No opportunity has both clips confirmed; no definitive advice is generated." },
  ];
  const next = coachRows.flatMap(row => {
    const c = row.comparison;
    if (!row.videoConfirmed || !row.contextComplete || c?.status !== "available" || c.combined_gain_s === null) return [];
    return [zh ? `${name(row.name)}：先与教练回看 L${c.section.lap} / L${c.overall.lap} 的速度差从哪里开始。${c.combined_gain_s > 0 ? "这次局部优势保持到了下游，但不代表可以直接复制动作。" : "局部优势没有保持到下游，不把局部更快当作改进目标。"}一次只测试一项调整，比较同一区段和下游用时；出现不稳定就停止。`
      : `${row.name}: review where the speed difference begins in L${c.section.lap} / L${c.overall.lap} with your coach. ${c.combined_gain_s > 0 ? "The local gain lasted downstream this time, but that does not validate copying an action." : "The local gain did not last downstream; do not target the local time alone."} Test one change, compare the same section and downstream, and stop if unstable.`];
  }).slice(0, 3);
  const confirmedCoaches = coachRows.filter(row => row.videoConfirmed);
  const nextEmpty = confirmedCoaches.length && confirmedCoaches.every(row => row.comparison?.status === "same_lap")
    ? (zh ? "已核对区段的最快圈也是整圈最快圈，暂没有另一种更快开法的证据。可继续核对其他候选圈，不为填满建议而要求改变动作。" : "In the checked sections, the section winner is also the full-lap winner. There is no evidence of an alternative faster style; review other candidates before changing an action.")
    : confirmedCoaches.length
    ? (zh ? "已核对的片段尚不足以形成完整训练对照。先补齐减速、出弯或下游证据；不据局部更快直接要求更晚刹车。" : "Checked clips do not yet support a complete training comparison. Resolve missing approach, exit or downstream evidence before changing driving actions.")
    : (zh ? "先核对教练对照的两圈首尾画面，再与教练选择要测试的动作。" : "Check both coach-comparison videos at their boundaries, then choose a test with your coach.");
  const custom = !corner ? (zh ? "未完成自选弯道分组，或确认已变更。" : "Custom-corner grouping is incomplete or confirmations have changed.")
    : corner.patterns.status === "exploratory_groups" ? (zh ? `已确认 ${corner.patterns.confirmed_laps.length} 圈，观察到 ${corner.patterns.groups.length} 组开法；仅为本节描述性分组。` : `${corner.patterns.confirmed_laps.length} confirmed laps, ${corner.patterns.groups.length} exploratory groups; descriptive only.`)
    : corner.patterns.status === "no_clear_separation" ? (zh ? "已确认样本未发现清晰分开的开法，不强行分类。" : "Confirmed samples show no clear pattern separation.")
    : (zh ? "可用确认圈不足，暂不分类。" : "Too few confirmed laps to group.");
  const pending = zh ? `原目标圈对照：${result.pending.length} 个片段待确认；${result.rejected.length} 个已否定，不纳入建议。` : `Original target-lap comparisons: ${result.pending.length} pending; ${result.rejected.length} rejected and excluded from advice.`;
  const pendingNames = result.pending.map(r => `${name(r.name)} · L${r.referenceLap} / L${r.targetLap}`).join("; ");
  function download() {
    const text = [zh ? "本节复盘" : "Session debrief", lapSummary, zh ? "时间优势在哪里建立、是否保持" : "Where time is gained and whether it lasts", ...coachText.flatMap(row => row.lines), coachCaution, ...sections.flatMap(s => [s.title, ...(s.rows.length ? s.rows : [s.empty])]), zh ? "下一次训练" : "Next session", ...(next.length ? next : [nextEmpty]), custom, pending, pendingNames,
      zh ? "圈间差异不证明动作因果，不相加为目标圈速。视频未上传。" : "Observed differences are not causal and are not added into a target lap. Video was not uploaded."].join("\n\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "session-debrief.md"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="space-y-6" data-testid="guided-debrief">
    <div className="flex flex-wrap items-center justify-between gap-3"><span className="flex items-center gap-2 text-sm text-cyan-200"><FileCheck2 size={18} />{zh ? "来自本次复盘的确认记录" : "Based on this review's confirmations"}</span><button className={guideButton} onClick={download}><Download size={16} />{zh ? "保存总结" : "Save debrief"}</button></div>
    <p className="font-mono text-sm text-slate-300">{lapSummary}</p>
    <section className="space-y-4 border-t border-slate-700 pt-5" data-testid="debrief-coach-evidence"><h3 className="text-lg font-semibold">{zh ? "时间优势在哪里建立、是否保持" : "Where time is gained and whether it lasts"}</h3>
      {coachText.map(row => <div key={row.id} className="space-y-2 border-b border-slate-800 pb-4">{row.lines.map((line, i) => <p key={i} className={i < 2 ? "text-sm text-cyan-100" : "text-xs text-slate-400"}>{line}</p>)}</div>)}
      {!coachText.length && <p className="text-sm text-slate-400">{zh ? "当前没有可用推荐区段。" : "No recommended section is available."}</p>}
      <p className="text-xs text-amber-200">{coachCaution}</p><button className={guideButton} onClick={onReview}><Video size={16} />{zh ? "回看教练对照" : "Return to coach comparison"}</button>
    </section>
    <details className="space-y-4 border-t border-slate-700 pt-4"><summary className="cursor-pointer text-sm text-slate-400">{zh ? "原目标圈对照的确认记录" : "Original target-lap confirmation records"}</summary>{sections.map(s => <section key={s.title} className="border-t border-slate-700 pt-5"><h3 className="mb-3 text-lg font-semibold">{s.title}</h3>{s.rows.length ? <ul className="space-y-3">{s.rows.map(row => <li key={row} className="flex items-start gap-2 text-sm text-slate-200"><Check size={16} className="mt-1 shrink-0 text-cyan-300" />{row}</li>)}</ul> : <p className="text-sm text-slate-400">{s.empty}</p>}</section>)}</details>
    <section className="border-t border-slate-700 pt-5"><h3 className="mb-3 text-lg font-semibold">{zh ? "下一次训练重点" : "Next training focus"}</h3>{next.length ? <ul className="space-y-3 text-sm text-slate-200">{next.map(row => <li key={row}>{row}</li>)}</ul> : <p className="text-sm text-slate-400">{nextEmpty}</p>}</section>
    <section className="border-t border-slate-700 pt-5"><h3 className="mb-3 font-semibold">{zh ? "自选弯道与待确认事项" : "Your corner and open questions"}</h3><p className="text-sm text-slate-300">{custom}</p><p className="mt-2 text-sm text-amber-200">{pending}</p>{pendingNames && <p className="mt-2 text-sm text-slate-400">{pendingNames}</p>}<button className={`${guideButton} mt-4`} onClick={onReview}>{zh ? "返回核对片段" : "Review the clips"}<ArrowRight size={16} /></button></section>
    <p className="text-xs text-amber-200">{zh ? "人工起点仍有 ±0.5 秒不确定性，GPS 异常提示不会因片段确认而解除。原目标圈记录沿用原分析区间计时；教练对照采用画面下标出的同一组空间门，不改变原共识成绩。" : "Manual starts retain ±0.5s uncertainty; clip confirmation never clears GPS warnings. Original target-lap records retain their original intervals; coach comparisons use the shared spatial gates shown below the videos, without changing consensus scores."}</p>
    <p className="text-xs text-slate-500">{zh ? "人工确认只说明片段对应，不证明刹车或油门原因。差异不相加为目标圈速；AI 建议请与教练核实。" : "Clip confirmation does not establish pedal causes. Differences are not added into a target lap; validate advice with your coach."}</p>
  </div>;
}
