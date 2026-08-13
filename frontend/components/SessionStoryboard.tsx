"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { toPng } from "html-to-image";
import QRCode from "qrcode";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  Image as ImageIcon,
  Link2,
  Play,
  Sparkles,
  Smartphone,
  Target,
  ThumbsDown,
  ThumbsUp,
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
import { resolveApiConfig } from "../lib/config";
import { submitNarrativeFeedback } from "../lib/feedbackApi";
import type { StoryboardNode, StoryboardResponse } from "../lib/storyboardApi";
import { StoryboardWechatCard } from "./StoryboardWechatCard";

export function SessionStoryboard({
  storyboard,
  videoUrl,
  shareUrl,
}: {
  storyboard: StoryboardResponse;
  videoUrl: string | null;
  shareUrl: string;
}) {
  const { t, locale } = useI18n();
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [exportAllOpen, setExportAllOpen] = useState(false);
  const [exportAllBusy, setExportAllBusy] = useState(false);
  const [wechatExportBusy, setWechatExportBusy] = useState(false);
  const [wechatQrDataUrl, setWechatQrDataUrl] = useState("");
  const [feedbackSent, setFeedbackSent] = useState<{ nodeId: string; thumbsUp: boolean } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const exportAllRef = useRef<HTMLDivElement>(null);
  const wechatExportRef = useRef<HTMLElement>(null);
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

  useEffect(() => {
    let active = true;
    if (!shareUrl) return () => { active = false; };
    void QRCode.toDataURL(shareUrl, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#091018", light: "#ffffff" },
    }).then((dataUrl) => {
      if (active) setWechatQrDataUrl(dataUrl);
    }).catch(() => {
      if (active) setWechatQrDataUrl("");
    });
    return () => { active = false; };
  }, [shareUrl]);

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

  const exportAllImage = useCallback(async () => {
    if (!exportAllRef.current) return;
    setExportAllBusy(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const dataUrl = await toPng(exportAllRef.current, {
        pixelRatio: 2,
        backgroundColor: "#0b0f14",
      });
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = `ai-review-${storyboard.token}-all.png`;
      anchor.click();
    } finally {
      setExportAllBusy(false);
    }
  }, [storyboard.token]);

  const exportJson = useCallback(() => {
    const payload = {
      schema_version: 1,
      exported_at: new Date().toISOString(),
      storyboard,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ai-review-${storyboard.token}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [storyboard]);

  const exportWechatImage = useCallback(async () => {
    if (!wechatExportRef.current || !wechatQrDataUrl) return;
    setWechatExportBusy(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const dataUrl = await toPng(wechatExportRef.current, {
        width: 1080,
        height: 1920,
        pixelRatio: 1,
        backgroundColor: "#091018",
      });
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = `ai-review-${storyboard.token}-wechat-1080x1920.png`;
      anchor.click();
    } finally {
      setWechatExportBusy(false);
    }
  }, [storyboard.token, wechatQrDataUrl]);

  const sendFeedback = useCallback(async (nodeId: string, thumbsUp: boolean) => {
    try {
      const config = await resolveApiConfig();
      const ok = await submitNarrativeFeedback(
        config.apiOrigin,
        config.apiPrefix,
        {
          node_id: nodeId,
          token: storyboard.token,
          source: node.source,
          locale: locale === "zh" ? "zh" : "en",
          thumbs_up: thumbsUp,
        },
      );
      if (ok) setFeedbackSent({ nodeId, thumbsUp });
    } catch {
      // Feedback is optional; failures should not block the review.
    }
  }, [storyboard.token, node.source, locale]);

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
          <button type="button" className="story-button" onClick={() => setExportAllOpen(true)}>
            <ImageIcon size={16} /> {t("story.exportAll")}
          </button>
          <button
            type="button"
            className="story-button"
            onClick={exportWechatImage}
            disabled={wechatExportBusy || !wechatQrDataUrl}
          >
            <Smartphone size={16} /> {wechatExportBusy ? t("story.exporting") : t("story.exportWechat")}
          </button>
          <button type="button" className="story-button" onClick={exportJson}>
            <Download size={16} /> {t("story.exportJson")}
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
          onFeedback={(thumbsUp) => void sendFeedback(node.id, thumbsUp)}
          feedbackSent={feedbackSent?.nodeId === node.id}
          feedbackWasHelpful={feedbackSent?.nodeId === node.id ? feedbackSent.thumbsUp : null}
        />
        {exporting ? <span className="storyboard__big-watermark">{storyboard.watermark}</span> : null}
      </div>

      {exportAllOpen ? (
        <div className="storyboard-export-all" role="dialog" aria-modal="true" aria-label={t("story.exportAllTitle")}>
          <header className="storyboard-export-all__header">
            <h4>{t("story.exportAllTitle")}</h4>
            <div className="storyboard__actions">
              <button type="button" className="story-button" onClick={exportAllImage} disabled={exportAllBusy}>
                <ImageIcon size={16} /> {exportAllBusy ? t("story.exporting") : t("story.exportAll")}
              </button>
              <button type="button" className="story-button" onClick={() => setExportAllOpen(false)}>
                {t("story.exportAllClose")}
              </button>
            </div>
          </header>
          <div className="storyboard-export-all__body" ref={exportAllRef}>
            {storyboard.nodes.map((item) => (
              <StoryCard
                key={item.id}
                node={item}
                videoUrl={null}
                exporting
                watermark={storyboard.watermark}
                videoRef={null}
                onTogglePlayback={() => {}}
                onTimeUpdate={() => {}}
              />
            ))}
          </div>
        </div>
      ) : null}
      {wechatQrDataUrl ? (
        <div className="storyboard-wechat-export-stage" aria-hidden="true">
          <StoryboardWechatCard
            storyboard={storyboard}
            qrDataUrl={wechatQrDataUrl}
            cardRef={wechatExportRef}
          />
        </div>
      ) : null}
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
  onFeedback,
  feedbackSent = false,
  feedbackWasHelpful = null,
}: {
  node: StoryboardNode;
  videoUrl: string | null;
  exporting: boolean;
  watermark: string;
  videoRef: RefObject<HTMLVideoElement | null> | null;
  onTogglePlayback: () => void;
  onTimeUpdate: () => void;
  onFeedback?: (thumbsUp: boolean) => void;
  feedbackSent?: boolean;
  feedbackWasHelpful?: boolean | null;
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
              ref={videoRef ?? undefined}
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
        {onFeedback ? (
          <div className="story-card__feedback">
            <button
              type="button"
              aria-label={t("story.feedbackHelpful")}
              disabled={feedbackSent}
              onClick={() => onFeedback(true)}
            >
              <ThumbsUp size={14} />
            </button>
            <button
              type="button"
              aria-label={t("story.feedbackNotHelpful")}
              disabled={feedbackSent}
              onClick={() => onFeedback(false)}
            >
              <ThumbsDown size={14} />
            </button>
            {feedbackSent ? (
              <span>
                {t("story.feedbackThanks")}
                {feedbackWasHelpful === false ? ` ${t("story.feedbackDownHint")}` : ""}
              </span>
            ) : null}
          </div>
        ) : null}
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
