export type PublicDemoLap = {
  lap: number;
  lap_time: number;
};

export type PublicDemoTrackPoint = {
  distance_m: number;
  local_x_m: number;
  local_y_m: number;
};

export type PublicDemoSectorLap = {
  lap: number;
  total_loss_s: number;
  sector_losses: Record<string, number>;
};

export type PublicDemoSummary = {
  schema_version: 1;
  provenance: {
    dataset_kind: "anonymized_real_session";
    derived_from_real_session: true;
    publication_permission: "confirmed";
  };
  display: {
    driver: string;
    vehicle: string;
    track: string;
  };
  fastest_lap: PublicDemoLap;
  lap_rows: PublicDemoLap[];
  track: {
    lap_length_m: number;
    points: PublicDemoTrackPoint[];
  };
  sector_loss: {
    source: string;
    official: boolean;
    sector_best: Record<string, number>;
    laps: PublicDemoSectorLap[];
  };
  summary: {
    source: "llm" | "structured";
    narrative: string | null;
    bullets: string[];
  };
  synthetic_curve_generated: false;
};

export function parsePublicDemoSummary(value: unknown): PublicDemoSummary | null {
  if (!isRecord(value) || value.schema_version !== 1) return null;
  if (value.synthetic_curve_generated !== false) return null;
  if (!isRecord(value.provenance)) return null;
  if (
    value.provenance.dataset_kind !== "anonymized_real_session"
    || value.provenance.derived_from_real_session !== true
    || value.provenance.publication_permission !== "confirmed"
  ) return null;
  if (!isRecord(value.fastest_lap) || !isLap(value.fastest_lap)) return null;
  if (!Array.isArray(value.lap_rows) || !value.lap_rows.length || !value.lap_rows.every(isLap)) return null;
  if (!isRecord(value.track) || !isFiniteNumber(value.track.lap_length_m)) return null;
  if (!Array.isArray(value.track.points) || value.track.points.length < 2 || !value.track.points.every(isTrackPoint)) return null;
  if (!isRecord(value.sector_loss) || !Array.isArray(value.sector_loss.laps)) return null;
  if (!isRecord(value.summary) || !Array.isArray(value.summary.bullets)) return null;
  return value as PublicDemoSummary;
}

export type PublicDemoFetcher = (url: string) => Promise<Response>;

/**
 * Fetch and validate the compact public demo summary from a backend origin.
 *
 * This is the client-side counterpart of `loadServerPublicDemo`: it is only
 * used when server-rendered demo data is unavailable and the visitor asks to
 * retry. It never synthesizes values; anything that fails validation returns
 * null so the UI keeps showing the explicit unavailable state.
 */
export async function fetchPublicDemoSummary(
  apiOrigin: string,
  apiPrefix: string,
  fetcher: PublicDemoFetcher = fetch,
): Promise<PublicDemoSummary | null> {
  const origin = apiOrigin.replace(/\/+$/, "");
  const prefix = `/${apiPrefix.replace(/^\/+|\/+$/g, "")}`;
  try {
    const response = await fetcher(`${origin}${prefix}/xrk/demo-session`);
    if (!response.ok) return null;
    return parsePublicDemoSummary(await response.json());
  } catch {
    return null;
  }
}

function isLap(value: unknown): boolean {
  return isRecord(value)
    && Number.isInteger(value.lap)
    && isFiniteNumber(value.lap_time)
    && value.lap_time > 0;
}

function isTrackPoint(value: unknown): boolean {
  return isRecord(value)
    && isFiniteNumber(value.distance_m)
    && isFiniteNumber(value.local_x_m)
    && isFiniteNumber(value.local_y_m);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
