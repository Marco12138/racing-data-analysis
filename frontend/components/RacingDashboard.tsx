"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CirclePlay,
  Database,
  Download,
  Flag,
  Gauge,
  LineChart,
  LoaderCircle,
  MapPin,
  Play,
  Scissors,
  Trash2,
  Upload,
  Video,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  analyzeLaps,
  buildTelemetryMetricRows,
  compareSpeedByDistance,
  formatSeconds,
  formatSector,
  generateDriverReport,
  generateHandlingFlags,
  getSectorColumns,
  normalizeLapRows,
  normalizeTelemetryRows,
  parseCsv,
  summarizeTelemetry,
} from "../lib/analysis";
import {
  type AimImportResponse,
} from "../lib/aimImportApi";
import {
  analyzeXrkInspection,
  deleteXrkInspection,
  getLocalXrkLibrary,
  getXrkInspection,
  inspectLocalXrkSource,
  inspectXrkFile,
  type LocalXrkSource,
  type XrkAnalysis,
  type XrkAnalyzeOptions,
  type XrkInspection,
  XrkApiError,
} from "../lib/xrkAnalysisApi";
import { consumeSelectedFile } from "../lib/fileUpload";
import {
  MAX_TEMPORARY_SESSIONS,
  SESSION_STORAGE_KEY,
  parseStoredSessions,
  toStoredSession,
} from "../lib/sessionWorkspace";
import { removeInspectionSessions } from "../lib/driverComparison";
import { FrontendApiConfigError, frontendConfig } from "../lib/config";
import { sampleLapCsv, sampleTelemetryCsv } from "../lib/sampleData";
import {
  loadPublishedRealDemo,
  type PublishedRealDemoSession,
} from "../lib/realDemoSession";
import { XrkAnalysisWorkspace } from "./XrkAnalysisWorkspace";
import { XrkInspectionWorkspace } from "./XrkInspectionWorkspace";
import { MultiSessionWorkspace } from "./MultiSessionWorkspace";
import { NewSessionCard } from "./NewSessionCard";
import { commitPendingVideo, isXrkFileName } from "../lib/sessionUpload";
import { useI18n } from "../lib/i18n";
import { buildSessionSummary } from "../lib/driverProfile";
import { saveSessionSummary } from "../lib/driverProfileDb";
import {
  clearVideoJob,
  createVideoJob,
  createVideoMarker,
  deleteVideoMarker,
  getDeploymentCapabilities,
  getVideoJob,
  getVideoLibrary,
  keyframeUrl,
  markerExportUrl,
  videoStreamUrl,
  type VideoJob,
  type VideoMarker,
  type VideoSource,
  type DeploymentCapabilities,
} from "../lib/videoApi";

const chartColors = ["#f6c945", "#35d6d0", "#ff5964", "#66e38f"];
const demoLapRows = normalizeLapRows(parseCsv(sampleLapCsv));
const demoTelemetryRows = normalizeTelemetryRows(parseCsv(sampleTelemetryCsv));

export function RacingDashboard({ initialDemo = false }: { initialDemo?: boolean }) {
  const { locale } = useI18n();
  const [lapRows, setLapRows] = useState(() => initialDemo ? [...demoLapRows] : normalizeLapRows([]));
  const [telemetryRows, setTelemetryRows] = useState(() => initialDemo ? [...demoTelemetryRows] : normalizeTelemetryRows([]));
  const [driverName, setDriverName] = useState(initialDemo ? "Demo Driver" : "Driver");
  const [vehicleName, setVehicleName] = useState(initialDemo ? "Demo Kart" : "Vehicle");
  const [trackName, setTrackName] = useState(initialDemo ? "Shanghai Sprint Circuit" : "Local Kart Track");
  const [sessionDate, setSessionDate] = useState(initialDemo ? "2026-06-14" : new Date().toISOString().slice(0, 10));
  const [referenceLap, setReferenceLap] = useState(initialDemo ? 6 : 1);
  const [targetLap, setTargetLap] = useState(initialDemo ? 3 : 1);
  const [videoJob, setVideoJob] = useState<VideoJob | null>(null);
  const [dataError, setDataError] = useState("");
  const [aimImport, setAimImport] = useState<AimImportResponse | null>(null);
  const [xrkInspection, setXrkInspection] = useState<XrkInspection | null>(null);
  const [xrkAnalysis, setXrkAnalysis] = useState<XrkAnalysis | null>(null);
  const [publishedDemo, setPublishedDemo] = useState<PublishedRealDemoSession | null>(null);
  const [xrkSessions, setXrkSessions] = useState<XrkInspection[]>([]);
  const [pendingVideoFile, setPendingVideoFile] = useState<File | null>(null);
  const [activeVideoFile, setActiveVideoFile] = useState<File | null>(null);
  const [deploymentCapabilities, setDeploymentCapabilities] =
    useState<DeploymentCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState("");
  const [capabilityLoading, setCapabilityLoading] = useState(true);
  const [localXrkSources, setLocalXrkSources] = useState<LocalXrkSource[]>([]);
  const [aimImportStatus, setAimImportStatus] = useState<"idle" | "inspecting" | "inspected" | "analyzing" | "loaded">(
    "idle"
  );
  const xrkAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    let attempt = 0;
    const maxAttempts = 3;
    async function loadCapabilities() {
      try {
        const capabilities = await getDeploymentCapabilities();
        if (!active) return;
        setDeploymentCapabilities(capabilities);
        setCapabilityError("");
      } catch (error) {
        if (!active) return;
        attempt += 1;
        if (attempt < maxAttempts) {
          window.setTimeout(loadCapabilities, attempt * 1500);
          return;
        }
        setCapabilityError(formatXrkClientError(error as Error));
      } finally {
        if (active) setCapabilityLoading(false);
      }
    }
    void loadCapabilities();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (deploymentCapabilities?.mode !== "local") return;
    let active = true;
    void getLocalXrkLibrary()
      .then((sources) => {
        if (active) setLocalXrkSources(sources);
      })
      .catch(() => {
        if (active) setLocalXrkSources([]);
      });
    return () => {
      active = false;
    };
  }, [deploymentCapabilities?.mode]);

  useEffect(() => {
    if (initialDemo) void loadDemoData();
  }, [initialDemo]);

  useEffect(() => {
    let active = true;
    const stored = parseStoredSessions(window.localStorage.getItem(SESSION_STORAGE_KEY));
    Promise.allSettled(stored.map((session) => getXrkInspection(session.inspection_id)))
      .then((results) => {
        if (!active) return;
        const restored = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        setXrkSessions(restored);
        window.localStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify(restored.map(toStoredSession))
        );
      });
    return () => {
      active = false;
    };
  }, []);

  const lapAnalysis = useMemo(() => (lapRows.length ? analyzeLaps(lapRows) : null), [lapRows]);
  const telemetrySummary = useMemo(
    () => (telemetryRows.length ? summarizeTelemetry(telemetryRows) : null),
    [telemetryRows]
  );
  const handlingFlags = useMemo(
    () => (telemetryRows.length ? generateHandlingFlags(telemetryRows) : []),
    [telemetryRows]
  );
  const behaviorInputsAvailable = useMemo(
    () => telemetryRows.some((row) => typeof row.brake === "number" || typeof row.throttle === "number"),
    [telemetryRows]
  );
  const lapOptions = lapRows.map((row) => row.lap);
  const speedComparison = useMemo(
    () =>
      telemetryRows.length && lapOptions.includes(referenceLap) && lapOptions.includes(targetLap)
        ? compareSpeedByDistance(telemetryRows, referenceLap, targetLap)
        : [],
    [telemetryRows, referenceLap, targetLap, lapOptions]
  );
  const telemetryCurve = useMemo(
    () => telemetryRows.filter((row) => row.lap === targetLap),
    [telemetryRows, targetLap]
  );
  const generatedDataReport = useMemo(
    () => (lapAnalysis ? generateDriverReport(lapAnalysis, telemetrySummary, handlingFlags) : null),
    [lapAnalysis, telemetrySummary, handlingFlags]
  );
  const dataReport = aimImport?.report ?? generatedDataReport;
  const virtualSectors = aimImport?.virtual_sectors.derived_not_official ?? false;
  const sectorSourceLabel = virtualSectors
    ? "Virtual sectors · equal-distance thirds · not official timing"
    : null;

  async function handleCsvUpload(file: File, kind: "lap" | "telemetry") {
    try {
      const rows = parseCsv(await file.text());
      if (kind === "lap") {
        const normalized = normalizeLapRows(rows);
        if (!normalized.length || !getSectorColumns(normalized).length) {
          throw new Error("Lap CSV requires lap, lap_time and at least one sector_ column.");
        }
        setLapRows(normalized);
        setReferenceLap(normalized[0].lap);
        setTargetLap(normalized[Math.min(1, normalized.length - 1)].lap);
      } else {
        const normalized = normalizeTelemetryRows(rows);
        if (!normalized.length) {
          throw new Error("Telemetry CSV requires a valid lap column and numeric samples.");
        }
        setTelemetryRows(normalized);
      }
      xrkAbortRef.current?.abort();
      setAimImport(null);
      setXrkInspection(null);
      setXrkAnalysis(null);
      setPublishedDemo(null);
      setAimImportStatus("idle");
      setDataError("");
    } catch (error) {
      setDataError((error as Error).message);
    }
  }

  async function handleAimUpload(file: File): Promise<XrkInspection | null> {
    if (!isXrkFileName(file.name)) {
      setDataError("Please select an AiM .xrk or .xrz file.");
      return null;
    }
    const activeTemporarySessions = xrkSessions.filter(
      (session) => Date.parse(session.expires_at) > Date.now()
    );
    if (activeTemporarySessions.length >= MAX_TEMPORARY_SESSIONS) {
      setDataError("Temporary Session Workspace is full. Remove one session before importing another XRK.");
      return null;
    }
    const serverImport = deploymentCapabilities?.xrk_server_import;
    if (!serverImport?.available) {
      setDataError(
        serverImport?.message ??
          capabilityError ??
          "XRK server import is not available in this deployment."
      );
      return null;
    }
    if (xrkAbortRef.current) {
      return null;
    }
    const controller = new AbortController();
    xrkAbortRef.current = controller;
    setAimImportStatus("inspecting");
    setDataError("");
    try {
      const inspected = await inspectXrkFile(
        file,
        controller.signal,
        serverImport.max_upload_bytes,
      );
      applyXrkInspection(inspected);
      return inspected;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        setDataError("XRK upload was cancelled.");
      } else {
        setDataError(formatXrkClientError(error as Error));
      }
      setAimImportStatus("idle");
      return null;
    } finally {
      if (xrkAbortRef.current === controller) xrkAbortRef.current = null;
    }
  }

  async function handleLocalXrkSource(sourceId: string): Promise<void> {
    if (xrkAbortRef.current || !sourceId) return;
    const controller = new AbortController();
    xrkAbortRef.current = controller;
    setAimImportStatus("inspecting");
    setDataError("");
    try {
      applyXrkInspection(await inspectLocalXrkSource(sourceId, controller.signal));
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setDataError(formatXrkClientError(error as Error));
      }
      setAimImportStatus("idle");
    } finally {
      if (xrkAbortRef.current === controller) xrkAbortRef.current = null;
    }
  }

  function applyXrkInspection(inspected: XrkInspection): void {
      setLapRows(normalizeLapRows([]));
      setTelemetryRows(normalizeTelemetryRows([]));
      setAimImport(null);
      setXrkInspection(inspected);
      setXrkAnalysis(null);
      setPublishedDemo(null);
      setXrkSessions((current) => {
        const next = [
          ...current.filter((session) => session.inspection_id !== inspected.inspection_id),
          inspected,
        ].slice(-MAX_TEMPORARY_SESSIONS);
        window.localStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify(next.map(toStoredSession))
        );
        return next;
      });
      setDriverName(metadataText(inspected.metadata, "Driver", "Driver"));
      setVehicleName(metadataText(inspected.metadata, "Vehicle", "Vehicle"));
      setTrackName(metadataText(inspected.metadata, "Venue", "Unknown track"));
      setSessionDate(normalizeAimDate(inspected.metadata["Log Date"]));
      setAimImportStatus("inspected");
  }

  async function handleNewSession(xrkFile: File, videoFile: File | null) {
    setPendingVideoFile(videoFile);
    const inspected = await handleAimUpload(xrkFile);
    if (!inspected) {
      setPendingVideoFile(null);
      return;
    }
    await runXrkAnalysis({}, inspected, videoFile);
  }

  async function runXrkAnalysis(
    options: Partial<XrkAnalyzeOptions> = {},
    inspectionOverride?: XrkInspection,
    pendingVideoOverride?: File | null,
  ) {
    const inspection = inspectionOverride ?? xrkInspection;
    if (!inspection) return;
    const pendingVideo = pendingVideoOverride ?? pendingVideoFile;
    const controller = new AbortController();
    xrkAbortRef.current?.abort();
    xrkAbortRef.current = controller;
    setAimImportStatus("analyzing");
    setDataError("");
    try {
      const result = await analyzeXrkInspection(
        {
          inspection_id: inspection.inspection_id,
          language: locale === "zh" ? "zh" : "en",
          reference_lap: options.reference_lap ?? xrkAnalysis?.reference_lap ?? null,
          target_lap: options.target_lap ?? xrkAnalysis?.target_lap ?? null,
          distance_step_m: options.distance_step_m ?? 1,
          sector_count: options.sector_count ?? xrkAnalysis?.sectors?.count ?? 3,
          sector_boundaries_m: options.sector_boundaries_m,
          manual_zones: options.manual_zones,
          lap_quality_absolute_gap_s:
            options.lap_quality_absolute_gap_s
            ?? xrkAnalysis?.lap_quality.config.absolute_gap_threshold_s
            ?? 0.5,
          lap_quality_relative_gap_pct:
            options.lap_quality_relative_gap_pct
            ?? xrkAnalysis?.lap_quality.config.relative_gap_threshold_pct
            ?? 1,
        },
        controller.signal
      );
      const normalizedLaps = normalizeLapRows(result.sectors?.lap_rows ?? result.lap_rows);
      setLapRows(normalizedLaps);
      setTelemetryRows([]);
      setReferenceLap(result.reference_lap);
      setTargetLap(result.target_lap);
      setXrkAnalysis(result);
      setPublishedDemo(null);
      setAimImport(null);
      setAimImportStatus("loaded");
      setActiveVideoFile((current) => commitPendingVideo(pendingVideo, current));
      setPendingVideoFile(null);
      void saveSessionSummary(buildSessionSummary({
        inspection_id: result.inspection_id,
        track_id: result.track?.track_id ?? "unknown-track",
        track_name: trackName,
        driver_name: driverName,
        vehicle_name: vehicleName,
        fastest_lap: result.fastest_lap,
        corner_improvements: (result.consensus_benchmark?.corners ?? [])
          .filter((corner) => corner.net_gain > 0)
          .map((corner) => ({ corner: corner.corner, net_gain: corner.net_gain })),
        training_priorities: (result.ai_coach_summary?.training_priorities ?? [])
          .map((priority) => priority.what_to_test)
          .filter(Boolean),
      })).catch(() => {
        // The local driver profile is optional; analysis still completes.
      });
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setDataError(formatXrkClientError(error as Error));
      }
      setAimImportStatus(xrkAnalysis ? "loaded" : "inspected");
    } finally {
      if (xrkAbortRef.current === controller) xrkAbortRef.current = null;
    }
  }

  async function loadDemoData() {
    xrkAbortRef.current?.abort();
    const realDemo = await loadPublishedRealDemo();
    if (realDemo) {
      const analysis = realDemo.analysis;
      const normalizedLaps = normalizeLapRows(analysis.sectors?.lap_rows ?? analysis.lap_rows);
      setLapRows(normalizedLaps);
      setTelemetryRows([]);
      setReferenceLap(analysis.reference_lap);
      setTargetLap(analysis.target_lap);
      setDriverName(realDemo.display.driver);
      setVehicleName(realDemo.display.vehicle);
      setTrackName(realDemo.display.track);
      setSessionDate(realDemo.display.date);
      setAimImport(null);
      setXrkInspection(null);
      setXrkAnalysis(analysis);
      setPublishedDemo(realDemo);
      setAimImportStatus("loaded");
      setDataError("");
      setActiveVideoFile(null);
      setPendingVideoFile(null);
      return;
    }
    setLapRows([...demoLapRows]);
    setTelemetryRows([...demoTelemetryRows]);
    setReferenceLap(6);
    setTargetLap(3);
    setDriverName("Demo Driver");
    setVehicleName("Demo Kart");
    setTrackName("Shanghai Sprint Circuit");
    setSessionDate("2026-06-14");
    setAimImport(null);
    setXrkInspection(null);
    setXrkAnalysis(null);
    setPublishedDemo(null);
    setAimImportStatus("idle");
    setDataError("");
    setActiveVideoFile(null);
    setPendingVideoFile(null);
  }

  function selectTemporarySession(inspectionId: string) {
    const session = xrkSessions.find((item) => item.inspection_id === inspectionId);
    if (!session) return;
    setXrkInspection(session);
    setXrkAnalysis(null);
    setPublishedDemo(null);
    setAimImport(null);
    setAimImportStatus("inspected");
    setActiveVideoFile(null);
    setPendingVideoFile(null);
    setDriverName(metadataText(session.metadata, "Driver", "Driver"));
    setVehicleName(metadataText(session.metadata, "Vehicle", "Vehicle"));
    setTrackName(metadataText(session.metadata, "Venue", "Unknown track"));
    setSessionDate(normalizeAimDate(session.metadata["Log Date"]));
    setDataError("");
  }

  function removeTemporarySession(inspectionId: string) {
    void deleteXrkInspection(inspectionId);
    setXrkSessions((current) => {
      const next = current.filter((session) => session.inspection_id !== inspectionId);
      window.localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify(next.map(toStoredSession))
      );
      return next;
    });
    if (xrkInspection?.inspection_id === inspectionId) {
      setXrkInspection(null);
      setXrkAnalysis(null);
      setAimImportStatus("idle");
      setActiveVideoFile(null);
      setPendingVideoFile(null);
    }
  }

  function expireTemporarySessions(inspectionIds: string[]) {
    setXrkSessions((current) => {
      const next = removeInspectionSessions(current, inspectionIds);
      window.localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify(next.map(toStoredSession))
      );
      return next;
    });
    if (xrkInspection && inspectionIds.includes(xrkInspection.inspection_id)) {
      setXrkInspection(null);
      setXrkAnalysis(null);
      setAimImportStatus("idle");
      setActiveVideoFile(null);
      setPendingVideoFile(null);
    }
    setDataError(
      "A temporary XRK session expired and was removed. Upload that file again to continue Driver Comparison."
    );
  }

  const videoMetadata = videoJob?.metadata;
  const metrics = lapAnalysis
      ? [
        [<Flag size={20} key="laps" />, "Total Laps", String(lapRows.length), "Timed laps analyzed", "#66e38f"],
        [<Gauge size={20} key="fastest" />, "Fastest Lap", formatSeconds(lapAnalysis.fastestLap.lap_time), `Lap ${lapAnalysis.fastestLap.lap}`, "#f6c945"],
        [<BarChart3 size={20} key="references" />, "Valid References", String(lapAnalysis.topValidLaps.length), "Real completed laps only", "#35d6d0"],
        [<Activity size={20} key="consistency" />, "Consistency", `${lapAnalysis.consistencyScore.toFixed(0)}%`, `σ ${lapAnalysis.lapTimeStandardDeviation.toFixed(3)}s`, "#ff5964"],
      ]
    : [
        [<CirclePlay size={20} key="duration" />, "Video Duration", videoMetadata ? formatTimestamp(videoMetadata.duration_seconds) : "--", videoJob?.source_name ?? "No video analyzed", "#f6c945"],
        [<Video size={20} key="resolution" />, "Resolution", videoMetadata?.resolution ?? "--", videoMetadata?.codec.toUpperCase() ?? "Awaiting analysis", "#35d6d0"],
        [<Activity size={20} key="fps" />, "Frame Rate", videoMetadata ? `${videoMetadata.fps.toFixed(2)} fps` : "--", videoMetadata ? `${videoMetadata.frame_count.toLocaleString()} frames` : "Video-only mode", "#ff5964"],
        [<BarChart3 size={20} key="frames" />, "Keyframes", String(videoJob?.keyframes.length ?? 0), `${videoJob?.markers.length ?? 0} manual markers`, "#66e38f"],
      ];

  return (
    <main className="dashboard-shell engineering-grid">
      <section className="mx-auto flex max-w-[1680px] flex-col gap-5 px-5 py-5 lg:px-8">
        <header className="panel flex flex-col gap-5 rounded-lg px-5 py-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-3 text-xs font-semibold uppercase text-[#35d6d0]">
              <Gauge size={18} /> Motorsport engineering dashboard
            </div>
            <h1 className="text-3xl font-semibold text-white md:text-5xl">AI Racing Telemetry Analysis</h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-300 md:text-base">
              Local onboard video review with optional lap and telemetry data
            </p>
          </div>
          <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2 xl:min-w-[720px] xl:grid-cols-4">
            <SessionInput label="Driver" value={driverName} onChange={setDriverName} />
            <SessionInput label="Vehicle" value={vehicleName} onChange={setVehicleName} />
            <SessionInput label="Track" value={trackName} onChange={setTrackName} />
            <SessionInput label="Date" value={sessionDate} onChange={setSessionDate} />
          </div>
        </header>

        <section className="grid gap-5 xl:grid-cols-[340px_1fr]">
          <aside className="flex flex-col gap-5">
            <NewSessionCard
              status={aimImportStatus}
              hasPendingVideo={Boolean(pendingVideoFile)}
              onStart={handleNewSession}
            />
            <DataUploadPanel
              lapLoaded={lapRows.length > 0}
              telemetryLoaded={telemetryRows.length > 0}
              aimImport={aimImport}
              xrkInspection={xrkInspection}
              aimImportStatus={aimImportStatus}
              error={dataError}
              capabilities={deploymentCapabilities}
              capabilityError={capabilityError}
              capabilityLoading={capabilityLoading}
              localXrkSources={localXrkSources}
              onAimFile={handleAimUpload}
              onLocalXrkSource={handleLocalXrkSource}
              onCancelXrk={() => xrkAbortRef.current?.abort()}
              onLapFile={(file) => handleCsvUpload(file, "lap")}
              onTelemetryFile={(file) => handleCsvUpload(file, "telemetry")}
              onLoadDemo={loadDemoData}
            />
            <DataReadinessPanel
              lapLoaded={lapRows.length > 0}
              telemetryLoaded={telemetryRows.length > 0}
              aimImport={aimImport}
              xrkInspection={xrkInspection}
              xrkAnalysis={xrkAnalysis}
              publishedDemo={Boolean(publishedDemo)}
            />
            {!xrkAnalysis && <BehaviorPanel telemetryLoaded={telemetryRows.length > 0} behaviorInputsAvailable={behaviorInputsAvailable} flags={handlingFlags} />}
          </aside>

          <section className="flex min-w-0 flex-col gap-5">
            {xrkInspection && !xrkAnalysis ? (
              <XrkInspectionWorkspace
                inspection={xrkInspection}
                analyzing={aimImportStatus === "analyzing"}
                onContinue={() => void runXrkAnalysis()}
              />
            ) : (
              <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {metrics.map(([icon, label, value, detail, accent]) => (
                <MetricCard
                  key={String(label)}
                  icon={icon as React.ReactNode}
                  label={String(label)}
                  value={String(value)}
                  detail={String(detail)}
                  accent={String(accent)}
                />
              ))}
            </div>

            {!xrkAnalysis && <VideoWorkspace onJobChange={setVideoJob} />}

            {xrkAnalysis ? (
              <XrkAnalysisWorkspace
                analysis={xrkAnalysis}
                analyzing={aimImportStatus === "analyzing"}
                onAnalyze={runXrkAnalysis}
                publishedDemo={Boolean(publishedDemo)}
                initialVideoFile={activeVideoFile}
                llmNarrative={deploymentCapabilities?.llm_narrative ?? { available: false, model: null }}
              />
            ) : lapAnalysis ? (
              <>
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
                      ["Vehicle", vehicleName],
                      ["Track name", trackName],
                      ["Total timed laps", String(lapRows.length)],
                      ["Fastest lap", `Lap ${lapAnalysis.fastestLap.lap}`],
                      ["Reference policy", "Real completed laps only"],
                      ["Top valid laps", lapAnalysis.topValidLaps.map((lap) => `Lap ${lap.lap}`).join(", ") || "Unavailable"],
                      ["Sector source", sectorSourceLabel ?? "Provided timing sectors"],
                      ["Average lap", formatSeconds(lapAnalysis.averageLap)],
                    ]}
                  />
                </div>

                <div className="grid gap-5 xl:grid-cols-2">
                  <ChartPanel
                    title="Sector Loss Chart"
                    subtitle={sectorSourceLabel ?? "Per-lap loss versus each sector best"}
                  >
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
                  <ChartPanel
                    title="Sector Performance"
                    subtitle={sectorSourceLabel ?? "Best, average, and average loss"}
                  >
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
                  {speedComparison.length ? (
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
                  ) : (
                    <UnavailablePanel title="Best Lap Comparison" message="Telemetry channel unavailable" />
                  )}
                  {telemetrySummary ? <TelemetryPanel summary={telemetrySummary} /> : <UnavailablePanel title="Telemetry Analysis" message="Telemetry channel unavailable" />}
                </div>

                {telemetryCurve.length ? (
                  <ChartPanel title="Telemetry Curve" subtitle={`Lap ${targetLap}: speed, throttle and brake by distance`}>
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart data={telemetryCurve}>
                        <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" />
                        <XAxis dataKey="distance" stroke="#8b98aa" />
                        <YAxis yAxisId="speed" stroke="#f6c945" />
                        <YAxis yAxisId="input" orientation="right" domain={[0, 100]} stroke="#35d6d0" />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Line yAxisId="speed" type="monotone" dataKey="speed" name="Speed" stroke="#f6c945" strokeWidth={3} dot={false} connectNulls />
                        <Line yAxisId="input" type="monotone" dataKey="throttle" name="Throttle" stroke="#35d6d0" strokeWidth={2} dot={false} connectNulls />
                        <Line yAxisId="input" type="monotone" dataKey="brake" name="Brake" stroke="#ff5964" strokeWidth={2} dot={false} connectNulls />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </ChartPanel>
                ) : (
                  <UnavailablePanel title="Telemetry Curve" message="Telemetry channel unavailable" />
                )}

                {dataReport && <ReportPanel title="Data Driver Review" report={dataReport} />}
                <LapTable data={lapAnalysis.lapDeltas} />
              </>
            ) : (
              <UnavailablePanel
                title="Lap & Sector Analysis"
                message="当前为视频独立分析模式。上传对应圈速 CSV 后，才会显示真实圈速、lap delta 和 sector loss。"
              />
            )}
              </>
            )}
          </section>
        </section>
        <MultiSessionWorkspace
          sessions={xrkSessions}
          activeInspectionId={xrkInspection?.inspection_id ?? null}
          onSelect={selectTemporarySession}
          onRemove={removeTemporarySession}
          onExpire={expireTemporarySessions}
        />
      </section>
    </main>
  );
}

function VideoWorkspace({ onJobChange }: { onJobChange: (job: VideoJob | null) => void }) {
  const localMode = frontendConfig.deploymentMode === "local";
  const [sources, setSources] = useState<VideoSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [job, setJob] = useState<VideoJob | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(localMode);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pollingJobId = job?.id;
  const pollingJobStatus = job?.status;

  useEffect(() => {
    if (!localMode) return;
    let active = true;
    getDeploymentCapabilities()
      .then((capabilities) => {
        if (!capabilities.local_video_library) {
          throw new Error(
            capabilities.direct_uploads
              ? "当前部署使用云端上传模式。"
              : "当前公开部署尚未启用云端视频上传，请使用本机模式分析视频。"
          );
        }
        return getVideoLibrary();
      })
      .then((items) => {
        if (!active) return;
        setSources(items);
        setSelectedSourceId(items[0]?.source_id ?? "");
        setError(items.length ? "" : "本机视频目录中没有找到 MP4、MOV 或 ZIP。 ");
      })
      .catch((reason: Error) => active && setError(reason.message))
      .finally(() => active && setLoadingLibrary(false));
    return () => {
      active = false;
    };
  }, [localMode]);

  useEffect(() => {
    onJobChange(job);
  }, [job, onJobChange]);

  useEffect(() => {
    if (!pollingJobId || pollingJobStatus === "completed" || pollingJobStatus === "failed") return;
    let active = true;
    const poll = async () => {
      try {
        const next = await getVideoJob(pollingJobId);
        if (active) setJob(next);
      } catch (reason) {
        if (active) setError((reason as Error).message);
      }
    };
    const timer = window.setInterval(poll, 1500);
    poll();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pollingJobId, pollingJobStatus]);

  async function startAnalysis() {
    if (!selectedSourceId) return;
    setError("");
    setPlaybackFailed(false);
    try {
      const jobId = await createVideoJob(selectedSourceId);
      setJob({
        id: jobId,
        source_id: selectedSourceId,
        source_name: sources.find((source) => source.source_id === selectedSourceId)?.name ?? "Local video",
        status: "queued",
        progress: 0,
        metadata: null,
        keyframes: [],
        warnings: [],
        report: null,
        error: null,
        markers: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  async function addMarker(markerType: VideoMarker["marker_type"]) {
    if (!job || job.status !== "completed") return;
    const starts = job.markers.filter((marker) => marker.marker_type === "lap_start");
    const ends = job.markers.filter((marker) => marker.marker_type === "lap_end");
    const openStart = [...starts].reverse().find((start) => !ends.some((end) => end.lap === start.lap));
    const nextLap = Math.max(0, ...starts.map((marker) => marker.lap ?? 0)) + 1;
    const lap = markerType === "lap_start" ? nextLap : markerType === "lap_end" ? openStart?.lap ?? null : openStart?.lap ?? null;
    if (markerType === "lap_end" && lap === null) {
      setError("请先标记一圈的开始时间。 ");
      return;
    }
    try {
      const marker = await createVideoMarker(job.id, {
        marker_type: markerType,
        timestamp: currentTime,
        lap,
        notes,
      });
      setJob({ ...job, markers: [...job.markers, marker].sort((a, b) => a.timestamp - b.timestamp) });
      setNotes("");
      setError("");
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  async function removeMarker(markerId: number) {
    if (!job) return;
    try {
      await deleteVideoMarker(job.id, markerId);
      setJob({ ...job, markers: job.markers.filter((marker) => marker.id !== markerId) });
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  async function clearAnalysis() {
    if (!job) return;
    try {
      await clearVideoJob(job.id);
      setJob(null);
      setCurrentTime(0);
      setError("");
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  function seek(timestamp: number) {
    if (!videoRef.current) return;
    videoRef.current.currentTime = timestamp;
    setCurrentTime(timestamp);
  }

  const completed = job?.status === "completed" && job.metadata;
  const selectedSource = sources.find((source) => source.source_id === selectedSourceId);

  if (!localMode) {
    return <BrowserVideoUpload />;
  }

  return (
    <div className="flex flex-col gap-5" data-testid="video-workspace">
      <BrowserVideoUpload />
      <section className="panel rounded-lg p-4 md:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <SectionTitle icon={<Video size={18} />} title="Local Video Analysis" subtitle="本机读取，不上传云端" />
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
          <label className="min-w-0 text-xs text-slate-400">
            本机视频库
            <select
              aria-label="本机视频库"
              value={selectedSourceId}
              disabled={loadingLibrary || Boolean(job && job.status !== "failed")}
              onChange={(event) => setSelectedSourceId(event.target.value)}
              className="mt-1 block w-full min-w-[280px] rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-[#35d6d0]"
            >
              {!sources.length && <option value="">未发现视频</option>}
              {sources.map((source) => (
                <option key={source.source_id} value={source.source_id}>
                  {source.relative_path} · {formatBytes(source.size_bytes)}
                </option>
              ))}
            </select>
          </label>
          {!job || job.status === "failed" ? (
            <CommandButton icon={<Play size={16} />} label="开始分析" onClick={startAnalysis} disabled={!selectedSourceId} accent />
          ) : (
            <CommandButton icon={<Trash2 size={16} />} label="清理分析" onClick={clearAnalysis} danger />
          )}
        </div>
      </div>

      {selectedSource && !job && (
        <p className="mt-4 rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
          已选择 {selectedSource.name}，大小 {formatBytes(selectedSource.size_bytes)}。ZIP 将仅在本机缓存中解压。
        </p>
      )}

      {job && job.status !== "completed" && job.status !== "failed" && (
        <div className="mt-4 rounded-md border border-[#35d6d0]/25 bg-[#35d6d0]/5 p-4">
          <div className="flex items-center justify-between gap-3 text-sm text-slate-200">
            <span className="flex items-center gap-2"><LoaderCircle size={16} className="animate-spin text-[#35d6d0]" />{jobStatusLabel(job.status)}</span>
            <span className="mono text-[#35d6d0]">{job.progress}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded bg-slate-800">
            <div className="h-full bg-[#35d6d0] transition-all" style={{ width: `${job.progress}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-500">大文件分析会先解压，再抽取 12 张代表关键帧。</p>
        </div>
      )}

      {(error || job?.error) && (
        <div className="mt-4 flex gap-2 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-3 text-sm text-red-100">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <span>{job?.error ?? error}</span>
        </div>
      )}

      {completed && (
        <>
          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.75fr)]">
            <div className="min-w-0">
              <div className="overflow-hidden rounded-md border border-slate-800 bg-black">
                {!playbackFailed ? (
                  <video
                    ref={videoRef}
                    data-testid="video-player"
                    className="aspect-video w-full bg-black object-contain"
                    src={videoStreamUrl(job.id)}
                    controls
                    preload="metadata"
                    onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                    onError={() => setPlaybackFailed(true)}
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center px-8 text-center text-sm leading-6 text-slate-300">
                    当前浏览器无法播放此 HEVC 原片。关键帧分析仍可用，可改用支持 HEVC 的浏览器查看完整视频。
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                <span className="truncate pr-4">{job.source_name}</span>
                <span className="mono shrink-0">{formatTimestamp(currentTime)} / {formatTimestamp(completed.duration_seconds)}</span>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <CompactMetric label="Duration" value={formatTimestamp(completed.duration_seconds)} />
                <CompactMetric label="Resolution" value={completed.resolution} />
                <CompactMetric label="Frame rate" value={`${completed.fps.toFixed(2)} fps`} />
                <CompactMetric label="Codec" value={completed.codec.toUpperCase()} />
                <CompactMetric label="Frame count" value={completed.frame_count.toLocaleString()} />
                <CompactMetric label="File size" value={formatBytes(completed.file_size_bytes)} />
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                <label className="text-xs text-slate-500" htmlFor="marker-notes">Marker note</label>
                <input
                  id="marker-notes"
                  value={notes}
                  maxLength={500}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="可选：弯角、线路或动作备注"
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-[#35d6d0]"
                />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <CommandButton icon={<Flag size={15} />} label="圈开始" onClick={() => addMarker("lap_start")} />
                  <CommandButton icon={<Scissors size={15} />} label="圈结束" onClick={() => addMarker("lap_end")} />
                  <CommandButton icon={<MapPin size={15} />} label="弯道" onClick={() => addMarker("corner")} />
                  <CommandButton icon={<Zap size={15} />} label="事件" onClick={() => addMarker("event")} />
                </div>
                <p className="mt-2 text-xs text-slate-500">标记时间：{formatTimestamp(currentTime)}</p>
              </div>
            </div>
          </div>

          {job.warnings.length > 0 && (
            <div className="mt-4 rounded-md border border-amber-400/25 bg-amber-400/8 px-3 py-3 text-xs leading-5 text-amber-100">
              {job.warnings.join(" ")}
            </div>
          )}

          <div className="mt-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Representative Keyframes</p>
              <span className="text-xs text-slate-500">点击跳转到对应时间</span>
            </div>
            <div className="thin-scrollbar flex gap-3 overflow-x-auto pb-2">
              {job.keyframes.map((frame) => (
                <button
                  key={frame.filename}
                  type="button"
                  title={`跳转到 ${formatTimestamp(frame.timestamp)}`}
                  onClick={() => seek(frame.timestamp)}
                  className="w-44 shrink-0 overflow-hidden rounded-md border border-slate-800 bg-slate-950 text-left hover:border-[#35d6d0] focus:outline-none focus:ring-2 focus:ring-[#35d6d0]"
                >
                  {/* Keyframes are served by the authenticated analysis API, not a public image CDN. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={keyframeUrl(job.id, frame.filename)} alt={`关键帧 ${frame.index}`} className="aspect-video w-full object-cover" />
                  <span className="block px-2 py-2 text-xs text-slate-300">{formatTimestamp(frame.timestamp)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_420px]">
            <MarkerTable job={job} onSeek={seek} onDelete={removeMarker} />
            <ReportPanel title="Video Review" report={job.report ?? "视频报告不可用。"} />
          </div>
        </>
      )}
      </section>
    </div>
  );
}

type BrowserVideoInfo = {
  name: string;
  size: number;
  type: string;
  duration: number | null;
  width: number | null;
  height: number | null;
};

function BrowserVideoUpload() {
  const [videoUrl, setVideoUrl] = useState("");
  const [previewFrame, setPreviewFrame] = useState("");
  const [info, setInfo] = useState<BrowserVideoInfo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  function selectVideo(file: File) {
    if (!file.type.startsWith("video/") && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) {
      setError("Please select an MP4, MOV, M4V or WebM video.");
      return;
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const nextUrl = URL.createObjectURL(file);
    setVideoUrl(nextUrl);
    setPreviewFrame("");
    setError("");
    setInfo({
      name: file.name,
      size: file.size,
      type: file.type || "video",
      duration: null,
      width: null,
      height: null,
    });
  }

  function captureFirstFrame(video: HTMLVideoElement) {
    if (!video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 960 / video.videoWidth);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPreviewFrame(canvas.toDataURL("image/jpeg", 0.86));
  }

  return (
    <section className="panel rounded-lg p-4 md:p-5" data-testid="browser-video-upload">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <SectionTitle icon={<Video size={18} />} title="Video Preview" subtitle="Browser-only preview; the file stays on this device" />
        <label className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-[#f6c945] bg-[#f6c945] px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-[#ffe078]">
          <Upload size={16} /> Upload Video
          <input
            className="hidden"
            type="file"
            accept="video/mp4,video/quicktime,video/webm,.m4v"
            onChange={(event) => event.target.files?.[0] && selectVideo(event.target.files[0])}
          />
        </label>
      </div>

      {!info && (
        <p className="mt-4 rounded-md border border-dashed border-slate-700 bg-slate-950/45 px-4 py-6 text-center text-sm text-slate-400">
          Upload a video to inspect its file information and first frame.
        </p>
      )}

      {info && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
          <div className="overflow-hidden rounded-md border border-slate-800 bg-black">
            {previewFrame ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewFrame} alt={`First frame of ${info.name}`} className="aspect-video w-full object-contain" />
              </>
            ) : (
              <div className="flex aspect-video items-center justify-center text-sm text-slate-500">Reading first frame...</div>
            )}
          </div>
          <div className="grid content-start grid-cols-2 gap-3">
            <CompactMetric label="File" value={info.name} />
            <CompactMetric label="Size" value={formatBytes(info.size)} />
            <CompactMetric label="Type" value={info.type} />
            <CompactMetric label="Duration" value={info.duration === null ? "Reading..." : formatTimestamp(info.duration)} />
            <CompactMetric label="Resolution" value={info.width && info.height ? `${info.width}x${info.height}` : "Reading..."} />
            <CompactMetric label="Upload status" value="Ready locally" />
          </div>
          <video
            className="hidden"
            src={videoUrl}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              setInfo((current) => current ? {
                ...current,
                duration: Number.isFinite(video.duration) ? video.duration : null,
                width: video.videoWidth || null,
                height: video.videoHeight || null,
              } : current);
            }}
            onLoadedData={(event) => captureFirstFrame(event.currentTarget)}
            onError={() => setError("The browser could not decode this video. File information is still available.")}
          />
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-md border border-amber-400/25 bg-amber-400/8 px-3 py-3 text-sm text-amber-100">
          {error}
        </p>
      )}
    </section>
  );
}

function MarkerTable({ job, onSeek, onDelete }: { job: VideoJob; onSeek: (time: number) => void; onDelete: (id: number) => void }) {
  const hasLapMarkers = job.markers.some((marker) => marker.marker_type === "lap_start" || marker.marker_type === "lap_end");
  return (
    <section className="rounded-md border border-slate-800 bg-slate-950/45 p-4">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle icon={<Flag size={17} />} title="Timeline Markers" subtitle="人工圈段与复盘事件" />
        {hasLapMarkers && (
          <a href={markerExportUrl(job.id)} className="inline-flex items-center gap-2 rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-[#35d6d0]">
            <Download size={15} /> 导出 CSV
          </a>
        )}
      </div>
      {job.markers.length ? (
        <div className="thin-scrollbar mt-3 max-h-[290px] overflow-auto">
          {job.markers.map((marker) => (
            <div key={marker.id} className="grid grid-cols-[88px_1fr_32px] items-center gap-3 border-b border-slate-800 py-3 text-sm">
              <button type="button" onClick={() => onSeek(marker.timestamp)} className="mono text-left text-[#35d6d0] hover:text-white" title="跳转到标记">
                {formatTimestamp(marker.timestamp)}
              </button>
              <div className="min-w-0">
                <p className="text-slate-200">{markerLabel(marker)}{marker.lap ? ` · Lap ${marker.lap}` : ""}</p>
                {marker.notes && <p className="truncate text-xs text-slate-500">{marker.notes}</p>}
              </div>
              <button type="button" onClick={() => onDelete(marker.id)} className="flex h-8 w-8 items-center justify-center text-slate-500 hover:text-red-300" title="删除标记" aria-label="删除标记">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">播放视频并在需要的位置添加圈段或事件标记。</p>
      )}
    </section>
  );
}

function DataUploadPanel({
  lapLoaded,
  telemetryLoaded,
  aimImport,
  xrkInspection,
  aimImportStatus,
  error,
  capabilities,
  capabilityError,
  capabilityLoading,
  localXrkSources,
  onAimFile,
  onLocalXrkSource,
  onCancelXrk,
  onLapFile,
  onTelemetryFile,
  onLoadDemo,
}: {
  lapLoaded: boolean;
  telemetryLoaded: boolean;
  aimImport: AimImportResponse | null;
  xrkInspection: XrkInspection | null;
  aimImportStatus: "idle" | "inspecting" | "inspected" | "analyzing" | "loaded";
  error: string;
  capabilities: DeploymentCapabilities | null;
  capabilityError: string;
  capabilityLoading: boolean;
  localXrkSources: LocalXrkSource[];
  onAimFile: (file: File) => void;
  onLocalXrkSource: (sourceId: string) => void | Promise<void>;
  onCancelXrk: () => void;
  onLapFile: (file: File) => void;
  onTelemetryFile: (file: File) => void;
  onLoadDemo: () => void;
}) {
  const [localSourceId, setLocalSourceId] = useState("");
  const aimLabel =
    aimImportStatus === "inspecting"
      ? "Uploading and inspecting channels..."
      : aimImportStatus === "analyzing"
        ? "Cleaning GPS and aligning laps..."
        : xrkInspection
          ? `${xrkInspection.filename} inspected`
          : aimImport
        ? `${aimImport.source.name} loaded`
        : "Import XRK / XRZ (Beta)";
  const busy = aimImportStatus === "inspecting" || aimImportStatus === "analyzing";
  const serverImport = capabilities?.xrk_server_import;
  const xrkAvailable = Boolean(serverImport?.available);
  const xrkDisabled = busy || capabilityLoading || !xrkAvailable;
  return (
    <section className="panel rounded-lg p-4">
      <SectionTitle icon={<Upload size={18} />} title="Session Data" subtitle="AiM logger file or existing CSV exports" />
      <div className="mt-3 flex items-start justify-between gap-3 border-y border-slate-800 py-3 text-xs">
        <div>
          <p className="font-medium text-slate-300">XRK Server Import</p>
          <p className="mt-1 leading-5 text-slate-500">
            {capabilityLoading
              ? "Checking public parser..."
              : xrkAvailable
                ? `${serverImport?.parser} ${serverImport?.version ?? ""} · ${serverImport?.platform}`
                : serverImport?.message ?? capabilityError ?? "Unavailable"}
          </p>
        </div>
        <span className={xrkAvailable ? "text-emerald-300" : capabilityLoading ? "text-slate-500" : "text-red-300"}>
          {capabilityLoading ? "Checking" : xrkAvailable ? "Available" : "Unavailable"}
        </span>
      </div>
      <FileInput
        label={aimLabel}
        accept=".xrk,.xrz"
        disabled={xrkDisabled}
        icon={busy ? <LoaderCircle size={16} className="animate-spin text-[#35d6d0]" /> : undefined}
        onFile={onAimFile}
      />
      {capabilities?.mode === "local" && localXrkSources.length > 0 && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          <p className="text-xs font-medium text-slate-300">本机 XRK 文件库</p>
          <div className="mt-2 grid gap-2">
            <select
              className="min-h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-xs text-slate-200"
              value={localSourceId || localXrkSources[0]?.source_id}
              disabled={busy}
              onChange={(event) => setLocalSourceId(event.target.value)}
            >
              {localXrkSources.map((source) => (
                <option key={source.source_id} value={source.source_id}>
                  {source.root} / {source.relative_path} · {formatBytes(source.size_bytes)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onLocalXrkSource(localSourceId || localXrkSources[0].source_id)}
              className="min-h-10 rounded-md border border-[#35d6d0] px-3 text-xs font-semibold text-[#35d6d0] disabled:opacity-50"
            >
              直接分析本机文件
            </button>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            文件由本机 FastAPI 直接读取，不经过浏览器上传。
          </p>
        </div>
      )}
      {xrkInspection && (
        <div className="mt-3 rounded-md border border-slate-700 bg-slate-950/60 p-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <StatusLine label="File size" value={formatBytes(xrkInspection.file_size_bytes)} />
            <StatusLine label="Timed laps" value={String(xrkInspection.laps)} />
            <StatusLine label="GPS" value={xrkInspection.has_gps ? "Available" : "Unavailable"} />
            <StatusLine label="RPM" value={xrkInspection.has_rpm ? "Available" : "Unavailable"} />
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            {xrkInspection.channels.filter((channel) => channel.available).length} usable channels ·
            official sectors {xrkInspection.has_predefined_sectors ? "available" : "unavailable"}
          </p>
          <p className="mt-2 text-xs leading-5 text-[#35d6d0]">
            Review the full channel inspection in the main workspace, then continue to analysis.
          </p>
        </div>
      )}
      {busy && (
        <button type="button" onClick={onCancelXrk} className="mt-2 w-full rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-red-400">
          Cancel
        </button>
      )}
      <div className="my-3 flex items-center gap-3 text-[10px] uppercase text-slate-600">
        <span className="h-px flex-1 bg-slate-800" /> or CSV <span className="h-px flex-1 bg-slate-800" />
      </div>
      <FileInput label={lapLoaded ? "Lap/Sector CSV loaded" : "Lap/Sector CSV"} accept=".csv" onFile={onLapFile} />
      <FileInput label={telemetryLoaded ? "Telemetry CSV loaded" : "Telemetry CSV"} accept=".csv" onFile={onTelemetryFile} />
      <button type="button" onClick={onLoadDemo} className="mt-3 flex w-full items-center justify-between rounded-md border border-slate-700 px-3 py-3 text-sm text-slate-300 hover:border-[#f6c945]">
        <span>Try Demo</span><Database size={16} className="text-[#f6c945]" />
      </button>
      {error && <p className="mt-3 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs leading-5 text-red-100">{error}</p>}
      <p className="mt-3 text-xs leading-5 text-slate-500">
        Uploaded XRK files are processed temporarily and are not permanently stored in the current demo.
        Normalized data expires after 30 minutes.
      </p>
    </section>
  );
}

function FileInput({
  label,
  accept,
  disabled = false,
  icon,
  onFile,
}: {
  label: string;
  accept: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  onFile: (file: File) => void | Promise<unknown>;
}) {
  return (
    <label className={`file-input mt-3 flex items-center justify-between gap-3 rounded-md px-3 py-3 text-sm text-slate-300 ${disabled ? "pointer-events-none cursor-wait opacity-70" : "cursor-pointer"}`}>
      <span className="min-w-0 truncate">{label}</span>
      <input
        className="hidden"
        type="file"
        accept={accept}
        onChange={(event) => {
          if (disabled) return;
          const input = event.currentTarget;
          const file = event.target.files?.[0];
          if (!file) return;
          void consumeSelectedFile(file, onFile, () => {
            input.value = "";
          });
        }}
      />
      {icon ?? <Upload size={16} className="shrink-0 text-[#f6c945]" />}
    </label>
  );
}

function DataReadinessPanel({
  lapLoaded,
  telemetryLoaded,
  aimImport,
  xrkInspection,
  xrkAnalysis,
  publishedDemo,
}: {
  lapLoaded: boolean;
  telemetryLoaded: boolean;
  aimImport: AimImportResponse | null;
  xrkInspection: XrkInspection | null;
  xrkAnalysis: XrkAnalysis | null;
  publishedDemo: boolean;
}) {
  const usedChannels = aimImport?.channels
    .filter((channel) => channel.status === "used")
    .map((channel) => channel.name);
  return (
    <section className="panel rounded-lg p-4">
      <SectionTitle icon={<AlertTriangle size={18} />} title="Data Readiness" subtitle="量化结论的数据边界" />
      <StatusLine label="Lap / sector" value={lapLoaded ? "Loaded" : "Not provided"} />
      <StatusLine label="Telemetry" value={telemetryLoaded || Boolean(xrkAnalysis?.comparison.length) ? "Loaded" : "Not provided"} />
      {publishedDemo && (
        <>
          <StatusLine label="Source" value="Anonymized real session · read-only" />
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Published only after provenance, permission and privacy review checks pass.
          </p>
        </>
      )}
      {aimImport && (
        <>
          <StatusLine label="Source" value="AiM XRK/XRZ" />
          <StatusLine label="Valid laps" value={String(aimImport.lap_selection.valid_laps.length)} />
          <p className="mt-3 rounded-md border border-amber-400/25 bg-amber-400/8 px-3 py-2 text-xs leading-5 text-amber-100">
            Virtual sectors use equal-distance thirds and are not official timing splits.
          </p>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Available: {usedChannels?.join(", ") || "No supported channels"}
          </p>
        </>
      )}
      {xrkInspection && !aimImport && (
        <>
          <StatusLine label="Source" value="AiM XRK/XRZ · Beta" />
          <StatusLine label="Channels" value={String(xrkInspection.channels.length)} />
          <StatusLine label="GPS / RPM" value={`${xrkInspection.has_gps ? "yes" : "no"} / ${xrkInspection.has_rpm ? "yes" : "no"}`} />
          <StatusLine label="Parser" value={`${xrkInspection.parser.library} · ${xrkInspection.parser.license}`} />
          {!xrkInspection.has_predefined_sectors && (
            <p className="mt-3 rounded-md border border-amber-400/25 bg-amber-400/8 px-3 py-2 text-xs leading-5 text-amber-100">
              Official sectors unavailable. Analysis uses explicitly labelled virtual sectors.
            </p>
          )}
        </>
      )}
      {!lapLoaded && <p className="mt-3 rounded-md border border-amber-400/25 bg-amber-400/8 px-3 py-2 text-xs leading-5 text-amber-100">只有视频时不计算圈速或 sector loss。</p>}
    </section>
  );
}

function BehaviorPanel({ telemetryLoaded, behaviorInputsAvailable, flags }: { telemetryLoaded: boolean; behaviorInputsAvailable: boolean; flags: ReturnType<typeof generateHandlingFlags> }) {
  return (
    <section className="panel rounded-lg p-4">
      <SectionTitle icon={<Activity size={18} />} title="Driving Behavior Assistant" subtitle="Heuristic flags only" />
      {!telemetryLoaded ? (
        <p className="mt-3 text-sm leading-6 text-slate-400">未提供遥测数据，该分析功能不可用。视频画面不会被用于自动诊断转向不足或转向过度。</p>
      ) : !behaviorInputsAvailable ? (
        <p className="mt-3 text-sm leading-6 text-slate-400">当前遥测缺少刹车与油门通道，驾驶行为诊断不可用；平台不会据此判断转向不足或转向过度。</p>
      ) : flags.length ? (
        <div className="thin-scrollbar mt-3 max-h-[260px] overflow-auto">
          {flags.map((flag, index) => (
            <div key={`${flag.lap}-${flag.eventType}-${index}`} className="mb-3 rounded-md border border-slate-700 bg-slate-950/50 p-3">
              <p className="text-sm font-semibold text-white">{flag.eventType}</p>
              <p className="mt-1 text-xs text-slate-400">Lap {flag.lap} · {flag.sector} · {flag.confidence} confidence</p>
              <p className="mt-2 text-xs leading-5 text-slate-300">{flag.reason}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-400">No behavior flags in the current telemetry.</p>
      )}
      <p className="mt-3 text-xs leading-5 text-slate-500">Handling analysis is heuristic and must be validated by a driver or coach.</p>
    </section>
  );
}

function SessionInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-1 block text-[11px] uppercase text-slate-500">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-[#35d6d0]" /></label>;
}

function MetricCard({ icon, label, value, detail, accent }: { icon: React.ReactNode; label: string; value: string; detail: string; accent: string }) {
  return <article className="metric-card rounded-lg p-4"><div className="mb-4 flex items-center justify-between"><span style={{ color: accent }}>{icon}</span><span className="text-[11px] uppercase text-slate-500">{label}</span></div><p className="mono break-words text-2xl font-semibold text-white">{value}</p><p className="mt-2 truncate text-sm text-slate-400">{detail}</p></article>;
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3"><p className="text-[10px] uppercase text-slate-500">{label}</p><p className="mono mt-1 break-words text-sm text-white">{value}</p></div>;
}

function CommandButton({ icon, label, onClick, disabled, accent, danger }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; accent?: boolean; danger?: boolean }) {
  const colors = danger ? "border-red-400/35 text-red-200 hover:bg-red-400/10" : accent ? "border-[#f6c945] bg-[#f6c945] text-slate-950 hover:bg-[#ffe078]" : "border-slate-700 text-slate-200 hover:border-[#35d6d0]";
  return <button type="button" onClick={onClick} disabled={disabled} className={`mt-auto inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${colors}`}>{icon}{label}</button>;
}

function ChartPanel({ title, subtitle, action, children }: { title: string; subtitle: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="panel rounded-lg p-4"><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><SectionTitle icon={<LineChart size={18} />} title={title} subtitle={subtitle} />{action}</div>{children}</section>;
}

function DataPanel({ title, rows }: { title: string; rows: [string, string][] }) {
  return <section className="panel rounded-lg p-4"><SectionTitle icon={<Gauge size={18} />} title={title} subtitle="Session Overview" /><div className="mt-4 divide-y divide-slate-800">{rows.map(([label, value]) => <StatusLine key={label} label={label} value={value} />)}</div></section>;
}

function TelemetryPanel({ summary }: { summary: ReturnType<typeof summarizeTelemetry> }) {
  return <DataPanel title="Telemetry Analysis" rows={buildTelemetryMetricRows(summary)} />;
}

function ReportPanel({ title, report }: { title: string; report: string }) {
  return <section className="panel rounded-lg p-4"><SectionTitle icon={<Zap size={18} />} title={title} subtitle="Verified findings and explicit limits" /><pre className="thin-scrollbar mt-4 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-950/70 p-4 text-sm leading-6 text-slate-200">{report}</pre></section>;
}

function UnavailablePanel({ title, message }: { title: string; message: string }) {
  return <section className="panel rounded-lg p-5"><SectionTitle icon={<AlertTriangle size={18} />} title={title} subtitle="Not available for this session" /><p className="mt-4 max-w-3xl text-sm leading-6 text-slate-400">{message}</p></section>;
}

function LapTable({ data }: { data: Array<Record<string, string | number | null>> }) {
  const keys = Object.keys(data[0] ?? {}).slice(0, 8);
  return <section className="panel rounded-lg p-4"><SectionTitle icon={<BarChart3 size={18} />} title="Lap Analysis Table" subtitle="Lap time, delta, and sector values" /><div className="thin-scrollbar mt-4 overflow-auto"><table className="w-full min-w-[760px] border-collapse text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr>{keys.map((key) => <th key={key} className="border-b border-slate-800 px-3 py-3">{key}</th>)}</tr></thead><tbody>{data.map((row) => <tr key={String(row.lap)} className="border-b border-slate-900 text-slate-300">{keys.map((key, index) => <td key={key} className={`px-3 py-3 ${index === 0 ? "text-white" : ""}`}>{formatCell(row[key])}</td>)}</tr>)}</tbody></table></div></section>;
}

function LapSelect({ label, value, options, onChange }: { label: string; value: number; options: number[]; onChange: (value: number) => void }) {
  return <label className="text-xs text-slate-400">{label}<select value={value} onChange={(event) => onChange(Number(event.target.value))} className="ml-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white">{options.map((option) => <option key={option} value={option}>Lap {option}</option>)}</select></label>;
}

function SectionTitle({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return <div><div className="flex items-center gap-2 text-sm font-semibold text-white"><span className="text-[#35d6d0]">{icon}</span>{title}</div><p className="mt-1 text-xs text-slate-500">{subtitle}</p></div>;
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 py-2 text-sm"><span className="text-slate-500">{label}</span><span className="text-right text-slate-200">{value}</span></div>;
}

function markerLabel(marker: VideoMarker) {
  return { lap_start: "圈开始", lap_end: "圈结束", corner: "弯道", event: "事件" }[marker.marker_type];
}

function jobStatusLabel(status: VideoJob["status"]) {
  return { queued: "分析任务已排队", extracting: "正在本机解压视频", analyzing: "正在读取元数据并抽取关键帧", completed: "分析完成", failed: "分析失败" }[status];
}

function formatTimestamp(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(0, bytes / 1024).toFixed(1)} KB`;
}

function formatCell(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(3);
  return value == null ? "" : String(value);
}

function metadataText(
  metadata: AimImportResponse["metadata"],
  key: string,
  fallback: string
) {
  const value = metadata[key];
  return value === null || value === undefined || String(value).trim() === ""
    ? fallback
    : String(value);
}

function normalizeAimDate(value: string | number | null | undefined) {
  const text = String(value ?? "").trim();
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!match) return new Date().toISOString().slice(0, 10);
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function formatXrkClientError(error: Error) {
  if (error instanceof XrkApiError) {
    const request = error.requestId ? ` Request ID: ${error.requestId}.` : "";
    return `${error.message} [${error.code}].${request}`;
  }
  if (error instanceof FrontendApiConfigError) {
    return `${error.message} [${error.code}].`;
  }
  return error.message;
}

const tooltipStyle = { background: "#0b1018", border: "1px solid rgba(148, 163, 184, 0.28)", borderRadius: "8px", color: "#e9edf3" };
