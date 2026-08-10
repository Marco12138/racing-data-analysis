"use client";

import { useState } from "react";
import { Clapperboard, Sparkles } from "lucide-react";

import { resolveApiConfig } from "../lib/config";
import { useI18n } from "../lib/i18n";
import {
  buildStoryboardAlignmentInput,
  canCreateStoryboard,
  createStoryboardPayload,
  type StoryboardResponse,
} from "../lib/storyboardApi";
import type { VideoSyncCalibration } from "../lib/videoTelemetrySync";
import type { XrkAnalysis } from "../lib/xrkAnalysisApi";
import { SessionStoryboard } from "./SessionStoryboard";

export function StoryboardPanel({
  analysis,
  videoFile,
  videoUrl,
  videoDurationS,
  calibration,
  offsetMs,
  publishedDemo = false,
}: {
  analysis: XrkAnalysis;
  videoFile: File | null;
  videoUrl: string | null;
  videoDurationS: number;
  calibration: VideoSyncCalibration | null;
  offsetMs: number;
  publishedDemo?: boolean;
}) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const [storyboard, setStoryboard] = useState<StoryboardResponse | null>(null);
  const [error, setError] = useState("");

  const canCreate =
    !publishedDemo
    && canCreateStoryboard({
      hasTrack: Boolean(analysis.track),
      videoFile,
      videoDurationS,
      calibration,
      offsetMs,
    });

  async function createStoryboard() {
    if (!canCreate) return;
    setCreating(true);
    setError("");
    try {
      const config = await resolveApiConfig();
      const alignment = buildStoryboardAlignmentInput({
        calibration,
        offsetMs,
        videoDurationS,
        targetLap: analysis.target_lap,
        videoFile,
      });
      const result = await createStoryboardPayload(config.apiOrigin, config.apiPrefix, {
        analysis: {
          inspection_id: analysis.inspection_id,
          reference_lap: analysis.reference_lap,
          target_lap: analysis.target_lap,
          distance_step_m: 1,
          sector_count: analysis.sectors?.count ?? 3,
          sector_boundaries_m: null,
          manual_zones: [],
          lap_quality_absolute_gap_s:
            analysis.lap_quality.config.absolute_gap_threshold_s ?? 0.5,
          lap_quality_relative_gap_pct:
            analysis.lap_quality.config.relative_gap_threshold_pct ?? 1,
        },
        alignment,
      });
      if (!result) {
        setError(t("xrk.storyboard.error"));
        return;
      }
      setStoryboard(result);
    } catch {
      setError(t("xrk.storyboard.error"));
    } finally {
      setCreating(false);
    }
  }

  if (publishedDemo) {
    return (
      <div className="storyboard-panel">
        <p className="storyboard-panel__hint">{t("xrk.storyboard.demoNotAvailable")}</p>
      </div>
    );
  }

  return (
    <div className="storyboard-panel">
      {!storyboard ? (
        <>
          <div className="storyboard-panel__intro">
            <Sparkles size={18} />
            <div>
              <h3>{t("xrk.storyboard.title")}</h3>
              <p>{t("xrk.storyboard.description")}</p>
            </div>
          </div>
          {!canCreate ? (
            <p className="storyboard-panel__hint">
              {!analysis.track
                ? t("xrk.storyboard.missingTrack")
                : !videoFile
                  ? t("xrk.storyboard.missingVideo")
                  : videoDurationS <= 0
                    ? t("xrk.storyboard.missingDuration")
                    : t("xrk.storyboard.missingVideo")}
            </p>
          ) : (
            <>
              <button type="button" className="hero-primary" onClick={createStoryboard} disabled={creating}>
                <Clapperboard size={17} />
                {creating ? t("xrk.storyboard.generating") : t("xrk.storyboard.generate")}
              </button>
              {!calibration && Number.isFinite(offsetMs) ? (
                <p className="storyboard-panel__hint">{t("xrk.storyboard.offsetOnlyHint")}</p>
              ) : null}
            </>
          )}
          {error ? <p className="storyboard-panel__error" role="alert">{error}</p> : null}
        </>
      ) : (
        <SessionStoryboard
          storyboard={storyboard}
          videoUrl={videoUrl}
          shareUrl={`${typeof window !== "undefined" ? window.location.origin : ""}/story/${storyboard.token}`}
        />
      )}
    </div>
  );
}
