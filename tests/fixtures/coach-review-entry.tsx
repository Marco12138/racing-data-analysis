import { CoachReviewPanel } from "../../frontend/components/CoachReviewPanel";
import { I18nProvider } from "../../frontend/lib/i18n";
import type { ComponentProps } from "react";
import { CoachDebrief } from "../../frontend/components/CoachDebrief";
export { reviewStartDistance, reviewContextBounds } from "../../frontend/lib/reviewBoundaries";
export { selectCoachReviews, reviewWindowAtOffset, reviewValue } from "../../frontend/lib/coachReview";

export function CoachReviewTest({ locale, ...props }: ComponentProps<typeof CoachReviewPanel> & { locale: "zh" | "en" }) {
  return <I18nProvider initialLocale={locale}><CoachReviewPanel {...props} /></I18nProvider>;
}

export function CoachDebriefTest({ locale, ...props }: ComponentProps<typeof CoachDebrief> & { locale: "zh" | "en" }) {
  return <I18nProvider initialLocale={locale}><CoachDebrief {...props} /></I18nProvider>;
}
