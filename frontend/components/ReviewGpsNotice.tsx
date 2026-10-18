"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
import type { VideoIdentity } from "../lib/manualReview";
import { parseReviewGpsEvidence, reviewGpsKey, reviewGpsOverlaps, REVIEW_GPS_EVENT } from "../lib/reviewGpsEvidence";

export function ReviewGpsNotice({ fingerprint, video, start, end, offset }: {
  fingerprint: string; video: VideoIdentity; start: number; end: number; offset: number | null;
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  const [raw, setRaw] = useState<string | null>(null);
  useEffect(() => {
    const read = () => { try { setRaw(localStorage.getItem(reviewGpsKey(fingerprint))); } catch { setRaw(null); } };
    queueMicrotask(read); window.addEventListener(REVIEW_GPS_EVENT, read); window.addEventListener("storage", read);
    return () => { window.removeEventListener(REVIEW_GPS_EVENT, read); window.removeEventListener("storage", read); };
  }, [fingerprint]);
  const evidence = parseReviewGpsEvidence(raw, video);
  const segments = offset === null ? [] : reviewGpsOverlaps(evidence, start - .5, end + .5, offset);
  const failed = segments.filter(s => s.status === "gps_inconsistent");
  return <div className="mt-2 text-xs text-amber-200" data-testid="review-gps-notice">
    {failed.length ? <><p>{zh ? "本片段涉及 GPS 信号异常区间，人工确认仍可用于复盘；自动同步未通过。" : "This clip overlaps GPS signal disagreement. Manual review remains available; automatic synchronization has not passed."}</p>
      {failed.map((s, i) => <p key={i}>GPS · {s.video_range_s[0].toFixed(2)}–{s.video_range_s[1].toFixed(2)}s</p>)}</>
      : <p className="text-slate-400">{!evidence || offset === null || !segments.length
        ? (zh ? "此片段暂无可用 GPS 分段校验；人工确认不代表 GPS 校验通过。" : "No usable segmented GPS check for this clip. Manual confirmation is not a GPS pass.")
        : (zh ? "本片段未触及已标出的 GPS 异常区间；拟合、未检验区间不算通过，参照物匹配也不改变 GPS 结论。" : "No flagged GPS disagreement overlaps this clip. Fitted or untested intervals are not passes; visual matching does not change GPS results.")}</p>}
  </div>;
}
