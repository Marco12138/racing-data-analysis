export type NarrativeFeedbackInput = {
  node_id: string;
  token: string | null;
  source: "storyboard" | "coach";
  locale: "zh" | "en";
  thumbs_up: boolean;
};

export type FeedbackFetcher = (url: string, init?: RequestInit) => Promise<Response>;

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
