"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clapperboard,
  FileText,
  Flag,
  Gauge,
  Link2,
  Map,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  WandSparkles,
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
import { autoSyncVideoTelemetry } from "../lib/xrkAnalysisApi";
import { extractVideoSyncFeatures } from "../lib/videoFeatureExtraction";
import {
  createVideoSyncCalibration,
  nearestPointByDistance,
  nearestPointBySessionTime,
  nextSeekRequest,
  parseVideoSyncCalibration,
  telemetrySessionTimeBounds,
  telemetryToVideoTimeS,
  validateVideoSeek,
  videoToTelemetryTimeS,
  type SeekRequest,
  type VideoSyncCalibration,
} from "../lib/videoTelemetrySync";
import { useI18n, type TranslationKey } from "../lib/i18n";
import { StoryboardPanel } from "./StoryboardPanel";

const tabs = [
  ["overview", "xrk.tab.overview", Gauge],
  ["quality", "xrk.tab.quality", ShieldCheck],
  ["track", "xrk.tab.track", Map],
  ["comparison", "xrk.tab.comparison", BarChart3],
  ["actions", "xrk.tab.actions", Activity],
  ["sectors", "xrk.tab.sectors", Flag],
  ["video", "xrk.tab.video", Video],
  ["storyboard", "xrk.tab.storyboard", Clapperboard],
  ["coach", "xrk.tab.coach", Target],
  ["report", "xrk.tab.report", FileText],
] as const satisfies ReadonlyArray<readonly [string, TranslationKey, typeof Gauge]>;

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
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [cursorDistance, setCursorDistance] = useState(0);
  const [seekRequest, setSeekRequest] = useState<SeekRequest | null>(null);
  const [sectorCount, setSectorCount] = useState(analysis.sectors?.count ?? 3);
  const [customBoundaries, setCustomBoundaries] = useState<number[]>([]);
  const [zoneStart, setZoneStart] = useState<number | null>(null);
  const [manualZones, setManualZones] = useState<XrkAnalyzeOptions["manual_zones"]>([]);
  const videoStorageKey = `racing-video-sync:${analysis.track?.track_id ?? "unknown"}:${analysis.file_fingerprint}`;
  const [videoUrl, setVideoUrl] = useState("");
  const [videoName, setVideoName] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoDurationS, setVideoDurationS] = useState(0);
  const [calibration, setCalibration] = useState<VideoSyncCalibration | null>(() => {
    if (typeof window === "undefined") return null;
    return parseVideoSyncCalibration(window.localStorage.getItem(videoStorageKey));
  });
  const [offsetMs, setOffsetMs] = useState(calibration?.offset_ms ?? 0);

  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  useEffect(() => {
    if (calibration) {
      window.localStorage.setItem(videoStorageKey, JSON.stringify(calibration));
    }
  }, [calibration, videoStorageKey]);

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
    setSeekRequest((previous) => nextSeekRequest(previous, distance));
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
      <nav className="panel thin-scrollbar flex overflow-x-auto rounded-lg p-2" aria-label={t("xrk.navLabel")}>
        {tabs.map(([id, labelKey, Icon]) => (
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
            <Icon size={16} /> {t(labelKey)}
          </button>
        ))}
      </nav>

      {analyzing && (
        <div className="rounded-md border border-[#35d6d0]/30 bg-[#35d6d0]/10 px-4 py-3 text-sm text-cyan-100">
          {t("xrk.status.analyzing")}
        </div>
      )}

      {publishedDemo && (
        <div className="rounded-md border border-[#35d6d0]/30 bg-[#35d6d0]/10 px-4 py-3 text-sm text-cyan-100">
          {t("xrk.status.published")}
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
          <Unavailable reason={t("xrk.unavailable.gps")} />
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
          <Unavailable reason={t("xrk.unavailable.alignment")} />
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
          <Unavailable reason={t("xrk.unavailable.rpm")} />
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
          <Unavailable reason={t("xrk.unavailable.sectors")} />
        )
      )}

      {activeTab === "video" && (
        <VideoSyncPanel
          analysis={analysis}
          cursorDistance={cursorDistance}
          seekRequest={seekRequest}
          onCursor={setCursorDistance}
          videoUrl={videoUrl}
          videoName={videoName}
          videoFile={videoFile}
          videoDurationS={videoDurationS}
          calibration={calibration}
          offsetMs={offsetMs}
          setVideoUrl={setVideoUrl}
          setVideoName={setVideoName}
          setVideoFile={setVideoFile}
          setVideoDurationS={setVideoDurationS}
          setCalibration={setCalibration}
          setOffsetMs={setOffsetMs}
        />
      )}

      {activeTab === "storyboard" && (
        <StoryboardPanel
          analysis={analysis}
          videoFile={videoFile}
          videoUrl={videoUrl}
          videoDurationS={videoDurationS}
          calibration={calibration}
          publishedDemo={publishedDemo}
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
  const { t } = useI18n();
  const metrics = [
    [t("xrk.overview.fastest"), analysis.lap_quality.top_valid_laps[0] ? `Lap ${analysis.lap_quality.top_valid_laps[0].lap}` : t("xrk.video.unavailableTime")],
    [t("xrk.overview.target"), `Lap ${analysis.target_lap}`],
    [t("xrk.overview.eligible"), String(analysis.lap_quality.reference_eligible_count)],
    [t("xrk.overview.trackLength"), analysis.track ? `${analysis.track.lap_length_m.toFixed(1)} m` : t("xrk.video.unavailableTime")],
  ];
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <Panel title={t("xrk.overview.boundaryTitle")} subtitle={t("xrk.overview.boundarySubtitle")}>
        <div className="grid gap-3 sm:grid-cols-2">
          {metrics.map(([label, value]) => (
            <div key={label} className="rounded-md border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-[11px] uppercase text-slate-500">{label}</p>
              <p className="mt-2 text-xl font-semibold text-white">{value}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-400">
          {t("xrk.overview.virtualBoundary")}
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          {t("xrk.overview.realLapBoundary")}
        </p>
      </Panel>
      <Panel title={t("xrk.overview.evidenceTitle")} subtitle={t("xrk.overview.evidenceSubtitle")}>
        {selectedEvent ? <EventEvidence event={selectedEvent} /> : (
          <p className="text-sm text-slate-400">{t("xrk.overview.selectEvidence")}</p>
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
  const { t } = useI18n();
  const top = new Set(analysis.lap_quality.top_valid_laps.map((lap) => lap.lap));
  const [absoluteGap, setAbsoluteGap] = useState(
    analysis.lap_quality.config.absolute_gap_threshold_s
  );
  const [relativeGap, setRelativeGap] = useState(
    analysis.lap_quality.config.relative_gap_threshold_pct
  );
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <Panel title={t("xrk.quality.title")} subtitle={t("xrk.quality.subtitle")}>
        <div className="thin-scrollbar overflow-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">{t("xrk.quality.lap")}</th>
                <th>{t("xrk.quality.lapTime")}</th>
                <th>{t("xrk.quality.gap")}</th>
                <th>{t("xrk.quality.status")}</th>
                <th>{t("xrk.quality.score")}</th>
                <th>{t("xrk.quality.aiReference")}</th>
                <th>{t("xrk.quality.reason")}</th>
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
                  <td>{top.has(lap.lap) ? t("xrk.quality.topReference") : lap.analysis_eligible ? t("xrk.quality.eligible") : t("xrk.quality.no")}</td>
                  <td className="max-w-[280px] text-xs text-slate-500">{lap.reasons.join(" ") || t("xrk.quality.passed")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title={t("xrk.quality.policyTitle")} subtitle={t("xrk.quality.policySubtitle")}>
        <dl className="space-y-3 text-sm">
          <QualityFact label={t("xrk.quality.absoluteGap")} value={`${analysis.lap_quality.config.absolute_gap_threshold_s.toFixed(3)}s`} />
          <QualityFact label={t("xrk.quality.relativeGap")} value={`${analysis.lap_quality.config.relative_gap_threshold_pct.toFixed(1)}%`} />
          <QualityFact label={t("xrk.quality.availableTop")} value={String(analysis.lap_quality.top_valid_laps.length)} />
          <QualityFact
            label={t("xrk.quality.fastestConsistent")}
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
          <p className="text-xs font-semibold uppercase text-slate-500">{t("xrk.quality.thresholds")}</p>
          <label className="mt-3 block text-xs text-slate-400">
            {t("xrk.quality.absoluteSeconds")}
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
            {t("xrk.quality.relativePercent")}
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
            {t("xrk.quality.apply")}
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
  const { t } = useI18n();
  const [mode, setMode] = useState<MapMode>("overlay");
  const [channel, setChannel] = useState<ColorChannel>("speed");
  return (
    <Panel
      title={t("xrk.track.title")}
      subtitle={t("xrk.track.subtitle")}
      action={
        <div className="flex flex-wrap gap-2">
          <Select value={mode} onChange={(value) => setMode(value as MapMode)} options={[
            ["reference", t("xrk.map.reference")],
            ["target", t("xrk.map.selected")],
            ["overlay", t("xrk.map.overlay")],
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
  const { t } = useI18n();
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
        title={t("xrk.comparison.topTitle")}
        subtitle={t("xrk.comparison.topSubtitle")}
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
          <p className="text-sm text-slate-400">{t("xrk.comparison.empty")}</p>
        )}
        <p className="mt-3 text-xs leading-5 text-slate-500">
          {analysis.lap_quality.minimum_top_laps_met
            ? t("xrk.comparison.realOnly")
            : analysis.lap_quality.notice}
        </p>
      </Panel>
      <Panel
        title={t("xrk.comparison.selectedTitle")}
        subtitle={t("xrk.comparison.selectedSubtitle")}
        action={readOnly ? undefined : (
          <div className="flex flex-wrap gap-2">
            <LapPicker
              label={t("xrk.comparison.reference")}
              value={analysis.reference_lap}
              options={referenceOptions}
              onChange={(reference_lap) => onAnalyze({ reference_lap })}
            />
            <LapPicker
              label={t("xrk.comparison.target")}
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
        <Panel title={t("xrk.comparison.speedTitle")} subtitle={t("xrk.comparison.speedSubtitle")}>
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
        <Panel title={t("xrk.comparison.deltaTitle")} subtitle={t("xrk.comparison.deltaSubtitle")}>
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
  const { t } = useI18n();
  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <Panel title={t("xrk.actions.title")} subtitle={t("xrk.actions.subtitle")}>
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
        <Panel title={t("xrk.actions.eventsTitle")} subtitle={t("xrk.actions.eventsSubtitle")}>
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
            )) : <p className="text-sm text-slate-400">{t("xrk.actions.noEvents")}</p>}
          </div>
        </Panel>
      </div>
      {!analysis.capabilities.direct_brake && (
        <div className="rounded-md border border-amber-400/25 bg-amber-400/8 px-4 py-3 text-sm leading-6 text-amber-100">
          {t("xrk.actions.noBrake")}
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
  const { t } = useI18n();
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
        title={t("xrk.sectors.title")}
        subtitle={t("xrk.sectors.subtitle")}
        action={readOnly ? undefined : (
          <div className="flex flex-wrap gap-2">
            <Select value={String(sectorCount)} onChange={(value) => {
              setSectorCount(Number(value));
              setCustomBoundaries([]);
            }} options={[2, 3, 4, 5, 6].map((value) => [String(value), t("xrk.sectors.count", { value })])} />
            <Select value={mapTool} onChange={(value) => setMapTool(value as "sector" | "zone")} options={[
              ["sector", t("xrk.sectors.boundaryTool")],
              ["zone", t("xrk.sectors.zoneTool")],
            ]} />
            <button
              type="button"
              disabled={analyzing}
              onClick={() => void onApply()}
              className="rounded-md border border-[#f6c945] bg-[#f6c945] px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50"
            >
              {t("xrk.sectors.apply")}
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
            ? t("xrk.sectors.readOnly")
            : mapTool === "sector"
            ? t("xrk.sectors.selection", { current: customBoundaries.length, required: sectorCount - 1 })
            : zoneStart === null ? t("xrk.sectors.zoneEntry") : t("xrk.sectors.zoneExit", { value: zoneStart.toFixed(1) })}
        </p>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title={t("xrk.sectors.resultTitle")} subtitle={t("xrk.sectors.resultSubtitle")}>
          <div className="thin-scrollbar overflow-auto">
            <table className="w-full min-w-[460px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr><th className="py-2">{t("xrk.quality.lap")}</th>{Object.keys(analysis.sectors!.sector_best).map((key) => <th key={key}>{key}</th>)}</tr>
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
        <Panel title={t("xrk.sectors.zoneTitle")} subtitle={t("xrk.sectors.zoneSubtitle")}>
          <div className="thin-scrollbar max-h-[360px] space-y-3 overflow-auto">
            {analysis.zones.comparisons.map((zone) => (
              <article key={zone.id} className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex justify-between gap-3">
                  <strong className="text-sm text-white">{zone.name}</strong>
                  <span className="text-xs text-slate-500">{zone.source}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-300">
                  {zone.entry_distance_m.toFixed(1)}–{zone.exit_distance_m.toFixed(1)} m ·
                  {t("xrk.sectors.loss")} {numberCell(zone.estimated_zone_loss_s)} s ·
                  {zone.findings.find((finding) => finding.metric === "minimum_rpm")
                    ? ` ${t("xrk.sectors.minRpmDelta")} ${numberCell(zone.findings.find((finding) => finding.metric === "minimum_rpm")?.difference)} rpm`
                    : ` ${t("xrk.sectors.minRpmUnavailable")}`}
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
  seekRequest,
  onCursor,
  videoUrl,
  videoName,
  videoFile,
  videoDurationS,
  calibration,
  offsetMs,
  setVideoUrl,
  setVideoName,
  setVideoFile,
  setVideoDurationS,
  setCalibration,
  setOffsetMs,
}: {
  analysis: XrkAnalysis;
  cursorDistance: number;
  seekRequest: SeekRequest | null;
  onCursor: (distance: number) => void;
  videoUrl: string;
  videoName: string;
  videoFile: File | null;
  videoDurationS: number;
  calibration: VideoSyncCalibration | null;
  offsetMs: number;
  setVideoUrl: (value: string) => void;
  setVideoName: (value: string) => void;
  setVideoFile: (value: File | null) => void;
  setVideoDurationS: (value: number) => void;
  setCalibration: (value: VideoSyncCalibration | null) => void;
  setOffsetMs: (value: number) => void;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncError, setSyncError] = useState("");
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [autoConfidence, setAutoConfidence] = useState<number | null>(null);
  const autoSyncAbortRef = useRef<AbortController | null>(null);
  const storageKey = `racing-video-sync:${analysis.track?.track_id ?? "unknown"}:${analysis.file_fingerprint}`;
  const targetPoints = analysis.track?.target ?? [];
  const cursorPoint = nearestPointByDistance(targetPoints, cursorDistance);

  useEffect(() => () => {
    autoSyncAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!videoRef.current || !seekRequest || !analysis.track) return;
    const point = nearestPointByDistance(analysis.track.target, seekRequest.distance_m);
    if (point?.session_time_s == null) {
      queueMicrotask(() => setSyncError(t("xrk.video.noTelemetryTime")));
      return;
    }
    const targetTime = telemetryToVideoTimeS(point.session_time_s, offsetMs);
    const validation = validateVideoSeek(targetTime, videoDurationS);
    if (!validation.ok) {
      queueMicrotask(() => setSyncError(t("xrk.video.seekInvalid")));
      return;
    }
    videoRef.current.currentTime = validation.time_s;
    queueMicrotask(() => {
      setSyncError("");
      setSyncMessage(t("xrk.video.seeked", {
        lap: analysis.target_lap,
        distance: point.distance_m.toFixed(1),
        video: validation.time_s.toFixed(3),
      }));
    });
  }, [seekRequest, offsetMs, videoDurationS, analysis.track, analysis.target_lap, t]);

  function loadVideoMetadata() {
    const video = videoRef.current;
    if (!video || !videoFile || !Number.isFinite(video.duration) || video.duration <= 0) {
      setVideoDurationS(0);
      setSyncError(t("xrk.video.invalidDuration"));
      return;
    }
    setVideoDurationS(video.duration);
    if (calibration && calibrationMatchesVideo(calibration, videoFile, video.duration)) {
      setOffsetMs(calibration.offset_ms);
      setSyncMessage(t("xrk.video.restore", { offset: signedMilliseconds(calibration.offset_ms) }));
      setSyncError("");
    } else if (calibration) {
      setOffsetMs(0);
      setSyncMessage("");
      setSyncError(t("xrk.video.wrongVideo"));
    } else {
      setSyncError("");
    }
  }

  function calibrateCurrentMoment() {
    const video = videoRef.current;
    if (!video || !videoFile) {
      setSyncError(t("xrk.video.chooseBeforeCalibration"));
      return;
    }
    if (!cursorPoint) {
      setSyncError(t("xrk.video.selectDistance"));
      return;
    }
    try {
      const next = createVideoSyncCalibration({
        videoTimeS: video.currentTime,
        telemetryPoint: cursorPoint,
        targetLap: analysis.target_lap,
        videoDurationS,
        fileSizeBytes: videoFile.size,
        fileLastModifiedMs: videoFile.lastModified,
        fileMimeType: videoFile.type,
      });
      setCalibration(next);
      setOffsetMs(next.offset_ms);
      setSyncError("");
      setSyncMessage(t("xrk.video.calibrated", {
        video: next.video_time_s.toFixed(3),
        lap: next.target_lap,
        distance: next.telemetry_distance_m.toFixed(1),
      }));
    } catch {
      setSyncError(t("xrk.video.calibrationFailed"));
    }
  }

  function updateManualOffset(value: number) {
    setOffsetMs(value);
    setCalibration(null);
    window.localStorage.removeItem(storageKey);
    setSyncError("");
    setSyncMessage(t("xrk.video.manualActive"));
  }

  async function runAutomaticAlignment() {
    const video = videoRef.current;
    if (!video || !videoFile || videoDurationS <= 0) {
      setSyncError(t("xrk.video.chooseBeforeAuto"));
      return;
    }
    if (!analysis.inspection_id || analysis.inspection_id.startsWith("public-demo")) {
      setSyncError(t("xrk.video.activeInspectionRequired"));
      return;
    }
    autoSyncAbortRef.current?.abort();
    const controller = new AbortController();
    autoSyncAbortRef.current = controller;
    setAutoSyncing(true);
    setAutoConfidence(null);
    setSyncError("");
    setSyncMessage(t("xrk.video.reading"));
    try {
      const videoFeatures = await extractVideoSyncFeatures(video, {
        signal: controller.signal,
      });
      setSyncMessage(t("xrk.video.comparing"));
      const result = await autoSyncVideoTelemetry({
        inspection_id: analysis.inspection_id,
        video_features: videoFeatures,
      }, controller.signal);
      setOffsetMs(result.offset_ms);
      setCalibration(null);
      window.localStorage.removeItem(storageKey);
      setAutoConfidence(result.confidence);
      if (result.reliable) {
        setSyncMessage(t("xrk.video.autoReliable", {
          offset: signedMilliseconds(result.offset_ms),
          confidence: formatConfidence(result.confidence),
        }));
      } else {
        setSyncMessage("");
        setSyncError(t("xrk.video.autoUnreliable", {
          confidence: formatConfidence(result.confidence),
          offset: signedMilliseconds(result.offset_ms),
        }));
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setSyncMessage("");
        setSyncError((error as Error).message || t("xrk.video.autoFailed"));
      }
    } finally {
      if (autoSyncAbortRef.current === controller) autoSyncAbortRef.current = null;
      setAutoSyncing(false);
    }
  }

  function followVideo() {
    if (!analysis.track || !videoRef.current) return;
    const sessionTime = videoToTelemetryTimeS(videoRef.current.currentTime, offsetMs);
    const bounds = telemetrySessionTimeBounds(analysis.track.target);
    if (!bounds || sessionTime < bounds.start_s || sessionTime > bounds.end_s) return;
    const point = nearestPointBySessionTime(analysis.track.target, sessionTime);
    if (point) onCursor(point.distance_m);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <Panel title={t("xrk.video.title")} subtitle={t("xrk.video.subtitle")}>
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            className="aspect-video w-full bg-black"
            onTimeUpdate={followVideo}
            onLoadedMetadata={loadVideoMetadata}
          />
        ) : (
          <label className="flex aspect-video cursor-pointer flex-col items-center justify-center border border-dashed border-slate-700 bg-slate-950/70 text-slate-400 hover:border-[#35d6d0]">
            <Video size={30} />
            <span className="mt-3 text-sm">{t("xrk.video.choose")}</span>
            <input className="hidden" type="file" accept="video/*" onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (videoUrl) URL.revokeObjectURL(videoUrl);
              setVideoUrl(URL.createObjectURL(file));
              setVideoName(file.name);
              setVideoFile(file);
              setVideoDurationS(0);
              setSyncMessage("");
              setSyncError("");
              setAutoConfidence(null);
            }} />
          </label>
        )}
        {videoName && <p className="mt-2 truncate text-xs text-slate-400">{videoName}</p>}
      </Panel>
      <Panel title={t("xrk.video.syncTitle")} subtitle={t("xrk.video.syncSubtitle")}>
        <label className="block text-xs text-slate-400">
          {t("xrk.video.offset")}
          <input
            type="number"
            step={50}
            value={offsetMs}
            onChange={(event) => updateManualOffset(Number(event.target.value) || 0)}
            className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          />
        </label>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          {t("xrk.video.signConvention")}
        </p>
        <div className="mt-4 rounded-md border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs text-slate-500">{t("xrk.video.sharedCursor")}</p>
          <p className="mt-1 text-lg font-semibold text-white">{cursorDistance.toFixed(1)} m</p>
          <p className="mt-1 text-xs text-slate-500">
            {t("xrk.video.selectedTime", {
              lap: analysis.target_lap,
              value: cursorPoint?.session_time_s == null ? t("xrk.video.unavailableTime") : `${cursorPoint.session_time_s.toFixed(3)} s`,
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={runAutomaticAlignment}
          disabled={autoSyncing || !videoUrl || videoDurationS <= 0 || !analysis.inspection_id || analysis.inspection_id.startsWith("public-demo")}
          className="mt-4 flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-cyan-500/60 bg-cyan-500/10 px-4 text-sm font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <WandSparkles size={16} /> {autoSyncing ? t("xrk.video.autoRunning") : t("xrk.video.auto")}
        </button>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          {t("xrk.video.privacy")}
        </p>
        {autoConfidence != null && (
          <p className="mt-2 text-xs text-slate-400">{t("xrk.video.autoConfidence", { value: formatConfidence(autoConfidence) })}</p>
        )}
        <button
          type="button"
          onClick={calibrateCurrentMoment}
          disabled={!videoUrl || videoDurationS <= 0 || cursorPoint?.session_time_s == null}
          className="mt-4 flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-[#f6c945] px-4 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Link2 size={16} /> {t("xrk.video.calibrate")}
        </button>
        {videoDurationS > 0 && (
          <p className="mt-2 text-xs text-slate-500">{t("xrk.video.duration", { value: videoDurationS.toFixed(3) })}</p>
        )}
        {calibration && (
          <p className="mt-2 text-xs leading-5 text-emerald-300">
            {t("xrk.video.savedAnchor", {
              video: calibration.video_time_s.toFixed(3),
              distance: calibration.telemetry_distance_m.toFixed(1),
              offset: signedMilliseconds(calibration.offset_ms),
            })}
          </p>
        )}
        {syncMessage && <p className="mt-2 text-xs leading-5 text-cyan-200">{syncMessage}</p>}
        {syncError && <p role="alert" className="mt-2 text-xs leading-5 text-red-300">{syncError}</p>}
        <p className="mt-4 text-xs leading-5 text-slate-500">
          {t("xrk.video.followBoundary", { lap: analysis.target_lap })}
        </p>
        <p className="mt-2 text-xs leading-5 text-slate-600">
          {t("xrk.video.savedPrivacy")}
        </p>
      </Panel>
    </div>
  );
}

function calibrationMatchesVideo(
  calibration: VideoSyncCalibration,
  file: File,
  durationS: number
): boolean {
  return calibration.video.size_bytes === file.size
    && calibration.video.last_modified_ms === file.lastModified
    && Math.abs(calibration.video.duration_s - durationS) <= 0.1;
}

function signedMilliseconds(value: number): string {
  return `${value >= 0 ? "+" : ""}${value} ms`;
}

function formatConfidence(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function CoachSummaryPanel({
  analysis,
  onCursor,
}: {
  analysis: XrkAnalysis;
  onCursor: (distance: number) => void;
}) {
  const { t } = useI18n();
  const summary = analysis.ai_coach_summary;
  const improvement = analysis.achievable_improvement_range;
  const rangeAvailable = improvement.maximum_improvement_s > 0;
  return (
    <div className="space-y-5">
      <Panel title={t("xrk.coach.title")} subtitle={t("xrk.coach.subtitle")}>
        {analysis.narrative ? (
          <div>
            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-200">
              {analysis.narrative}
            </p>
            <p className="mt-4 text-xs font-medium text-amber-200">
              {t("xrk.coach.disclaimer")}
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <QualityFact
                label={t("xrk.coach.primaryFocus")}
                value={summary.training_priorities[0]?.corner ?? t("xrk.coach.noFocus")}
              />
              <QualityFact
                label={t("xrk.coach.achievableRange")}
                value={rangeAvailable
                  ? `${improvement.minimum_improvement_s.toFixed(3)}–${improvement.maximum_improvement_s.toFixed(3)}s`
                  : t("xrk.coach.insufficient")}
              />
              <QualityFact label={t("xrk.coach.confidence")} value={humanEvent(improvement.confidence)} />
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-300">{summary.reference_statement}</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              {t("xrk.coach.rangeBoundary")}
            </p>
          </>
        )}
      </Panel>

      <Panel title={t("xrk.coach.nextPriorities")} subtitle={t("xrk.coach.nextSubtitle")}>
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
                      <p className="text-[11px] font-semibold uppercase text-[#35d6d0]">{t("xrk.coach.priority", { index: index + 1 })}</p>
                      <h3 className="mt-1 text-lg font-semibold text-white">{priority.corner}</h3>
                    </div>
                    {corner && (
                      <button
                        type="button"
                        onClick={() => onCursor((corner.entry_distance_m + corner.exit_distance_m) / 2)}
                        className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-[#35d6d0]"
                      >
                        {t("xrk.coach.jump")}
                      </button>
                    )}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{priority.why}</p>
                  <CoachField label={t("xrk.coach.whatToTest")} value={priority.what_to_test} />
                  <CoachField label={t("xrk.coach.trainingDrill")} value={priority.training_drill} />
                  <CoachField label={t("xrk.coach.stopCondition")} value={priority.stop_condition} />
                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">{t("xrk.coach.successCriteria")}</p>
                    <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-300">
                      {priority.success_criteria.map((criterion) => <li key={criterion}>- {criterion}</li>)}
                    </ul>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {t("xrk.coach.evidence")}: {priority.evidence.channels.join(", ")} · {t("xrk.coach.confidence")}: {priority.confidence}
                    {priority.limitation ? ` · ${priority.limitation}` : ""}
                  </p>
                </section>
              );
            })}
          </div>
        ) : (
          <p className="text-sm leading-6 text-slate-400">
            {t("xrk.coach.noPriority")}
          </p>
        )}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title={t("xrk.coach.stableTitle")} subtitle={t("xrk.coach.stableSubtitle")}>
          {summary.stable_strengths.length ? summary.stable_strengths.map((strength) => (
            <div key={`${strength.corner}-${strength.finding}`} className="border-t border-slate-800 py-3 first:border-t-0 first:pt-0">
              <strong className="text-sm text-white">{strength.corner}</strong>
              <p className="mt-1 text-sm leading-6 text-slate-400">{strength.finding}</p>
            </div>
          )) : <p className="text-sm text-slate-400">{t("xrk.coach.noStrength")}</p>}
        </Panel>
        <Panel title={t("xrk.coach.rejectedTitle")} subtitle={t("xrk.coach.rejectedSubtitle")}>
          {summary.rejected_apparent_improvements.length ? summary.rejected_apparent_improvements.map((item) => (
            <div key={item.corner} className="border-t border-slate-800 py-3 first:border-t-0 first:pt-0">
              <strong className="text-sm text-white">{item.corner}</strong>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                {t("xrk.coach.localGain")} {item.local_gain_s.toFixed(3)}s · {t("xrk.coach.downstreamCost")} {item.downstream_cost_s.toFixed(3)}s · {t("xrk.coach.net")} {item.net_gain_s >= 0 ? "+" : ""}{item.net_gain_s.toFixed(3)}s.
              </p>
              <p className="mt-1 text-xs text-slate-500">{item.reason}</p>
            </div>
          )) : <p className="text-sm text-slate-400">{t("xrk.coach.noRejected")}</p>}
        </Panel>
      </div>

      {(summary.fastest_lap_unique_features.length > 0 || summary.emerging_improvements.length > 0) && (
        <Panel title={t("xrk.coach.emergingTitle")} subtitle={t("xrk.coach.emergingSubtitle")}>
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
  const { t } = useI18n();
  return (
    <Panel title={t("xrk.report.title")} subtitle={t("xrk.report.subtitle")}>
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
  const { t } = useI18n();
  return (
    <section className="panel rounded-lg p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <AlertTriangle size={18} className="text-amber-300" /> {t("xrk.unavailable.generic")}
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
