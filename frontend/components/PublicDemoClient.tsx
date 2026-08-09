"use client";

import { useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import {
  Activity,
  BarChart3,
  ChevronDown,
  Gauge,
  Languages,
  Play,
  Sparkles,
  Upload,
  Zap,
} from "lucide-react";

import type { PublicDemoSummary, PublicDemoTrackPoint } from "../lib/publicDemo";
import { useI18n, type TranslationKey } from "../lib/i18n";
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
  const previewRef = useRef<HTMLElement>(null);
  const dashboardRef = useRef<HTMLElement>(null);

  function openDashboard(withDemo: boolean) {
    setLoadDemo(withDemo);
    setDemoVersion((version) => version + 1);
    window.setTimeout(() => {
      dashboardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function showSamplePreview() {
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
        demo={initialDemo}
        onOpenFullDemo={() => openDashboard(true)}
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

function PublicDemoDashboard({
  ref,
  demo,
  onOpenFullDemo,
}: {
  ref: Ref<HTMLElement>;
  demo: PublicDemoSummary | null;
  onOpenFullDemo: () => void;
}) {
  const { t } = useI18n();
  const sectorNames = useMemo(
    () => demo ? Object.keys(demo.sector_loss.sector_best).sort() : [],
    [demo]
  );
  const averageLoss = useMemo(() => {
    if (!demo) return {};
    return Object.fromEntries(sectorNames.map((sector) => {
      const values = demo.sector_loss.laps
        .map((lap) => lap.sector_losses[sector])
        .filter((value) => Number.isFinite(value));
      const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      return [sector, mean];
    }));
  }, [demo, sectorNames]);
  const maxLoss = Math.max(0.001, ...Object.values(averageLoss));

  return (
    <section ref={ref} id="sample-session" className="public-demo-preview" aria-labelledby="sample-session-title">
      <div className="public-demo-preview__header">
        <div>
          <p className="hero-kicker">{t("demo.kicker")}</p>
          <h2 id="sample-session-title">{t("demo.title")}</h2>
          <p>{t("demo.description")}</p>
        </div>
        <button type="button" className="hero-primary" onClick={onOpenFullDemo} disabled={!demo}>
          <Gauge size={18} /> {t("demo.openFull")}
        </button>
      </div>

      {demo ? (
        <div className="public-demo-preview__body">
          <div className="public-demo-metrics" aria-label="Sample session metrics">
            <Metric label={t("demo.fastestLap")} value={`${demo.fastest_lap.lap_time.toFixed(3)}s`} detail={`Lap ${demo.fastest_lap.lap}`} />
            <Metric label={t("demo.timedLaps")} value={String(demo.lap_rows.length)} detail={t("demo.realLoggerLaps")} />
            <Metric label={t("demo.trackLength")} value={`${demo.track.lap_length_m.toFixed(1)} m`} detail={t("demo.cleanedGps")} />
          </div>

          <div className="public-demo-grid">
            <section className="public-demo-module" aria-labelledby="demo-track-title">
              <div className="module-heading">
                <h3 id="demo-track-title">{t("demo.gpsTrack")}</h3>
                <span>{t("demo.fastestValidLap")}</span>
              </div>
              <MiniTrackMap points={demo.track.points} />
            </section>

            <section className="public-demo-module" aria-labelledby="demo-laps-title">
              <div className="module-heading">
                <h3 id="demo-laps-title">{t("demo.lapTimes")}</h3>
                <span>{t("demo.loggerTiming")}</span>
              </div>
              <div className="demo-lap-list thin-scrollbar">
                {demo.lap_rows.map((lap) => (
                  <div key={lap.lap} className={lap.lap === demo.fastest_lap.lap ? "is-fastest" : ""}>
                    <span>Lap {lap.lap}</span>
                    <strong>{lap.lap_time.toFixed(3)}s</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="public-demo-module" aria-labelledby="demo-sector-title">
              <div className="module-heading">
                <h3 id="demo-sector-title">{t("demo.sectorLoss")}</h3>
                <span>{demo.sector_loss.official ? t("demo.officialSectors") : t("demo.virtualSectors")}</span>
              </div>
              <div className="sector-loss-bars">
                {sectorNames.map((sector) => {
                  const value = averageLoss[sector] ?? 0;
                  return (
                    <div key={sector}>
                      <div><span>{formatSector(sector)}</span><strong>{t("demo.averageLoss", { value: value.toFixed(3) })}</strong></div>
                      <span className="sector-loss-track"><i style={{ width: `${Math.max(3, value / maxLoss * 100)}%` }} /></span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="public-demo-module public-demo-summary" aria-labelledby="demo-summary-title">
              <div className="module-heading">
                <h3 id="demo-summary-title"><Sparkles size={16} /> {t("demo.aiSummary")}</h3>
                <span>{demo.summary.source === "llm" ? t("demo.aiNarrative") : t("demo.structuredFallback")}</span>
              </div>
              {demo.summary.source === "llm" && demo.summary.narrative ? (
                <p>{demo.summary.narrative}</p>
              ) : demo.summary.bullets.length ? (
                <ul>{demo.summary.bullets.slice(0, 3).map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
              ) : (
                <p>{t("demo.structuredAvailable")}</p>
              )}
              <small>{t("demo.evidenceBoundary")}</small>
            </section>
          </div>
        </div>
      ) : (
        <div className="public-demo-unavailable" role="status">
          {t("demo.unavailable")}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function MiniTrackMap({ points }: { points: PublicDemoTrackPoint[] }) {
  const { t } = useI18n();
  const usable = points.filter((point) => Number.isFinite(point.local_x_m) && Number.isFinite(point.local_y_m));
  if (usable.length < 2) return <p className="public-demo-unavailable">{t("demo.trackUnavailable")}</p>;
  const xs = usable.map((point) => point.local_x_m);
  const ys = usable.map((point) => point.local_y_m);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scale = Math.min(520 / width, 280 / height);
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;
  const offsetX = (560 - renderedWidth) / 2;
  const offsetY = (320 - renderedHeight) / 2;
  const path = usable.map((point, index) => {
    const x = offsetX + (point.local_x_m - minX) * scale;
    const y = 320 - offsetY - (point.local_y_m - minY) * scale;
    return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 560 320" className="public-demo-track" role="img" aria-label={t("demo.gpsTrack")}>
      <path d={path} fill="none" stroke="rgba(53,214,208,.18)" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
      <path d={path} fill="none" stroke="#35d6d0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={offsetX} cy={320 - offsetY} r="6" fill="#f6c945" />
    </svg>
  );
}

function formatSector(value: string): string {
  return value.replace("sector_", "Sector ");
}
