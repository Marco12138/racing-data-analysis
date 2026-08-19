"use client";

import { useState } from "react";
import { Clapperboard, Film, HardDrive, Play, Upload } from "lucide-react";

import { useI18n } from "../lib/i18n";
import { describeFileReadError, materializeXrkFile } from "../lib/fileUpload";
import {
  canStartNewSession,
  isXrkFileName,
  resolveLocalXrkSource,
  type SessionUploadSelection,
} from "../lib/sessionUpload";
import type { LocalXrkSource } from "../lib/xrkAnalysisApi";

const STEPS = ["sessionCard.step.upload", "sessionCard.step.inspect", "sessionCard.step.analyze", "sessionCard.step.video"] as const;

export function NewSessionCard({
  status,
  hasPendingVideo,
  onStart,
  localSources = [],
  onStartLocal,
}: {
  status: "idle" | "inspecting" | "inspected" | "analyzing" | "loaded";
  hasPendingVideo: boolean;
  onStart: (xrkFile: File, videoFile: File | null) => void;
  localSources?: LocalXrkSource[];
  onStartLocal?: (sourceId: string, videoFile: File | null) => void;
}) {
  const { t } = useI18n();
  const [xrkFile, setXrkFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [xrkError, setXrkError] = useState("");
  const [xrkReading, setXrkReading] = useState(false);
  const [lastStatus, setLastStatus] = useState(status);
  const [localSourceId, setLocalSourceId] = useState("");
  const selection: SessionUploadSelection = { xrkFile, videoFile };
  const ready = canStartNewSession(selection);
  const localSource = resolveLocalXrkSource(localSources, localSourceId);
  const busy = status === "inspecting" || status === "analyzing";
  const inputLocked = busy || xrkReading;

  if (status !== lastStatus) {
    setLastStatus(status);
    if (status === "loaded") {
      setXrkFile(null);
      setVideoFile(null);
      setXrkError("");
    }
  }

  async function chooseXrk(file: File | null) {
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
    setXrkReading(true);
    try {
      setXrkFile(await materializeXrkFile(file));
    } catch (error) {
      setXrkFile(null);
      setXrkError(describeFileReadError(error));
    } finally {
      setXrkReading(false);
    }
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

      {localSources.length > 0 && onStartLocal && (
        <div className="new-session-card__local">
          <p className="new-session-card__local-title">
            <HardDrive size={13} />
            {t("sessionCard.localLibraryTitle")}
          </p>
          <select
            value={localSource?.source_id ?? ""}
            disabled={busy}
            onChange={(event) => setLocalSourceId(event.target.value)}
            aria-label={t("sessionCard.localLibraryTitle")}
          >
            {localSources.map((source) => (
              <option key={source.source_id} value={source.source_id}>
                {source.root} / {source.relative_path}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="new-session-card__local-start"
            disabled={!localSource || busy}
            onClick={() => {
              if (localSource && onStartLocal) {
                onStartLocal(localSource.source_id, videoFile);
              }
            }}
          >
            <Play size={15} fill="currentColor" />
            {t("sessionCard.localLibraryStart")}
          </button>
          <p className="new-session-card__privacy">{t("sessionCard.localLibraryHint")}</p>
        </div>
      )}

      <label className="new-session-card__file">
        <Upload size={15} />
        <span>{xrkReading ? t("sessionCard.reading") : xrkFile ? xrkFile.name : t("sessionCard.xrkLabel")}</span>
        <input
          type="file"
          accept=".xrk,.xrz"
          onChange={(event) => {
            if (!inputLocked) void chooseXrk(event.target.files?.[0] ?? null);
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
            if (!inputLocked) setVideoFile(event.target.files?.[0] ?? null);
          }}
        />
      </label>
      <p className="new-session-card__privacy">{t("sessionCard.privacy")}</p>

      <button
        type="button"
        className="new-session-card__start"
        disabled={!ready || busy || xrkReading}
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
