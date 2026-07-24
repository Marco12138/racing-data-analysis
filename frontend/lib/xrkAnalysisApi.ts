import type { CsvRow } from "./analysis";
import { FrontendApiConfigError, resolveApiUrl } from "./config";

export type XrkChannel = {
  name: string;
  normalized_name: string;
  canonical_name: string | null;
  unit: string | null;
  sample_count: number;
  sample_rate_hz: number | null;
  first_timestamp_s: number | null;
  last_timestamp_s: number | null;
  available: boolean;
  all_zero: boolean;
  analysis_usage: string[];
};

export type XrkInspection = {
  inspection_id: string;
  expires_at: string;
  filename: string;
  file_size_bytes: number;
  metadata: Record<string, string | number | null>;
  laps: number;
  valid_laps: number[];
  excluded_laps: Array<Record<string, unknown>>;
  channels: XrkChannel[];
  has_gps: boolean;
  has_gps_speed: boolean;
  has_rpm: boolean;
  has_accelerometer: boolean;
  has_gyro: boolean;
  has_lap_timing: boolean;
  has_predefined_sectors: boolean;
  parser: {
    library: string;
    version: string;
    license: string;
    status: string;
    platform: string;
  };
  session_summary: {
    lap_segments: number;
    timed_laps: number;
    session_duration_s: number;
    fastest_lap: { lap: number; lap_time_s: number } | null;
  };
  processing_duration_ms: number;
  warning_codes: string[];
  warnings: string[];
  request_id: string;
};

export type XrkTrackPoint = {
  distance_m: number;
  lap_time_s: number | null;
  session_time_s: number | null;
  local_x_m: number | null;
  local_y_m: number | null;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  rpm: number | null;
  longitudinal_g: number | null;
  lateral_g: number | null;
  time_delta_s?: number | null;
};

export type XrkComparisonRow = Record<string, number | null>;

export type XrkEvent = {
  lap: number;
  sector: number | null;
  zone?: string | null;
  distance_m: number;
  lap_time_s: number;
  session_time_s: number;
  event_type: string;
  confidence: "low" | "medium" | "high";
  channels_used?: string[];
  thresholds: Record<string, number>;
  evidence: Record<string, number | boolean | null>;
};

export type XrkZoneComparison = {
  id: string;
  name: string;
  source: string;
  entry_distance_m: number;
  exit_distance_m: number;
  reference: Record<string, number | string | null>;
  target: Record<string, number | string | null>;
  estimated_zone_loss_s: number | null;
  findings: Array<{
    metric: string;
    label: string;
    reference: number;
    target: number;
    difference: number;
    unit: string;
    evidence_class: string;
  }>;
};

export type XrkAnalysis = {
  format: "aim_xrk_analysis";
  inspection_id: string;
  expires_at: string;
  file_fingerprint: string;
  metadata: Record<string, string | number | null>;
  capabilities: {
    gps: boolean;
    rpm: boolean;
    lap_timing: boolean;
    official_sectors: boolean;
    direct_brake: boolean;
    direct_throttle: boolean;
  };
  reference_lap: number;
  target_lap: number;
  fastest_lap: { lap: number; lap_time: number };
  lap_rows: CsvRow[];
  track: null | {
    track_id: string;
    lap_length_m: number;
    reference_lap: number;
    target_lap: number;
    reference: XrkTrackPoint[];
    target: XrkTrackPoint[];
  };
  comparison: XrkComparisonRow[];
  events: XrkEvent[];
  event_comparison: Array<Record<string, unknown>>;
  sectors: null | {
    source: string;
    official: boolean;
    count: number;
    boundaries_m: number[];
    lap_rows: CsvRow[];
    sector_best: Record<string, number>;
    theoretical_best: number;
    warnings: string[];
  };
  zones: {
    automatic: Array<Record<string, unknown>>;
    active: Array<Record<string, unknown>>;
    comparisons: XrkZoneComparison[];
  };
  evidence_catalog: Record<string, string[]>;
  video_sync: {
    video_time_offset_ms: number;
    lap_video_ranges: Array<{
      lap: number;
      telemetry_start_s: number;
      telemetry_end_s: number;
      video_start_s: number | null;
      video_end_s: number | null;
    }>;
  };
  warnings: string[];
  report: string;
};

export type XrkAnalyzeOptions = {
  inspection_id: string;
  reference_lap?: number | null;
  target_lap?: number | null;
  distance_step_m?: number;
  sector_count?: number;
  sector_boundaries_m?: number[] | null;
  manual_zones?: Array<{
    id?: string;
    name?: string;
    entry_distance_m: number;
    exit_distance_m: number;
  }>;
};

export class XrkApiError extends Error {
  readonly code: string;
  readonly requestId: string | null;

  constructor(message: string, code = "XRK_REQUEST_FAILED", requestId: string | null = null) {
    super(message);
    this.name = "XrkApiError";
    this.code = code;
    this.requestId = requestId;
  }
}

async function responseError(response: Response, fallback: string): Promise<XrkApiError> {
  try {
    const body = (await response.json()) as {
      detail?: string;
      message?: string;
      error_code?: string;
      request_id?: string;
    };
    return new XrkApiError(
      body.message ?? body.detail ?? fallback,
      body.error_code ?? "XRK_REQUEST_FAILED",
      body.request_id ?? response.headers.get("X-Request-ID")
    );
  } catch {
    return new XrkApiError(
      fallback,
      "XRK_REQUEST_FAILED",
      response.headers.get("X-Request-ID")
    );
  }
}

export async function inspectXrkFile(
  file: File,
  signal?: AbortSignal
): Promise<XrkInspection> {
  const form = new FormData();
  form.append("file", file);
  let response: Response;
  try {
    response = await fetch(await resolveApiUrl("/xrk/inspect"), {
      method: "POST",
      body: form,
      signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    if (error instanceof FrontendApiConfigError) throw error;
    throw new XrkApiError(
      "The XRK inspection service could not be reached. CSV and Demo remain available.",
      "XRK_SERVICE_UNREACHABLE"
    );
  }
  if (!response.ok) {
    throw await responseError(response, `XRK inspection failed (${response.status}).`);
  }
  return response.json() as Promise<XrkInspection>;
}

export async function analyzeXrkInspection(
  options: XrkAnalyzeOptions,
  signal?: AbortSignal
): Promise<XrkAnalysis> {
  const response = await fetch(await resolveApiUrl("/xrk/analyze"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
    signal,
  });
  if (!response.ok) {
    throw await responseError(response, `XRK analysis failed (${response.status}).`);
  }
  return response.json() as Promise<XrkAnalysis>;
}

export async function deleteXrkInspection(inspectionId: string): Promise<void> {
  const url = await resolveApiUrl(`/xrk/inspections/${inspectionId}`).catch(() => null);
  if (!url) return;
  await fetch(url, { method: "DELETE" }).catch(() => {
    // Temporary data also expires automatically.
  });
}
