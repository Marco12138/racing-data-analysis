import type { CsvRow } from "./analysis";
import { resolveApiUrl } from "./config";
import { exceedsUploadLimit, materializeUploadBlob } from "./fileUpload";
import type { VideoSyncFeature } from "./videoFeatureExtraction";

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

export type XrkLapQualityRow = {
  lap: number;
  lap_time: number;
  gap_to_fastest: number;
  quality_status: string;
  quality_score: number;
  reasons: string[];
  analysis_eligible: boolean;
  consistency_score?: number;
  behavior_anomaly_score?: number;
};

export type XrkConsensusCorner = {
  corner_id: string;
  corner: string;
  entry_distance_m: number;
  exit_distance_m: number;
  downstream_end_distance_m: number;
  source_laps: number[];
  common_fast_pattern: string[];
  fastest_lap_unique_features: string[];
  repeatability_score: number;
  occurrence_count: number;
  supporting_laps: number[];
  local_gain: number;
  downstream_cost: number;
  net_gain: number;
  transferable_improvement: boolean;
  evidence: {
    features_by_lap: Array<Record<string, number | string | string[] | null>>;
    channels: string[];
    similarity_by_lap: Record<string, number>;
    lap_times: Record<string, number | null>;
    provenance: string;
  };
  confidence: "low" | "medium" | "high";
};

export type XrkTrainingPriority = {
  corner: string;
  why: string;
  what_to_test: string;
  training_drill: string;
  success_criteria: string[];
  stop_condition: string;
  evidence: XrkConsensusCorner["evidence"];
  confidence: "low" | "medium" | "high";
  limitation: string | null;
};

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
  lap_quality: {
    config: {
      absolute_gap_threshold_s: number;
      relative_gap_threshold_pct: number;
    };
    laps: XrkLapQualityRow[];
    reference_eligible_count: number;
    top_valid_laps: XrkLapQualityRow[];
    fastest_consistent_lap: XrkLapQualityRow | null;
    minimum_top_laps_met: boolean;
    notice: string | null;
  };
  top_laps_comparison: {
    laps: XrkLapQualityRow[];
    fastest_consistent_lap: XrkLapQualityRow | null;
    aligned: XrkComparisonRow[];
    distance_step_m: number | null;
    synthetic_curve_generated: false;
  };
  events: XrkEvent[];
  event_comparison: Array<Record<string, unknown>>;
  sectors: null | {
    source: string;
    official: boolean;
    count: number;
    boundaries_m: number[];
    lap_rows: CsvRow[];
    sector_best: Record<string, number>;
    warnings: string[];
  };
  zones: {
    automatic: Array<Record<string, unknown>>;
    active: Array<Record<string, unknown>>;
    comparisons: XrkZoneComparison[];
  };
  evidence_catalog: Record<string, string[]>;
  consensus_benchmark: {
    reference_policy: "real_completed_reference_eligible_laps_only";
    lap_order: number[];
    lap_count: number;
    synthetic_curve_generated: false;
    corners: XrkConsensusCorner[];
  };
  achievable_improvement_range: {
    minimum_improvement_s: number;
    maximum_improvement_s: number;
    confidence: "low" | "medium" | "high";
    basis: string[];
    source_laps: number[];
    limitations: string[];
  };
  ai_coach_summary: {
    reference_statement: string;
    top_valid_laps: XrkLapQualityRow[];
    common_fast_patterns: Array<Record<string, unknown>>;
    fastest_lap_net_differences: Array<{
      corner: string;
      local_gain_s: number;
      downstream_cost_s: number;
      net_gain_s: number;
      confidence: string;
    }>;
    fastest_lap_unique_features: Array<{
      corner: string;
      features: string[];
      transferable_improvement: false;
      confidence: string;
      reason: string;
    }>;
    emerging_improvements: Array<{
      corner: string;
      reason: string;
      supporting_laps: number[];
      confidence: string;
    }>;
    rejected_apparent_improvements: Array<{
      corner: string;
      local_gain_s: number;
      downstream_cost_s: number;
      net_gain_s: number;
      reason: string;
    }>;
    training_priorities: XrkTrainingPriority[];
    stable_strengths: Array<{
      corner: string;
      finding: string;
      evidence: Array<Record<string, unknown>>;
    }>;
    limitations: string[];
  };
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
  narrative?: string | null;
};

export type XrkAnalyzeOptions = {
  inspection_id: string;
  reference_lap?: number | null;
  target_lap?: number | null;
  distance_step_m?: number;
  sector_count?: number;
  sector_boundaries_m?: number[] | null;
  lap_quality_absolute_gap_s?: number;
  lap_quality_relative_gap_pct?: number;
  language?: "zh" | "en";
  manual_zones?: Array<{
    id?: string;
    name?: string;
    entry_distance_m: number;
    exit_distance_m: number;
  }>;
};

export type VideoSyncAutoResult = {
  offset_ms: number;
  confidence: number;
  reliable: boolean;
  source: "temporary_xrk_inspection" | "request_summary";
  evidence: {
    method: string;
    offset_convention: string;
    video_feature_points: number;
    telemetry_speed_points: number;
    video_change_events: number;
    telemetry_deceleration_events: number;
    matched_overlap_s: number;
    overlap_ratio: number;
    best_correlation: number;
    peak_margin: number;
    reliable_confidence_threshold: number;
  };
  warnings: string[];
  request_id: string;
};

export type DriverComparisonResult = {
  format: "cross_session_real_lap_comparison";
  sessions: {
    a: CrossSessionSummary;
    b: CrossSessionSummary;
  };
  lap_time_difference_s: number;
  comparison: Array<Record<string, number | null>>;
  track: null | {
    lap_length_a_m: number;
    lap_length_b_m: number;
    common_distance_m: number;
    a: XrkTrackPoint[];
    b: XrkTrackPoint[];
  };
  zones: Array<{
    id: string;
    name: string;
    entry_distance_m: number;
    exit_distance_m: number;
    a: Record<string, number | string | null>;
    b: Record<string, number | string | null>;
    time_difference_s: number | null;
  }>;
  evidence_catalog: Record<string, string[]>;
  warnings: string[];
  synthetic_curve_generated: false;
  reference_policy: string;
  report: string;
};

export type CrossSessionSummary = {
  inspection_id: string;
  metadata: Record<string, string | number | null>;
  selected_lap: number;
  selected_lap_time_s: number;
  lap_quality: XrkAnalysis["lap_quality"];
  gps_quality: Record<string, unknown>;
  available_channels: string[];
};

export type SetupExperimentResult = {
  format: "setup_experiment_real_lap_analysis";
  experiment: Record<string, unknown>;
  baseline: SetupSessionSummary;
  modified: SetupSessionSummary;
  zones: Array<{
    id: string;
    name: string;
    entry_distance_m: number;
    exit_distance_m: number;
    baseline_top3: Record<string, number | null>;
    modified_top3: Record<string, number | null>;
    source_laps: { baseline: number[]; modified: number[] };
    local_gain_s: number;
    downstream_cost_s: number;
    net_gain_s: number;
    repeatability_score: number;
    confidence: "low" | "medium" | "high";
    evidence: string[];
  }>;
  measured: string[];
  calculated: string[];
  driver_feedback: Record<string, string>;
  inferred: Array<{ zone: string; finding: string; confidence: string }>;
  confounders: string[];
  next_test: Array<{ priority: number; candidate: string; basis: string; confidence: string }>;
  warnings: string[];
  synthetic_curve_generated: false;
  report: string;
};

export type SetupSessionSummary = {
  inspection_id: string;
  metadata: Record<string, string | number | null>;
  top_valid_laps: XrkLapQualityRow[];
  lap_count: number;
  median_lap_time_s: number;
  lap_time_range_s: number;
  lap_quality: XrkAnalysis["lap_quality"];
};

export class XrkApiError extends Error {
  readonly code: string;
  readonly requestId: string | null;
  readonly status: number | null;

  constructor(
    message: string,
    code = "XRK_REQUEST_FAILED",
    requestId: string | null = null,
    status: number | null = null
  ) {
    super(message);
    this.name = "XrkApiError";
    this.code = code;
    this.requestId = requestId;
    this.status = status;
  }
}

async function responseError(response: Response, fallback: string): Promise<XrkApiError> {
  try {
    const body = (await response.json()) as {
      detail?: unknown;
      message?: unknown;
      error_code?: string;
      request_id?: string;
    };
    return new XrkApiError(
      readableApiErrorMessage(body.message, body.detail, fallback),
      body.error_code ?? "XRK_REQUEST_FAILED",
      body.request_id ?? response.headers.get("X-Request-ID"),
      response.status
    );
  } catch {
    return new XrkApiError(
      fallback,
      "XRK_REQUEST_FAILED",
      response.headers.get("X-Request-ID"),
      response.status
    );
  }
}

/**
 * FastAPI validation errors return `detail` as an array of objects; backend
 * PublicApiError responses use a plain `message` string. Always render a
 * readable string so the UI never shows "[object Object]".
 */
function readableApiErrorMessage(
  message: unknown,
  detail: unknown,
  fallback: string,
): string {
  if (typeof message === "string" && message.trim()) return message;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg);
        }
        return "";
      })
      .filter((part) => part.trim());
    if (parts.length) return parts.join("；");
  } else if (typeof detail === "string" && detail.trim()) {
    return detail;
  }
  return fallback;
}

export async function inspectXrkFile(
  file: File,
  signal?: AbortSignal,
  maxUploadBytes?: number | null,
): Promise<XrkInspection> {
  if (!file || file.size <= 0) {
    throw new XrkApiError(
      "所选文件大小为 0，请重新选择 XRK 文件。",
      "XRK_UPLOAD_EMPTY_FILE"
    );
  }
  if (exceedsUploadLimit(file, maxUploadBytes)) {
    throw new XrkApiError(
      `XRK 文件为 ${formatUploadBytes(file.size)}，超过当前服务的 ${formatUploadBytes(maxUploadBytes!)} 上传上限。`,
      "XRK_FILE_TOO_LARGE",
      null,
      413,
    );
  }

  let blob: Blob;
  try {
    blob = await materializeUploadBlob(file);
    if (blob.size !== file.size) {
      throw new XrkApiError(
        "文件读取不完整，请重新选择 XRK 文件。",
        "XRK_UPLOAD_EMPTY_FILE"
      );
    }
  } catch (error) {
    if (error instanceof XrkApiError) throw error;
    throw new XrkApiError(
      "浏览器无法读取所选 XRK 文件。请重新选择文件，或确认文件未被移动和占用。",
      "XRK_FILE_READ_FAILED",
    );
  }

  const url = await resolveApiUrl("/xrk/inspect");
  let response: Response;
  try {
    const form = new FormData();
    form.append("file", blob, file.name);
    response = await fetch(url, {
      method: "POST",
      body: form,
      signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    if (error instanceof XrkApiError) throw error;
    throw new XrkApiError(
      "浏览器未能把 XRK 发送到分析服务。请检查网络连接；若能力检查正常，请检查 Cloudflare 代理来源和上传限制。CSV 与 Demo 仍可使用。",
      "XRK_UPLOAD_TRANSPORT_FAILED"
    );
  }
  if (!response.ok) {
    throw await responseError(response, `XRK inspection failed (${response.status}).`);
  }
  return response.json() as Promise<XrkInspection>;
}

function formatUploadBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
}

export async function getXrkInspection(inspectionId: string): Promise<XrkInspection> {
  const response = await fetch(await resolveApiUrl(`/xrk/inspections/${inspectionId}`));
  if (!response.ok) {
    throw await responseError(response, `XRK session restore failed (${response.status}).`);
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

export async function autoSyncVideoTelemetry(options: {
  inspection_id: string;
  video_features: VideoSyncFeature[];
  max_offset_s?: number;
  search_step_s?: number;
  min_overlap_s?: number;
}, signal?: AbortSignal): Promise<VideoSyncAutoResult> {
  const response = await fetch(await resolveApiUrl("/xrk/video-sync/auto"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
    signal,
  });
  if (!response.ok) {
    throw await responseError(response, `Automatic video alignment failed (${response.status}).`);
  }
  return response.json() as Promise<VideoSyncAutoResult>;
}

export async function deleteXrkInspection(inspectionId: string): Promise<void> {
  const url = await resolveApiUrl(`/xrk/inspections/${inspectionId}`).catch(() => null);
  if (!url) return;
  await fetch(url, { method: "DELETE" }).catch(() => {
    // Temporary data also expires automatically.
  });
}

export async function compareDriverLaps(options: {
  session_a: { inspection_id: string; lap?: number | null };
  session_b: { inspection_id: string; lap?: number | null };
  distance_step_m?: number;
  manual_zones?: XrkAnalyzeOptions["manual_zones"];
}): Promise<DriverComparisonResult> {
  const response = await fetch(await resolveApiUrl("/comparisons/laps"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!response.ok) {
    throw await responseError(response, `Driver comparison failed (${response.status}).`);
  }
  return response.json() as Promise<DriverComparisonResult>;
}

export async function analyzeSetupExperiment(options: {
  baseline_inspection_id: string;
  modified_inspection_id: string;
  experiment: {
    id?: string;
    name: string;
    primary_change: {
      category: string;
      parameter: string;
      before: string | number | null;
      after: string | number | null;
      unit?: string | null;
    };
    secondary_changes?: Array<Record<string, string | number | null>>;
    conditions?: Record<string, string | number | null>;
    driver_feedback?: Record<string, string>;
  };
  distance_step_m?: number;
  manual_zones?: XrkAnalyzeOptions["manual_zones"];
}): Promise<SetupExperimentResult> {
  const response = await fetch(await resolveApiUrl("/setup-experiments/analyze"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!response.ok) {
    throw await responseError(response, `Setup experiment failed (${response.status}).`);
  }
  return response.json() as Promise<SetupExperimentResult>;
}
