"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  FileText,
  Flag,
  Gauge,
  Map,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Video,
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
  ["quality", "Lap Quality", ShieldCheck],
  ["track", "Track Map", Map],
  ["comparison", "Lap Comparison", BarChart3],
  ["actions", "Driver Benchmark", Activity],
  ["sectors", "Sector / Zones", Flag],
  ["video", "Video Sync", Video],
  ["coach", "AI Coach Summary", Target],
  ["report", "Report", FileText],
] as const;

type TabId = (typeof tabs)[number][0];
type MapMode = "reference" | "target" | "overlay";
type ColorChannel = "speed" | "rpm" | "time_delta_s" | "longitudinal_g" | "lateral_g";

export function XrkAnalysisWorkspace({
  analysis,
  analyzing,
  onAnalyze,
  publishedDemo = false,
}: {
  analysis: XrkAnalysis;
  analyzing: boolean;
  onAnalyze: (options: Partial<XrkAnalyzeOptions>) => Promise<void>;
  publishedDemo?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [cursorDistance, setCursorDistance] = useState(0);
  const [seekDistance, setSeekDistance] = useState<number | null>(null);
  const [sectorCount, setSectorCount] = useState(analysis.sectors?.count ?? 3);
  const [customBoundaries, setCustomBoundaries] = useState<number[]>([]);
  const [zoneStart, setZoneStart] = useState<number | null>(null);
  const [manualZones, setManualZones] = useState<XrkAnalyzeOptions["manual_zones"]>([]);

  useEffect(() => {
    if (publishedDemo) return;
    const stored = readSectorConfig(analysis.track?.track_id);
    if (!stored) return;
    queueMicrotask(() => {
      setSectorCount(stored.sectorCount);
      setCustomBoundaries(stored.boundaries);
    });
  }, [analysis.track?.track_id, publishedDemo]);

  const lapOptions = analysis.lap_rows.map((row) => Number(row.lap));
  const selectedEvent = nearestEvent(analysis.events, cursorDistance);

  function selectDistance(distance: number) {
    setCursorDistance(distance);
    setSeekDistance(distance);
  }

  async function applySectors() {
    if (analysis.track) {
      window.localStorage.setItem(
        `racing-sectors:${analysis.track.track_id}`,
        JSON.stringify({
          sectorCount,
          boundaries: customBoundaries.length === sectorCount - 1 ? customBoundaries : [],
        })
      );
    }
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

      {publishedDemo && (
        <div className="rounded-md border border-[#35d6d0]/30 bg-[#35d6d0]/10 px-4 py-3 text-sm text-cyan-100">
          Anonymized real session · read-only published analysis. All displayed telemetry comes
          from the reviewed artifact; interactive recalculation requires uploading a session.
        </div>
      )}

      {activeTab === "overview" && (
        <Overview analysis={analysis} selectedEvent={selectedEvent} />
      )}

      {activeTab === "quality" && (
        <LapQualityPanel
          analysis={analysis}
          analyzing={analyzing}
          onAnalyze={onAnalyze}
          readOnly={publishedDemo}
        />
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
            readOnly={publishedDemo}
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
            readOnly={publishedDemo}
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

      {activeTab === "coach" && <CoachSummaryPanel analysis={analysis} onCursor={selectDistance} />}

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
    ["Fastest valid lap", analysis.lap_quality.top_valid_laps[0] ? `Lap ${analysis.lap_quality.top_valid_laps[0].lap}` : "Unavailable"],
    ["Target lap", `Lap ${analysis.target_lap}`],
    ["Reference-eligible", String(analysis.lap_quality.reference_eligible_count)],
    ["Track length", analysis.track ? `${analysis.track.lap_length_m.toFixed(1)} m` : "Unavailable"],
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
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Every comparison reference is a real completed lap that passed the quality gate.
          The system does not construct a stitched target lap or RPM trace.
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

function LapQualityPanel({
  analysis,
  analyzing,
  onAnalyze,
  readOnly,
}: {
  analysis: XrkAnalysis;
  analyzing: boolean;
  onAnalyze: (options: Partial<XrkAnalyzeOptions>) => Promise<void>;
  readOnly: boolean;
}) {
  const top = new Set(analysis.lap_quality.top_valid_laps.map((lap) => lap.lap));
  const [absoluteGap, setAbsoluteGap] = useState(
    analysis.lap_quality.config.absolute_gap_threshold_s
  );
  const [relativeGap, setRelativeGap] = useState(
    analysis.lap_quality.config.relative_gap_threshold_pct
  );
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <Panel title="Lap Quality Gate" subtitle="Only eligible real laps can enter the reference Top 3">
        <div className="thin-scrollbar overflow-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Lap</th>
                <th>Lap time</th>
                <th>Gap</th>
                <th>Status</th>
                <th>Score</th>
                <th>AI reference</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {analysis.lap_quality.laps.map((lap) => (
                <tr key={lap.lap} className="border-t border-slate-800 text-slate-300">
                  <td className="py-2 font-semibold text-white">Lap {lap.lap}</td>
                  <td>{lap.lap_time.toFixed(3)}s</td>
                  <td>{lap.gap_to_fastest >= 0 ? "+" : ""}{lap.gap_to_fastest.toFixed(3)}s</td>
                  <td><span className={qualityClass(lap.quality_status)}>{humanEvent(lap.quality_status)}</span></td>
                  <td>{Math.round(lap.quality_score * 100)}%</td>
                  <td>{top.has(lap.lap) ? "Top reference" : lap.analysis_eligible ? "Eligible" : "No"}</td>
                  <td className="max-w-[280px] text-xs text-slate-500">{lap.reasons.join(" ") || "Passed timing and telemetry checks."}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Reference policy" subtitle="Real completed laps only">
        <dl className="space-y-3 text-sm">
          <QualityFact label="Absolute gap" value={`${analysis.lap_quality.config.absolute_gap_threshold_s.toFixed(3)}s`} />
          <QualityFact label="Relative gap" value={`${analysis.lap_quality.config.relative_gap_threshold_pct.toFixed(1)}%`} />
          <QualityFact label="Available Top laps" value={String(analysis.lap_quality.top_valid_laps.length)} />
          <QualityFact
            label="Fastest consistent"
            value={analysis.lap_quality.fastest_consistent_lap
              ? `Lap ${analysis.lap_quality.fastest_consistent_lap.lap}`
              : "Unavailable"}
          />
        </dl>
        {analysis.lap_quality.notice && (
          <p className="mt-4 rounded-md border border-amber-400/25 bg-amber-400/8 p-3 text-xs leading-5 text-amber-100">
            {analysis.lap_quality.notice}
          </p>
        )}
        {!readOnly && <div className="mt-5 border-t border-slate-800 pt-4">
          <p className="text-xs font-semibold uppercase text-slate-500">Coach thresholds</p>
          <label className="mt-3 block text-xs text-slate-400">
            Absolute gap (seconds)
            <input
              type="number"
              min={0.05}
              max={5}
              step={0.05}
              value={absoluteGap}
              onChange={(event) => setAbsoluteGap(Number(event.target.value))}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>
          <label className="mt-3 block text-xs text-slate-400">
            Relative gap (%)
            <input
              type="number"
              min={0.1}
              max={10}
              step={0.1}
              value={relativeGap}
              onChange={(event) => setRelativeGap(Number(event.target.value))}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>
          <button
            type="button"
            disabled={analyzing || !Number.isFinite(absoluteGap) || !Number.isFinite(relativeGap)}
            onClick={() => void onAnalyze({
              lap_quality_absolute_gap_s: absoluteGap,
              lap_quality_relative_gap_pct: relativeGap,
            })}
            className="mt-4 w-full rounded-md bg-[#f6c945] px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50"
          >
            Apply quality gate
          </button>
        </div>}
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
            ["reference", "Reference"],
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
        <span>Reference Lap {analysis.reference_lap}</span>
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
  readOnly,
}: {
  analysis: XrkAnalysis;
  lapOptions: number[];
  cursorDistance: number;
  onCursor: (value: number) => void;
  onAnalyze: (options: Partial<XrkAnalyzeOptions>) => Promise<void>;
  readOnly: boolean;
}) {
  const topLaps = analysis.top_laps_comparison.laps;
  const topColors = ["#f6c945", "#35d6d0", "#ff5964"];
  const referenceOptions = analysis.lap_quality.laps
    .filter((lap) => lap.analysis_eligible)
    .map((lap) => lap.lap);
  const topRpmLines = topLaps.map((lap, index) => (
    [
      `lap_${lap.lap}_rpm`,
      `${index + 1}. Lap ${lap.lap} · ${lap.lap_time.toFixed(3)}s`,
      topColors[index % topColors.length],
    ] as [string, string, string]
  ));
  const consistentLap = analysis.top_laps_comparison.fastest_consistent_lap;
  if (consistentLap && !topLaps.some((lap) => lap.lap === consistentLap.lap)) {
    topRpmLines.push([
      `lap_${consistentLap.lap}_rpm`,
      `Consistent · Lap ${consistentLap.lap} · ${consistentLap.lap_time.toFixed(3)}s`,
      "#66e38f",
    ]);
  }
  return (
    <>
      <Panel
        title="Top valid laps · RPM consensus"
        subtitle="Fastest, second and third fastest quality-gated real laps aligned by distance"
      >
        {analysis.top_laps_comparison.aligned.length && topRpmLines.length ? (
          <TelemetryChart
            data={analysis.top_laps_comparison.aligned}
            lines={topRpmLines}
            cursorDistance={cursorDistance}
            onCursor={onCursor}
            height={320}
          />
        ) : (
          <p className="text-sm text-slate-400">No distance-aligned eligible lap overlay is available.</p>
        )}
        <p className="mt-3 text-xs leading-5 text-slate-500">
          {analysis.lap_quality.minimum_top_laps_met
            ? "All three traces are real completed laps. No RPM segments are stitched or averaged into a target curve."
            : analysis.lap_quality.notice}
        </p>
      </Panel>
      <Panel
        title="Selected real-lap comparison"
        subtitle="Reference must pass the quality gate; the selected lap may be used for context"
        action={readOnly ? undefined : (
          <div className="flex flex-wrap gap-2">
            <LapPicker
              label="Reference"
              value={analysis.reference_lap}
              options={referenceOptions}
              onChange={(reference_lap) => onAnalyze({ reference_lap })}
            />
            <LapPicker
              label="Target"
              value={analysis.target_lap}
              options={lapOptions}
              onChange={(target_lap) => onAnalyze({ target_lap })}
            />
          </div>
        )}
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
        <Panel title="Driver Benchmark & Corner Dynamics" subtitle="RPM with longitudinal G as supporting evidence">
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
  readOnly,
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
  readOnly: boolean;
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
        action={readOnly ? undefined : (
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
        )}
      >
        <TrackSvg
          reference={analysis.track!.reference}
          target={analysis.track!.target}
          mode="reference"
          channel="speed"
          cursorDistance={zoneStart ?? 0}
          onSelect={readOnly ? () => {} : handleMapPoint}
          boundaries={customBoundaries.length ? customBoundaries : analysis.sectors!.boundaries_m.slice(1, -1)}
        />
        <p className="mt-3 text-xs text-slate-400">
          {readOnly
            ? "Published virtual sectors and suggested zones are fixed for this read-only demo."
            : mapTool === "sector"
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
  const storageKey = `racing-video-sync:${analysis.track?.track_id ?? "unknown"}:${analysis.file_fingerprint}`;
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

function CoachSummaryPanel({
  analysis,
  onCursor,
}: {
  analysis: XrkAnalysis;
  onCursor: (distance: number) => void;
}) {
  const summary = analysis.ai_coach_summary;
  const improvement = analysis.achievable_improvement_range;
  const rangeAvailable = improvement.maximum_improvement_s > 0;
  return (
    <div className="space-y-5">
      <Panel title="AI Driver Improvement Summary" subtitle="Structured evidence from quality-gated real laps">
        {analysis.narrative ? (
          <div>
            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-200">
              {analysis.narrative}
            </p>
            <p className="mt-4 text-xs font-medium text-amber-200">
              AI 生成，请与教练核实
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <QualityFact
                label="Primary focus"
                value={summary.training_priorities[0]?.corner ?? "No validated focus"}
              />
              <QualityFact
                label="Achievable range"
                value={rangeAvailable
                  ? `${improvement.minimum_improvement_s.toFixed(3)}–${improvement.maximum_improvement_s.toFixed(3)}s`
                  : "Insufficient evidence"}
              />
              <QualityFact label="Confidence" value={humanEvent(improvement.confidence)} />
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-300">{summary.reference_statement}</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              This range is empirical and conservative. It is not a target lap time, and the
              listed changes are not assumed to coexist in one lap.
            </p>
          </>
        )}
      </Panel>

      <Panel title="Next-session priorities" subtitle="At most three transferable, downstream-safe patterns">
        {summary.training_priorities.length ? (
          <div>
            {summary.training_priorities.map((priority, index) => {
              const corner = analysis.consensus_benchmark.corners.find(
                (item) => item.corner === priority.corner
              );
              return (
                <section key={priority.corner} className="border-t border-slate-800 py-5 first:border-t-0 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase text-[#35d6d0]">Priority {index + 1}</p>
                      <h3 className="mt-1 text-lg font-semibold text-white">{priority.corner}</h3>
                    </div>
                    {corner && (
                      <button
                        type="button"
                        onClick={() => onCursor((corner.entry_distance_m + corner.exit_distance_m) / 2)}
                        className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-[#35d6d0]"
                      >
                        Show on track
                      </button>
                    )}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{priority.why}</p>
                  <CoachField label="What to test" value={priority.what_to_test} />
                  <CoachField label="Training drill" value={priority.training_drill} />
                  <CoachField label="Stop condition" value={priority.stop_condition} />
                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">Success criteria</p>
                    <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-300">
                      {priority.success_criteria.map((criterion) => <li key={criterion}>- {criterion}</li>)}
                    </ul>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    Evidence: {priority.evidence.channels.join(", ")} · Confidence: {priority.confidence}
                    {priority.limitation ? ` · ${priority.limitation}` : ""}
                  </p>
                </section>
              );
            })}
          </div>
        ) : (
          <p className="text-sm leading-6 text-slate-400">
            No corner pattern currently meets the repeatability, net-gain and downstream-cost
            requirements. Review the emerging evidence without treating it as a training target.
          </p>
        )}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Stable strengths" subtitle="Repeatable behavior that should not be changed casually">
          {summary.stable_strengths.length ? summary.stable_strengths.map((strength) => (
            <div key={`${strength.corner}-${strength.finding}`} className="border-t border-slate-800 py-3 first:border-t-0 first:pt-0">
              <strong className="text-sm text-white">{strength.corner}</strong>
              <p className="mt-1 text-sm leading-6 text-slate-400">{strength.finding}</p>
            </div>
          )) : <p className="text-sm text-slate-400">No stable strength passed the current repeatability threshold.</p>}
        </Panel>
        <Panel title="Rejected apparent improvements" subtitle="Local gains that did not survive downstream validation">
          {summary.rejected_apparent_improvements.length ? summary.rejected_apparent_improvements.map((item) => (
            <div key={item.corner} className="border-t border-slate-800 py-3 first:border-t-0 first:pt-0">
              <strong className="text-sm text-white">{item.corner}</strong>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Local gain {item.local_gain_s.toFixed(3)}s · downstream cost {item.downstream_cost_s.toFixed(3)}s · net {item.net_gain_s >= 0 ? "+" : ""}{item.net_gain_s.toFixed(3)}s.
              </p>
              <p className="mt-1 text-xs text-slate-500">{item.reason}</p>
            </div>
          )) : <p className="text-sm text-slate-400">No downstream-compromised local gain was found in the current Top laps.</p>}
        </Panel>
      </div>

      {(summary.fastest_lap_unique_features.length > 0 || summary.emerging_improvements.length > 0) && (
        <Panel title="Observed but not yet transferable" subtitle="Real-lap differences that need repetition or coach confirmation">
          {[...summary.fastest_lap_unique_features, ...summary.emerging_improvements].map((item) => (
            <div key={`${item.corner}-${item.reason}`} className="border-t border-slate-800 py-3 first:border-t-0 first:pt-0">
              <strong className="text-sm text-white">{item.corner}</strong>
              {"features" in item && (
                <p className="mt-1 text-sm leading-6 text-slate-300">{item.features.join("; ")}</p>
              )}
              <p className="mt-1 text-xs leading-5 text-slate-500">{item.reason} Confidence: {item.confidence}.</p>
            </div>
          ))}
        </Panel>
      )}

      <div className="rounded-md border border-amber-400/25 bg-amber-400/8 px-4 py-3 text-xs leading-5 text-amber-100">
        {summary.limitations.join(" ")}
      </div>
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

function QualityFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-base font-semibold text-white">{value}</p>
    </div>
  );
}

function CoachField({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-sm leading-6 text-slate-300">{value}</p>
    </div>
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

function qualityClass(status: string) {
  const color = status === "REFERENCE_ELIGIBLE"
    ? "bg-emerald-400/15 text-emerald-200"
    : status === "CONTEXT_ONLY"
      ? "bg-slate-700 text-slate-300"
      : "bg-amber-400/15 text-amber-100";
  return `rounded px-2 py-1 text-[10px] uppercase ${color}`;
}

function numberCell(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "Unavailable";
}

function formatPercent(analysis: XrkAnalysis, key: string) {
  const quality = analysis as XrkAnalysis & { gps_quality?: Record<string, number> };
  const value = quality.gps_quality?.[key];
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "Unavailable";
}

function readSectorConfig(trackId?: string) {
  if (typeof window === "undefined" || !trackId) return null;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(`racing-sectors:${trackId}`) ?? "null"
    ) as { sectorCount?: number; boundaries?: number[] } | null;
    if (
      !parsed
      || !Number.isInteger(parsed.sectorCount)
      || (parsed.sectorCount ?? 0) < 2
      || (parsed.sectorCount ?? 0) > 6
      || !Array.isArray(parsed.boundaries)
    ) return null;
    return {
      sectorCount: parsed.sectorCount as number,
      boundaries: parsed.boundaries.filter((value) => typeof value === "number" && Number.isFinite(value)),
    };
  } catch {
    return null;
  }
}

const tooltipStyle = {
  background: "#0b1018",
  border: "1px solid rgba(148, 163, 184, 0.28)",
  borderRadius: "6px",
  color: "#e9edf3",
};
