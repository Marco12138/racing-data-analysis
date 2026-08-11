"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Upload, User } from "lucide-react";
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
import { summarizeProfile, type SessionSummary } from "../lib/driverProfile";
import {
  clearAllSummaries,
  exportSummariesJson,
  getAllSessionSummaries,
  importSummaries,
} from "../lib/driverProfileDb";

export function DriverProfilePage() {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [importError, setImportError] = useState("");
  const profile = useMemo(() => summarizeProfile(sessions), [sessions]);

  useEffect(() => {
    let active = true;
    getAllSessionSummaries()
      .then((rows) => {
        if (active) setSessions(rows);
      })
      .catch(() => {
        if (active) setNotice(t("profile.storageUnavailable"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t]);

  async function exportJson() {
    try {
      const json = await exportSummariesJson();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "driver-profile-backup.json";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setNotice(t("profile.storageUnavailable"));
    }
  }

  async function importJson(file: File | null) {
    if (!file) return;
    setImportError("");
    setNotice("");
    try {
      const parsed = JSON.parse(await file.text());
      const rows = Array.isArray(parsed.sessions) ? parsed.sessions : Array.isArray(parsed) ? parsed : null;
      if (!rows) {
        setImportError(t("profile.importError"));
        return;
      }
      const count = await importSummaries(rows as SessionSummary[]);
      const all = await getAllSessionSummaries();
      setSessions(all);
      setNotice(t("profile.imported", { count }));
    } catch {
      setImportError(t("profile.importError"));
    }
  }

  if (loading) {
    return <main className="profile-page"><p className="profile-page__hint">{t("profile.loading")}</p></main>;
  }

  return (
    <main className="profile-page">
      <header className="profile-page__header">
        <div>
          <p className="hero-kicker"><User size={15} /> {t("profile.kicker")}</p>
          <h1>{t("profile.title")}</h1>
          <p>{t("profile.description")}</p>
        </div>
        <div className="profile-page__actions">
          <button type="button" className="story-button" onClick={exportJson}>
            <Download size={15} /> {t("profile.export")}
          </button>
          <label className="story-button">
            <Upload size={15} /> {t("profile.import")}
            <input className="hidden" type="file" accept="application/json,.json" onChange={(event) => void importJson(event.target.files?.[0] ?? null)} />
          </label>
          <button type="button" className="story-button" onClick={() => void clearAllSummaries().then(() => setSessions([]))}>
            {t("profile.clear")}
          </button>
        </div>
      </header>
      {notice ? <p className="profile-page__notice">{notice}</p> : null}
      {importError ? <p className="profile-page__error">{importError}</p> : null}

      {sessions.length === 0 ? (
        <p className="profile-page__hint">{t("profile.noData")}</p>
      ) : (
        <>
          <div className="public-demo-metrics">
            <div><span>{t("profile.totalSessions")}</span><strong>{profile.total_sessions}</strong><small>{t("profile.sessionsStored")}</small></div>
            <div><span>{t("profile.weaknessesTitle")}</span><strong>{profile.weaknesses.length}</strong><small>{t("profile.weaknessesSubtitle")}</small></div>
            <div><span>{t("profile.weeklyFocusTitle")}</span><strong>{profile.weekly_focus.length}</strong><small>{t("profile.weeklyFocusSubtitle")}</small></div>
          </div>

          <section className="profile-page__section">
            <h2>{t("profile.fastestCurve")}</h2>
            {profile.tracks.map((track) => (
              <div key={track.track_id} className="profile-page__chart">
                <h3>{track.track_name}</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={track.laps.map((lap, index) => ({ index: index + 1, lap_time: lap.lap_time }))}>
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                    <XAxis dataKey="index" tick={{ fontSize: 10, fill: "#64748b" }} />
                    <YAxis domain={["dataMin - 0.2", "dataMax + 0.2"]} tick={{ fontSize: 10, fill: "#64748b" }} />
                    <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", fontSize: 12 }} />
                    <Line type="monotone" dataKey="lap_time" name={t("profile.fastestLap")} stroke="#35d6d0" dot={{ r: 3 }} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ))}
          </section>

          <section className="profile-page__section">
            <h2>{t("profile.weaknessesTitle")}</h2>
            {profile.weaknesses.length ? (
              <ul className="profile-page__list">
                {profile.weaknesses.map((weakness) => (
                  <li key={weakness.corner}>
                    <strong>{weakness.corner}</strong>
                    <span>{t("profile.weaknessDetail", { count: weakness.sessions_count, gain: weakness.average_net_gain.toFixed(3) })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="profile-page__hint">{t("profile.noWeaknesses")}</p>
            )}
          </section>

          <section className="profile-page__section">
            <h2>{t("profile.weeklyFocusTitle")}</h2>
            {profile.weekly_focus.length ? (
              <ol className="profile-page__list">
                {profile.weekly_focus.map((item) => (
                  <li key={item.priority}>
                    <strong>{item.priority}</strong>
                    <span>{t("profile.focusDetail", { count: item.sessions })}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="profile-page__hint">{t("profile.noFocus")}</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
