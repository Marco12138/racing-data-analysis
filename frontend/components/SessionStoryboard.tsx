"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { toPng } from "html-to-image";
import {
  ChevronLeft,
  ChevronRight,
  Film,
  Image as ImageIcon,
  Link2,
  Play,
  Sparkles,
  Target,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useI18n } from "../lib/i18n";
import type { StoryboardNode, StoryboardResponse } from "../lib/storyboardApi";

export function SessionStoryboard({
  storyboard,
  videoUrl,
  shareUrl,
}: {
  storyboard: StoryboardResponse;
  videoUrl: string | null;
  shareUrl: string;
}) {
  const { t } = useI18n();
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const node = storyboard.nodes[Math.min(page, storyboard.nodes.length - 1)];
  const [renderedToken, setRenderedToken] = useState(storyboard.token);
  if (renderedToken !== storyboard.token) {
    setRenderedToken(storyboard.token);
    setPage(0);
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl || !node) return;
    video.pause();
    video.currentTime = node.time_range[0];
  }, [page, node, videoUrl]);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.currentTime < node.time_range[0] || video.currentTime > node.time_range[1]) {
        video.currentTime = node.time_range[0];
      }
      void video.play();
    } else {
      video.pause();
    }
  }, [node]);

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video && node && video.currentTime > node.time_range[1]) {
      video.pause();
      video.currentTime = node.time_range[0];
    }
  }, [node]);

  const copyShareLink = useCallback(async () => {
    const url = shareUrl || (typeof window !== "undefined" ? window.location.href : "");
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // Clipboard unavailable; the URL remains visible in the UI.
    }
  }, [shareUrl]);

  const exportImage = useCallback(async () => {
    if (!exportRef.current) return;
    setExporting(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const dataUrl = await toPng(exportRef.current, {
        pixelRatio: 2,
        backgroundColor: "#0b0f14",
      });
      const blob = await (await fetch(dataUrl)).blob();
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setCopiedImage(true);
      } catch {
        const anchor = document.createElement("a");
        anchor.href = dataUrl;
        anchor.download = `ai-review-${storyboard.token}.png`;
        anchor.click();
      }
      window.setTimeout(() => setCopiedImage(false), 1800);
    } finally {
      setExporting(false);
    }
  }, [storyboard.token]);

  if (storyboard.nodes.length === 0) return null;

  return (
    <section className="storyboard" aria-label={t("story.title")}>
      <header className="storyboard__header">
        <div>
          <p className="hero-kicker"><Film size={15} /> {t("story.kicker")}</p>
          <h3>{t("story.title")}</h3>
          <p>{t("story.subtitle")}</p>
        </div>
        <div className="storyboard__actions">
          <button type="button" className="story-button" onClick={exportImage} disabled={exporting}>
            <ImageIcon size={16} /> {exporting ? t("story.exporting") : copiedImage ? t("story.copied") : t("story.copyImage")}
          </button>
          <button type="button" className="story-button" onClick={copyShareLink}>
            <Link2 size={16} /> {copiedLink ? t("story.copied") : t("story.copyLink")}
          </button>
        </div>
      </header>

      <div className="storyboard__pager" aria-label={t("story.pageNav")}>
        <button
          type="button"
          className="story-page-arrow"
          aria-label={t("story.prev")}
          disabled={page === 0}
          onClick={() => setPage((current) => Math.max(0, current - 1))}
        >
          <ChevronLeft size={18} />
        </button>
        <span>{t("story.page", { current: page + 1, total: storyboard.nodes.length })}</span>
        <button
          type="button"
          className="story-page-arrow"
          aria-label={t("story.next")}
          disabled={page >= storyboard.nodes.length - 1}
          onClick={() => setPage((current) => Math.min(storyboard.nodes.length - 1, current + 1))}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="storyboard__card" ref={exportRef}>
        <StoryCard
          node={node}
          videoUrl={videoUrl}
          exporting={exporting}
          watermark={storyboard.watermark}
          videoRef={videoRef}
          onTogglePlayback={togglePlayback}
          onTimeUpdate={onTimeUpdate}
        />
        {exporting ? <span className="storyboard__big-watermark">{storyboard.watermark}</span> : null}
      </div>
    </section>
  );
}

function StoryCard({
  node,
  videoUrl,
  exporting,
  watermark,
  videoRef,
  onTogglePlayback,
  onTimeUpdate,
}: {
  node: StoryboardNode;
  videoUrl: string | null;
  exporting: boolean;
  watermark: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  onTogglePlayback: () => void;
  onTimeUpdate: () => void;
}) {
  const { t } = useI18n();
  return (
    <article className="story-card">
      <div className="story-card__media">
        {exporting || !videoUrl ? (
          <div className="story-card__media-placeholder">
            <Film size={28} />
            <strong>{t("story.videoClip")}</strong>
            <span>{formatRange(node.time_range)}</span>
            <small>{videoUrl ? t("story.videoLocal") : t("story.videoShareNote")}</small>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              src={videoUrl}
              preload="metadata"
              playsInline
              onTimeUpdate={onTimeUpdate}
            />
            <button type="button" className="story-card__play" onClick={onTogglePlayback} aria-label={t("story.playClip")}>
              <Play size={22} fill="currentColor" />
            </button>
            <span className="story-card__timecode">{formatRange(node.time_range)}</span>
          </>
        )}
      </div>

      <div className="story-card__body">
        <h4>{node.title}</h4>
        <div className="story-card__meta">
          <span>{node.source === "llm" ? t("story.sourceLlm") : t("story.sourceStructured")}</span>
          <span>{t("story.evidenceLaps", { laps: node.evidence_laps.join(", ") })}</span>
        </div>

        <TelemetryMiniChart node={node} />

        <div className="story-card__advice">
          <p><Sparkles size={15} /> <strong>{t("story.insight")}：</strong>{node.insight}</p>
          <p><Target size={15} /> <strong>{t("story.drill")}：</strong>{node.drill || t("story.noDrill")}</p>
        </div>
        <small className="story-card__watermark">{watermark}</small>
      </div>
    </article>
  );
}

function TelemetryMiniChart({ node }: { node: StoryboardNode }) {
  const { t } = useI18n();
  const overlay = node.telemetry_overlay;
  const data = overlay.distance_m.map((distance, index) => ({
    d: Number(distance.toFixed(1)),
    speed: overlay.speed_kmh[index],
    rpm: overlay.rpm[index],
    t: overlay.available.throttle && overlay.throttle[index] != null ? overlay.throttle[index] : null,
    b: overlay.available.brake && overlay.brake[index] != null ? overlay.brake[index] : null,
  }));
  const showPedals = overlay.available.throttle || overlay.available.brake;

  return (
    <div className="story-card__chart">
      {showPedals ? (
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
            <XAxis dataKey="d" tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(value: number) => `${value}m`} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "#64748b" }} />
            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} hide />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", fontSize: 12 }} />
            <Line yAxisId="left" type="monotone" dataKey="speed" name={t("story.channelSpeed")} stroke="#35d6d0" dot={false} strokeWidth={2} />
            <Line yAxisId="right" type="monotone" dataKey="t" name={t("story.channelThrottle")} stroke="#f6c945" dot={false} strokeWidth={1.5} />
            <Line yAxisId="right" type="monotone" dataKey="b" name={t("story.channelBrake")} stroke="#ff5964" dot={false} strokeWidth={1.5} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
            <XAxis dataKey="d" tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(value: number) => `${value}m`} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "#64748b" }} />
            <YAxis yAxisId="right" orientation="right" hide />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", fontSize: 12 }} />
            <Line yAxisId="left" type="monotone" dataKey="speed" name={t("story.channelSpeed")} stroke="#35d6d0" dot={false} strokeWidth={2} />
            <Line yAxisId="right" type="monotone" dataKey="rpm" name={t("story.channelRpm")} stroke="#a78bfa" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      )}
      <small className="story-card__channel-note">
        {showPedals ? t("story.pedalsMeasured") : t("story.pedalsUnavailable")}
      </small>
    </div>
  );
}

function formatRange(range: [number, number]): string {
  return `${formatSeconds(range[0])} – ${formatSeconds(range[1])}`;
}

function formatSeconds(value: number): string {
  const whole = Math.max(0, Math.round(value));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
