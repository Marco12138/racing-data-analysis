"use client";

import { useMemo, useRef, useState, type Ref } from "react";
import {
  Activity,
  BarChart3,
  ChevronDown,
  Gauge,
  Play,
  Sparkles,
  Upload,
  Zap,
} from "lucide-react";

import type { PublicDemoSummary, PublicDemoTrackPoint } from "../lib/publicDemo";
import { RacingDashboard } from "./RacingDashboard";

const capabilities = [
  {
    icon: <Activity size={20} />,
    title: "Telemetry Analysis",
    description: "Analyze speed, throttle, brake and driving behavior.",
  },
  {
    icon: <BarChart3 size={20} />,
    title: "Lap Performance",
    description: "Identify sector-level time loss.",
  },
  {
    icon: <Zap size={20} />,
    title: "Driving Insight",
    description: "Generate actionable feedback for drivers.",
  },
];

export function PublicDemoClient({ initialDemo }: { initialDemo: PublicDemoSummary | null }) {
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
        <nav className="public-nav" aria-label="Primary navigation">
          <span className="public-brand"><Gauge size={19} /> Racing Data Lab</span>
          <button type="button" className="nav-command" onClick={() => openDashboard(false)}>
            Open Dashboard
          </button>
        </nav>
        <div className="hero-content">
          <p className="hero-kicker">Motorsport performance engineering</p>
          <h1 id="platform-title">AI Racing Telemetry Analysis Platform</h1>
          <p className="hero-description">
            A data-driven platform for analyzing racing performance using telemetry data,
            lap comparison and AI-assisted insights.
          </p>
          <div className="hero-actions">
            <button type="button" className="hero-primary" onClick={showSamplePreview}>
              <Play size={18} fill="currentColor" /> Try Demo with sample XRK session
            </button>
            <button type="button" className="hero-secondary" onClick={() => openDashboard(false)}>
              <Upload size={18} /> Upload Data
            </button>
          </div>
        </div>
        <button
          type="button"
          className="hero-scroll"
          onClick={showSamplePreview}
          aria-label="View the public sample session"
        >
          <ChevronDown size={22} />
        </button>
      </section>

      <PublicDemoDashboard
        ref={previewRef}
        demo={initialDemo}
        onOpenFullDemo={() => openDashboard(true)}
      />

      <section id="capabilities" className="capability-band" aria-label="Platform capabilities">
        <div className="capability-inner">
          {capabilities.map((capability) => (
            <article key={capability.title} className="capability-item">
              <span>{capability.icon}</span>
              <div>
                <h2>{capability.title}</h2>
                <p>{capability.description}</p>
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
          <p className="hero-kicker">Published analysis · real completed laps</p>
          <h2 id="sample-session-title">Anonymized sample XRK session</h2>
          <p>
            Read-only evidence from a publication-reviewed session. Virtual sectors are derived
            from GPS distance and are not official timing splits.
          </p>
        </div>
        <button type="button" className="hero-primary" onClick={onOpenFullDemo} disabled={!demo}>
          <Gauge size={18} /> Open full analysis
        </button>
      </div>

      {demo ? (
        <div className="public-demo-preview__body">
          <div className="public-demo-metrics" aria-label="Sample session metrics">
            <Metric label="Fastest lap" value={`${demo.fastest_lap.lap_time.toFixed(3)}s`} detail={`Lap ${demo.fastest_lap.lap}`} />
            <Metric label="Timed laps" value={String(demo.lap_rows.length)} detail="Real logger laps" />
            <Metric label="Track length" value={`${demo.track.lap_length_m.toFixed(1)} m`} detail="Calculated from cleaned GPS" />
          </div>

          <div className="public-demo-grid">
            <section className="public-demo-module" aria-labelledby="demo-track-title">
              <div className="module-heading">
                <h3 id="demo-track-title">GPS track</h3>
                <span>Fastest valid lap</span>
              </div>
              <MiniTrackMap points={demo.track.points} />
            </section>

            <section className="public-demo-module" aria-labelledby="demo-laps-title">
              <div className="module-heading">
                <h3 id="demo-laps-title">Lap times</h3>
                <span>Logger timing</span>
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
                <h3 id="demo-sector-title">Sector loss overview</h3>
                <span>{demo.sector_loss.official ? "Official sectors" : "Virtual sectors"}</span>
              </div>
              <div className="sector-loss-bars">
                {sectorNames.map((sector) => {
                  const value = averageLoss[sector] ?? 0;
                  return (
                    <div key={sector}>
                      <div><span>{formatSector(sector)}</span><strong>+{value.toFixed(3)}s avg</strong></div>
                      <span className="sector-loss-track"><i style={{ width: `${Math.max(3, value / maxLoss * 100)}%` }} /></span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="public-demo-module public-demo-summary" aria-labelledby="demo-summary-title">
              <div className="module-heading">
                <h3 id="demo-summary-title"><Sparkles size={16} /> AI review summary</h3>
                <span>{demo.summary.source === "llm" ? "AI narrative" : "Structured fallback"}</span>
              </div>
              {demo.summary.source === "llm" && demo.summary.narrative ? (
                <p>{demo.summary.narrative}</p>
              ) : demo.summary.bullets.length ? (
                <ul>{demo.summary.bullets.slice(0, 3).map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
              ) : (
                <p>Structured coaching evidence is available in the full analysis.</p>
              )}
              <small>All reference laps are real completed laps. Validate inferred findings with a coach.</small>
            </section>
          </div>
        </div>
      ) : (
        <div className="public-demo-unavailable" role="status">
          The reviewed sample session is temporarily unavailable. Upload and CSV workflows remain available below.
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function MiniTrackMap({ points }: { points: PublicDemoTrackPoint[] }) {
  const usable = points.filter((point) => Number.isFinite(point.local_x_m) && Number.isFinite(point.local_y_m));
  if (usable.length < 2) return <p className="public-demo-unavailable">GPS track unavailable</p>;
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
    <svg viewBox="0 0 560 320" className="public-demo-track" role="img" aria-label="GPS track outline for the sample session">
      <path d={path} fill="none" stroke="rgba(53,214,208,.18)" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
      <path d={path} fill="none" stroke="#35d6d0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={offsetX} cy={320 - offsetY} r="6" fill="#f6c945" />
    </svg>
  );
}

function formatSector(value: string): string {
  return value.replace("sector_", "Sector ");
}
