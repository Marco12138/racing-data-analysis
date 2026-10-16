import { RpmSyncReview } from "../../frontend/components/RpmSyncReview";
import { ManualLapBinding } from "../../frontend/components/ManualLapBinding";
import { I18nProvider } from "../../frontend/lib/i18n";
import type { ComponentProps } from "react";

export function RpmSyncTest({ locale, ...props }: ComponentProps<typeof RpmSyncReview> & { locale: "zh" | "en" }) {
  return <I18nProvider initialLocale={locale}><RpmSyncReview {...props} /></I18nProvider>;
}

export function ManualLapTest({ locale, ...props }: ComponentProps<typeof ManualLapBinding> & { locale: "zh" | "en" }) {
  return <I18nProvider initialLocale={locale}><ManualLapBinding {...props} /></I18nProvider>;
}
