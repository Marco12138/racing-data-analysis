"use client";

import { useRef, useState } from "react";
import { Activity, BarChart3, ChevronDown, Gauge, Play, Upload, Zap } from "lucide-react";

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

export function PublicDemoPage() {
  const [demoVersion, setDemoVersion] = useState(0);
  const [loadDemo, setLoadDemo] = useState(false);
  const dashboardRef = useRef<HTMLElement>(null);

  function openDashboard(withDemo: boolean) {
    setLoadDemo(withDemo);
    setDemoVersion((version) => version + 1);
    window.setTimeout(() => {
      dashboardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
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
            <button type="button" className="hero-primary" onClick={() => openDashboard(true)}>
              <Play size={18} fill="currentColor" /> Try Demo
            </button>
            <button type="button" className="hero-secondary" onClick={() => openDashboard(false)}>
              <Upload size={18} /> Upload Data
            </button>
          </div>
        </div>
        <button
          type="button"
          className="hero-scroll"
          onClick={() => document.getElementById("capabilities")?.scrollIntoView({ behavior: "smooth" })}
          aria-label="View platform capabilities"
        >
          <ChevronDown size={22} />
        </button>
      </section>

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
