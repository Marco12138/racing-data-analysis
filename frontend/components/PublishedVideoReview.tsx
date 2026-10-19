"use client";

import { useRef, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { isPublishedVideoReview, type PublishedVideoReview as Review } from "../lib/publishedVideoReview";

/** Read-only real footage. Playback does not confirm sync or submit coach feedback. */
export function PublishedVideoReview({ review }: { review: Review }) {
  const { locale } = useI18n(), zh = locale === "zh";
  const [sectorId, setSectorId] = useState(review.segments[0]?.id);
  const [target, setTarget] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const videos = useRef<Array<HTMLVideoElement | null>>([]);
  if (!isPublishedVideoReview(review)) return null;
  const sector = review.segments.find(s => s.id === sectorId) ?? review.segments[0];
  const reference = sector.winner_laps[0];
  const targetLap = sector.rows.some(r => r.lap === target && r.lap !== reference)
    ? target! : sector.rows.find(r => r.lap !== reference)!.lap;
  const pair = sector.comparisons.find(p => p.target_lap === targetLap);
  const clips = [reference, targetLap].map(lap => review.clips.find(c => c.sector_id === sector.id && c.lap === lap));
  async function replay() {
    setError(false);
    try {
      for (const video of videos.current) { if (video) { video.pause(); video.currentTime = 0; } }
      await Promise.all(videos.current.map(video => video?.play()));
    } catch { setError(true); }
  }
  return <section className="min-w-0 space-y-4 border-y border-slate-700 py-5" data-testid="published-video-review">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-lg font-semibold text-white">{zh ? "真实前三快圈 · 视频复盘" : "Real top-three laps · Video review"}</h3>
      <button className="inline-flex items-center gap-2 rounded border border-slate-600 px-3 py-2 text-sm text-cyan-200" onClick={() => void replay()}><Play size={16} />{zh ? "并排播放" : "Play both"}</button>
    </header>
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex gap-1" role="group" aria-label={zh ? "复盘分段" : "Review sector"}>
        {review.segments.map(s => <button key={s.id} aria-pressed={s.id === sector.id} onClick={() => { setSectorId(s.id); setTarget(null); setError(false); }}
          className={`rounded px-3 py-2 text-sm ${s.id === sector.id ? "bg-yellow-400 text-black" : "border border-slate-600 text-slate-300"}`}>Sector {s.number}</button>)}
      </div>
      <label className="text-xs text-slate-400">{zh ? "对照圈" : "Comparison lap"}<select value={targetLap} onChange={e => { setTarget(Number(e.target.value)); setError(false); }}
        className="ml-2 rounded border border-slate-600 bg-slate-950 p-2 text-sm text-white">
        {sector.rows.filter(r => r.lap !== reference).map(r => <option key={r.lap} value={r.lap}>L{r.lap}</option>)}
      </select></label>
    </div>
    <div className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-sm">
      {sector.rows.map(row => <span key={row.lap} className={row.lap === reference ? "text-emerald-300" : "text-slate-300"}>L{row.lap} · {row.time_s.toFixed(3)}s</span>)}
    </div>
    {pair && <p className="text-sm text-slate-200">{zh
      ? `L${reference} 本段比 L${targetLap} 快 ${pair.local_gain_s.toFixed(3)}s。`
      : `L${reference} is ${pair.local_gain_s.toFixed(3)}s faster than L${targetLap} in this sector.`}
      {pair.net_gain_through_next_s !== null && (zh
        ? `连同下一段，${pair.net_gain_through_next_s < 0 ? "慢" : "快"} ${Math.abs(pair.net_gain_through_next_s).toFixed(3)}s。`
        : ` Across this and the next sector: ${Math.abs(pair.net_gain_through_next_s).toFixed(3)}s ${pair.net_gain_through_next_s < 0 ? "slower" : "faster"}.`)}
    </p>}
    <div className="grid min-w-0 gap-4 md:grid-cols-2">{clips.map((clip, i) => clip && <figure key={clip.url} className="min-w-0">
      <figcaption className="mb-2 text-sm text-white">L{clip.lap} · {i === 0 ? (zh ? "本段最快" : "Fastest split") : (zh ? "对照圈" : "Comparison")}</figcaption>
      <video ref={el => { videos.current[i] = el; }} src={clip.url} poster={clip.poster} controls playsInline muted preload="none"
        className="aspect-video w-full bg-black" onError={() => setError(true)} />
      {clip.gps_warning && <p className="mt-2 text-xs text-amber-200">{zh ? "此片段与 GPS 异常区间重叠，位置仍需人工复核。" : "This clip overlaps a GPS-inconsistent interval; position needs human review."}</p>}
    </figure>)}</div>
    {error && <p role="alert" className="text-sm text-amber-200">{zh ? "视频未能播放，请重试或使用播放器单独播放。" : "Playback failed. Retry or use the individual player controls."}<button className="ml-2 inline-flex items-center gap-1 underline" onClick={() => void replay()}><RotateCcw size={14} />{zh ? "重试" : "Retry"}</button></p>}
    <p className="text-xs leading-5 text-slate-400">{zh
      ? `以人工确认的 L${review.anchor_lap} 起点推算，保留 ±${review.anchor_uncertainty_s.toFixed(1)} 秒误差；每段取后 5 秒。并排播放按相对时间，不是逐帧空间对齐。视频用于观察，不证明全部同步通过。虚拟 Sector 非官方计时点，小差异不等于稳定提升；样例不收集教练投票。`
      : `Extrapolated from the manually anchored L${review.anchor_lap}, retaining ±${review.anchor_uncertainty_s.toFixed(1)}s uncertainty. Each excerpt lasts 5s. Playback uses elapsed time, not frame-by-frame spatial alignment. Video does not prove full synchronization. Virtual sectors are not official gates; small differences do not establish improvement. Demo votes are disabled.`}</p>
  </section>;
}
