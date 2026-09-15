import { ManualReviewVideo } from "../../frontend/components/ManualReviewVideo";
import { I18nProvider } from "../../frontend/lib/i18n";
import type { ComponentProps } from "react";
export * from "../../frontend/lib/manualReview";
export { selectCoachReviews } from "../../frontend/lib/coachReview";

export function ManualReviewTest({ locale, ...props }: ComponentProps<typeof ManualReviewVideo> & { locale: "zh" | "en" }) {
  return <I18nProvider initialLocale={locale}><ManualReviewVideo {...props} /></I18nProvider>;
}
