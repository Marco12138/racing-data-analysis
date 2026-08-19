"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  BarChart3,
  ChevronDown,
  Gauge,
  Languages,
  Play,
  Upload,
  Zap,
} from "lucide-react";

import { fetchPublicDemoSummary, type PublicDemoSummary } from "../lib/publicDemo";
import { resolveApiConfig } from "../lib/config";
import { useI18n, type TranslationKey } from "../lib/i18n";
import { PublicDemoDashboard } from "./PublicDemoDashboard";
import { RacingDashboard } from "./RacingDashboard";

const capabilities = [
  {
    icon: <Activity size={20} />,
    title: "capabilities.telemetry.title",
    description: "capabilities.telemetry.description",
  },
  {
    icon: <BarChart3 size={20} />,
    title: "capabilities.lap.title",
    description: "capabilities.lap.description",
  },
  {
    icon: <Zap size={20} />,
    title: "capabilities.insight.title",
    description: "capabilities.insight.description",
  },
] satisfies Array<{ icon: ReactNode; title: TranslationKey; description: TranslationKey }>;

export function PublicDemoClient({ initialDemo }: { initialDemo: PublicDemoSummary | null }) {
  const { locale, setLocale, t } = useI18n();
  const [demoVersion, setDemoVersion] = useState(0);
  const [loadDemo, setLoadDemo] = useState(false);
  const [demoOverride, setDemoOverride] = useState<PublicDemoSummary | null | undefined>(undefined);
  const [demoLoading, setDemoLoading] = useState(false);
  const previewRef = useRef<HTMLElement>(null);
  const dashboardRef = useRef<HTMLElement>(null);
  const currentDemo = demoOverride ?? initialDemo;

  function openDashboard(withDemo: boolean) {
    setLoadDemo(withDemo);
    setDemoVersion((version) => version + 1);
    window.setTimeout(() => {
      dashboardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  async function retryDemo() {
    setDemoLoading(true);
    let summary: PublicDemoSummary | null = null;
    try {
      const config = await resolveApiConfig();
      summary = await fetchPublicDemoSummary(config.apiOrigin, config.apiPrefix);
    } catch {
      summary = null;
    }
    setDemoOverride(summary);
    setDemoLoading(false);
  }

  function showSamplePreview() {
    if (!currentDemo && !demoLoading) {
      void retryDemo();
    }
    previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="public-demo-page">
      <section className="public-hero" aria-labelledby="platform-title">
        <nav className="public-nav" aria-label={t("nav.primary")}>
          <span className="public-brand"><Gauge size={19} /> {t("brand.name")}</span>
          <div className="public-nav-actions">
            <div className="language-switch" aria-label="Language">
              <Languages size={15} aria-hidden="true" />
              <button type="button" className={locale === "zh" ? "is-active" : ""} onClick={() => setLocale("zh")}>中</button>
              <button type="button" className={locale === "en" ? "is-active" : ""} onClick={() => setLocale("en")}>EN</button>
            </div>
            <Link href="/profile" className="nav-command">
              {t("nav.profile")}
            </Link>
            <a
              href="https://ai-video-coach.vercel.app"
              target="_blank"
              rel="noreferrer"
              className="nav-command"
            >
              {t("nav.videoCoach")}
            </a>
            <button type="button" className="nav-command" onClick={() => openDashboard(false)}>
              {t("nav.openDashboard")}
            </button>
          </div>
        </nav>
        <div className="hero-content">
          <p className="hero-kicker">{t("hero.kicker")}</p>
          <h1 id="platform-title">{t("hero.title")}</h1>
          <p className="hero-description">{t("hero.description")}</p>
          <div className="hero-actions">
            <button type="button" className="hero-primary" onClick={showSamplePreview}>
              <Play size={18} fill="currentColor" /> {t("hero.tryDemo")}
            </button>
            <button type="button" className="hero-secondary" onClick={() => openDashboard(false)}>
              <Upload size={18} /> {t("hero.upload")}
            </button>
          </div>
        </div>
        <button
          type="button"
          className="hero-scroll"
          onClick={showSamplePreview}
          aria-label={t("hero.scroll")}
        >
          <ChevronDown size={22} />
        </button>
      </section>

      <PublicDemoDashboard
        ref={previewRef}
        demo={currentDemo}
        onOpenFullDemo={() => openDashboard(true)}
        onRetry={retryDemo}
        retryLoading={demoLoading}
      />

      <section id="capabilities" className="capability-band" aria-label={t("capabilities.label")}>
        <div className="capability-inner">
          {capabilities.map((capability) => (
            <article key={capability.title} className="capability-item">
              <span>{capability.icon}</span>
              <div>
                <h2>{t(capability.title)}</h2>
                <p>{t(capability.description)}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section ref={dashboardRef} id="dashboard" className="dashboard-anchor">
        <RacingDashboard key={demoVersion} initialDemo={loadDemo} />
      </section>
    </main>
  );
}
