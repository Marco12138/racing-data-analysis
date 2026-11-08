import { I18nProvider } from "../../frontend/lib/i18n";
import { PublishedGuidedContent } from "../../frontend/components/PublishedGuidedReview";
import type { PublishedCoachData } from "../../frontend/lib/publishedCoach";
import type { ReviewStep } from "../../frontend/lib/guidedReview";
export { publishedCoachEvidence, loadPublishedCoach } from "../../frontend/lib/publishedCoach";
export { coachObservation } from "../../frontend/lib/recommendedCoach";
export { cornerTelemetryTime, cornerChannelAt } from "../../frontend/lib/selectedCorner";
export { publishedPlaybackBounds } from "../../frontend/lib/publishedVideoReview";
export { coachTrajectory, driverTrajectory, trajectoryAt,replayFrame } from "../../frontend/lib/cornerTrajectory";
export { sceneCandidate,samplePlan } from "../../frontend/lib/trajectoryVideo";
export { readTrajectoryFrames } from "../../frontend/lib/landmarkVideo";
export { blendCamera,fitCamera,screenPoint } from "../../frontend/lib/trajectoryCamera";
export function PublishedGuideTest({ locale, data, step }: { locale: "zh" | "en"; data: PublishedCoachData; step: ReviewStep }) {
  return <I18nProvider initialLocale={locale}><PublishedGuidedContent data={data} initialStep={step} /></I18nProvider>;
}
