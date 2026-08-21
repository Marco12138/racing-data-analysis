import { useMemo, type Ref } from "react";
import { Gauge, RefreshCw, Sparkles } from "lucide-react";

import type { PublicDemoSummary, PublicDemoTrackPoint } from "../lib/publicDemo";
import { useI18n } from "../lib/i18n";

/**
 * Read-only public sample-session panel rendered below the hero.
 *
 * Every number comes from the backend reviewed-real-session artifact. When the
 * reviewed artifact contains an AI narrative it is rendered with an explicit
 * evidence boundary; otherwise the structured coaching bullets are shown.
 */
export function PublicDemoDashboard({
  ref,
  demo,
  onOpenFullDemo,
  onRetry,
  retryLoading = false,
}: {
  ref: Ref<HTMLElement>;
  demo: PublicDemoSummary | null;
  onOpenFullDemo: () => void;
  onRetry?: () => void;
  retryLoading?: boolean;
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
          <p>{t("demo.unavailable")}</p>
          {onRetry ? (
            <button type="button" className="hero-primary" onClick={onRetry} disabled={retryLoading}>
              <RefreshCw size={16} className={retryLoading ? "public-demo-retry-icon is-spinning" : "public-demo-retry-icon"} aria-hidden="true" />
              {retryLoading ? t("demo.retrying") : t("demo.retry")}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

export function MiniTrackMap({ points }: { points: PublicDemoTrackPoint[] }) {
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
