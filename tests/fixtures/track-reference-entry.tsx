import { TrackReferencePanel } from "../../frontend/components/TrackReferencePanel";
import { I18nProvider } from "../../frontend/lib/i18n";
import type { ComponentProps } from "react";
export * from "../../frontend/lib/trackReference";
export * from "../../frontend/lib/feedbackApi";

export function TrackReferenceTest({ locale, ...props }: ComponentProps<typeof TrackReferencePanel> & { locale: "zh" | "en" }) {
  return <I18nProvider initialLocale={locale}><TrackReferencePanel {...props} /></I18nProvider>;
}
