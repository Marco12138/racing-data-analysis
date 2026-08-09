import type { XrkAnalysis } from "./xrkAnalysisApi";

export const REAL_DEMO_ASSET_URL =
  process.env.NEXT_PUBLIC_REAL_DEMO_ASSET_URL?.trim() ?? "";

export type PublishedRealDemoSession = {
  schema_version: 1;
  provenance: {
    dataset_kind: "anonymized_real_session";
    derived_from_real_session: true;
    publication_permission: "confirmed";
    telemetry_values: "measured_or_backend_calculated_only";
  };
  privacy_review: {
    status: "passed";
    private_identifiers_removed: true;
    free_text_reviewed: true;
  };
  display: {
    driver: "Anonymous Driver";
    vehicle: "Anonymous Kart";
    track: "Anonymous Circuit";
    date: "Private";
  };
  analysis: XrkAnalysis;
};

/** Load an optional, publication-reviewed real demo without weakening the CSV fallback. */
export async function loadPublishedRealDemo(
  assetUrl = REAL_DEMO_ASSET_URL,
  fetcher: typeof fetch = fetch,
): Promise<PublishedRealDemoSession | null> {
  if (!isSameOriginAssetPath(assetUrl)) return null;

  try {
    const response = await fetcher(assetUrl, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    return isPublishedRealDemo(value) ? sanitizePublishedRealDemo(value) : null;
  } catch {
    return null;
  }
}

function sanitizePublishedRealDemo(
  value: PublishedRealDemoSession,
): PublishedRealDemoSession {
  return {
    ...value,
    analysis: {
      ...value.analysis,
      inspection_id: "published-demo",
      file_fingerprint: "redacted",
      metadata: { data_source: "Anonymized real session" },
      track: value.analysis.track
        ? { ...value.analysis.track, track_id: "anonymous-circuit" }
        : null,
    },
  };
}

/** Enforce provenance, privacy review, real-lap references, and complete demo capability. */
export function isPublishedRealDemo(value: unknown): value is PublishedRealDemoSession {
  if (!isRecord(value) || value.schema_version !== 1) return false;
  const provenance = value.provenance;
  const privacy = value.privacy_review;
  const display = value.display;
  const analysis = value.analysis;

  if (
    !isRecord(provenance)
    || provenance.dataset_kind !== "anonymized_real_session"
    || provenance.derived_from_real_session !== true
    || provenance.publication_permission !== "confirmed"
    || provenance.telemetry_values !== "measured_or_backend_calculated_only"
  ) return false;

  if (
    !isRecord(privacy)
    || privacy.status !== "passed"
    || privacy.private_identifiers_removed !== true
    || privacy.free_text_reviewed !== true
  ) return false;

  if (
    !isRecord(display)
    || display.driver !== "Anonymous Driver"
    || display.vehicle !== "Anonymous Kart"
    || display.track !== "Anonymous Circuit"
    || display.date !== "Private"
  ) return false;

  if (!isRecord(analysis) || analysis.format !== "aim_xrk_analysis") return false;
  const track = analysis.track;
  const quality = analysis.lap_quality;
  const topLaps = analysis.top_laps_comparison;
  const consensus = analysis.consensus_benchmark;
  const sectors = analysis.sectors;
  const zones = analysis.zones;

  return Boolean(
    isRecord(track)
    && Array.isArray(track.reference)
    && track.reference.length > 1
    && track.reference.every(isTrackPoint)
    && Array.isArray(analysis.comparison)
    && analysis.comparison.length > 1
    && analysis.comparison.every(isTelemetryComparisonRow)
    && isRecord(quality)
    && Array.isArray(quality.top_valid_laps)
    && quality.top_valid_laps.length >= 3
    && isRecord(topLaps)
    && topLaps.synthetic_curve_generated === false
    && Array.isArray(topLaps.laps)
    && topLaps.laps.length >= 3
    && Array.isArray(topLaps.aligned)
    && topLaps.aligned.length > 1
    && isRecord(consensus)
    && consensus.reference_policy === "real_completed_reference_eligible_laps_only"
    && consensus.synthetic_curve_generated === false
    && Array.isArray(consensus.lap_order)
    && consensus.lap_order.length >= 3
    && Array.isArray(consensus.corners)
    && consensus.corners.length > 0
    && isRecord(sectors)
    && Array.isArray(sectors.lap_rows)
    && sectors.lap_rows.length >= 3
    && sectors.lap_rows.every(isTimedLap)
    && isRecord(zones)
    && Array.isArray(zones.active)
    && Array.isArray(zones.comparisons)
    && zones.comparisons.length > 0
  );
}

function isTrackPoint(value: unknown): boolean {
  return isRecord(value)
    && isFiniteNumber(value.distance_m)
    && isFiniteNumber(value.local_x_m)
    && isFiniteNumber(value.local_y_m);
}

function isTelemetryComparisonRow(value: unknown): boolean {
  if (!isRecord(value) || !isFiniteNumber(value.distance_m)) return false;
  return [
    value.reference_speed,
    value.target_speed,
    value.reference_rpm,
    value.target_rpm,
  ].some(isFiniteNumber);
}

function isTimedLap(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.lap) && isFiniteNumber(value.lap_time);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSameOriginAssetPath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
