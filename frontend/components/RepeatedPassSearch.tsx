"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { findRepeatedPasses, type RepeatedPass } from "../lib/repeatedPasses";

/** Candidate gallery is scoped to files and keyframe by the parent's React key. */
export function RepeatedPassSearch({ source, target, onPreview, onUse }: {
  source: { url: string; start: number; file?: File }; target: { url: string; duration: number; file?: File };
  onPreview: (time: number) => void; onUse: (time: number) => void;
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  const [rows, setRows] = useState<RepeatedPass[]>([]), [busy, setBusy] = useState(false);
  const [fraction, setFraction] = useState(0), [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState<string[]>([]), [rejected, setRejected] = useState<string[]>([]);
  const [mode, setMode] = useState(""), [excluded, setExcluded] = useState(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function search() {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(""); setRows([]); setConfirmed([]); setRejected([]); setFraction(0); setMode(""); setExcluded(0);
    try {
      const result = await findRepeatedPasses(source, target, abort.signal, setFraction);
      if (!abort.signal.aborted) {
        setRows(result.passes); setMode(result.mode); setExcluded(result.excluded);
        if (!result.passes.length) setError(zh ? "没有可靠候选。可以在此视频独立选择起点；不同机位的外观可能无法匹配。" : "No reliable candidates. Select an independent start in this video; different camera views may not match.");
        if (result.truncated) setError(zh ? "候选超过 60 个，仅列出前 60 个，请缩小素材范围。" : "More than 60 candidates; only the first 60 are listed.");
      }
    } catch {
      if (!abort.signal.aborted) setError(zh ? "未完成本地画面搜索。需可解码、5 秒至 30 分钟的视频；仍可人工选择。" : "Local search failed. Use a decodable 5-second to 30-minute video, or select manually.");
    } finally { if (controller.current === abort) setBusy(false); }
  }
  const button = "inline-flex min-h-10 items-center gap-2 rounded border border-slate-600 px-3 py-2 text-xs disabled:opacity-40";
  return <section className="space-y-3 border-t border-slate-700 pt-3" aria-label={zh ? "同一弯道多次经过" : "Repeated corner passes"}>
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void search()}><Search size={16} />{zh ? "查找这节所有相似起点" : "Find matching starts in this recording"}</button>
      {busy && <button className={button} onClick={() => { controller.current?.abort(); setBusy(false); }}><X size={16} />{zh ? "取消" : "Cancel"}</button>}</div>
    {busy && <progress aria-label={zh ? "关键帧搜索" : "Keyframe search"} className="w-full" value={fraction} max={1} />}
    <p className="text-xs text-slate-400">{zh ? "画面候选，不代表完整圈数或定位已通过。每段起点后 5 秒；请核对同一参照物。结尾相似度仅辅助观察，不要求不同车速到达同一终点。" : "Appearance candidates, not verified lap identities or complete coverage. Each clip is start +5s. Confirm the landmark; endpoint similarity is advisory because speeds differ."}</p>
    {mode && <p className="text-xs text-amber-200">{mode === "gps_then_visual" ? (zh ? "GoPro GPS 筛选位置，画面二次核对；GPS 异常 / 缺口未补值。" : "GoPro GPS narrows position, followed by visual review. GPS gaps/anomalies are not filled.") : (zh ? "没有可用的双侧 GPS，仅列出达到画面门槛的候选；不同机位可独立选帧。" : "No usable paired GPS; only appearance-gated candidates are shown. Select an independent keyframe for a different view.")}
      {excluded > 0 && (zh ? ` 已排除 ${excluded} 个不合格${mode === "gps_then_visual" ? "GPS 步长" : "画面候选"}。` : ` Excluded ${excluded} invalid ${mode === "gps_then_visual" ? "GPS steps" : "appearance candidates"}.`)}</p>}
    {rows.length > 0 && <p className="text-sm">{zh ? `找到 ${rows.length} 个候选 · 已确认 ${confirmed.length}` : `${rows.length} candidates · ${confirmed.length} confirmed`}</p>}
    <div className="grid max-h-[560px] gap-3 overflow-y-auto sm:grid-cols-2">{rows.filter(r => !rejected.includes(r.id)).map(row => <article key={row.id} className="min-w-0 rounded border border-slate-700 p-2">
      <button className="block w-full text-left" onClick={() => onPreview(row.start_s)}>
        {/* Local decoded frame; never uploaded or sent to an external image optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={row.thumbnail} alt={`${zh ? "候选起点" : "Candidate start"} ${row.start_s.toFixed(2)}s`} className="aspect-video w-full object-contain" />
        <span className="font-mono text-xs">{row.start_s.toFixed(2)}–{row.end_s.toFixed(2)}s</span></button>
      <p className="my-1 text-xs text-slate-400">{row.status === "ambiguous" ? (zh ? "多义候选，需人工核对" : "Ambiguous; review required") : (zh ? "相似画面候选" : "Similar-frame candidate")}</p>
      <div className="flex flex-wrap gap-2"><button className={button} onClick={() => { setConfirmed(ids => ids.includes(row.id) ? ids : [...ids, row.id]); onUse(row.start_s); }}><Check size={14} />{zh ? "同一位置，使用" : "Same location, use"}</button>
        <button className={button} aria-label={zh ? "否定此候选" : "Reject candidate"} onClick={() => { setRejected(ids => [...ids, row.id]); setConfirmed(ids => ids.filter(id => id !== row.id)); }}><X size={14} /></button></div>
    </article>)}</div>
    {error && <p role="status" className="text-xs text-amber-200">{error}</p>}
  </section>;
}
