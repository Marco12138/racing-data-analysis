"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Flag,
  Gauge,
  Map,
  SlidersHorizontal,
  Video,
  Zap,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  XrkAnalysis,
  XrkAnalyzeOptions,
  XrkEvent,
  XrkTrackPoint,
} from "../lib/xrkAnalysisApi";

const tabs = [
  ["overview", "Overview", Gauge],
  ["track", "Track Map", Map],
  ["comparison", "Lap Comparison", BarChart3],
  ["actions", "RPM & Driver Actions", Activity],
  ["sectors", "Sector / Zones", Flag],
  ["video", "Video Sync", Video],
  ["report", "Report", Zap],
] as const;

type TabId = (typeof tabs)[number][0];
type MapMode = "reference" | "target" | "overlay";
type ColorChannel = "speed" | "rpm" | "time_delta_s" | "longitudinal_g" | "lateral_g";

export function XrkAnalysisWorkspace({
  analysis,
  analyzing,
  onAnalyze,
}: {
  analysis: XrkAnalysis;
  analyzing: boolean;
  onAnalyze: (options: Partial<XrkAnalyzeOptions>) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [cursorDistance, setCursorDistance] = useState(0);
  const [seekDistance, setSeekDistance] = useState<number | null>(null);
  const [sectorCount, setSectorCount] = useState(analysis.sectors?.count ?? 3);
  const [customBoundaries, setCustomBoundaries] = useState<number[]>([]);
  const [zoneStart, setZoneStart] = useState<number | null>(null);
  const [manualZones, setManualZones] = useState<XrkAnalyzeOptions["manual_zones"]>([]);

  const lapOptions = analysis.lap_rows.map((row) => Number(row.lap));
  const selectedEvent = nearestEvent(analysis.events, cursorDistance);

  function selectDistance(distance: number) {
    setCursorDistance(distance);
    setSeekDistance(distance);
  }

  async function applySectors() {
    await onAnalyze({
      sector_count: sectorCount,
      sector_boundaries_m:
        customBoundaries.length === sectorCount - 1 ? customBoundaries : null,
      manual_zones: manualZones,
    });
  }

  async function addZonePoint(distance: number) {
    if (zoneStart === null) {
      setZoneStart(distance);
      return;
    }
    const entry = Math.min(zoneStart, distance);
    const exit = Math.max(zoneStart, distance);
    setZoneStart(null);
    if (exit - entry < 5) return;
    const next = [
      ...(manualZones ?? []),
      {
        id: `manual-${Date.now()}`,
        name: `Manual Zone ${(manualZones?.length ?? 0) + 1}`,
        entry_distance_m: entry,
        exit_distance_m: exit,
      },
    ];
    setManualZones(next);
    await onAnalyze({ manual_zones: next, sector_count: sectorCount });
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <nav className="panel thin-scrollbar flex overflow-x-auto rounded-lg p-2" aria-label="XRK analysis views">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm ${
              activeTab === id
                ? "bg-[#f6c945] font-semibold text-slate-950"
                : "text-slate-400 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </nav>

      {analyzing && (
        <div className="rounded-md border border-[#35d6d0]/30 bg-[#35d6d0]/10 px-4 py-3 text-sm text-cyan-100">
          Recalculating distance alignment, sectors, zones and behavior evidence...
        </div>
      )}

      {activeTab === "overview" && (
        <Overview analysis={analysis} selectedEvent={selectedEvent} />
      )}

      {activeTab === "track" && (
        analysis.track ? (
          <TrackMapPanel
            analysis={analysis}
            cursorDistance={cursorDistance}
            onSelect={selectDistance}
          />
        ) : (
          <Unavailable reason="GPS is unavailable or did not pass quality checks." />
        )
      )}

      {activeTab === "comparison" && (
        analysis.comparison.length ? (
          <ComparisonPanel
            analysis={analysis}
            lapOptions={lapOptions}
            cursorDistance={cursorDistance}
            onCursor={selectDistance}
            onAnalyze={onAnalyze}
          />
        ) : (
          <Unavailable reason="Two laps could not be aligned by track distance." />
        )
      )}

      {activeTab === "actions" && (
        analysis.capabilities.rpm ? (
          <ActionsPanel
            analysis={analysis}
            cursorDistance={cursorDistance}
            onCursor={selectDistance}
          />
        ) : (
          <Unavailable reason="RPM channel unavailable. GPS and lap analysis remain usable." />
        )
      )}

      {activeTab === "sectors" && (
        analysis.track && analysis.sectors ? (
          <SectorZonePanel
            analysis={analysis}
            sectorCount={sectorCount}
            setSectorCount={setSectorCount}
            customBoundaries={customBoundaries}
            setCustomBoundaries={setCustomBoundaries}
            zoneStart={zoneStart}
            onMapPoint={addZonePoint}
            onApply={applySectors}
            analyzing={analyzing}
          />
        ) : (
          <Unavailable reason="Distance-based sectors require usable GPS and lap timing." />
        )
      )}

      {activeTab === "video" && (
        <VideoSyncPanel
          analysis={analysis}
          cursorDistance={cursorDistance}
          seekDistance={seekDistance}
          onCursor={setCursorDistance}
        />
      )}

      {activeTab === "report" && <ReportPanel analysis={analysis} />}
    </section>
  );
}

function Overview({
  analysis,
  selectedEvent,
}: {
  analysis: XrkAnalysis;
  selectedEvent?: XrkEvent;
}) {
  const metrics = [
    ["Reference lap", `Lap ${analysis.reference_lap}`],
    ["Target lap", `Lap ${analysis.target_lap}`],
    ["Track length", analysis.track ? `${analysis.track.lap_length_m.toFixed(1)} m` : "Unavailable"],
    ["Events", String(analysis.events.length)],
  ];
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <Panel title="Analysis boundary" subtitle="What this session can support">
        <div className="grid gap-3 sm:grid-cols-2">
          {metrics.map(([label, value]) => (
            <div key={label} className="rounded-md border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-[11px] uppercase text-slate-500">{label}</p>
              <p className="mt-2 text-xl font-semibold text-white">{value}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-400">
          Virtual sectors and suggested zones are calculated from GPS distance. They are not
          official timing splits or named circuit corners.
        </p>
      </Panel>
      <Panel title="Evidence at cursor" subtitle="Measured, calculated and inferred">
        {selectedEvent ? <EventEvidence event={selectedEvent} /> : (
          <p className="text-sm text-slate-400">Select a track point or event to inspect its evidence.</p>
        )}
      </Panel>
    </div>
  );
}

function TrackMapPanel({
  analysis,
  cursorDistance,
  onSelect,
}: {
  analysis: XrkAnalysis;
  cursorDistance: number;
  onSelect: (distance: number) => void;
}) {
  const [mode, setMode] = useState<MapMode>("overlay");
  const [channel, setChannel] = useState<ColorChannel>("speed");
  return (
    <Panel
      title="Track Map"
      subtitle="Local metre projection with shared distance cursor"
      action={
        <div className="flex flex-wrap gap-2">
          <Select value={mode} onChange={(value) => setMode(value as MapMode)} options={[
            ["reference", "Best"],
            ["target", "Selected"],
            ["overlay", "Overlay"],
          ]} />
          <Select value={channel} onChange={(value) => setChannel(value as ColorChannel)} options={[
            ["speed", "Speed"],
            ["rpm", "RPM"],
            ["time_delta_s", "Time delta"],
            ["longitudinal_g", "Longitudinal G"],
            ["lateral_g", "Lateral G"],
          ]} />
        </div>
      }
    >
      <TrackSvg
        reference={analysis.track!.reference}
        target={analysis.track!.target}
        mode={mode}
        channel={channel}
        cursorDistance={cursorDistance}
        onSelect={onSelect}
      />
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-400">
        <span>Best Lap {analysis.reference_lap}</span>
        <span>Selected Lap {analysis.target_lap}</span>
        <span>GPS clean retention: {formatPercent(analysis, "retained_ratio")}</span>
      </div>
    </Panel>
  );
}

function ComparisonPanel({
  analysis,
  lapOptions,
  cursorDistance,
  onCursor,
  onAnalyze,
}: {
  analysis: XrkAnalysis;
  lapOptions: number[];
  cursorDistance: number;
  onCursor: (value: number) => void;
  onAnalyze: (options: Partial<XrkAnalyzeOptions>) => Promise<void>;
}) {
  return (
    <>
      <Panel
        title="Distance-aligned lap comparison"
        subtitle="Interpolated on track distance, never matched by array index"
        action={
          <div className="flex flex-wrap gap-2">
            <LapPicker
              label="Reference"
              value={analysis.reference_lap}
              options={lapOptions}
              onChange={(reference_lap) => onAnalyze({ reference_lap })}
            />
            <LapPicker
              label="Target"
              value={analysis.target_lap}
              options={lapOptions}
              onChange={(target_lap) => onAnalyze({ target_lap })}
            />
          </div>
        }
      >
        <TelemetryChart
          data={analysis.comparison}
          lines={[
            ["reference_rpm", "Reference RPM", "#f6c945"],
            ["target_rpm", "Target RPM", "#35d6d0"],
          ]}
          cursorDistance={cursorDistance}
          onCursor={onCursor}
          height={300}
        />
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Speed vs Distance" subtitle="Reference and selected lap">
          <TelemetryChart
            data={analysis.comparison}
            lines={[
              ["reference_speed", "Reference speed", "#f6c945"],
              ["target_speed", "Target speed", "#35d6d0"],
            ]}
            cursorDistance={cursorDistance}
            onCursor={onCursor}
          />
        </Panel>
        <Panel title="Cumulative Time Delta" subtitle="Positive means the target lap is behind">
          <TelemetryChart
            data={analysis.comparison}
            lines={[["cumulative_time_delta_s", "Time delta", "#ff5964"]]}
            cursorDistance={cursorDistance}
            onCursor={onCursor}
          />
        </Panel>
      </div>
    </>
  );
}

function ActionsPanel({
  analysis,
  cursorDistance,
  onCursor,
}: {
  analysis: XrkAnalysis;
  cursorDistance: number;
  onCursor: (distance: number) => void;
}) {
  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <Panel title="RPM & Longitudinal G" subtitle="Driver-action evidence by distance">
          <TelemetryChart
            data={analysis.comparison}
            lines={[
              ["target_rpm", "Target RPM", "#f6c945"],
              ["target_longitudinal_g", "Longitudinal G", "#35d6d0"],
            ]}
            cursorDistance={cursorDistance}
            onCursor={onCursor}
            events={analysis.events}
            height={340}
          />
        </Panel>
        <Panel title="Detected events" subtitle="Select an event to link map, charts and video">
          <div className="thin-scrollbar max-h-[390px] space-y-2 overflow-auto">
            {analysis.events.length ? analysis.events.map((event, index) => (
              <button
                key={`${event.lap}-${event.event_type}-${event.distance_m}-${index}`}
                type="button"
                onClick={() => onCursor(event.distance_m)}
                className="w-full rounded-md border border-slate-800 bg-slate-950/60 p-3 text-left hover:border-[#35d6d0]"
              >
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-sm text-white">{humanEvent(event.event_type)}</strong>
                  <span className={confidenceClass(event.confidence)}>{event.confidence}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Lap {event.lap} · {event.distance_m.toFixed(1)} m · {eventChannels(event).join(", ")}
                </p>
              </button>
            )) : <p className="text-sm text-slate-400">No supported action events were found.</p>}
          </div>
        </Panel>
      </div>
      {!analysis.capabilities.direct_brake && (
        <div className="rounded-md border border-amber-400/25 bg-amber-400/8 px-4 py-3 text-sm leading-6 text-amber-100">
          No direct brake channel is present. “Likely braking” is an inference from RPM,
          speed deceleration, negative longitudinal G and track curvature, and is capped at
          medium confidence.
        </div>
      )}
    </>
  );
}

function SectorZonePanel({
  analysis,
  sectorCount,
  setSectorCount,
  customBoundaries,
  setCustomBoundaries,
  zoneStart,
  onMapPoint,
  onApply,
  analyzing,
}: {
  analysis: XrkAnalysis;
  sectorCount: number;
  setSectorCount: (count: number) => void;
  customBoundaries: number[];
  setCustomBoundaries: (values: number[]) => void;
  zoneStart: number | null;
  onMapPoint: (distance: number) => void;
  onApply: () => Promise<void>;
  analyzing: boolean;
}) {
  const [mapTool, setMapTool] = useState<"sector" | "zone">("sector");
  function handleMapPoint(distance: number) {
    if (mapTool === "zone") {
      void onMapPoint(distance);
      return;
    }
    const expected = sectorCount - 1;
    const next = [...customBoundaries, distance]
      .sort((a, b) => a - b)
      .slice(-expected);
    setCustomBoundaries(next);
  }
  return (
    <>
      <Panel
        title="Virtual sectors & suggested zones"
        subtitle="Click the reference trace to place distance-based boundaries"
        action={
          <div className="flex flex-wrap gap-2">
            <Select value={String(sectorCount)} onChange={(value) => {
              setSectorCount(Number(value));
              setCustomBoundaries([]);
            }} options={[2, 3, 4, 5, 6].map((value) => [String(value), `${value} sectors`])} />
            <Select value={mapTool} onChange={(value) => setMapTool(value as "sector" | "zone")} options={[
              ["sector", "Sector boundary"],
              ["zone", "Zone entry / exit"],
            ]} />
            <button
              type="button"
              disabled={analyzing}
              onClick={() => void onApply()}
              className="rounded-md border border-[#f6c945] bg-[#f6c945] px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        }
      >
        <TrackSvg
          reference={analysis.track!.reference}
          target={analysis.track!.target}
          mode="reference"
          channel="speed"
          cursorDistance={zoneStart ?? 0}
          onSelect={handleMapPoint}
          boundaries={customBoundaries.length ? customBoundaries : analysis.sectors!.boundaries_m.slice(1, -1)}
        />
        <p className="mt-3 text-xs text-slate-400">
          {mapTool === "sector"
            ? `${customBoundaries.length}/${sectorCount - 1} custom boundaries selected. Empty selection uses equal distance.`
            : zoneStart === null ? "Click zone entry, then zone exit." : `Zone entry: ${zoneStart.toFixed(1)} m. Select exit.`}
        </p>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Sector result" subtitle="Virtual distance timing">
          <div className="thin-scrollbar overflow-auto">
            <table className="w-full min-w-[460px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr><th className="py-2">Lap</th>{Object.keys(analysis.sectors!.sector_best).map((key) => <th key={key}>{key}</th>)}</tr>
              </thead>
              <tbody>
                {analysis.sectors!.lap_rows.map((row) => (
                  <tr key={String(row.lap)} className="border-t border-slate-800 text-slate-300">
                    <td className="py-2 text-white">{String(row.lap)}</td>
                    {Object.keys(analysis.sectors!.sector_best).map((key) => <td key={key}>{numberCell(row[key])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Zone comparison" subtitle="Suggested or manually defined analysis ranges">
          <div className="thin-scrollbar max-h-[360px] space-y-3 overflow-auto">
            {analysis.zones.comparisons.map((zone) => (
              <article key={zone.id} className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex justify-between gap-3">
                  <strong className="text-sm text-white">{zone.name}</strong>
                  <span className="text-xs text-slate-500">{zone.source}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-300">
                  {zone.entry_distance_m.toFixed(1)}–{zone.exit_distance_m.toFixed(1)} m ·
                  loss {numberCell(zone.estimated_zone_loss_s)} s ·
                  {zone.findings.find((finding) => finding.metric === "minimum_rpm")
                    ? ` min RPM Δ ${numberCell(zone.findings.find((finding) => finding.metric === "minimum_rpm")?.difference)} rpm`
                    : " min RPM unavailable"}
                </p>
              </article>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}

function VideoSyncPanel({
  analysis,
  cursorDistance,
  seekDistance,
  onCursor,
}: {
  analysis: XrkAnalysis;
  cursorDistance: number;
  seekDistance: number | null;
  onCursor: (distance: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoName, setVideoName] = useState("");
  const storageKey = `racing-video-sync:${analysis.track?.track_id ?? "unknown"}:${analysis.inspection_id}`;
  const [offsetMs, setOffsetMs] = useState(() => {
    if (typeof window === "undefined") return 0;
    return Number(window.localStorage.getItem(storageKey) ?? "0") || 0;
  });

  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, String(offsetMs));
  }, [offsetMs, storageKey]);

  useEffect(() => {
    if (!videoRef.current || seekDistance === null || !analysis.track) return;
    const point = nearestPoint(analysis.track.target, seekDistance);
    if (point?.session_time_s != null) {
      videoRef.current.currentTime = Math.max(0, point.session_time_s + offsetMs / 1000);
    }
  }, [seekDistance, offsetMs, analysis.track]);

  function followVideo() {
    if (!analysis.track || !videoRef.current) return;
    const sessionTime = videoRef.current.currentTime - offsetMs / 1000;
    const point = analysis.track.target.reduce((best, candidate) => {
      if (candidate.session_time_s == null) return best;
      if (!best || Math.abs(candidate.session_time_s - sessionTime) < Math.abs((best.session_time_s ?? 0) - sessionTime)) return candidate;
      return best;
    }, null as XrkTrackPoint | null);
    if (point) onCursor(point.distance_m);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <Panel title="Local video sync" subtitle="Video remains in this browser and is never uploaded">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            className="aspect-video w-full bg-black"
            onTimeUpdate={followVideo}
          />
        ) : (
          <label className="flex aspect-video cursor-pointer flex-col items-center justify-center border border-dashed border-slate-700 bg-slate-950/70 text-slate-400 hover:border-[#35d6d0]">
            <Video size={30} />
            <span className="mt-3 text-sm">Choose onboard video</span>
            <input className="hidden" type="file" accept="video/*" onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (videoUrl) URL.revokeObjectURL(videoUrl);
              setVideoUrl(URL.createObjectURL(file));
              setVideoName(file.name);
            }} />
          </label>
        )}
        {videoName && <p className="mt-2 truncate text-xs text-slate-400">{videoName}</p>}
      </Panel>
      <Panel title="Synchronization" subtitle="Telemetry session time plus manual video offset">
        <label className="block text-xs text-slate-400">
          Video offset (ms)
          <input
            type="number"
            step={50}
            value={offsetMs}
            onChange={(event) => setOffsetMs(Number(event.target.value) || 0)}
            className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          />
        </label>
        <div className="mt-4 rounded-md border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs text-slate-500">Shared track cursor</p>
          <p className="mt-1 text-lg font-semibold text-white">{cursorDistance.toFixed(1)} m</p>
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-500">
          Clicking the map or an event seeks the video. During playback, the telemetry cursor
          follows the selected lap using session time.
        </p>
      </Panel>
    </div>
  );
}

function ReportPanel({ analysis }: { analysis: XrkAnalysis }) {
  return (
    <Panel title="Evidence-aware driver review" subtitle="Measured, calculated and inferred are kept separate">
      <pre className="thin-scrollbar max-h-[620px] overflow-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-950/70 p-4 text-sm leading-6 text-slate-200">
        {analysis.report}
      </pre>
      {analysis.warnings.length > 0 && (
        <div className="mt-4 space-y-2">
          {analysis.warnings.map((warning) => (
            <p key={warning} className="text-xs leading-5 text-amber-100">{warning}</p>
          ))}
        </div>
      )}
    </Panel>
  );
}

function TrackSvg({
  reference,
  target,
  mode,
  channel,
  cursorDistance,
  onSelect,
  boundaries = [],
}: {
  reference: XrkTrackPoint[];
  target: XrkTrackPoint[];
  mode: MapMode;
  channel: ColorChannel;
  cursorDistance: number;
  onSelect: (distance: number) => void;
  boundaries?: number[];
}) {
  const [hover, setHover] = useState<XrkTrackPoint | null>(null);
  const all = [...reference, ...target].filter((point) => point.local_x_m != null && point.local_y_m != null);
  const bounds = coordinateBounds(all);
  const project = (point: XrkTrackPoint) => ({
    x: 28 + (((point.local_x_m ?? 0) - bounds.minX) / bounds.width) * 744,
    y: 472 - (((point.local_y_m ?? 0) - bounds.minY) / bounds.height) * 444,
  });
  const visible = mode === "reference" ? [reference] : mode === "target" ? [target] : [reference, target];
  const values = visible.flat().map((point) => point[channel]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const cursor = nearestPoint(mode === "target" ? target : reference, cursorDistance);
  return (
    <div className="relative">
      <svg viewBox="0 0 800 500" className="max-h-[620px] w-full bg-[#080c12]" role="img" aria-label="GPS track map">
        {visible.map((trace, traceIndex) => trace.slice(0, -1).map((point, index) => {
          const next = trace[index + 1];
          const a = project(point);
          const b = project(next);
          const color = mode === "overlay"
            ? traceIndex === 0 ? "#f6c945" : "#35d6d0"
            : valueColor(point[channel], min, max);
          return (
            <line
              key={`${traceIndex}-${index}`}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={color} strokeWidth={mode === "overlay" ? 2.5 : 4}
              strokeLinecap="round"
            />
          );
        }))}
        {reference.filter((_, index) => index % 5 === 0).map((point, index) => {
          const p = project(point);
          return (
            <circle
              key={`hit-${index}`}
              cx={p.x} cy={p.y} r={7}
              fill="transparent"
              onMouseEnter={() => setHover(point)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect(point.distance_m)}
              className="cursor-crosshair"
            />
          );
        })}
        {boundaries.map((boundary) => {
          const point = nearestPoint(reference, boundary);
          if (!point) return null;
          const p = project(point);
          return <circle key={boundary} cx={p.x} cy={p.y} r={7} fill="#ff5964" stroke="#fff" strokeWidth={2} />;
        })}
        {cursor && (() => {
          const p = project(cursor);
          return <circle cx={p.x} cy={p.y} r={7} fill="#fff" stroke="#ff5964" strokeWidth={3} />;
        })()}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-slate-700 bg-slate-950/95 p-3 text-xs text-slate-200">
          <p>{hover.distance_m.toFixed(1)} m · {numberCell(hover.lap_time_s)} s</p>
          <p>{numberCell(hover.speed)} km/h · {numberCell(hover.rpm)} rpm</p>
        </div>
      )}
    </div>
  );
}

function TelemetryChart({
  data,
  lines,
  cursorDistance,
  onCursor,
  events = [],
  height = 260,
}: {
  data: Array<Record<string, number | null>>;
  lines: Array<[string, string, string]>;
  cursorDistance: number;
  onCursor: (distance: number) => void;
  events?: XrkEvent[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} onClick={(state) => {
        const value = state?.activeLabel;
        if (typeof value === "number") onCursor(value);
      }}>
        <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" />
        <XAxis dataKey="distance_m" stroke="#8b98aa" type="number" domain={["dataMin", "dataMax"]} />
        <YAxis stroke="#8b98aa" />
        <Tooltip contentStyle={tooltipStyle} />
        {lines.map(([key, name, color]) => (
          <Line key={key} type="monotone" dataKey={key} name={name} stroke={color} dot={false} connectNulls strokeWidth={2} />
        ))}
        {events.map((event, index) => (
          <ReferenceLine key={`${event.event_type}-${event.distance_m}-${index}`} x={event.distance_m} stroke={eventColor(event.event_type)} strokeOpacity={0.55} />
        ))}
        <ReferenceLine x={cursorDistance} stroke="#fff" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function EventEvidence({ event }: { event: XrkEvent }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <strong className="text-white">{humanEvent(event.event_type)}</strong>
        <span className={confidenceClass(event.confidence)}>{event.confidence} confidence</span>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Lap {event.lap} · {event.distance_m.toFixed(1)} m · {event.lap_time_s.toFixed(2)} s
      </p>
      <div className="mt-4 space-y-2">
        {Object.entries(event.evidence).slice(0, 7).map(([key, value]) => (
          <div key={key} className="flex justify-between gap-4 text-xs">
            <span className="text-slate-500">{key.replaceAll("_", " ")}</span>
            <span className="text-slate-200">{String(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel rounded-lg p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <SlidersHorizontal size={17} className="text-[#35d6d0]" /> {title}
          </div>
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Unavailable({ reason }: { reason: string }) {
  return (
    <section className="panel rounded-lg p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <AlertTriangle size={18} className="text-amber-300" /> Analysis unavailable
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-400">{reason}</p>
    </section>
  );
}

function Select({ value, options, onChange }: { value: string; options: Array<readonly [string, string]>; onChange: (value: string) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white">
      {options.map(([option, label]) => <option key={option} value={option}>{label}</option>)}
    </select>
  );
}

function LapPicker({ label, value, options, onChange }: { label: string; value: number; options: number[]; onChange: (value: number) => void }) {
  return (
    <label className="text-xs text-slate-400">
      {label}
      <select value={value} onChange={(event) => onChange(Number(event.target.value))} className="ml-2 rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-white">
        {options.map((lap) => <option key={lap} value={lap}>Lap {lap}</option>)}
      </select>
    </label>
  );
}

function coordinateBounds(points: XrkTrackPoint[]) {
  const xs = points.map((point) => point.local_x_m ?? 0);
  const ys = points.map((point) => point.local_y_m ?? 0);
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 1);
  return { minX, minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function nearestPoint(points: XrkTrackPoint[], distance: number) {
  return points.reduce((best, point) => (
    !best || Math.abs(point.distance_m - distance) < Math.abs(best.distance_m - distance) ? point : best
  ), null as XrkTrackPoint | null);
}

function nearestEvent(events: XrkEvent[], distance: number) {
  return events.reduce((best, event) => (
    !best || Math.abs(event.distance_m - distance) < Math.abs(best.distance_m - distance) ? event : best
  ), undefined as XrkEvent | undefined);
}

function valueColor(value: number | null | undefined, min: number, max: number) {
  if (value == null || !Number.isFinite(value)) return "#475569";
  const ratio = Math.max(0, Math.min(1, (value - min) / Math.max(0.0001, max - min)));
  const hue = 205 - ratio * 160;
  return `hsl(${hue} 80% 58%)`;
}

function eventColor(type: string) {
  if (type.includes("BRAKING")) return "#ff5964";
  if (type.includes("LIFT") || type.includes("COAST")) return "#f6c945";
  if (type.includes("REACCEL") || type.includes("ACCELERATION")) return "#66e38f";
  return "#35d6d0";
}

function humanEvent(type: string) {
  return type.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eventChannels(event: XrkEvent) {
  return event.channels_used?.length
    ? event.channels_used
    : Object.keys(event.evidence).filter((key) => !key.endsWith("_smoothed") && !key.endsWith("_slope"));
}

function confidenceClass(confidence: string) {
  return `rounded px-2 py-1 text-[10px] uppercase ${
    confidence === "high"
      ? "bg-emerald-400/15 text-emerald-200"
      : confidence === "medium"
        ? "bg-amber-400/15 text-amber-100"
        : "bg-slate-700 text-slate-300"
  }`;
}

function numberCell(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "Unavailable";
}

function formatPercent(analysis: XrkAnalysis, key: string) {
  const quality = analysis as XrkAnalysis & { gps_quality?: Record<string, number> };
  const value = quality.gps_quality?.[key];
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "Unavailable";
}

const tooltipStyle = {
  background: "#0b1018",
  border: "1px solid rgba(148, 163, 184, 0.28)",
  borderRadius: "6px",
  color: "#e9edf3",
};
