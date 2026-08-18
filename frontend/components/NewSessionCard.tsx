"use client";

import { useState } from "react";
import { Clapperboard, Film, Play, Upload } from "lucide-react";

import { useI18n } from "../lib/i18n";
import {
  canStartNewSession,
  isXrkFileName,
  type SessionUploadSelection,
} from "../lib/sessionUpload";

const STEPS = ["sessionCard.step.upload", "sessionCard.step.inspect", "sessionCard.step.analyze", "sessionCard.step.video"] as const;

export function NewSessionCard({
  status,
  hasPendingVideo,
  onStart,
}: {
  status: "idle" | "inspecting" | "inspected" | "analyzing" | "loaded";
  hasPendingVideo: boolean;
  onStart: (xrkFile: File, videoFile: File | null) => void;
}) {
  const { t } = useI18n();
  const [xrkFile, setXrkFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [xrkError, setXrkError] = useState("");
  const [lastStatus, setLastStatus] = useState(status);
  const selection: SessionUploadSelection = { xrkFile, videoFile };
  const ready = canStartNewSession(selection);
  const busy = status === "inspecting" || status === "analyzing";

  if (status !== lastStatus) {
    setLastStatus(status);
    if (status === "loaded") {
      setXrkFile(null);
      setVideoFile(null);
      setXrkError("");
    }
  }

  function chooseXrk(file: File | null) {
    setXrkError("");
    if (!file) {
      setXrkFile(null);
      return;
    }
    if (!isXrkFileName(file.name)) {
      setXrkError(t("sessionCard.xrkInvalid"));
      setXrkFile(null);
      return;
    }
    setXrkFile(file);
  }

  const activeStep =
    status === "inspecting"
      ? 1
      : status === "analyzing"
        ? 2
        : status === "loaded"
          ? hasPendingVideo
            ? 3
            : 4
          : -1;

  return (
    <section className="new-session-card" aria-labelledby="new-session-title">
      <div className="new-session-card__header">
        <Clapperboard size={18} />
        <div>
          <h3 id="new-session-title">{t("sessionCard.title")}</h3>
          <p>{t("sessionCard.description")}</p>
        </div>
      </div>

      <label className="new-session-card__file">
        <Upload size={15} />
        <span>{xrkFile ? xrkFile.name : t("sessionCard.xrkLabel")}</span>
        <input
          type="file"
          accept=".xrk,.xrz"
          onChange={(event) => {
            if (!busy) chooseXrk(event.target.files?.[0] ?? null);
          }}
        />
      </label>
      {xrkError ? <p className="new-session-card__error">{xrkError}</p> : null}

      <label className="new-session-card__file">
        <Film size={15} />
        <span>{videoFile ? videoFile.name : t("sessionCard.videoLabel")}</span>
        <input
          type="file"
          accept="video/mp4,video/quicktime,.mp4,.mov"
          onChange={(event) => {
            if (!busy) setVideoFile(event.target.files?.[0] ?? null);
          }}
        />
      </label>
      <p className="new-session-card__privacy">{t("sessionCard.privacy")}</p>

      <button
        type="button"
        className="new-session-card__start"
        disabled={!ready || busy}
        onClick={() => {
          if (xrkFile) onStart(xrkFile, videoFile);
        }}
      >
        <Play size={16} fill="currentColor" />
        {busy ? t("sessionCard.running") : t("sessionCard.start")}
      </button>

      {status !== "idle" ? (
        <ol className="new-session-card__steps" aria-label={t("sessionCard.stepsLabel")}>
          {STEPS.map((key, index) => (
            <li key={key} className={activeStep === index ? "is-active" : activeStep > index || activeStep === 4 ? "is-done" : ""}>
              {t(key)}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
