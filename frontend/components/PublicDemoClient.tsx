"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Gauge, Languages, Upload } from "lucide-react";

import { fetchPublicDemoSummary, type PublicDemoSummary } from "../lib/publicDemo";
import { resolveApiConfig } from "../lib/config";
import { useI18n } from "../lib/i18n";
import { PublicDemoDashboard } from "./PublicDemoDashboard";

export function PublicDemoClient({ initialDemo }: { initialDemo: PublicDemoSummary | null }) {
  const { locale, setLocale, t } = useI18n();
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
    <main className="public-demo-page demo-route-page">
      <nav className="workspace-topbar" aria-label={t("nav.primary")}>
        <Link href="/" className="workspace-topbar__brand"><Gauge size={18} /> {t("brand.name")}</Link>
        <div className="public-nav-actions">
          <div className="language-switch" aria-label="Language">
            <Languages size={15} aria-hidden="true" />
            <button type="button" className={locale === "zh" ? "is-active" : ""} onClick={() => setLocale("zh")}>中</button>
            <button type="button" className={locale === "en" ? "is-active" : ""} onClick={() => setLocale("en")}>EN</button>
          </div>
          <Link href="/" className="nav-command"><ArrowLeft size={15} /> {t("nav.home")}</Link>
          <Link href="/workspace" className="hero-primary"><Upload size={16} /> {t("nav.openDashboard")}</Link>
        </div>
      </nav>
      <PublicDemoDashboard
        ref={previewRef}
        demo={demo}
        onOpenFullDemo={() => { window.location.href = "/workspace?demo=1"; }}
        onRetry={retryDemo}
        retryLoading={loading}
      />
    </main>
  );
}
