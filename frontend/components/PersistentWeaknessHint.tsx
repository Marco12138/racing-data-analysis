"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { useI18n } from "../lib/i18n";
import { findRepeatedWeaknesses, type SessionSummary } from "../lib/driverProfile";
import { getAllSessionSummaries } from "../lib/driverProfileDb";

export function PersistentWeaknessHint({ trackId }: { trackId: string | null }) {
  const { t } = useI18n();
  const [weaknesses, setWeaknesses] = useState<Array<{ corner: string; sessions_count: number }>>([]);

  useEffect(() => {
    let active = true;
    if (!trackId) return;
    getAllSessionSummaries()
      .then((sessions: SessionSummary[]) => {
        if (!active) return;
        setWeaknesses(findRepeatedWeaknesses(sessions.filter((session) => session.track_id === trackId)));
      })
      .catch(() => {
        // The profile is optional; failures should not block the workspace.
      });
    return () => {
      active = false;
    };
  }, [trackId]);

  if (!weaknesses.length) return null;
  return (
    <p className="persistent-weakness-hint" role="note">
      <AlertTriangle size={15} />
      {t("profile.persistentWeakness", {
        corners: weaknesses.map((item) => `${item.corner}(${item.sessions_count})`).join(", "),
      })}
    </p>
  );
}
