"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Flag,
  Gauge,
  LineChart,
  Play,
  Upload,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  analyzeLaps,
  compareSpeedByDistance,
  formatSeconds,
  formatSector,
  generateDriverReport,
  generateHandlingFlags,
  normalizeLapRows,
  normalizeTelemetryRows,
  parseCsv,
  summarizeTelemetry,
  validateFiles,
} from "../lib/analysis";
import { sampleLapCsv, sampleTelemetryCsv } from "../lib/sampleData";

const chartColors = ["#f6c945", "#35d6d0", "#ff5964", "#66e38f"];

export function RacingDashboard() {
  const [lapRows, setLapRows] = useState(() => normalizeLapRows(parseCsv(sampleLapCsv)));
  const [telemetryRows, setTelemetryRows] = useState(() => normalizeTelemetryRows(parseCsv(sampleTelemetryCsv)));
  const [driverName, setDriverName] = useState("Demo Driver");
  const [trackName, setTrackName] = useState("Shanghai Sprint Circuit");
  const [sessionDate, setSessionDate] = useState("2026-07-22");
  const [referenceLap, setReferenceLap] = useState(6);
  const [targetLap, setTargetLap] = useState(3);
  const [videoName, setVideoName] = useState("No video uploaded");

  const lapAnalysis = useMemo(() => analyzeLaps(lapRows), [lapRows]);
  const telemetrySummary = useMemo(() => summarizeTelemetry(telemetryRows), [telemetryRows]);
  const handlingFlags = useMemo(() => generateHandlingFlags(telemetryRows), [telemetryRows]);
  const validation = useMemo(() => validateFiles(lapRows, telemetryRows), [lapRows, telemetryRows]);
  const speedComparison = useMemo(
    () => compareSpeedByDistance(telemetryRows, referenceLap, targetLap),
    [telemetryRows, referenceLap, targetLap]
  );
  const report = useMemo(
    () => generateDriverReport(lapAnalysis, telemetrySummary, handlingFlags),
    [lapAnalysis, telemetrySummary, handlingFlags]
  );

  const lapOptions = lapRows.map((row) => row.lap);

  async function handleCsvUpload(file: File, kind: "lap" | "telemetry") {
    const text = await file.text();
    const rows = parseCsv(text);
    if (kind === "lap") {
      const normalized = normalizeLapRows(rows);
      if (normalized.length > 0) setLapRows(normalized);
    } else {
      const normalized = normalizeTelemetryRows(rows);
      if (normalized.length > 0) setTelemetryRows(normalized);
    }
  }

  return (
    <main className="dashboard-shell engineering-grid">
      <section className="mx-auto flex max-w-[1680px] flex-col gap-5 px-5 py-5 lg:px-8">
        <header className="panel flex flex-col gap-5 rounded-lg px-5 py-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.24em] text-[#35d6d0]">
              <Gauge size={18} />
              Motorsport engineering dashboard
            </div>
            <h1 className="text-3xl font-semibold text-white md:text-5xl">AI Racing Telemetry Analysis</h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-300 md:text-base">
              Turning racing data into actionable driving insights
            </p>
          </div>
          <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-3 lg:min-w-[520px]">
            <SessionInput label="Driver" value={driverName} onChange={setDriverName} />
            <SessionInput label="Track" value={trackName} onChange={setTrackName} />
            <SessionInput label="Date" value={sessionDate} onChange={setSessionDate} />
          </div>
        </header>

        <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
          <aside className="flex flex-col gap-5">
            <UploadPanel
              videoName={videoName}
              onLapFile={(file) => handleCsvUpload(file, "lap")}
              onTelemetryFile={(file) => handleCsvUpload(file, "telemetry")}
              onVideoFile={(file) => setVideoName(file.name)}
            />
            <ValidationPanel validation={validation} />
            <BehaviorPanel flags={handlingFlags} />
          </aside>

          <section className="flex flex-col gap-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard icon={<Flag size={20} />} label="Fastest Lap" value={formatSeconds(lapAnalysis.fastestLap.lap_time)} detail={`Lap ${lapAnalysis.fastestLap.lap}`} accent="#f6c945" />
              <MetricCard icon={<Zap size={20} />} label="Theoretical Best" value={formatSeconds(lapAnalysis.theoreticalBest)} detail="Best sectors combined" accent="#35d6d0" />
              <MetricCard icon={<Activity size={20} />} label="Potential Gain" value={formatSeconds(lapAnalysis.potentialGain)} detail={formatSector(lapAnalysis.mainLossSector)} accent="#ff5964" />
              <MetricCard icon={<BarChart3 size={20} />} label="Consistency Score" value={lapAnalysis.consistencyScore.toFixed(1)} detail={`Average lap ${formatSeconds(lapAnalysis.averageLap)}`} accent="#66e38f" />
            </div>

            <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
              <ChartPanel title="Lap Time Chart" subtitle="X: lap number, Y: lap time">
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={lapAnalysis.lapDeltas}>
                    <defs>
                      <linearGradient id="lapGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#f6c945" stopOpacity={0.65} />
                        <stop offset="100%" stopColor="#f6c945" stopOpacity={0.04} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" />
                    <XAxis dataKey="lap" stroke="#8b98aa" />
                    <YAxis stroke="#8b98aa" domain={["dataMin - 0.2", "dataMax + 0.2"]} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Area type="monotone" dataKey="lap_time" name="Lap time" stroke="#f6c945" fill="url(#lapGradient)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartPanel>

              <DataPanel
                title="Session Overview"
                rows={[
                  ["Driver name", driverName],
                  ["Track name", trackName],
                  ["Session date", sessionDate],
                  ["Total laps", String(lapRows.length)],
                  ["Fastest lap", `Lap ${lapAnalysis.fastestLap.lap}`],
                  ["Theoretical best lap", formatSeconds(lapAnalysis.theoreticalBest)],
                  ["Average lap time", formatSeconds(lapAnalysis.averageLap)],
                  ["Best sector", formatSector(lapAnalysis.bestSector)],
                ]}
              />
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <ChartPanel title="Sector Loss Chart" subtitle="Per-lap time loss versus each sector best">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={lapAnalysis.sectorLossRows}>
                    <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" />
                    <XAxis dataKey="lap" stroke="#8b98aa" />
                    <YAxis stroke="#8b98aa" />
                    <Tooltip contentStyle={tooltipStyle} />
                    {lapAnalysis.sectors.map((sector, index) => (
                      <Bar key={sector} dataKey={`${sector}_loss`} stackId="loss" name={formatSector(sector)} fill={chartColors[index % chartColors.length]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartPanel>

              <ChartPanel title="Sector Performance" subtitle="Best, average, and average loss">
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={lapAnalysis.sectorRanking}>
                    <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" />
                    <XAxis dataKey="sector" tickFormatter={formatSector} stroke="#8b98aa" />
                    <YAxis stroke="#8b98aa" />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(label) => formatSector(String(label))} />
                    <Bar dataKey="average" name="Average" fill="#263241" />
                    <Line type="monotone" dataKey="best" name="Best" stroke="#35d6d0" strokeWidth={3} />
                    <Line type="monotone" dataKey="averageLoss" name="Average loss" stroke="#ff5964" strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartPanel>
            </div>

            <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
              <ChartPanel
                title="Best Lap Comparison"
                subtitle="Speed difference by distance"
                action={
                  <div className="flex gap-2">
                    <LapSelect label="Reference" value={referenceLap} options={lapOptions} onChange={setReferenceLap} />
                    <LapSelect label="Target" value={targetLap} options={lapOptions} onChange={setTargetLap} />
                  </div>
                }
              >
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={speedComparison}>
                    <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" />
                    <XAxis dataKey="distance" stroke="#8b98aa" />
                    <YAxis stroke="#8b98aa" />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Area type="monotone" dataKey="speedDiff" name="Speed difference" stroke="#35d6d0" fill="#35d6d033" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartPanel>

              <TelemetryPanel summary={telemetrySummary} />
            </div>

            <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
              <ReportPanel report={report} />
              <VideoPanel videoName={videoName} />
            </div>

            <LapTable data={lapAnalysis.lapDeltas} />
          </section>
        </section>
      </section>
    </main>
  );
}

function SessionInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-[#35d6d0]"
      />
    </label>
  );
}

function UploadPanel({
  videoName,
  onLapFile,
  onTelemetryFile,
  onVideoFile,
}: {
  videoName: string;
  onLapFile: (file: File) => void;
  onTelemetryFile: (file: File) => void;
  onVideoFile: (file: File) => void;
}) {
  return (
    <section className="panel rounded-lg p-4">
      <SectionTitle icon={<Upload size={18} />} title="Data Upload" subtitle="CSV validation runs instantly" />
      <FileInput label="Lap/Sector CSV" accept=".csv" onFile={onLapFile} />
      <FileInput label="Telemetry CSV" accept=".csv" onFile={onTelemetryFile} />
      <FileInput label="Onboard video" accept=".mp4,.mov" onFile={onVideoFile} />
      <p className="mt-3 truncate rounded-md bg-slate-950/60 px-3 py-2 text-xs text-slate-400">{videoName}</p>
    </section>
  );
}

function FileInput({ label, accept, onFile }: { label: string; accept: string; onFile: (file: File) => void }) {
  return (
    <label className="file-input mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-3 text-sm text-slate-300">
      <span>{label}</span>
      <input
        className="hidden"
        type="file"
        accept={accept}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
        }}
      />
      <Upload size={16} className="text-[#f6c945]" />
    </label>
  );
}

function ValidationPanel({ validation }: { validation: ReturnType<typeof validateFiles> }) {
  return (
    <section className="panel rounded-lg p-4">
      <SectionTitle icon={<AlertTriangle size={18} />} title="File Validation" subtitle="Input readiness" />
      <StatusLine label="Lap file" value={validation.lapStatus} />
      <StatusLine label="Telemetry" value={validation.telemetryStatus} />
      {validation.advancedWarning && (
        <p className="mt-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
          Some advanced analysis features are unavailable because required telemetry channels are missing.
        </p>
      )}
    </section>
  );
}

function BehaviorPanel({ flags }: { flags: ReturnType<typeof generateHandlingFlags> }) {
  return (
    <section className="panel rounded-lg p-4">
      <SectionTitle icon={<Activity size={18} />} title="Driving Behavior Assistant" subtitle="Heuristic flags only" />
      <div className="thin-scrollbar mt-3 max-h-[260px] overflow-auto">
        {flags.length ? (
          flags.map((flag, index) => (
            <div key={`${flag.lap}-${flag.eventType}-${index}`} className="mb-3 rounded-md border border-slate-700/70 bg-slate-950/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-white">{flag.eventType}</p>
                <span className="rounded bg-[#f6c945]/15 px-2 py-1 text-[11px] text-[#f6c945]">{flag.confidence}</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">Lap {flag.lap} · {flag.sector}</p>
              <p className="mt-2 text-xs leading-5 text-slate-300">{flag.reason}</p>
            </div>
          ))
        ) : (
          <p className="text-sm text-slate-400">No behavior flags in the current telemetry.</p>
        )}
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        Handling analysis is a heuristic assistant, not a definitive vehicle dynamics diagnosis.
      </p>
    </section>
  );
}

function MetricCard({ icon, label, value, detail, accent }: { icon: React.ReactNode; label: string; value: string; detail: string; accent: string }) {
  return (
    <article className="metric-card rounded-lg p-4">
      <div className="mb-4 flex items-center justify-between">
        <span style={{ color: accent }}>{icon}</span>
        <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</span>
      </div>
      <p className="mono text-3xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{detail}</p>
    </article>
  );
}

function ChartPanel({ title, subtitle, action, children }: { title: string; subtitle: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel rounded-lg p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <SectionTitle icon={<LineChart size={18} />} title={title} subtitle={subtitle} />
        {action}
      </div>
      {children}
    </section>
  );
}

function DataPanel({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <section className="panel rounded-lg p-4">
      <SectionTitle icon={<Gauge size={18} />} title={title} subtitle="Session Overview" />
      <div className="mt-4 divide-y divide-slate-800">
        {rows.map(([label, value]) => (
          <StatusLine key={label} label={label} value={value} />
        ))}
      </div>
    </section>
  );
}

function TelemetryPanel({ summary }: { summary: ReturnType<typeof summarizeTelemetry> }) {
  const rows: [string, string][] = [
    ["Maximum speed", summary.maxSpeed ? `${summary.maxSpeed.toFixed(1)} km/h` : "Unavailable"],
    ["Average speed", summary.averageSpeed ? `${summary.averageSpeed.toFixed(1)} km/h` : "Unavailable"],
    ["Average throttle", summary.averageThrottle ? `${summary.averageThrottle.toFixed(1)}%` : "Unavailable"],
    ["Full throttle", summary.fullThrottlePercentage ? `${summary.fullThrottlePercentage.toFixed(1)}%` : "Unavailable"],
    ["Maximum brake", summary.maxBrake ? `${summary.maxBrake.toFixed(1)}%` : "Unavailable"],
    ["Braking duration", summary.brakingDuration ? `${summary.brakingDuration.toFixed(1)}%` : "Unavailable"],
    ["Minimum corner speed", summary.minimumCornerSpeed ? `${summary.minimumCornerSpeed.toFixed(1)} km/h` : "Unavailable"],
    ["Maximum lateral G", summary.maxLateralG ? `${summary.maxLateralG.toFixed(2)} g` : "Unavailable"],
  ];
  return <DataPanel title="Telemetry Analysis" rows={rows} />;
}

function ReportPanel({ report }: { report: string }) {
  return (
    <section className="panel rounded-lg p-4">
      <SectionTitle icon={<Zap size={18} />} title="AI Driver Review" subtitle="Structured findings to natural-language report" />
      <pre className="thin-scrollbar mt-4 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-950/70 p-4 text-sm leading-6 text-slate-200">
        {report}
      </pre>
    </section>
  );
}

function VideoPanel({ videoName }: { videoName: string }) {
  return (
    <section className="panel rounded-lg p-4">
      <SectionTitle icon={<Play size={18} />} title="Video Analysis" subtitle="Upload, timeline, lap-video mapping placeholder" />
      <div className="mt-4 aspect-video rounded-md border border-slate-800 bg-[linear-gradient(135deg,#171f2c,#0a0d12)] p-4">
        <div className="flex h-full flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Loaded video</span>
            <span>mp4 / mov</span>
          </div>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[#f6c945]/40 bg-[#f6c945]/10 text-[#f6c945]">
            <Play size={28} />
          </div>
          <div>
            <p className="truncate text-sm text-white">{videoName}</p>
            <div className="mt-3 h-2 rounded bg-slate-800">
              <div className="h-2 w-1/3 rounded bg-[#35d6d0]" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LapTable({ data }: { data: Array<Record<string, string | number | null>> }) {
  return (
    <section className="panel rounded-lg p-4">
      <SectionTitle icon={<BarChart3 size={18} />} title="Lap Analysis Table" subtitle="Lap time, delta, and sector values" />
      <div className="thin-scrollbar mt-4 overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.14em] text-slate-500">
            <tr>
              {Object.keys(data[0] ?? {}).slice(0, 8).map((key) => (
                <th key={key} className="border-b border-slate-800 px-3 py-3">{key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={String(row.lap)} className="border-b border-slate-900/80 text-slate-300">
                {Object.keys(data[0] ?? {}).slice(0, 8).map((key, index) => (
                  <td key={key} className={`px-3 py-3 ${index === 0 ? "text-white" : ""}`}>{formatCell(row[key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LapSelect({ label, value, options, onChange }: { label: string; value: number; options: number[]; onChange: (value: number) => void }) {
  return (
    <label className="text-xs text-slate-400">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="ml-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white"
      >
        {options.map((option) => (
          <option key={option} value={option}>Lap {option}</option>
        ))}
      </select>
    </label>
  );
}

function SectionTitle({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <span className="text-[#35d6d0]">{icon}</span>
        {title}
      </div>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-200">{value}</span>
    </div>
  );
}

function formatCell(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(3);
  if (value === null || value === undefined) return "";
  return String(value);
}

const tooltipStyle = {
  background: "#0b1018",
  border: "1px solid rgba(148, 163, 184, 0.28)",
  borderRadius: "8px",
  color: "#e9edf3",
};

