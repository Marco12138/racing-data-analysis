import { GoproSyncPanel, GnssSyncReview } from "../../frontend/components/GoproSyncPanel";
import { I18nProvider } from "../../frontend/lib/i18n";
import type { ComponentProps } from "react";

export function GnssSyncTest({ locale, ...props }: ComponentProps<typeof GnssSyncReview> & { locale: "zh" | "en" }) {
  return <I18nProvider initialLocale={locale}><GnssSyncReview {...props} /></I18nProvider>;
}

export function GoproPanelTest({ locale, ...props }: ComponentProps<typeof GoproSyncPanel> & { locale: "zh" | "en" }) {
  return <I18nProvider initialLocale={locale}><GoproSyncPanel {...props} /></I18nProvider>;
}
