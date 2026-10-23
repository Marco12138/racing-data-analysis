import { ClipTelemetrySide, ClipTelemetryDelta } from "../../frontend/components/ClipTelemetry";
import { I18nProvider } from "../../frontend/lib/i18n";
import type { ClipComparison } from "../../frontend/lib/clipTelemetry";
export { compareClipTelemetry } from "../../frontend/lib/clipTelemetry";

export function ClipTelemetryTest({ comparison, locale }: { comparison: ClipComparison; locale: "zh" | "en" }) {
  return <I18nProvider initialLocale={locale}>
    <ClipTelemetrySide comparison={comparison} side="reference" distance={null} />
    <ClipTelemetrySide comparison={comparison} side="target" distance={null} />
    <ClipTelemetryDelta comparison={comparison} cursors={{ reference: null, target: null }} />
  </I18nProvider>;
}
