"use client";

import { ShieldAlert } from "lucide-react";

import { useI18n } from "../lib/i18n";
import type { StoryboardResponse } from "../lib/storyboardApi";
import { SessionStoryboard } from "./SessionStoryboard";

export function StorySharePage({
  storyboard,
  shareUrl,
}: {
  storyboard: StoryboardResponse;
  shareUrl: string;
}) {
  const { t } = useI18n();
  return (
    <main className="story-share-page">
      <div className="story-share-banner" role="note">
        <ShieldAlert size={16} />
        <span>{storyboard.watermark}</span>
      </div>
      <SessionStoryboard storyboard={storyboard} videoUrl={null} shareUrl={shareUrl} />
      <footer className="story-share-footer">
        <p>{t("story.shareFooter")}</p>
        <p className="story-share-footer__laps">
          {t("story.referenceLap", { lap: storyboard.analysis.reference_lap ?? "-" })} ·{" "}
          {t("story.targetLap", { lap: storyboard.analysis.target_lap ?? "-" })} ·{" "}
          {storyboard.analysis.fastest_lap
            ? t("story.fastestLap", {
                lap: storyboard.analysis.fastest_lap.lap,
                time: storyboard.analysis.fastest_lap.lap_time.toFixed(3),
              })
            : t("story.fastestUnavailable")}
        </p>
      </footer>
    </main>
  );
}
