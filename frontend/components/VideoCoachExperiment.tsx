"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  lateralPositionFromRgba,
  sampleTimes,
  segmentCorners,
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

  const [videoUrl, setVideoUrl] = useState("");
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
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(file));
    setVideoName(file.name);
    setSamples([]);
    setCorners([]);
    setError("");
  }

  function onLoadedMetadata() {
    const video = videoRef.current;
    if (!video) return;
    setDurationS(video.duration);
    setLapEnd(video.duration);
    setVideoWidth(video.videoWidth);
    setVideoHeight(video.videoHeight);
  }

  function onTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
  }

  async function analyzeLap() {
    const video = videoRef.current;
    const sampleCanvas = sampleRef.current;
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
    for (let index = 0; index < times.length; index += 1) {
      video.currentTime = times[index];
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        };
        video.addEventListener("seeked", onSeeked);
      });
      ctx.drawImage(video, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      const lateral = lateralPositionFromRgba(image.data, width, height);
      if (lateral !== null) {
        found.push({ time_s: Number(times[index].toFixed(3)), lateral });
      }
      setProgress((index + 1) / times.length);
    }
    setSamples(found);
    setCorners(segmentCorners(found));
    setAnalyzing(false);
    setProgress(0);
    video.currentTime = lapStart;
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
        {
          start: Number(start.toFixed(2)),
          end: Number(end.toFixed(2)),
          apex: Number(((start + end) / 2).toFixed(2)),
          direction: 1,
        },
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
          </div>

          <video
            ref={videoRef}
            src={videoUrl}
            controls
            className="video-coach__player"
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
          />

          <div className="video-coach__lap">
            <button type="button" className="story-button" onClick={() => setLapStart(videoRef.current?.currentTime ?? 0)}>
              {t("videoCoach.setStart")} {lapStart.toFixed(2)}s
            </button>
            <button type="button" className="story-button" onClick={() => setLapEnd(videoRef.current?.currentTime ?? 0)}>
              {t("videoCoach.setEnd")} {lapEnd.toFixed(2)}s
            </button>
            <button type="button" className="story-button" onClick={analyzeLap} disabled={analyzing}>
              <Play size={15} /> {analyzing ? `${t("videoCoach.analyzing")} ${Math.round(progress * 100)}%` : t("videoCoach.analyze")}
            </button>
            {samples.length ? (
              <button type="button" className="story-button" onClick={downloadTrace}>
                <Download size={15} /> {t("videoCoach.downloadTrace")}
              </button>
            ) : null}
          </div>
          {error ? <p className="video-coach__error">{error}</p> : null}

          <canvas ref={overlayRef} width={OVERLAY_W} height={OVERLAY_H} className="video-coach__overlay" />

          {samples.length ? (
            <>
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

              <section className="video-coach__corners">
                <div className="video-coach__corners-head">
                  <h2>{t("videoCoach.corners")}</h2>
                  <button type="button" className="story-button" onClick={addCorner}>
                    {t("videoCoach.addCorner")}
                  </button>
                </div>
                {corners.length ? (
                  <ul className="video-coach__corner-list">
                    {corners.map((corner, index) => (
                      <li key={`${corner.start}-${index}`}>
                        <strong>{t("videoCoach.corner", { index: index + 1 })}</strong>
                        <label>
                          {t("videoCoach.start")}
                          <input type="number" step={0.1} value={Number(corner.start.toFixed(2))} onChange={(event) => updateCorner(index, { start: Number(event.target.value) })} />
                        </label>
                        <label>
                          {t("videoCoach.end")}
                          <input type="number" step={0.1} value={Number(corner.end.toFixed(2))} onChange={(event) => updateCorner(index, { end: Number(event.target.value) })} />
                        </label>
                        <span>{t("videoCoach.apex")} {corner.apex.toFixed(2)}s · {corner.direction === 1 ? "→" : "←"}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="video-coach__hint">{t("videoCoach.noCorners")}</p>
                )}
              </section>
            </>
          ) : null}
        </>
      ) : (
        <p className="video-coach__hint">{t("videoCoach.uploadHint")}</p>
      )}
      <canvas ref={sampleRef} className="hidden" />
    </main>
  );
}
