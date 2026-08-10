export type StoryboardOverlay = {
  distance_m: number[];
  session_time_s: number[];
  speed_kmh: number[];
  rpm: number[];
  longitudinal_g: number[];
  lateral_g: number[];
  throttle: Array<number | null>;
  brake: Array<number | null>;
  available: { throttle: boolean; brake: boolean };
};

export type StoryboardNode = {
  id: string;
  kind: "corner" | "event";
  title: string;
  time_range: [number, number];
  distance_range_m: [number, number];
  telemetry_overlay: StoryboardOverlay;
  insight: string;
  drill: string;
  evidence_laps: number[];
  corner: { name: string; entry_distance_m: number; exit_distance_m: number } | null;
  source: "structured" | "llm";
};

export type StoryboardResponse = {
  schema_version: 1;
  token: string;
  watermark: string;
  created_at: string;
  expires_at: string;
  analysis: {
    reference_lap: number | null;
    target_lap: number | null;
    fastest_lap: { lap: number; lap_time: number } | null;
  };
  video: { duration_s: number; required: boolean; uploaded: boolean };
  nodes: StoryboardNode[];
};

export type StoryboardAlignmentInput = {
  offset_ms: number;
  video_duration_s: number;
  target_lap: number | null;
  telemetry_session_time_s: number | null;
  video_time_s: number | null;
  video_size_bytes: number | null;
  video_last_modified_ms: number | null;
  video_mime_type: string | null;
};

export type StoryboardFetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Validate a backend storyboard payload. Returns null instead of trusting bad data. */
export function parseStoryboardResponse(value: unknown): StoryboardResponse | null {
  if (!isRecord(value) || value.schema_version !== 1) return null;
  if (typeof value.token !== "string" || !value.token) return null;
  if (typeof value.watermark !== "string" || !value.watermark) return null;
  if (typeof value.created_at !== "string" || typeof value.expires_at !== "string") return null;
  if (!isRecord(value.analysis)) return null;
  if (!isRecord(value.video) || !isFiniteNumber(value.video.duration_s) || value.video.duration_s <= 0) return null;
  if (!Array.isArray(value.nodes) || value.nodes.length < 1) return null;

  const nodes: StoryboardNode[] = [];
  for (const raw of value.nodes) {
    const node = parseNode(raw);
    if (!node) return null;
    nodes.push(node);
  }
  return {
    schema_version: 1,
    token: value.token,
    watermark: value.watermark,
    created_at: value.created_at,
    expires_at: value.expires_at,
    analysis: {
      reference_lap: finiteOrNull(value.analysis.reference_lap),
      target_lap: finiteOrNull(value.analysis.target_lap),
      fastest_lap: isRecord(value.analysis.fastest_lap)
        ? { lap: value.analysis.fastest_lap.lap, lap_time: value.analysis.fastest_lap.lap_time }
        : null,
    },
    video: {
      duration_s: value.video.duration_s,
      required: value.video.required === true,
      uploaded: value.video.uploaded === true,
    },
    nodes,
  };
}

function parseNode(value: unknown): StoryboardNode | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id) return null;
  if (value.kind !== "corner" && value.kind !== "event") return null;
  if (typeof value.title !== "string" || !value.title) return null;
  if (typeof value.insight !== "string" || !value.insight) return null;
  if (typeof value.drill !== "string" || !value.drill.trim()) return null;
  if (value.source !== "structured" && value.source !== "llm") return null;
  if (!Array.isArray(value.evidence_laps) || !value.evidence_laps.every((lap) => Number.isInteger(lap))) return null;

  const timeRange = finitePair(value.time_range);
  const distanceRange = finitePair(value.distance_range_m);
  if (!timeRange || !distanceRange) return null;

  const overlay = parseOverlay(value.telemetry_overlay);
  if (!overlay) return null;

  const corner = isRecord(value.corner)
    ? {
        name: String(value.corner.name ?? ""),
        entry_distance_m: Number(value.corner.entry_distance_m),
        exit_distance_m: Number(value.corner.exit_distance_m),
      }
    : null;
  if (value.corner != null && corner === null) return null;

  return {
    id: value.id,
    kind: value.kind,
    title: value.title,
    time_range: timeRange,
    distance_range_m: distanceRange,
    telemetry_overlay: overlay,
    insight: value.insight,
    drill: value.drill,
    evidence_laps: value.evidence_laps,
    corner,
    source: value.source,
  };
}

function parseOverlay(value: unknown): StoryboardOverlay | null {
  if (!isRecord(value)) return null;
  if (!isRecord(value.available)) return null;
  const length = arrayLength(value.distance_m);
  if (length < 2) return null;
  if (!sameLength(value.session_time_s, length)) return null;
  if (!sameLength(value.speed_kmh, length)) return null;
  if (!sameLength(value.rpm, length)) return null;
  if (!sameLength(value.longitudinal_g, length)) return null;
  if (!sameLength(value.lateral_g, length)) return null;
  if (!(value.throttle.length === 0 || sameLength(value.throttle, length))) return null;
  if (!(value.brake.length === 0 || sameLength(value.brake, length))) return null;
  if (!allFinite(value.distance_m) || !allFinite(value.session_time_s)) return null;
  return {
    distance_m: value.distance_m,
    session_time_s: value.session_time_s,
    speed_kmh: value.speed_kmh,
    rpm: value.rpm,
    longitudinal_g: value.longitudinal_g,
    lateral_g: value.lateral_g,
    throttle: value.throttle,
    brake: value.brake,
    available: isRecord(value.available)
      ? { throttle: value.available.throttle === true, brake: value.available.brake === true }
      : { throttle: false, brake: false },
  };
}

export async function fetchStoryboardPayload(
  apiOrigin: string,
  apiPrefix: string,
  token: string,
  fetcher: StoryboardFetcher = fetch,
): Promise<StoryboardResponse | null> {
  try {
    const response = await fetcher(`${baseApiUrl(apiOrigin, apiPrefix)}/storyboards/${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return parseStoryboardResponse(await response.json());
  } catch {
    return null;
  }
}

export async function createStoryboardPayload(
  apiOrigin: string,
  apiPrefix: string,
  body: unknown,
  fetcher: StoryboardFetcher = fetch,
): Promise<StoryboardResponse | null> {
  try {
    const response = await fetcher(`${baseApiUrl(apiOrigin, apiPrefix)}/storyboard`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return parseStoryboardResponse(await response.json());
  } catch {
    return null;
  }
}

function baseApiUrl(apiOrigin: string, apiPrefix: string): string {
  const origin = apiOrigin.replace(/\/+$/, "");
  const prefix = `/${apiPrefix.replace(/^\/+|\/+$/g, "")}`;
  return `${origin}${prefix}`;
}

function finitePair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  if (!isFiniteNumber(value[0]) || !isFiniteNumber(value[1])) return null;
  return [value[0], value[1]];
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : -1;
}

function sameLength(value: unknown, length: number): boolean {
  return Array.isArray(value) && value.length === length;
}

function allFinite(value: unknown): boolean {
  return Array.isArray(value) && value.every(isFiniteNumber);
}

function finiteOrNull(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- validator narrows unknown records after structural checks
function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
