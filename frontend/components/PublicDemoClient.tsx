"use client";

import { useRef, useState } from "react";

import { fetchPublicDemoSummary, type PublicDemoSummary } from "../lib/publicDemo";
import { resolveApiConfig } from "../lib/config";
import { SiteNavigation } from "./SiteNavigation";
import { PublicDemoDashboard } from "./PublicDemoDashboard";

export function PublicDemoClient({ initialDemo }: { initialDemo: PublicDemoSummary | null }) {
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
      <PublicDemoDashboard
        ref={previewRef}
        demo={demo}
        onOpenFullDemo={() => { window.location.href = "/workspace?demo=1"; }}
        onRetry={retryDemo}
        retryLoading={loading}
      />
    </main></>
  );
}
