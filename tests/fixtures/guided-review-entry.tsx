import { I18nProvider } from "../../frontend/lib/i18n";
import { ReviewSteps, ReviewFooter, GuidedOverview, GuidedDebrief } from "../../frontend/components/GuidedReview";
import type { XrkAnalysis } from "../../frontend/lib/xrkAnalysisApi";
import { NewSessionCard } from "../../frontend/components/NewSessionCard";
import type { RecommendedCoachEvidence } from "../../frontend/lib/recommendedCoach";
export { selectCoachReviews } from "../../frontend/lib/coachReview";

export function GuideTest({ locale, analysis, view, coachEvidence }: { locale: "zh" | "en"; analysis: XrkAnalysis; view: "start" | "overview" | "summary"; coachEvidence?: RecommendedCoachEvidence[] }) {
  return <I18nProvider initialLocale={locale}>{view === "start" ? <ReviewSteps step={0} hasData={false} /> : view === "overview" ? <GuidedOverview analysis={analysis} videoName="" videoDuration={0} /> : <><GuidedDebrief analysis={analysis} receipts={[]} corner={null} coachEvidence={coachEvidence} onReview={() => {}} /><ReviewFooter step={5} onStep={() => {}} paired={false} busy={false} /></>}</I18nProvider>;
}

export function ImportPanelsTest() {
  return <I18nProvider initialLocale="en"><div hidden><NewSessionCard status="loaded" hasPendingVideo={false} onStart={() => {}} /></div><NewSessionCard guided status="loaded" hasPendingVideo={false} onStart={() => {}} /></I18nProvider>;
}
