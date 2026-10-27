"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Download, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { loadPublishedCoach, publishedCoachEvidence, type PublishedCoachData, type PublishedCoachSection } from "../lib/publishedCoach";
import { coachObservation } from "../lib/recommendedCoach";
import type { ReviewStep } from "../lib/guidedReview";
import { cornerTelemetryDomains } from "../lib/selectedCorner";
import { ReviewSteps, GuidedOverview } from "./GuidedReview";
import { PublishedClip } from "./PublishedVideoReview";
import { CornerCandidateNavigation } from "./SelectedCornerTelemetry";
import { CornerCoachComparison } from "./CornerCoachComparison";

export function PublishedGuidedReview() {
  const { locale } = useI18n(), zh = locale === "zh";
  const [data, setData] = useState<PublishedCoachData | null>(null), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    loadPublishedCoach(controller.signal).then(setData).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [retry]);
  if (!data) return <section className="py-10" role="status">{error ? (zh ? "公开样例版本不一致或暂不可用。" : "Published sample versions differ or are unavailable.") : (zh ? "正在读取已发布素材…" : "Loading published material…")}
    {error && <button className="ml-3 underline" onClick={() => { setError(false); setRetry(n => n + 1); }}>{zh ? "重试" : "Retry"}</button>}</section>;
  return <PublishedGuidedContent data={data} />;
}

export function PublishedGuidedContent({ data, initialStep = 0 }: { data: PublishedCoachData; initialStep?: ReviewStep }) {
  const { locale } = useI18n(), zh = locale === "zh";
  const [step, setStep] = useState(initialStep), [sectionId, setSectionId] = useState(data.evidence.sections[0].id);
  const root = useRef<HTMLElement>(null);
  const section = data.evidence.sections.find(s => s.id === sectionId)!;
  const evidence = data.evidence.sections.map(s => publishedCoachEvidence(s, zh));
  const best = data.analysis.lap_quality.top_valid_laps.filter(l => l.analysis_eligible).toSorted((a, b) => a.lap_time - b.lap_time)[0];
  const bestLabel = best ? `L${best.lap} · ${best.lap_time.toFixed(3)}s` : "—";
  const boundary = zh
    ? "只使用已获准公开的 3 组 × 3 圈短片与匿名遥测。GPS 异常提示和原始人工锚点 ±0.5秒保留；未对全片或每个候选作人工确认。"
    : "Only the previously approved 3 sections × 3 laps and anonymous telemetry are used. GPS warnings and the original manual ±0.5s anchor remain; the full recording and individual candidates are not independently confirmed.";
  const sampling = zh
    ? "本页重算基于已发布的距离采样网格，不是原生采样。下游约50m仅有遥测，没有公开视频校验；短片不覆盖完整减速到出弯，不能据此确定最佳动作。"
    : "Recomputed from the published distance grid, not native samples. The next ~50m has telemetry but no published video validation. Excerpts do not cover the full deceleration-to-exit sequence and cannot establish the best technique.";
  function go(next: number) {
    if (!Number.isInteger(next) || next < 0 || next > 5) return;
    root.current?.querySelectorAll("video").forEach(v => v.pause());
    setStep(next as ReviewStep);
    root.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  function download() {
    const text = [zh ? "# 已发布样例 · 本节总结" : "# Published sample · Debrief", boundary, sampling,
      ...evidence.map(e => `## ${e.name}\n${coachObservation(e, zh).join("\n\n")}`),
      zh ? "没有已验证的驾驶动作或训练收益；没有生成理论参考圈。" : "No driving action or training benefit is validated; no theoretical reference lap is generated."].join("\n\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `published-coach-${locale}.md`; link.click(); URL.revokeObjectURL(url);
  }
  return <section ref={root} className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-7" data-testid="published-guided-review">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs text-cyan-300">{zh ? "已发布真实数据 · 只读样例" : "Published real data · Read-only sample"}</p><h1 className="mt-2 text-2xl font-semibold text-white">{zh ? "六步教练复盘" : "Six-step coach review"}</h1></div>
      <div className="flex flex-wrap gap-4 text-sm text-cyan-200"><a href="/review">{zh ? "开始自己的复盘" : "Start your review"}</a><a href="/workspace?demo=1">{zh ? "自由工作台" : "Free workspace"}</a></div></header>
    <ReviewSteps step={step} hasData onStep={go} />
    <p className="text-xs leading-5 text-slate-400">{boundary}</p>
    {step === 0 && <section className="space-y-4" aria-label={zh ? "样例素材" : "Sample material"}>
      <h2 className="text-xl font-semibold">{zh ? "素材已就绪" : "Material ready"}</h2>
      <div className="grid gap-6 border-y border-slate-700 py-5 md:grid-cols-2"><div><h3 className="font-semibold">AiM · {zh ? "匿名遥测" : "Anonymous telemetry"}</h3><p className="mt-2 text-sm text-slate-300">{data.analysis.lap_rows.length} {zh ? "记录圈" : "recorded laps"} · {data.analysis.lap_quality.reference_eligible_count} {zh ? "个有效参考圈" : "eligible references"}</p><p className="mt-1 font-mono text-cyan-200">{bestLabel}</p></div>
        <div><h3 className="font-semibold">GoPro · {zh ? "已发布车载摘录" : "Published onboard excerpts"}</h3><p className="mt-2 text-sm text-slate-300">L4 / L5 / L6 · 3 × 3 · 5s</p><p className="mt-1 text-sm text-slate-400">{zh ? "原声、GPS 速度、AiM 速度 / RPM" : "Original audio, GPS speed, AiM speed / RPM"}</p></div></div>
      <p className="text-sm text-slate-400">{zh ? "未载入私人原片；样例不保存锚点、教练投票或训练标签。" : "No private originals loaded. This demo saves no anchors, coach votes or training labels."}</p>
    </section>}
    {step === 1 && <GuidedOverview analysis={data.analysis} videoName={zh ? "已发布短片（非完整原片）" : "Published excerpts (not the full original)"} videoDuration={5} />}
    {step === 2 && <section className="space-y-4" data-testid="published-anchor-boundary">
      <h2 className="text-xl font-semibold">{zh ? "原始人工配对 · 只读" : "Original manual pairing · Read-only"}</h2>
      <dl className="grid grid-cols-2 gap-4 border-y border-slate-700 py-5 text-sm"><div><dt className="text-slate-400">AiM {zh ? "圈号" : "lap"}</dt><dd className="mt-1 font-mono">L{data.review.anchor_lap}</dd></div><div><dt className="text-slate-400">{zh ? "原视频起点" : "Original video start"}</dt><dd className="mt-1 font-mono">{data.review.anchor_video_start_s.toFixed(2)}s ±0.5s</dd></div><div><dt className="text-slate-400">{zh ? "视频相对遥测偏移" : "Video minus telemetry offset"}</dt><dd className="mt-1 font-mono">+{data.review.offset_s.toFixed(3)}s</dd></div><div><dt className="text-slate-400">{zh ? "整段自动校验" : "Whole-recording validation"}</dt><dd className="mt-1 text-amber-200">{zh ? "未通过整段验证" : "Not fully validated"}</dd></div></dl>
      <p className="text-sm text-amber-200">{zh ? "公开片段不包含起终点线的完整过线画面，不能在此重新确认或修改原锚点。" : "Published clips do not include complete timing-line crossings. The original anchor cannot be reconfirmed or edited here."}</p>
    </section>}
    {(step === 3 || step === 4) && <>
      <h2 className="text-xl font-semibold">{step === 3 ? (zh ? "推荐复盘 · 已发布区段摘录" : "Recommended review · Published excerpts") : (zh ? "自选弯道 · 浏览已发布候选" : "Selected corner · Browse published candidates")}</h2>
      <div className="flex flex-wrap gap-2" role="group" aria-label={zh ? "公开区段" : "Published section"}>{data.evidence.sections.map((s, i) => <button key={s.id} aria-pressed={s.id === sectionId} onClick={() => setSectionId(s.id)} className={`rounded border px-3 py-2 text-sm ${s.id === sectionId ? "border-yellow-400 bg-yellow-400 text-black" : "border-slate-600 text-slate-300"}`}>Sector {i + 1} · {zh ? "摘录" : "excerpt"}</button>)}</div>
      <PublishedCoachExplorer key={section.id} section={section} data={data} />
      {step === 4 && <p className="text-sm text-amber-200">{zh ? "公开素材只有这三组区段、每段三圈；不足以验证常用开法分类。任意选弯和跨圈参照物搜索需要在本地导入完整视频。" : "The public material contains only these three sections and three laps each, insufficient to validate driving-style groups. Arbitrary corner selection and cross-lap landmark search require a full local video."}</p>}
    </>}
    {step === 5 && <section className="space-y-5" data-testid="published-debrief">
      <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{zh ? "本节总结 · 与推荐复盘同一证据" : "Debrief · Same evidence as recommended review"}</h2><button onClick={download} className="inline-flex items-center gap-2 rounded border border-slate-600 px-3 py-2 text-sm"><Download size={16} />{zh ? "导出总结" : "Export debrief"}</button></header>
      <p className="text-sm text-emerald-200">{zh ? "真实整圈最快：" : "Fastest real full lap: "}{bestLabel}{zh ? "。局部更快不等于整圈更快，也不代表动作已被验证。" : ". A local advantage is not a faster full lap or a validated technique."}</p>
      {evidence.map((e, i) => <article key={e.id} className="space-y-3 border-t border-slate-700 pt-4"><h3 className="font-semibold">Sector {i + 1} · {zh ? "已发布摘录" : "published excerpt"}</h3><div className="space-y-2 text-sm leading-6" data-testid={`published-summary-${e.id}`}>{coachObservation(e, zh).map(line => <p key={line}>{line}</p>)}</div><button onClick={() => { setSectionId(e.id); go(3); }} className="text-sm text-cyan-200 underline">{zh ? "返回这段证据" : "Return to this evidence"}</button></article>)}
      <p className="border-t border-slate-700 pt-4 text-sm text-amber-200">{zh ? "下一步：先核对完整减速到出弯过程及同弯位置，再由教练确认一项调整。现有摘录不支持直接给出刹车点或油门动作处方。" : "Next: verify the full deceleration-to-exit sequence and matching location, then ask a coach to confirm one adjustment. These excerpts cannot prescribe braking or throttle actions."}</p>
      <div className="flex flex-wrap gap-4 text-sm text-cyan-200"><a href="/compare">{zh ? "双车手六步复盘（需两组素材）" : "Two-driver review (requires two datasets)"}</a><a href="/video-coach">{zh ? "独立视频分析" : "Video-only analysis"}</a><a href="/workspace?demo=1">{zh ? "赛道图、单圈对比与完整数据表" : "Track map, lap comparison and data tables"}</a></div>
    </section>}
    {step >= 3 && <p className="text-xs leading-5 text-slate-400">{sampling}</p>}
    <footer className="flex items-center justify-between gap-3 border-t border-slate-700 pt-5"><button disabled={step === 0} onClick={() => go(step - 1)} className="flex min-h-11 items-center gap-2 rounded border border-slate-600 px-4 disabled:opacity-40"><ArrowLeft size={16} />{zh ? "上一步" : "Back"}</button><span className="text-xs text-slate-400">{step + 1} / 6</span><button disabled={step === 5} onClick={() => go(step + 1)} className="flex min-h-11 items-center gap-2 rounded bg-yellow-400 px-4 font-semibold text-black disabled:opacity-40">{zh ? "下一步" : "Next"}<ArrowRight size={16} /></button></footer>
  </section>;
}

function PublishedCoachExplorer({ section, data }: { section: PublishedCoachSection; data: PublishedCoachData }) {
  const { locale } = useI18n(), zh = locale === "zh";
  const evidence = publishedCoachEvidence(section, zh), comparison = evidence.comparison!;
  const laps = section.result.laps.filter(l => l.status === "candidate");
  const first = comparison.status !== "unavailable" ? comparison.section.lap : laps[0]?.lap;
  const [left, setLeft] = useState(first), [right, setRight] = useState(comparison.status === "available" ? comparison.overall.lap : laps.find(l => l.lap !== first)?.lap);
  const [audio, setAudio] = useState<number | null>(0), [error, setError] = useState(false);
  const players = useRef<Array<HTMLVideoElement | null>>([]);
  const register = useCallback((index: number, el: HTMLVideoElement | null) => { players.current[index] = el; }, []);
  const rows = [left, right].map(lap => laps.find(l => l.lap === lap));
  const clips = rows.map(row => data.review.clips.find(c => c.sector_id === section.id && c.lap === row?.lap));
  const domains = cornerTelemetryDomains(rows), limit = Math.max(...rows.map(r => r?.elapsed_s ?? 0));
  async function replay() {
    setError(false);
    try {
      for (const [i, v] of players.current.entries()) if (v && rows[i] && clips[i]) { v.pause(); v.currentTime = rows[i]!.start_session_s! - clips[i]!.telemetry_start_s; }
      await Promise.all(players.current.map(v => v?.play()));
    } catch { setError(true); }
  }
  function pair(a: number, b: number) { players.current.forEach(v => v?.pause()); setLeft(a); setRight(b); }
  return <section className="min-w-0 space-y-5" data-testid="published-coach-explorer">
    <div className="space-y-2 text-sm leading-6 text-cyan-100" data-testid={`published-recommendation-${section.id}`}>{coachObservation(evidence, zh).map(line => <p key={line}>{line}</p>)}</div>
    <CornerCandidateNavigation laps={laps.filter(r => r.lap !== left)} selectedLap={right ?? null} sourceLap={section.result.source_lap} onSelect={lap => pair(left, lap)} />
    <div className="grid min-w-0 gap-5 lg:grid-cols-2">{rows.map((row, i) => row && clips[i] && <figure key={`${i}-${row.lap}`} className="min-w-0"><figcaption className="mb-2 font-semibold">L{row.lap} · {row.elapsed_s!.toFixed(3)}s · {zh ? "共同空间区段" : "Shared spatial section"}</figcaption>
      <PublishedClip clip={clips[i]!} row={row} domains={domains} elapsedLimit={limit} index={i} onVideo={register} active muted={audio !== i} onAudio={setAudio} onError={() => setError(true)} />
      {section.gps_flagged_laps.includes(row.lap) && <p className="mt-2 text-sm text-amber-200">{zh ? "GPS 异常候选：保留显示，不参与最快开法判断。" : "GPS-inconsistent candidate: visible, but excluded from best-technique ranking."}</p>}
    </figure>)}</div>
    <div className="flex flex-wrap gap-2"><button onClick={() => void replay()} className="inline-flex min-h-10 items-center gap-2 rounded border border-cyan-500 px-3 text-cyan-200"><Play size={16} />{zh ? "共同入口并排重播" : "Replay from common entry"}</button><button onClick={() => players.current.forEach(v => v?.pause())} className="inline-flex min-h-10 items-center gap-2 rounded border border-slate-600 px-3"><Pause size={16} />{zh ? "暂停" : "Pause"}</button>
      {[0, 1, null].map((side, i) => <button key={i} aria-pressed={audio === side} onClick={() => setAudio(side)} className={`inline-flex min-h-10 items-center gap-2 rounded border px-3 text-sm ${audio === side ? "border-cyan-400 text-cyan-200" : "border-slate-600"}`}>{side === null ? <VolumeX size={16} /> : <Volume2 size={16} />}{side === null ? (zh ? "静音" : "Mute") : `L${rows[side]?.lap} ${zh ? "声音" : "audio"}`}</button>)}
    </div>
    {error && <p role="alert" className="text-sm text-amber-200">{zh ? "播放失败，可使用原生播放器重试。" : "Playback failed; retry with native video controls."}</p>}
    <p className="text-xs text-slate-400">{zh ? "原短片各5秒；共同空间门位于片段内，实际对照时长按各圈过门时刻计算，不把5秒当作区段圈速。两侧不拉伸，速度/RPM跟随各自时间。" : "Original excerpts are 5s; shared gates lie inside them. Section time comes from each lap's gate crossings, not the fixed clip duration. Videos are not stretched; speed/RPM use each side's clock."}</p>
    <CornerCoachComparison comparison={comparison} onReview={pair} playable={laps.length >= 2} />
  </section>;
}
