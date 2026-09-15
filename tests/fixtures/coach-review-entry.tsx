import { CoachReviewPanel } from "../../frontend/components/CoachReviewPanel";
import { I18nProvider } from "../../frontend/lib/i18n";
import type { ComponentProps } from "react";

export function CoachReviewTest({ locale, ...props }: ComponentProps<typeof CoachReviewPanel> & { locale: "zh" | "en" }) {
  return <I18nProvider initialLocale={locale}><CoachReviewPanel {...props} /></I18nProvider>;
}
