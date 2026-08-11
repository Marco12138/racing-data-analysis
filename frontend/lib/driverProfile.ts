export type SessionSummary = {
  inspection_id: string;
  track_id: string;
  track_name: string;
  driver_name: string;
  vehicle_name: string;
  fastest_lap: { lap: number; lap_time: number };
  corner_improvements: Array<{ corner: string; net_gain: number }>;
  training_priorities: string[];
  analyzed_at: number;
};

export type SessionSummaryInput = Omit<SessionSummary, "analyzed_at"> & {
  analyzed_at?: number;
};

export const WEAKNESS_MIN_SESSIONS = 3;
export const WEAKNESS_MIN_NET_GAIN_S = 0.1;
export const WEEK_MS = 7 * 24 * 3600 * 1000;

export function buildSessionSummary(input: SessionSummaryInput): SessionSummary {
  return {
    inspection_id: input.inspection_id,
    track_id: input.track_id || "unknown-track",
    track_name: input.track_name || "Unknown track",
    driver_name: input.driver_name,
    vehicle_name: input.vehicle_name,
    fastest_lap: input.fastest_lap,
    corner_improvements: (input.corner_improvements ?? []).filter(
      (item) => Number.isFinite(item.net_gain) && item.net_gain > 0,
    ),
    training_priorities: input.training_priorities ?? [],
    analyzed_at: input.analyzed_at ?? Date.now(),
  };
}

export function perTrackFastestCurve(sessions: SessionSummary[]): Array<{
  track_id: string;
  track_name: string;
  laps: Array<{ lap: number; lap_time: number; analyzed_at: number }>;
}> {
  const byTrack = new Map<string, {
    track_name: string;
    laps: Array<{ lap: number; lap_time: number; analyzed_at: number }>;
  }>();
  for (const session of sessions) {
    const entry = byTrack.get(session.track_id) ?? {
      track_name: session.track_name,
      laps: [],
    };
    entry.laps.push({
      lap: session.fastest_lap.lap,
      lap_time: session.fastest_lap.lap_time,
      analyzed_at: session.analyzed_at,
    });
    byTrack.set(session.track_id, entry);
  }
  return Array.from(byTrack.entries()).map(([track_id, entry]) => ({
    track_id,
    track_name: entry.track_name,
    laps: entry.laps.sort((a, b) => a.analyzed_at - b.analyzed_at),
  }));
}

export function findRepeatedWeaknesses(
  sessions: SessionSummary[],
  options: { minSessions?: number; minNetGainS?: number } = {},
): Array<{ corner: string; sessions_count: number; average_net_gain: number }> {
  const minSessions = options.minSessions ?? WEAKNESS_MIN_SESSIONS;
  const minNetGain = options.minNetGainS ?? WEAKNESS_MIN_NET_GAIN_S;
  const byCorner = new Map<string, number[]>();
  for (const session of sessions) {
    for (const item of session.corner_improvements) {
      if (item.net_gain < minNetGain) continue;
      const gains = byCorner.get(item.corner) ?? [];
      gains.push(item.net_gain);
      byCorner.set(item.corner, gains);
    }
  }
  return Array.from(byCorner.entries())
    .filter(([, gains]) => gains.length >= minSessions)
    .map(([corner, gains]) => ({
      corner,
      sessions_count: gains.length,
      average_net_gain: Number((gains.reduce((sum, value) => sum + value, 0) / gains.length).toFixed(3)),
    }))
    .sort((a, b) => b.average_net_gain - a.average_net_gain);
}

export function rankTrainingPriorities(
  sessions: SessionSummary[],
  options: { withinMs?: number; limit?: number } = {},
): Array<{ priority: string; sessions: number }> {
  const withinMs = options.withinMs ?? WEEK_MS;
  const limit = options.limit ?? 3;
  const cutoff = Date.now() - withinMs;
  const counts = new Map<string, number>();
  for (const session of sessions) {
    if (session.analyzed_at < cutoff) continue;
    for (const priority of session.training_priorities) {
      const key = priority.trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([priority, count]) => ({ priority, sessions: count }))
    .sort((a, b) => b.sessions - a.sessions || a.priority.localeCompare(b.priority))
    .slice(0, limit);
}

export function summarizeProfile(sessions: SessionSummary[]) {
  return {
    total_sessions: sessions.length,
    tracks: perTrackFastestCurve(sessions),
    weaknesses: findRepeatedWeaknesses(sessions),
    weekly_focus: rankTrainingPriorities(sessions),
  };
}
