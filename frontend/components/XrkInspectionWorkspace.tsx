"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Cpu,
  Gauge,
  Play,
} from "lucide-react";

import type { XrkInspection } from "../lib/xrkAnalysisApi";

export function XrkInspectionWorkspace({
  inspection,
  analyzing,
  onContinue,
}: {
  inspection: XrkInspection;
  analyzing: boolean;
  onContinue: () => void;
}) {
  const usableChannels = inspection.channels.filter((channel) => channel.available);
  const fastest = inspection.session_summary.fastest_lap;

  return (
    <section className="panel rounded-lg p-5">
      <header className="flex flex-col gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase text-[#35d6d0]">
            <CheckCircle2 size={16} /> Inspection complete
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">XRK Session Inspection</h2>
          <p className="mt-2 text-sm text-slate-400">
            {inspection.filename} · {(inspection.file_size_bytes / 1024 / 1024).toFixed(2)} MB
          </p>
        </div>
        <button
          type="button"
          disabled={analyzing}
          onClick={onContinue}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#f6c945] px-5 text-sm font-semibold text-slate-950 disabled:cursor-wait disabled:opacity-60"
        >
          {analyzing ? <Activity size={17} className="animate-pulse" /> : <Play size={17} fill="currentColor" />}
          {analyzing ? "Preparing track analysis..." : "Continue to Analysis"}
        </button>
      </header>

      <div className="grid border-b border-slate-800 py-5 sm:grid-cols-2 xl:grid-cols-4">
        <InspectionMetric icon={<Clock3 size={17} />} label="Timed laps" value={String(inspection.laps)} />
        <InspectionMetric
          icon={<Gauge size={17} />}
          label="Fastest lap"
          value={fastest ? `Lap ${fastest.lap} · ${fastest.lap_time_s.toFixed(3)}s` : "Unavailable"}
        />
        <InspectionMetric
          icon={<Activity size={17} />}
          label="Session duration"
          value={formatDuration(inspection.session_summary.session_duration_s)}
        />
        <InspectionMetric
          icon={<Cpu size={17} />}
          label="Parser"
          value={`${inspection.parser.library} ${inspection.parser.version}`}
        />
      </div>

      <section className="grid gap-6 border-b border-slate-800 py-5 lg:grid-cols-[320px_1fr]">
        <div>
          <h3 className="text-sm font-semibold text-white">Analysis readiness</h3>
          <div className="mt-3 divide-y divide-slate-800">
            <Availability label="GPS position" available={inspection.has_gps} />
            <Availability label="GPS speed" available={inspection.has_gps_speed} />
            <Availability label="RPM" available={inspection.has_rpm} />
            <Availability label="Accelerometer" available={inspection.has_accelerometer} />
            <Availability label="Gyro / yaw" available={inspection.has_gyro} />
            <Availability label="Official sectors" available={inspection.has_predefined_sectors} />
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-500">
            Parsed on {inspection.parser.platform} in {inspection.processing_duration_ms.toLocaleString()} ms.
            Temporary normalized data expires automatically.
          </p>
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-white">Available channels</h3>
            <span className="text-xs text-slate-500">
              {usableChannels.length} usable / {inspection.channels.length} detected
            </span>
          </div>
          <div className="thin-scrollbar mt-3 max-h-[430px] overflow-auto rounded-md border border-slate-800">
            <table className="w-full min-w-[780px] text-left text-xs">
              <thead className="sticky top-0 bg-slate-950 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Channel</th>
                  <th className="px-3 py-2 font-medium">Normalized</th>
                  <th className="px-3 py-2 font-medium">Samples</th>
                  <th className="px-3 py-2 font-medium">Rate</th>
                  <th className="px-3 py-2 font-medium">Time range</th>
                  <th className="px-3 py-2 font-medium">Used by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {inspection.channels.map((channel) => (
                  <tr key={channel.name} className={channel.available ? "text-slate-200" : "text-slate-600"}>
                    <td className="px-3 py-2.5">
                      <span className="font-medium">{channel.name}</span>
                      <span className="ml-2 text-slate-600">{channel.unit ?? "unit n/a"}</span>
                    </td>
                    <td className="px-3 py-2.5">{channel.canonical_name ?? channel.normalized_name}</td>
                    <td className="px-3 py-2.5">{channel.sample_count.toLocaleString()}</td>
                    <td className="px-3 py-2.5">
                      {channel.sample_rate_hz ? `${channel.sample_rate_hz.toFixed(1)} Hz` : "n/a"}
                    </td>
                    <td className="px-3 py-2.5">
                      {channel.first_timestamp_s != null && channel.last_timestamp_s != null
                        ? `${channel.first_timestamp_s.toFixed(1)}–${channel.last_timestamp_s.toFixed(1)}s`
                        : "n/a"}
                    </td>
                    <td className="px-3 py-2.5">
                      {channel.available
                        ? channel.analysis_usage.join(", ") || "inspection only"
                        : channel.all_zero
                          ? "all zero"
                          : "unavailable"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {inspection.warnings.length > 0 && (
        <section className="pt-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-100">
            <AlertTriangle size={16} /> Data boundaries
          </h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-400">
            {inspection.warnings.map((warning, index) => (
              <li key={`${inspection.warning_codes[index] ?? "warning"}-${warning}`} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function InspectionMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="border-slate-800 px-3 py-3 first:pl-0 sm:border-l sm:first:border-l-0">
      <p className="flex items-center gap-2 text-xs text-slate-500">{icon}{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function Availability({ label, available }: { label: string; available: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className={available ? "text-emerald-300" : "text-slate-600"}>
        {available ? "Available" : "Unavailable"}
      </span>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}
