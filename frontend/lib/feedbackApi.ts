export type NarrativeFeedbackInput = {
  node_id: string;
  token: string | null;
  source: "llm" | "structured" | "storyboard" | "coach";
  locale: "zh" | "en";
  thumbs_up: boolean;
};

export type FeedbackFetcher = (url: string, init?: RequestInit) => Promise<Response>;

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
