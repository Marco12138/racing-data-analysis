export type NarrativeFeedbackInput = {
  node_id: string;
  token: string | null;
  source: "llm" | "structured" | "storyboard" | "coach";
  locale: "zh" | "en";
  thumbs_up: boolean;
};

export type FeedbackFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type ClipFeedbackInput = {
  feedback_id: string; clip_id: string; session_fingerprint: string; zone_id: string;
  reference_lap: number; target_lap: number; start_s: number; end_s: number;
  verdict: "accurate" | "partly_accurate" | "inaccurate" | "uncertain";
  reason: "too_early" | "too_late" | "wrong_corner" | "too_short" | "not_relevant" | "sync_uncertain" | null;
  locale: "zh" | "en"; selection_version: "coach-review-v1";
  selection_source?: "automatic" | "manual"; side?: "reference" | "target"; sync_confirmed?: boolean;
  correction?: { original_clip_id: string | null; original_start_s: number | null; original_end_s: number | null;
    anchor_video_s: number | null; anchor_session_s: number | null; anchor_distance_m: number | null } | null;
};

export async function submitClipFeedback(apiOrigin: string, apiPrefix: string, input: ClipFeedbackInput,
  fetcher: FeedbackFetcher = fetch): Promise<boolean> {
  try {
    const response = await fetcher(`${apiOrigin.replace(/\/+$/, "")}/${apiPrefix.replace(/^\/+|\/+$/g, "")}/feedback/clip-selection`, {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    if (!response.ok) return false;
    const result = await response.json() as Record<string, unknown> | null;
    return result?.received === true && result.id === input.feedback_id && result.verdict === input.verdict;
  } catch { return false; }
}

export type CoachValidationInput = {
  inspection_id: string;
  episode_id: string;
  pattern_id: string;
  pattern_type:
    | "BRAKE_LATE_REINFORCEMENT"
    | "BRAKE_RELEASE_ABRUPT"
    | "BRAKE_STEERING_OVERLAP";
  verdict: "confirmed" | "rejected" | "uncertain";
  locale: "zh" | "en";
  notes?: string;
};

export async function submitNarrativeFeedback(
  apiOrigin: string,
  apiPrefix: string,
  input: NarrativeFeedbackInput,
  fetcher: FeedbackFetcher = fetch,
): Promise<boolean> {
  try {
    const origin = apiOrigin.replace(/\/+$/, "");
    const prefix = `/${apiPrefix.replace(/^\/+|\/+$/g, "")}`;
    const response = await fetcher(`${origin}${prefix}/feedback`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function submitCoachValidation(
  apiOrigin: string,
  apiPrefix: string,
  input: CoachValidationInput,
  fetcher: FeedbackFetcher = fetch,
): Promise<boolean> {
  try {
    const origin = apiOrigin.replace(/\/+$/, "");
    const prefix = `/${apiPrefix.replace(/^\/+|\/+$/g, "")}`;
    const response = await fetcher(`${origin}${prefix}/feedback/coach-validation`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return response.ok;
  } catch {
    return false;
  }
}
