import * as React from "react";

import { I18nProvider } from "../../frontend/lib/i18n";
import { VideoSyncPanel } from "../../frontend/components/XrkAnalysisWorkspace";

// Test-only entry so the i18n provider and consumer share one bundled context.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixture props mirror the panel contract
export function VideoPanelTest({ locale, ...props }: any) {
  return React.createElement(
    I18nProvider,
    { initialLocale: locale ?? "zh" },
    React.createElement(VideoSyncPanel, props),
  );
}
