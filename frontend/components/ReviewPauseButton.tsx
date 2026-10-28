"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { pauseReviewPlayback, resumeReviewPlayback, reviewPlaybackState, type ReviewPlaybackState, type ReviewPlaybackTarget } from "../lib/reviewPlayback";

export function ReviewPauseButton({ getTargets, className, onPause, onResume, onError, onReplay }: {
  getTargets: () => ReviewPlaybackTarget[]; className: string;
  onPause?: () => void; onResume?: () => void; onError: () => void; onReplay?: () => void;
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  const [state, setState] = useState<ReviewPlaybackState>("unavailable");
  const generation = useRef(0);
  const previous = useRef<ReviewPlaybackTarget[]>([]);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    const targets = getTargets(), events = ["play", "pause", "ended", "seeked", "loadeddata", "emptied", "timeupdate"];
    if (targets.length !== previous.current.length || targets.some((t, i) => t.video !== previous.current[i]?.video
      || !Object.is(t.start, previous.current[i]?.start) || !Object.is(t.end, previous.current[i]?.end))) generation.current++;
    previous.current = targets;
    let live = true;
    const update = () => { if (live) setState(reviewPlaybackState(targets)); };
    queueMicrotask(update);
    targets.forEach(t => events.forEach(event => t.video?.addEventListener(event, update)));
    return () => { live = false; targets.forEach(t => events.forEach(event => t.video?.removeEventListener(event, update))); };
  }, [getTargets]);
  async function toggle() {
    const targets = getTargets(), current = reviewPlaybackState(targets);
    if (current === "playing") { generation.current++; onPause?.(); pauseReviewPlayback(targets); return; }
    if (current === "ended" && onReplay) { onReplay(); return; }
    if (current !== "paused") return;
    const token = generation.current;
    onResume?.();
    try { await resumeReviewPlayback(targets); }
    catch { if (token === generation.current) { onPause?.(); onError(); } }
  }
  const playing = state === "playing", ended = state === "ended";
  return <button className={className} disabled={state === "unavailable" || (ended && !onReplay)} onClick={() => void toggle()}
    data-testid="review-pause-resume" title={ended && !onReplay ? (zh ? "已到片段终点，可使用并排重播" : "Clip ended; use paired replay") : undefined}>
    {playing ? <Pause size={16} /> : <Play size={16} />}
    {playing ? (zh ? "暂停" : "Pause") : ended ? (onReplay ? (zh ? "重播" : "Replay") : (zh ? "播放结束" : "Ended")) : (zh ? "继续播放" : "Resume")}
  </button>;
}
