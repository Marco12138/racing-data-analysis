"use client";

import Link from "next/link";
import { Activity, ArrowRight, BarChart3, Gauge, Languages, Play, ShieldCheck, Upload, Zap } from "lucide-react";

import type { PublicDemoSummary } from "../lib/publicDemo";
import { useI18n, type TranslationKey } from "../lib/i18n";
import { MiniTrackMap } from "./PublicDemoDashboard";

const capabilities = [
  [Activity, "capabilities.telemetry.title", "capabilities.telemetry.description"],
  [BarChart3, "capabilities.lap.title", "capabilities.lap.description"],
  [Zap, "capabilities.insight.title", "capabilities.insight.description"],
] satisfies Array<[typeof Activity, TranslationKey, TranslationKey]>;

export function LandingPageClient({ demo }: { demo: PublicDemoSummary | null }) {
  const { locale, setLocale, t } = useI18n();
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
            <Link href="/demo" className="nav-command">{t("nav.demo")}</Link>
            <Link href="/workspace" className="nav-command">{t("nav.openDashboard")}</Link>
          </div>
        </nav>
        <div className="hero-content">
          <p className="hero-kicker">{t("hero.kicker")}</p>
          <h1 id="platform-title">{t("hero.title")}</h1>
          <p className="hero-description">{t("hero.description")}</p>
          <div className="hero-actions">
            <Link href="/demo" className="hero-primary"><Play size={18} fill="currentColor" /> {t("hero.tryDemo")}</Link>
            <Link href="/workspace" className="hero-secondary"><Upload size={18} /> {t("hero.upload")}</Link>
          </div>
        </div>
        <a className="hero-scroll" href="#sample-preview" aria-label={t("hero.scroll")}><ArrowRight size={21} /></a>
      </section>

      <section id="sample-preview" className="landing-preview-band" aria-labelledby="landing-preview-title">
        <div className="landing-preview-copy">
          <p className="hero-kicker">{t("demo.kicker")}</p>
          <h2 id="landing-preview-title">{t("landing.previewTitle")}</h2>
          <p>{t("landing.previewDescription")}</p>
          <div className="landing-evidence-line"><ShieldCheck size={16} /> {t("demo.evidenceBoundary")}</div>
          <Link href="/demo" className="hero-primary">{t("demo.openFull")} <ArrowRight size={17} /></Link>
        </div>
        <div className="landing-preview-visual">
          {demo ? (
            <>
              <div className="landing-preview-metrics">
                <span>{t("demo.fastestLap")} <strong>{demo.fastest_lap.lap_time.toFixed(3)}s</strong></span>
                <span>{t("demo.timedLaps")} <strong>{demo.lap_rows.length}</strong></span>
                <span>{t("demo.trackLength")} <strong>{demo.track.lap_length_m.toFixed(1)}m</strong></span>
              </div>
              <MiniTrackMap points={demo.track.points} />
            </>
          ) : (
            <div className="public-demo-unavailable">{t("demo.unavailable")}</div>
          )}
        </div>
      </section>

      <section className="capability-band" aria-label={t("capabilities.label")}>
        <div className="capability-inner">
          {capabilities.map(([Icon, title, description]) => (
            <article key={title} className="capability-item">
              <span><Icon size={20} /></span>
              <div><h2>{t(title)}</h2><p>{t(description)}</p></div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
