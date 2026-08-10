"use client";

import { useState } from "react";
import { Clapperboard, Sparkles } from "lucide-react";

import { resolveApiConfig } from "../lib/config";
import { useI18n } from "../lib/i18n";
import {
  createStoryboardPayload,
  type StoryboardAlignmentInput,
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
  publishedDemo = false,
}: {
  analysis: XrkAnalysis;
  videoFile: File | null;
  videoUrl: string | null;
  videoDurationS: number;
  calibration: VideoSyncCalibration | null;
  publishedDemo?: boolean;
}) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const [storyboard, setStoryboard] = useState<StoryboardResponse | null>(null);
  const [error, setError] = useState("");

  const canCreate =
    !publishedDemo
    && Boolean(analysis.track)
    && Boolean(videoFile)
    && Boolean(calibration)
    && videoDurationS > 0;

  async function createStoryboard() {
    if (!canCreate || !calibration) return;
    setCreating(true);
    setError("");
    try {
      const config = await resolveApiConfig();
      const alignment: StoryboardAlignmentInput = {
        offset_ms: calibration.offset_ms,
        video_duration_s: videoDurationS,
        target_lap: analysis.target_lap,
        telemetry_session_time_s: calibration.telemetry_session_time_s,
        video_time_s: calibration.video_time_s,
        video_size_bytes: videoFile?.size ?? null,
        video_last_modified_ms: videoFile?.lastModified ?? null,
        video_mime_type: videoFile?.type ?? null,
      };
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
                : !calibration || !videoFile
                  ? t("xrk.storyboard.missingVideo")
                  : t("xrk.storyboard.missingDuration")}
            </p>
          ) : (
            <button type="button" className="hero-primary" onClick={createStoryboard} disabled={creating}>
              <Clapperboard size={17} />
              {creating ? t("xrk.storyboard.generating") : t("xrk.storyboard.generate")}
            </button>
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
