import { RpmSyncReview } from "../../frontend/components/RpmSyncReview";
import { I18nProvider } from "../../frontend/lib/i18n";
import type { ComponentProps } from "react";

export function RpmSyncTest({ locale, ...props }: ComponentProps<typeof RpmSyncReview> & { locale: "zh" | "en" }) {
  return <I18nProvider initialLocale={locale}><RpmSyncReview {...props} /></I18nProvider>;
}
