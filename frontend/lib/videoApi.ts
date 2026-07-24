import { apiUrl, resolveApiUrl } from "./config";

export type VideoSource = {
  source_id: string;
  name: string;
  kind: "mp4" | "mov" | "zip";
  size_bytes: number;
  root: string;
  relative_path: string;
  modified_at: number;
};

export type VideoMetadata = {
  duration_seconds: number;
  fps: number;
  frame_count: number;
  width: number;
  height: number;
  resolution: string;
  codec: string;
  file_size_bytes: number;
};

export type VideoKeyframe = {
  index: number;
  timestamp: number;
  filename: string;
  brightness: number;
  sharpness: number;
};

export type VideoMarker = {
  id: number;
  marker_type: "lap_start" | "lap_end" | "corner" | "event";
  timestamp: number;
  lap: number | null;
  notes: string;
  created_at: string;
};

export type VideoJob = {
  id: string;
  source_id: string;
  source_name: string;
  status: "queued" | "extracting" | "analyzing" | "completed" | "failed";
  progress: number;
  metadata: VideoMetadata | null;
  keyframes: VideoKeyframe[];
  warnings: string[];
  report: string | null;
  error: string | null;
  markers: VideoMarker[];
  created_at: string;
  updated_at: string;
};

export type DeploymentCapabilities = {
  environment: "development" | "test" | "production";
  mode: "local" | "cloud";
  api_version: string;
  local_video_library: boolean;
  direct_uploads: boolean;
  persistent_object_storage: boolean;
  durable_task_queue: boolean;
  authentication: boolean;
  aim_imports: boolean;
  xrk_server_import: {
    enabled: boolean;
    available: boolean;
    parser: string;
    version: string | null;
    license: string | null;
    status: string;
    platform: string;
    max_upload_bytes: number;
    timeout_seconds: number;
    error_code: string | null;
    message: string | null;
  };
};

export function getDeploymentCapabilities(): Promise<DeploymentCapabilities> {
  return apiRequest<DeploymentCapabilities>("/capabilities");
}

export async function getVideoLibrary(): Promise<VideoSource[]> {
  const data = await apiRequest<{ sources: VideoSource[] }>("/video/library");
  return data.sources;
}

export async function createVideoJob(sourceId: string): Promise<string> {
  const data = await apiRequest<{ job_id: string }>("/video/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_id: sourceId }),
  });
  return data.job_id;
}

export function getVideoJob(jobId: string): Promise<VideoJob> {
  return apiRequest<VideoJob>(`/video/jobs/${jobId}`);
}

export async function createVideoMarker(
  jobId: string,
  marker: Pick<VideoMarker, "marker_type" | "timestamp" | "lap" | "notes">
): Promise<VideoMarker> {
  const data = await apiRequest<{ marker: VideoMarker }>(`/video/jobs/${jobId}/markers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(marker),
  });
  return data.marker;
}

export async function deleteVideoMarker(jobId: string, markerId: number): Promise<void> {
  await apiRequest<void>(`/video/jobs/${jobId}/markers/${markerId}`, { method: "DELETE" });
}

export async function clearVideoJob(jobId: string): Promise<void> {
  await apiRequest<void>(`/video/jobs/${jobId}`, { method: "DELETE" });
}

export function videoStreamUrl(jobId: string) {
  return apiUrl(`/video/jobs/${jobId}/stream`);
}

export function keyframeUrl(jobId: string, filename: string) {
  return apiUrl(`/video/jobs/${jobId}/frames/${encodeURIComponent(filename)}`);
}

export function markerExportUrl(jobId: string) {
  return apiUrl(`/video/jobs/${jobId}/markers.csv`);
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(await resolveApiUrl(path), init);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = body.message ?? body.detail ?? body.error?.message ?? message;
    } catch {
      // Preserve the status-based fallback for non-JSON errors.
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
