"use client";

import { useEffect, useRef, useState } from "react";
import { ScanEye, X } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { checkReviewBoundaries } from "../lib/reviewBoundaryVisual";

export type BoundaryVideo = { url: string; start: number; end?: number; duration: number; lap: number; confirmed: boolean; label?: string };
type Result = Awaited<ReturnType<typeof checkReviewBoundaries>>;

/** Read-only visual evidence: no calibration setters or storage writes are accepted here. */
export function ReviewBoundaryCheck({ reference, target, onSeek }: { reference: BoundaryVideo; target: BoundaryVideo; onSeek: (time: number) => void }) {
  const { locale } = useI18n(), zh = locale === "zh";
  const [result, setResult] = useState<Result | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function run() {
    const controller = new AbortController(); abort.current = controller;
    setBusy(true); setError(false); setResult(null);
    try { const next = await checkReviewBoundaries(reference, target, controller.signal); controller.signal.throwIfAborted(); setResult(next); }
    catch { if (!controller.signal.aborted) setError(true); }
    finally { if (abort.current === controller) setBusy(false); }
  }
  return <section className="mt-4 border-t border-slate-700 pt-4" data-testid="review-boundary-check" aria-label={zh ? "参照物二次核对" : "Boundary landmark check"}>
    <div className="flex flex-wrap items-center gap-3">
      <button disabled={busy} onClick={run} className="flex min-h-10 items-center gap-2 rounded border border-cyan-700 px-3 text-sm disabled:opacity-40"><ScanEye size={16} />{busy ? (zh ? "核对画面中…" : "Checking frames…") : (zh ? "核对起点与终点画面" : "Check start and end frames")}</button>
      {busy && <button onClick={() => abort.current?.abort()} className="flex min-h-10 items-center gap-1 text-sm"><X size={16} />{zh ? "取消" : "Cancel"}</button>}
    </div>
    <p className="mt-2 text-xs text-slate-400">{zh ? "起点仍保留人工估计 ±0.5 秒。二次核对不修改锚点；终点只作复核，不要求再次标记。" : "Manual start uncertainty remains ±0.5s. This check never edits anchors; the endpoint is review-only, with no second mark required."}</p>
    {(!reference.confirmed || !target.confirmed) && <p className="mt-2 text-xs text-amber-200">{zh ? "包含计时推算片段，画面相似不能代替圈号与位置的人工确认。" : "Includes timing-based clips. Similar images cannot replace manual lap and location confirmation."}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-amber-200">{zh ? "未能读取核对画面；人工锚点未改动。" : "Frames could not be read; manual anchors are unchanged."}</p>}
    {result && <>
      <p role="status" className="mt-3 text-sm text-cyan-200">{result.start.status === "candidate"
        ? (zh ? "找到一致的画面候选，仍需你确认。" : "Consistent visual candidate found; your confirmation is still required.")
        : result.start.status === "ambiguous" ? (zh ? "相似画面不唯一，或左右背景不一致，请人工核对起点。" : "Similar frames are ambiguous or the two background regions disagree. Check the start manually.")
        : (zh ? "背景证据不足，请人工核对起点。" : "Insufficient background evidence. Check the start manually.")}</p>
      {[0, 1].map(index => <div key={index} className="mt-3">
        <h6 className="mb-2 text-sm text-slate-300">{index === 0 ? (zh ? "起点" : "Start") : (zh ? "片段终点" : "Clip end")}</h6>
        <div className="grid grid-cols-2 gap-3">{(["reference", "target"] as const).map(side => <figure key={side} className="min-w-0">
          {/* Local decoded images must not pass through the remote image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result[side][index].url} alt={`${side === "reference" ? (zh ? "参考" : "Reference") : (zh ? "目标" : "Selected")} ${index === 0 ? "start" : "end"}`} className="aspect-video w-full object-contain" />
          <figcaption className="mt-1 text-xs text-slate-400">{(side === "reference" ? reference : target).label ?? `L${side === "reference" ? reference.lap : target.lap}`} · {result[side][index].time.toFixed(3)}s</figcaption>
        </figure>)}</div>
      </div>)}
      {result.start.time !== null && <button className="mt-3 min-h-10 rounded border border-slate-600 px-3 text-sm" onClick={() => onSeek(result.start.time!)}>{zh ? "仅查看建议帧" : "View suggested frame only"} · {result.start.time.toFixed(3)}s</button>}
      <p className="mt-2 text-xs text-amber-200">{result.endpoint.every(s => s !== null && s >= .72)
        ? (zh ? "终点背景较相似，可对照上图复核；不代表同步通过。" : "Endpoint backgrounds are similar; review the frames above. This is not a synchronization pass.")
        : (zh ? "终点背景相似证据不足，请看上图复核，无需另设终点。" : "Endpoint background evidence is weak. Review the frames above; no second endpoint mark is required.")}</p>
      <p className="mt-2 text-xs text-slate-400">{zh ? "仅比较两侧背景区域，不识别树或标志物的身份。遮挡、重复背景及不同走线会影响结果；画面相似不代表精确同步。" : "Compares two background regions, without recognizing object identity. Occlusion, repeated scenery and different lines affect results; similarity does not establish precise synchronization."}</p>
      <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer py-2">{zh ? "相似度详情（不是准确率）" : "Similarity detail (not accuracy)"}</summary>
        <p>{zh ? "后续两帧一致性" : "Following two-frame consistency"}: {result.sequence?.consistent ? (zh ? "候选一致" : "Candidate consistent") : (zh ? "未证实" : "Unverified")}</p>
        <p>NCC · {zh ? "起点左右背景" : "Start left/right"}: {result.start.regions.map(r => r.candidate?.score.toFixed(3) ?? "—").join(" / ")}</p>
        <p>NCC · {zh ? "终点左右背景" : "End left/right"}: {result.endpoint.map(s => s?.toFixed(3) ?? "—").join(" / ")}</p>
      </details>
    </>}
  </section>;
}
