import { ManualReviewVideo } from "../../frontend/components/ManualReviewVideo";
import { I18nProvider } from "../../frontend/lib/i18n";
import type { ComponentProps } from "react";
export * from "../../frontend/lib/manualReview";
export * from "../../frontend/lib/reviewCandidate";
export * from "../../frontend/lib/reviewBoundaries";
export * from "../../frontend/lib/reviewBoundaryVisual";
export * from "../../frontend/lib/reviewGpsEvidence";
export { reviewWindowAtOffset } from "../../frontend/lib/coachReview";
export { searchLandmarkVideo } from "../../frontend/lib/landmarkVideo";
export { selectCoachReviews } from "../../frontend/lib/coachReview";

export function ManualReviewTest({ locale, ...props }: ComponentProps<typeof ManualReviewVideo> & { locale: "zh" | "en" }) {
  return <I18nProvider initialLocale={locale}><ManualReviewVideo {...props} /></I18nProvider>;
}
