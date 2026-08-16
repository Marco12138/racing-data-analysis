"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Play, Scissors, Upload } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useI18n } from "../lib/i18n";
import {
  analyzeLapAudio,
  type LapAudioAnalysis,
} from "../lib/audioRpm";
import {
  buildManualCorner,
  findCornerIssues,
  lateralPositionFromRgba,
  resolveOverlapIssues,
  sampleTimes,
  segmentCorners,
  straightGaps,
  type CornerSegment,
  type LapSample,
} from "../lib/lapVision";

const SAMPLE_FPS = 8;
const OVERLAY_W = 640;
const OVERLAY_H = 360;
const TRACE_ROW = 0.55;

export function VideoCoachExperiment() {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sampleRef = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const [videoUrl, setVideoUrl] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoName, setVideoName] = useState("");
  const [durationS, setDurationS] = useState(0);
  const [videoWidth, setVideoWidth] = useState(0);
  const [videoHeight, setVideoHeight] = useState(0);
  const [lapStart, setLapStart] = useState(0);
  const [lapEnd, setLapEnd] = useState(0);
  const [samples, setSamples] = useState<LapSample[]>([]);
  const [corners, setCorners] = useState<CornerSegment[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState("");
  const [videoError, setVideoError] = useState("");
  const [mediaErrorDetail, setMediaErrorDetail] = useState("");
  const [loading, setLoading] = useState(false);
  const [largeFile, setLargeFile] = useState(false);
  const [fileSizeMb, setFileSizeMb] = useState(0);
  const [draft, setDraft] = useState<{ entry: number | null; apex: number | null; exit: number | null }>({
    entry: null,
    apex: null,
    exit: null,
  });
  const [rpmResult, setRpmResult] = useState<LapAudioAnalysis | null>(null);
  const [rpmAnalyzing, setRpmAnalyzing] = useState(false);
  const [rpmProgress, setRpmProgress] = useState(0);
  const [rpmError, setRpmError] = useState("");
  const [rpmHint, setRpmHint] = useState("");
  const [rpmStrokes, setRpmStrokes] = useState<2 | 4>(2);
  const [rpmReplacePending, setRpmReplacePending] = useState(false);
  const [loopCorner, setLoopCorner] = useState<number | null>(null);
  const videoReady = durationS > 0 && !videoError;
  const issues = useMemo(() => findCornerIssues(corners), [corners]);
  const straights = useMemo(() => straightGaps(corners), [corners]);
  const rpmChartData = useMemo(
    () =>
      rpmResult
        ? rpmResult.times.map((time_s, index) => ({
            time_s,
            rpm: rpmResult.rpm[index],
          }))
        : [],
    [rpmResult],
  );

  useEffect(() => {
    if (!videoUrl) return;
    return () => URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  const drawOverlay = useCallback(() => {
    const video = videoRef.current;
    const canvas = overlayRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, OVERLAY_W, OVERLAY_H);
    ctx.drawImage(video, 0, 0, OVERLAY_W, OVERLAY_H);
    if (!samples.length) return;

    const row = TRACE_ROW * OVERLAY_H;
    ctx.beginPath();
    samples.forEach((sample, index) => {
      const x = sample.lateral * OVERLAY_W;
      if (index === 0) ctx.moveTo(x, row);
      else ctx.lineTo(x, row);
    });
    ctx.strokeStyle = "rgba(53,214,208,0.85)";
    ctx.lineWidth = 2;
    ctx.stroke();

    const nearest = samples.reduce((best, sample) =>
      Math.abs(sample.time_s - currentTime) < Math.abs(best.time_s - currentTime)
        ? sample
        : best
    , samples[0]);
    ctx.beginPath();
    ctx.arc(nearest.lateral * OVERLAY_W, row, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#f6c945";
    ctx.fill();
  }, [samples, currentTime]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay, currentTime]);

  function onFile(file: File | null) {
    if (!file) return;
    const probe = document.createElement("video");
    const h264 = probe.canPlayType('video/mp4; codecs="avc1.42E01E,mp4a.40.2"');
    if (h264 === "") {
      setVideoError(t("videoCoach.codecUnsupported"));
      setVideoName(file.name);
      return;
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(file));
    setVideoFile(file);
    setVideoName(file.name);
    setSamples([]);
    setCorners([]);
    setRpmResult(null);
    setRpmError("");
    setRpmHint("");
    setRpmReplacePending(false);
    setRpmProgress(0);
    setError("");
    setVideoError("");
    setMediaErrorDetail("");
    setLoading(true);
    setLargeFile(file.size > 200 * 1024 * 1024);
    setFileSizeMb(Number((file.size / (1024 * 1024)).toFixed(1)));
  }

  function onLoadedMetadata() {
    const video = videoRef.current;
    if (!video) return;
    setLoading(false);
    setVideoError("");
    setDurationS(video.duration);
    setLapEnd(video.duration);
    setVideoWidth(video.videoWidth);
    setVideoHeight(video.videoHeight);
  }

  function onVideoError() {
    setLoading(false);
    setVideoError(t("videoCoach.loadFailed"));
    const video = videoRef.current;
    if (!video?.error) return;
    const code = video.error.code;
    const codes: Record<number, string> = {
      1: "MEDIA_ERR_ABORTED",
      2: "MEDIA_ERR_NETWORK",
      3: "MEDIA_ERR_DECODE",
      4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
    };
    const message = video.error.message ? `: ${video.error.message}` : "";
    setMediaErrorDetail(`${codes[code] ?? code}${message}`);
  }

  function onTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    if (loopCorner != null) {
      const corner = corners[loopCorner];
      if (corner && video.currentTime > corner.end) {
        video.pause();
        video.currentTime = corner.start;
      }
    }
  }

  const markPhase = useCallback((phase: "entry" | "apex" | "exit") => {
    const video = videoRef.current;
    if (!video || !videoReady) return;
    const time = video.currentTime;
    const next = { ...draft, [phase]: time };
    setDraft(next);
    if (phase !== "exit") return;
    if (next.entry == null || next.apex == null || next.exit == null) return;
    try {
      setCorners((current) => [
        ...current,
        buildManualCorner(next.entry as number, next.apex as number, next.exit as number, current.length + 1),
      ]);
      setDraft({ entry: null, apex: null, exit: null });
      setError("");
    } catch {
      setError(t("videoCoach.markOrder"));
      setDraft({ entry: null, apex: null, exit: null });
    }
  }, [draft, videoReady, t]);

  const markNext = useCallback(() => {
    if (draft.entry == null) markPhase("entry");
    else if (draft.apex == null) markPhase("apex");
    else markPhase("exit");
  }, [draft, markPhase]);

  function onTimelineClick(event: React.MouseEvent<HTMLDivElement>) {
    const bar = timelineRef.current;
    const video = videoRef.current;
    if (!bar || !video || durationS <= 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    video.currentTime = ratio * durationS;
  }

  function resolveOverlaps() {
    setCorners((current) => resolveOverlapIssues(current));
    setError("");
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const video = videoRef.current;
      if (!video || !videoReady) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (video.paused) void video.play();
        else video.pause();
      } else if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        markNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - (event.shiftKey ? 0.1 : 1 / 30));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        video.currentTime = Math.min(video.duration, video.currentTime + (event.shiftKey ? 0.1 : 1 / 30));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [videoReady, markNext]);

  function toggleCornerLoop(index: number) {
    const video = videoRef.current;
    const corner = corners[index];
    if (!video || !corner) return;
    setLoopCorner((current) => {
      if (current === index) return null;
      video.currentTime = corner.start;
      void video.play();
      return index;
    });
  }

  function deleteCorner(index: number) {
    setCorners((current) => current.filter((_, i) => i !== index));
    setLoopCorner(null);
  }

  function resetDraft() {
    setDraft({ entry: null, apex: null, exit: null });
  }

  function seekTo(timeS: number): Promise<void> {
    const video = videoRef.current;
    if (!video) return Promise.reject(new Error("no-video"));
    return new Promise((resolve, reject) => {
      const onSeeked = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("video-error"));
      };
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("seek-timeout"));
      }, 8000);
      const cleanup = () => {
        window.clearTimeout(timer);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("seeked", onSeeked);
      video.addEventListener("error", onError);
      try {
        video.currentTime = timeS;
      } catch {
        cleanup();
        reject(new Error("seek-failed"));
      }
    });
  }

  async function analyzeLap() {
    const video = videoRef.current;
    const sampleCanvas = sampleRef.current;
    if (!video || video.readyState < 1) {
      setError(t("videoCoach.notReady"));
      return;
    }
    if (!video || !sampleCanvas || lapEnd - lapStart < 3) {
      setError(t("videoCoach.needLap"));
      return;
    }
    setAnalyzing(true);
    setError("");
    setSamples([]);
    setCorners([]);
    const ctx = sampleCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      setAnalyzing(false);
      return;
    }
    const width = 160;
    const height = 90;
    sampleCanvas.width = width;
    sampleCanvas.height = height;
    const times = sampleTimes(lapStart, lapEnd, SAMPLE_FPS);
    const found: LapSample[] = [];
    try {
      for (let index = 0; index < times.length; index += 1) {
        await seekTo(times[index]);
        ctx.drawImage(video, 0, 0, width, height);
        const image = ctx.getImageData(0, 0, width, height);
        const lateral = lateralPositionFromRgba(image.data, width, height);
        if (lateral !== null) {
          found.push({ time_s: Number(times[index].toFixed(3)), lateral });
        }
        setProgress((index + 1) / times.length);
      }
    } catch {
      setError(t("videoCoach.analyzeFailed"));
      setAnalyzing(false);
      setProgress(0);
      return;
    }
    setSamples(found);
    setCorners(segmentCorners(found));
    setAnalyzing(false);
    setProgress(0);
    video.currentTime = lapStart;
  }

  function audioErrorText(code: string): string {
    if (code === "NO_AUDIO_TRACK") return t("videoCoach.audioNoTrack");
    if (code === "VIDEO_TOO_LONG") return t("videoCoach.audioTooLong");
    if (code === "AUDIO_UNSUPPORTED") return t("videoCoach.audioUnsupported");
    return t("videoCoach.audioFailed");
  }

  async function runAudioMark() {
    if (!videoFile || !videoReady) {
      setRpmError(t("videoCoach.notReady"));
      return;
    }
    if (lapEnd - lapStart < 3) {
      setRpmError(t("videoCoach.needLap"));
      return;
    }
    setRpmAnalyzing(true);
    setRpmProgress(0);
    setRpmError("");
    setRpmHint("");
    try {
      const result = await analyzeLapAudio(videoFile, {
        startS: lapStart,
        endS: lapEnd,
        strokes: rpmStrokes,
        onProgress: (fraction) => setRpmProgress(fraction),
      });
      setRpmResult(result);
      const candidates = result.events
        .map((event, index) => {
          try {
            return buildManualCorner(event.entry_s, event.apex_s, event.exit_s, index + 1);
          } catch {
            return null;
          }
        })
        .filter((corner): corner is CornerSegment => corner !== null);
      setCorners(candidates);
      setRpmReplacePending(false);
      setRpmHint(t("videoCoach.audioResult", { count: candidates.length }));
      const first = candidates[0];
      if (first && videoRef.current) {
        videoRef.current.currentTime = first.start;
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setRpmError(audioErrorText(code));
    } finally {
      setRpmAnalyzing(false);
    }
  }

  function onAudioMarkClick() {
    if (corners.length > 0 && !rpmReplacePending) {
      setRpmReplacePending(true);
      return;
    }
    void runAudioMark();
  }

  function updateCorner(index: number, patch: Partial<CornerSegment>) {
    setCorners((current) =>
      current.map((corner, i) => (i === index ? { ...corner, ...patch } : corner))
    );
  }

  function addCorner() {
    setCorners((current) => {
      const last = current[current.length - 1];
      const start = last ? last.end : lapStart;
      const end = Math.min(durationS, start + 5);
      return [
        ...current,
        buildManualCorner(
          Number(start.toFixed(2)),
          Number(((start + end) / 2).toFixed(2)),
          Number(end.toFixed(2)),
          current.length + 1,
        ),
      ];
    });
  }

  function downloadTrace() {
    const payload = {
      schema_version: 1,
      lap: { start_s: lapStart, end_s: lapEnd },
      samples,
      corners,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "lap-trace.json";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const chartData = samples.map((sample) => ({
    time_s: sample.time_s,
    lateral: sample.lateral,
  }));
  const nextPhaseLabel =
    draft.entry == null
      ? t("videoCoach.markEntry")
      : draft.apex == null
        ? t("videoCoach.markApex")
        : t("videoCoach.markExit");

  return (
    <main className="video-coach">
      <header className="video-coach__header">
        <div>
          <p className="hero-kicker"><Scissors size={15} /> {t("videoCoach.kicker")}</p>
          <h1>{t("videoCoach.title")}</h1>
          <p>{t("videoCoach.description")}</p>
          <p className="video-coach__privacy">{t("videoCoach.privacy")}</p>
        </div>
      </header>

      <label className="new-session-card__file">
        <Upload size={15} />
        <span>{videoName || t("videoCoach.upload")}</span>
        <input type="file" accept="video/*" onChange={(event) => onFile(event.target.files?.[0] ?? null)} />
      </label>

      {videoUrl ? (
        <>
          <div className="video-coach__meta">
            <span>{t("videoCoach.duration", { value: durationS.toFixed(1) })}</span>
            <span>{videoWidth > 0 ? `${videoWidth}×${videoHeight}` : "—"}</span>
            <span>{fileSizeMb > 0 ? `${fileSizeMb} MB` : ""}</span>
            {largeFile ? <span className="video-coach__large">{t("videoCoach.largeFile")}</span> : null}
          </div>

          {loading ? <p className="video-coach__hint">{t("videoCoach.loading")}</p> : null}
          {videoError ? <p className="video-coach__error">{videoError}</p> : null}
          {mediaErrorDetail ? <p className="video-coach__error">{mediaErrorDetail}</p> : null}

          <video
            ref={videoRef}
            src={videoUrl}
            controls
            className="video-coach__player"
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
            onError={onVideoError}
          />

          <div
            ref={timelineRef}
            className="video-coach__timeline"
            onClick={onTimelineClick}
            role="slider"
            aria-label={t("videoCoach.timeline")}
            aria-valuemin={0}
            aria-valuemax={Math.round(durationS)}
            aria-valuenow={Math.round(currentTime)}
          >
            <div className="video-coach__timeline-fill" style={{ width: `${durationS > 0 ? (currentTime / durationS) * 100 : 0}%` }} />
          </div>
          <p className="video-coach__mark-hint">{t("videoCoach.keyHint")}</p>

          <div className="video-coach__lap">
            <button type="button" className="story-button" onClick={() => setLapStart(videoRef.current?.currentTime ?? 0)}>
              {t("videoCoach.setStart")} {lapStart.toFixed(2)}s
            </button>
            <button type="button" className="story-button" onClick={() => setLapEnd(videoRef.current?.currentTime ?? 0)}>
              {t("videoCoach.setEnd")} {lapEnd.toFixed(2)}s
            </button>
            <button
              type="button"
              className="story-button"
              onClick={analyzeLap}
              disabled={analyzing || !videoReady}
            >
              <Play size={15} /> {analyzing ? `${t("videoCoach.analyzing")} ${Math.round(progress * 100)}%` : t("videoCoach.analyze")}
            </button>
            {!videoReady && !videoError ? (
              <span className="video-coach__hint">{t("videoCoach.waitingMetadata")}</span>
            ) : null}
            {samples.length ? (
              <button type="button" className="story-button" onClick={downloadTrace}>
                <Download size={15} /> {t("videoCoach.downloadTrace")}
              </button>
            ) : null}
            <label className="video-coach__strokes">
              {t("videoCoach.strokes")}
              <select
                value={rpmStrokes}
                onChange={(event) => setRpmStrokes(event.target.value === "4" ? 4 : 2)}
                disabled={rpmAnalyzing}
              >
                <option value={2}>{t("videoCoach.strokes2")}</option>
                <option value={4}>{t("videoCoach.strokes4")}</option>
              </select>
            </label>
            <button
              type="button"
              className="story-button is-primary"
              onClick={onAudioMarkClick}
              disabled={rpmAnalyzing || !videoReady}
            >
              {rpmAnalyzing
                ? `${t("videoCoach.audioAnalyzing")} ${Math.round(rpmProgress * 100)}%`
                : t("videoCoach.audioMark")}
            </button>
          </div>
          {error ? <p className="video-coach__error">{error}</p> : null}
          {rpmError ? <p className="video-coach__error">{rpmError}</p> : null}
          {rpmHint ? <p className="video-coach__ok">{rpmHint}</p> : null}
          {rpmReplacePending ? (
            <div className="video-coach__confirm">
              <span>{t("videoCoach.audioReplace", { count: corners.length })}</span>
              <button type="button" className="story-button" onClick={() => void runAudioMark()}>
                {t("videoCoach.confirm")}
              </button>
              <button
                type="button"
                className="story-button"
                onClick={() => setRpmReplacePending(false)}
              >
                {t("videoCoach.cancel")}
              </button>
            </div>
          ) : null}
          {!rpmAnalyzing && !rpmResult ? (
            <p className="video-coach__mark-hint">{t("videoCoach.audioMarkHint")}</p>
          ) : null}

          <canvas ref={overlayRef} width={OVERLAY_W} height={OVERLAY_H} className="video-coach__overlay" />

          {samples.length ? (
            <section className="video-coach__chart">
              <h2>{t("videoCoach.lateralChart")}</h2>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                  <XAxis dataKey="time_s" tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v: number) => `${v.toFixed(0)}s`} />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: "#64748b" }} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", fontSize: 12 }} />
                  <ReferenceLine x={currentTime} stroke="#f6c945" strokeDasharray="4 4" />
                  {corners.map((corner) => (
                    <ReferenceLine key={`s${corner.start}`} x={corner.start} stroke="#ff5964" strokeDasharray="3 3" />
                  ))}
                  <Line type="monotone" dataKey="lateral" name={t("videoCoach.lateralLabel")} stroke="#35d6d0" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          ) : null}

          {rpmResult && rpmResult.times.length > 1 ? (
            <section className="video-coach__chart">
              <h2>{t("videoCoach.rpmChart")}</h2>
              <ResponsiveContainer width="100%" height={190}>
                <LineChart
                  data={rpmChartData}
                  margin={{ top: 8, right: 16, bottom: 0, left: -10 }}
                >
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="time_s"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    tickFormatter={(value: number) => `${value.toFixed(0)}s`}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    domain={["auto", "auto"]}
                    tickFormatter={(value: number) => `${Math.round(value / 1000)}k`}
                  />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #334155", fontSize: 12 }}
                  />
                  <ReferenceLine x={currentTime} stroke="#f6c945" strokeDasharray="4 4" />
                  {corners.map((corner) => (
                    <ReferenceLine
                      key={`rpm-${corner.start}`}
                      x={corner.start}
                      stroke="#f6c945"
                      strokeDasharray="3 3"
                      opacity={0.5}
                    />
                  ))}
                  <Line
                    type="monotone"
                    dataKey="rpm"
                    name={t("videoCoach.rpmLabel")}
                    stroke="#ff5964"
                    dot={false}
                    strokeWidth={1.6}
                  />
                </LineChart>
              </ResponsiveContainer>
            </section>
          ) : null}

          <section className="video-coach__corners">
            <div className="video-coach__corners-head">
              <h2>{t("videoCoach.corners")}</h2>
              <button type="button" className="story-button" onClick={addCorner} disabled={!videoReady}>
                {t("videoCoach.addCorner")}
              </button>
            </div>

            <div className="video-coach__mark">
              <span className="video-coach__mark-hint">
                {t("videoCoach.markHint")} · {t("videoCoach.currentTime")} {currentTime.toFixed(2)}s
              </span>
              <button type="button" className="story-button is-primary" onClick={markNext} disabled={!videoReady}>
                {t("videoCoach.markNext", { phase: nextPhaseLabel })}
              </button>
              <button
                type="button"
                className={`story-button ${draft.entry != null ? "is-active" : ""}`}
                disabled={!videoReady || draft.entry != null}
                onClick={() => markPhase("entry")}
              >
                {t("videoCoach.markEntry")}{draft.entry != null ? ` ${draft.entry.toFixed(2)}s` : ""}
              </button>
              <button
                type="button"
                className={`story-button ${draft.apex != null ? "is-active" : ""}`}
                disabled={!videoReady || draft.entry == null || draft.apex != null}
                onClick={() => markPhase("apex")}
              >
                {t("videoCoach.markApex")}{draft.apex != null ? ` ${draft.apex.toFixed(2)}s` : ""}
              </button>
              <button
                type="button"
                className={`story-button ${draft.exit != null ? "is-active" : ""}`}
                disabled={!videoReady || draft.apex == null}
                onClick={() => markPhase("exit")}
              >
                {t("videoCoach.markExit")}{draft.exit != null ? ` ${draft.exit.toFixed(2)}s` : ""}
              </button>
              <button type="button" className="story-button" onClick={resetDraft} disabled={draft.entry == null && draft.apex == null && draft.exit == null}>
                {t("videoCoach.markCancel")}
              </button>
            </div>

            {issues.length ? (
              <p className="video-coach__error">
                {t("videoCoach.overlapsFound", { count: issues.length })}{" "}
                <button type="button" className="story-button" onClick={resolveOverlaps}>
                  {t("videoCoach.fixOverlap")}
                </button>
              </p>
            ) : straights.length ? (
              <p className="video-coach__ok">
                {straights.map((gap) =>
                  t("videoCoach.straightGap", {
                    from: gap.prev.name || t("videoCoach.corner", { index: gap.index }),
                    to: gap.next.name || t("videoCoach.corner", { index: gap.index + 1 }),
                    value: gap.gapS.toFixed(1),
                  })
                ).join(" · ")}
              </p>
            ) : null}

            {corners.length ? (
              <ul className="video-coach__corner-list">
                {corners.map((corner, index) => (
                  <li key={`${corner.start}-${index}`}>
                    <div className="video-coach__corner-top">
                      <strong>{corner.name || t("videoCoach.corner", { index: index + 1 })}</strong>
                      <input
                        aria-label={t("videoCoach.cornerName")}
                        value={corner.name ?? ""}
                        onChange={(event) => updateCorner(index, { name: event.target.value })}
                        placeholder={t("videoCoach.cornerName")}
                      />
                      <span>{corner.direction === 1 ? "→" : "←"}</span>
                    </div>
                    <div className="video-coach__corner-times">
                      <label>
                        {t("videoCoach.start")}
                        <input type="number" step={0.1} value={Number(corner.start.toFixed(2))} onChange={(event) => updateCorner(index, { start: Number(event.target.value) })} />
                      </label>
                      <label>
                        {t("videoCoach.apex")}
                        <input type="number" step={0.1} value={Number(corner.apex.toFixed(2))} onChange={(event) => updateCorner(index, { apex: Number(event.target.value) })} />
                      </label>
                      <label>
                        {t("videoCoach.end")}
                        <input type="number" step={0.1} value={Number(corner.end.toFixed(2))} onChange={(event) => updateCorner(index, { end: Number(event.target.value) })} />
                      </label>
                    </div>
                    <input
                      className="video-coach__corner-notes"
                      value={corner.notes ?? ""}
                      onChange={(event) => updateCorner(index, { notes: event.target.value })}
                      placeholder={t("videoCoach.cornerNotes")}
                    />
                    <div className="video-coach__corner-actions">
                      <button type="button" className="story-button" onClick={() => toggleCornerLoop(index)}>
                        {loopCorner === index ? t("videoCoach.cornerStop") : t("videoCoach.cornerPlay")}
                      </button>
                      <button type="button" className="story-button" onClick={() => deleteCorner(index)}>
                        {t("videoCoach.cornerDelete")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="video-coach__hint">{t("videoCoach.noCorners")}</p>
            )}
          </section>
        </>
      ) : (
        <p className="video-coach__hint">{t("videoCoach.uploadHint")}</p>
      )}
      <canvas ref={sampleRef} className="hidden" />
    </main>
  );
}
