import type { XrkAnalysis } from "./xrkAnalysisApi";
import type { SelectedCornerResult } from "./selectedCorner";
import { isPublishedVideoReview, type PublishedVideoReview } from "./publishedVideoReview";
import { compareCornerBest } from "./cornerCoach";
import type { RecommendedCoachEvidence } from "./recommendedCoach";

export type PublishedCoachSection = {
  id: string; name: string; gps_flagged_laps: number[];
  downstream_camera_validation: "not_available_in_published_excerpts";
  result: SelectedCornerResult;
};
export type PublishedCoachArtifact = {
  version: 1; source_sha256: string; sampling: "already_published_distance_grid";
  manual_anchor_modified: false; independent_video_validation: false;
  sections: PublishedCoachSection[];
};
export type PublishedCoachData = { analysis: XrkAnalysis; review: PublishedVideoReview; evidence: PublishedCoachArtifact };

/** A demo click never becomes a coach label or a new synchronization anchor. */
export function publishedCoachEvidence(section: PublishedCoachSection, zh = false): RecommendedCoachEvidence {
  return { id: section.id, name: zh ? section.name.replace(" · excerpt", " · 摘录") : section.name,
    comparison: compareCornerBest(section.result.laps, section.gps_flagged_laps),
    videoConfirmed: false, contextComplete: false };
}

export async function loadPublishedCoach(signal?: AbortSignal): Promise<PublishedCoachData> {
  const [source, evidenceResponse] = await Promise.all([
    fetch("/demo/reviewed-real-session.json", { signal }),
    fetch("/demo/coach-evidence.json", { signal }),
  ]);
  if (!source.ok || !evidenceResponse.ok) throw Error("PUBLIC_DEMO_UNAVAILABLE");
  const raw = await source.text(), resource = JSON.parse(raw);
  const evidence = await evidenceResponse.json() as PublishedCoachArtifact;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  if (resource.provenance?.publication_permission !== "confirmed" || !isPublishedVideoReview(resource.analysis?.video_review) || evidence.version !== 1
    || evidence.source_sha256 !== hash || evidence.manual_anchor_modified !== false
    || evidence.independent_video_validation !== false || evidence.sampling !== "already_published_distance_grid"
    || !Array.isArray(evidence.sections) || evidence.sections.length !== 3) throw Error("PUBLIC_DEMO_VERSION_MISMATCH");
  return { analysis: resource.analysis, review: resource.analysis.video_review, evidence };
}
