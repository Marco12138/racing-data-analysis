"use client";

import { useRef, useState } from "react";

import { fetchPublicDemoSummary, type PublicDemoSummary } from "../lib/publicDemo";
import { resolveApiConfig } from "../lib/config";
import { SiteNavigation } from "./SiteNavigation";
import { PublicDemoDashboard } from "./PublicDemoDashboard";
import { PublishedGuidedReview } from "./PublishedGuidedReview";
import { useI18n } from "../lib/i18n";

export function PublicDemoClient({ initialDemo }: { initialDemo: PublicDemoSummary | null }) {
  const { locale } = useI18n();
  const [demo, setDemo] = useState(initialDemo);
  const [loading, setLoading] = useState(false);
  const previewRef = useRef<HTMLElement>(null);

  async function retryDemo() {
    setLoading(true);
    try {
      const config = await resolveApiConfig();
      setDemo(await fetchPublicDemoSummary(config.apiOrigin, config.apiPrefix));
    } catch {
      setDemo(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <><SiteNavigation /><main className="public-demo-page demo-route-page">
      <PublishedGuidedReview />
      <details className="mx-auto max-w-7xl px-4 pb-8 sm:px-7"><summary className="cursor-pointer py-4 text-sm text-slate-400">{locale === "zh" ? "原始发布概览与分段计时" : "Original published overview and sector timing"}</summary>
      <PublicDemoDashboard
        ref={previewRef}
        demo={demo}
        onOpenFullDemo={() => { window.location.href = "/workspace?demo=1"; }}
        onRetry={retryDemo}
        retryLoading={loading}
      />
      </details>
    </main></>
  );
}
