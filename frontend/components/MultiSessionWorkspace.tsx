"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Clock3,
  FlaskConical,
  GitCompareArrows,
  Map,
  Trash2,
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

import {
  analyzeSetupExperiment,
  compareDriverLaps,
  type DriverComparisonResult,
  type SetupExperimentResult,
  type XrkInspection,
  type XrkTrackPoint,
} from "../lib/xrkAnalysisApi";
import {
  EXPERIMENT_STORAGE_KEY,
  metadataLabel,
  parseStoredExperiments,
  type SetupExperimentDraft,
} from "../lib/sessionWorkspace";

type WorkspaceTab = "compare" | "setup";

const chartTooltip = {
  backgroundColor: "#0b1017",
  border: "1px solid rgba(148, 163, 184, 0.35)",
  borderRadius: 6,
  fontSize: 12,
};

export function MultiSessionWorkspace({
  sessions,
  activeInspectionId,
  onSelect,
  onRemove,
}: {
  sessions: XrkInspection[];
  activeInspectionId: string | null;
  onSelect: (inspectionId: string) => void;
  onRemove: (inspectionId: string) => void;
}) {
  const [tab, setTab] = useState<WorkspaceTab>("compare");
  const [, setClock] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!sessions.length) return null;

  return (
    <section className="mt-6 space-y-5" aria-label="Temporary multi-session workspace">
      <div className="panel rounded-lg p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Temporary Session Workspace</h2>
            <p className="mt-1 text-xs text-slate-500">
              Up to four normalized XRK sessions remain available until their fixed server expiry.
            </p>
          </div>
          <span className="text-xs text-slate-500">{sessions.length} / 4 sessions</span>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {sessions.map((session) => {
            const active = activeInspectionId === session.inspection_id;
            return (
              <article
                key={session.inspection_id}
                className={`rounded-md border p-3 ${active ? "border-[#f6c945] bg-[#f6c945]/5" : "border-slate-800 bg-slate-950/45"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button type="button" className="min-w-0 text-left" onClick={() => onSelect(session.inspection_id)}>
                    <strong className="block truncate text-sm text-slate-100">
                      {metadataLabel(session.metadata, "Driver", session.filename)}
                    </strong>
                    <span className="mt-1 block truncate text-xs text-slate-500">
                      {metadataLabel(session.metadata, "Venue", "Track unknown")}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(session.inspection_id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-red-500/10 hover:text-red-300"
                    aria-label={`Remove ${session.filename}`}
                    title="Remove temporary session"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                  <span>{session.laps} timed laps</span>
                  <span className="flex items-center gap-1"><Clock3 size={12} /> {expiryLabel(session.expires_at)}</span>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <nav className="panel flex gap-2 rounded-lg p-2" aria-label="Cross-session analysis views">
        <WorkspaceTabButton active={tab === "compare"} onClick={() => setTab("compare")} icon={<GitCompareArrows size={16} />}>
          Driver Comparison
        </WorkspaceTabButton>
        <WorkspaceTabButton active={tab === "setup"} onClick={() => setTab("setup")} icon={<FlaskConical size={16} />}>
          Setup Experiment
        </WorkspaceTabButton>
      </nav>

      {tab === "compare" ? <DriverComparison sessions={sessions} /> : <SetupExperiment sessions={sessions} />}
    </section>
  );
}

function DriverComparison({ sessions }: { sessions: XrkInspection[] }) {
  const [aId, setAId] = useState(sessions[0]?.inspection_id ?? "");
  const [bId, setBId] = useState(sessions[1]?.inspection_id ?? "");
  const [lapA, setLapA] = useState("");
  const [lapB, setLapB] = useState("");
  const [result, setResult] = useState<DriverComparisonResult | null>(null);
  const [cursorDistance, setCursorDistance] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selectedAId = sessions.some((session) => session.inspection_id === aId)
    ? aId
    : sessions[0]?.inspection_id ?? "";
  const selectedBId = sessions.some((session) => session.inspection_id === bId)
    ? bId
    : sessions.find((session) => session.inspection_id !== selectedAId)?.inspection_id ?? "";
  const sessionA = sessions.find((session) => session.inspection_id === selectedAId);
  const sessionB = sessions.find((session) => session.inspection_id === selectedBId);

  async function runComparison() {
    if (!selectedAId || !selectedBId || selectedAId === selectedBId) {
      setError("Select two different temporary sessions.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      setResult(await compareDriverLaps({
        session_a: { inspection_id: selectedAId, lap: lapA ? Number(lapA) : null },
        session_b: { inspection_id: selectedBId, lap: lapB ? Number(lapB) : null },
        distance_step_m: 1,
      }));
      setCursorDistance(0);
    } catch (caught) {
      setResult(null);
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="panel rounded-lg p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_140px_auto_1fr_140px_auto] lg:items-end">
          <SessionSelect label="Driver A session" value={selectedAId} sessions={sessions} onChange={(value) => { setAId(value); setLapA(""); }} />
          <LapSelect label="A real lap" value={lapA} session={sessionA} onChange={setLapA} />
          <span className="hidden pb-2 text-center text-xs font-semibold text-slate-600 lg:block">VS</span>
          <SessionSelect label="Driver B session" value={selectedBId} sessions={sessions} onChange={(value) => { setBId(value); setLapB(""); }} />
          <LapSelect label="B real lap" value={lapB} session={sessionB} onChange={setLapB} />
          <button
            type="button"
            onClick={() => void runComparison()}
            disabled={loading || sessions.length < 2}
            className="min-h-10 rounded-md bg-[#f6c945] px-4 text-sm font-semibold text-slate-950 disabled:opacity-45"
          >
            {loading ? "Comparing..." : "Compare"}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Blank lap selections use each session&apos;s Fastest Valid Lap. Only real laps passing the Lap Quality Gate are accepted.
        </p>
        {error && <InlineError message={error} />}
      </section>

      {result && (
        <>
          <section className="panel grid rounded-lg md:grid-cols-3">
            <ComparisonMetric label="A real lap" value={`Lap ${result.sessions.a.selected_lap} · ${result.sessions.a.selected_lap_time_s.toFixed(3)}s`} />
            <ComparisonMetric label="B real lap" value={`Lap ${result.sessions.b.selected_lap} · ${result.sessions.b.selected_lap_time_s.toFixed(3)}s`} />
            <ComparisonMetric label="B minus A" value={`${signed(result.lap_time_difference_s)}s`} />
          </section>
          {result.track && (
            <section className="grid gap-5 xl:grid-cols-[minmax(360px,0.8fr)_minmax(0,1.2fr)]">
              <Panel title="GPS Overlay" subtitle="Two real laps · shared distance cursor" icon={<Map size={17} />}>
                <ComparisonTrackMap
                  a={result.track.a}
                  b={result.track.b}
                  cursorDistance={cursorDistance}
                  onCursor={setCursorDistance}
                />
              </Panel>
              <div className="space-y-5">
                <Panel title="Speed vs Distance" subtitle="Distance aligned, not sample-index aligned" icon={<Activity size={17} />}>
                  <ComparisonChart data={result.comparison} cursorDistance={cursorDistance} onCursor={setCursorDistance} lines={[
                    ["a_speed", "A speed", "#f6c945"],
                    ["b_speed", "B speed", "#35d6d0"],
                  ]} />
                </Panel>
                <Panel title="RPM vs Distance" subtitle="Unavailable channels are omitted" icon={<Activity size={17} />}>
                  <ComparisonChart data={result.comparison} cursorDistance={cursorDistance} onCursor={setCursorDistance} lines={[
                    ["a_rpm", "A RPM", "#f6c945"],
                    ["b_rpm", "B RPM", "#ff5964"],
                  ]} />
                </Panel>
                <Panel title="Cumulative Time Delta" subtitle="Positive means B is behind A" icon={<GitCompareArrows size={17} />}>
                  <ComparisonChart data={result.comparison} cursorDistance={cursorDistance} onCursor={setCursorDistance} lines={[
                    ["cumulative_time_delta_s", "B minus A", "#66e38f"],
                  ]} />
                </Panel>
              </div>
            </section>
          )}
          <ZoneComparisonTable result={result} />
          <EvidenceReport report={result.report} warnings={result.warnings} />
        </>
      )}
    </div>
  );
}

function SetupExperiment({ sessions }: { sessions: XrkInspection[] }) {
  const [experiments, setExperiments] = useState<SetupExperimentDraft[]>(() =>
    typeof window === "undefined"
      ? []
      : parseStoredExperiments(window.localStorage.getItem(EXPERIMENT_STORAGE_KEY))
  );
  const [baselineId, setBaselineId] = useState(sessions[0]?.inspection_id ?? "");
  const [modifiedId, setModifiedId] = useState(sessions[1]?.inspection_id ?? "");
  const [name, setName] = useState("Setup change validation");
  const [category, setCategory] = useState("tire_pressure");
  const [parameter, setParameter] = useState("rear_cold_pressure_psi");
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [unit, setUnit] = useState("psi");
  const [secondary, setSecondary] = useState("");
  const [tireModel, setTireModel] = useState("");
  const [ambient, setAmbient] = useState("");
  const [trackCondition, setTrackCondition] = useState("dry");
  const [feedback, setFeedback] = useState("");
  const [result, setResult] = useState<SetupExperimentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runExperiment() {
    if (!baselineId || !modifiedId || baselineId === modifiedId) {
      setError("Select different baseline and modified sessions.");
      return;
    }
    const draft: SetupExperimentDraft = {
      id: `experiment-${Date.now()}`,
      name,
      baselineInspectionId: baselineId,
      modifiedInspectionId: modifiedId,
      primaryChange: { category, parameter, before, after, unit },
      secondaryChanges: secondary.trim()
        ? [{ category: "other", parameter: secondary.trim(), before: "", after: "", unit: "" }]
        : [],
      conditions: {
        tire_model: tireModel,
        ambient_temperature_c: ambient ? Number(ambient) : null,
        track_condition: trackCondition,
      },
      driverFeedback: { overall: feedback },
      updatedAt: new Date().toISOString(),
    };
    setLoading(true);
    setError("");
    try {
      const analyzed = await analyzeSetupExperiment({
        baseline_inspection_id: baselineId,
        modified_inspection_id: modifiedId,
        experiment: {
          id: draft.id,
          name: draft.name,
          primary_change: draft.primaryChange,
          secondary_changes: draft.secondaryChanges,
          conditions: draft.conditions,
          driver_feedback: draft.driverFeedback,
        },
      });
      setResult(analyzed);
      const next = [draft, ...experiments.filter((item) => item.id !== draft.id)].slice(0, 30);
      setExperiments(next);
      window.localStorage.setItem(EXPERIMENT_STORAGE_KEY, JSON.stringify(next));
    } catch (caught) {
      setResult(null);
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <section className="panel rounded-lg p-4">
        <h2 className="text-sm font-semibold text-white">Controlled setup record</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">Use the same identified driver and track. One primary change is preferred.</p>
        <div className="mt-4 space-y-3">
          <TextField label="Experiment name" value={name} onChange={setName} />
          <SessionSelect label="Baseline session" value={baselineId} sessions={sessions} onChange={setBaselineId} />
          <SessionSelect label="Modified session" value={modifiedId} sessions={sessions} onChange={setModifiedId} />
          <SelectField label="Primary category" value={category} onChange={setCategory} options={[
            ["tire_pressure", "Tyre pressure"], ["track_width", "Track width"], ["caster", "Caster"],
            ["camber", "Camber"], ["toe", "Toe"], ["axle", "Axle"], ["hub_length", "Hub length"],
            ["ride_height", "Ride height"], ["seat_strut", "Seat strut"], ["other", "Other"],
          ]} />
          <TextField label="Parameter" value={parameter} onChange={setParameter} />
          <div className="grid grid-cols-3 gap-2">
            <TextField label="Before" value={before} onChange={setBefore} />
            <TextField label="After" value={after} onChange={setAfter} />
            <TextField label="Unit" value={unit} onChange={setUnit} />
          </div>
          <TextField label="Other simultaneous changes" value={secondary} onChange={setSecondary} placeholder="Leave blank when controlled" />
          <TextField label="Tyre model" value={tireModel} onChange={setTireModel} />
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Ambient °C" value={ambient} onChange={setAmbient} type="number" />
            <SelectField label="Track" value={trackCondition} onChange={setTrackCondition} options={[["dry", "Dry"], ["damp", "Damp"], ["wet", "Wet"], ["unknown", "Unknown"]]} />
          </div>
          <TextArea label="Driver feedback" value={feedback} onChange={setFeedback} />
          <button
            type="button"
            onClick={() => void runExperiment()}
            disabled={loading || sessions.length < 2}
            className="min-h-10 w-full rounded-md bg-[#f6c945] px-4 text-sm font-semibold text-slate-950 disabled:opacity-45"
          >
            {loading ? "Analyzing real Top laps..." : "Run Setup Experiment"}
          </button>
          {error && <InlineError message={error} />}
        </div>
        {experiments.length > 0 && (
          <div className="mt-5 border-t border-slate-800 pt-4">
            <h3 className="text-xs font-semibold uppercase text-slate-500">Saved on this browser</h3>
            <div className="mt-2 space-y-2">
              {experiments.slice(0, 5).map((experiment) => (
                <button
                  type="button"
                  key={experiment.id}
                  onClick={() => {
                    setName(experiment.name);
                    setBaselineId(experiment.baselineInspectionId);
                    setModifiedId(experiment.modifiedInspectionId);
                    setCategory(experiment.primaryChange.category);
                    setParameter(experiment.primaryChange.parameter);
                    setBefore(experiment.primaryChange.before);
                    setAfter(experiment.primaryChange.after);
                    setUnit(experiment.primaryChange.unit);
                  }}
                  className="block w-full rounded-md border border-slate-800 px-3 py-2 text-left text-xs text-slate-300 hover:border-slate-600"
                >
                  {experiment.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="space-y-5">
        {!result ? (
          <section className="panel flex min-h-72 items-center justify-center rounded-lg p-8 text-center">
            <div className="max-w-md">
              <FlaskConical className="mx-auto text-slate-600" size={28} />
              <h2 className="mt-4 text-base font-semibold text-slate-200">No setup experiment analyzed</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">The result will compare real Top valid laps, corner net gain, downstream cost and repeatability. It will not diagnose a mechanical cause.</p>
            </div>
          </section>
        ) : (
          <>
            <section className="panel grid rounded-lg md:grid-cols-3">
              <ComparisonMetric label={`Baseline Top-${result.baseline.lap_count}`} value={`${result.baseline.median_lap_time_s.toFixed(3)}s median`} />
              <ComparisonMetric label={`Modified Top-${result.modified.lap_count}`} value={`${result.modified.median_lap_time_s.toFixed(3)}s median`} />
              <ComparisonMetric label="Observed median change" value={`${signed(result.modified.median_lap_time_s - result.baseline.median_lap_time_s)}s`} />
            </section>
            <SetupZoneTable result={result} />
            <section className="grid gap-5 lg:grid-cols-2">
              <Panel title="Confounders" subtitle="Factors limiting causal confidence" icon={<FlaskConical size={17} />}>
                <BulletList items={result.confounders.length ? result.confounders : ["No declared confounder; uncontrolled factors may still exist."]} />
              </Panel>
              <Panel title="Next Test" subtitle="Candidate experiments, not mechanical instructions" icon={<Activity size={17} />}>
                <BulletList items={result.next_test.map((item) => `${item.candidate} ${item.basis}`)} />
              </Panel>
            </section>
            <EvidenceReport report={result.report} warnings={result.warnings} />
          </>
        )}
      </div>
    </div>
  );
}

function ComparisonChart({ data, lines, cursorDistance, onCursor }: {
  data: Array<Record<string, number | null>>;
  lines: Array<[string, string, string]>;
  cursorDistance: number;
  onCursor: (distance: number) => void;
}) {
  const available = lines.filter(([key]) => data.some((row) => typeof row[key] === "number"));
  if (!available.length) return <Unavailable text="Telemetry channel unavailable" />;
  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={data} onClick={(state) => typeof state?.activeLabel === "number" && onCursor(state.activeLabel)}>
        <CartesianGrid stroke="rgba(148,163,184,.14)" />
        <XAxis dataKey="distance_m" type="number" domain={["dataMin", "dataMax"]} stroke="#8b98aa" />
        <YAxis stroke="#8b98aa" />
        <Tooltip contentStyle={chartTooltip} />
        {available.map(([key, label, color]) => <Line key={key} dataKey={key} name={label} stroke={color} dot={false} connectNulls strokeWidth={2} />)}
        <ReferenceLine x={cursorDistance} stroke="#fff" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ComparisonTrackMap({ a, b, cursorDistance, onCursor }: {
  a: XrkTrackPoint[];
  b: XrkTrackPoint[];
  cursorDistance: number;
  onCursor: (distance: number) => void;
}) {
  const points = [...a, ...b].filter((point) => point.local_x_m != null && point.local_y_m != null);
  if (!points.length) return <Unavailable text="GPS track unavailable" />;
  const xs = points.map((point) => point.local_x_m as number);
  const ys = points.map((point) => point.local_y_m as number);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX); const height = Math.max(1, maxY - minY);
  const project = (point: XrkTrackPoint) => ({
    x: 24 + (((point.local_x_m ?? 0) - minX) / width) * 552,
    y: 376 - (((point.local_y_m ?? 0) - minY) / height) * 352,
  });
  const cursor = nearestPoint(a, cursorDistance);
  return (
    <svg viewBox="0 0 600 400" className="aspect-[3/2] w-full bg-[#080c12]" role="img" aria-label="Two driver GPS lap overlay">
      {[a, b].map((trace, traceIndex) => trace.slice(0, -1).map((point, index) => {
        const start = project(point); const end = project(trace[index + 1]);
        return <line key={`${traceIndex}-${index}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={traceIndex ? "#35d6d0" : "#f6c945"} strokeWidth={2.5} strokeLinecap="round" />;
      }))}
      {a.filter((_, index) => index % 5 === 0).map((point, index) => {
        const p = project(point);
        return <circle key={`hit-${index}`} cx={p.x} cy={p.y} r={7} fill="transparent" className="cursor-crosshair" onClick={() => onCursor(point.distance_m)} />;
      })}
      {cursor && (() => { const p = project(cursor); return <circle cx={p.x} cy={p.y} r={7} fill="#fff" stroke="#ff5964" strokeWidth={3} />; })()}
    </svg>
  );
}

function ZoneComparisonTable({ result }: { result: DriverComparisonResult }) {
  if (!result.zones.length) return <Panel title="Corner / Zone Comparison" subtitle="Suggested zones unavailable" icon={<Map size={17} />}><Unavailable text="Corner zones unavailable" /></Panel>;
  return (
    <Panel title="Corner / Zone Comparison" subtitle="B minus A · positive zone time means B is slower" icon={<Map size={17} />}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="text-slate-500"><tr><th className="py-2">Zone</th><th>A time</th><th>B time</th><th>Delta</th><th>A exit speed</th><th>B exit speed</th><th>Minimum RPM A / B</th></tr></thead>
          <tbody className="divide-y divide-slate-800">
            {result.zones.map((zone) => <tr key={zone.id} className="text-slate-300"><td className="py-3">{zone.name}</td><td>{cell(zone.a.elapsed_time_s)}s</td><td>{cell(zone.b.elapsed_time_s)}s</td><td>{zone.time_difference_s == null ? "n/a" : `${signed(zone.time_difference_s)}s`}</td><td>{cell(zone.a.exit_speed_kmh)}</td><td>{cell(zone.b.exit_speed_kmh)}</td><td>{cell(zone.a.minimum_rpm)} / {cell(zone.b.minimum_rpm)}</td></tr>)}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function SetupZoneTable({ result }: { result: SetupExperimentResult }) {
  return (
    <Panel title="Zone Net Gain" subtitle="Local gain minus downstream cost · real Top laps only" icon={<FlaskConical size={17} />}>
      {result.zones.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="text-slate-500"><tr><th className="py-2">Zone</th><th>Local gain</th><th>Downstream cost</th><th>Net gain</th><th>Repeatability</th><th>Confidence</th></tr></thead><tbody className="divide-y divide-slate-800">{result.zones.map((zone) => <tr key={zone.id} className="text-slate-300"><td className="py-3">{zone.name}</td><td>{signed(zone.local_gain_s)}s</td><td>{zone.downstream_cost_s.toFixed(3)}s</td><td className={zone.net_gain_s > 0 ? "text-emerald-300" : "text-amber-300"}>{signed(zone.net_gain_s)}s</td><td>{Math.round(zone.repeatability_score * 100)}%</td><td>{zone.confidence}</td></tr>)}</tbody></table></div> : <Unavailable text="No comparable corner zones were available" />}
    </Panel>
  );
}

function SessionSelect({ label, value, sessions, onChange }: { label: string; value: string; sessions: XrkInspection[]; onChange: (value: string) => void }) {
  return <label className="block text-xs text-slate-400">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="">Select session</option>{sessions.map((session) => <option key={session.inspection_id} value={session.inspection_id}>{metadataLabel(session.metadata, "Driver", session.filename)} · {metadataLabel(session.metadata, "Venue", "unknown track")}</option>)}</select></label>;
}

function LapSelect({ label, value, session, onChange }: { label: string; value: string; session?: XrkInspection; onChange: (value: string) => void }) {
  return <label className="block text-xs text-slate-400">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="">Fastest valid</option>{session?.valid_laps.map((lap) => <option key={lap} value={lap}>Lap {lap}</option>)}</select></label>;
}

function TextField({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return <label className="block text-xs text-slate-400">{label}<input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white" /></label>;
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-xs text-slate-400">{label}<textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} className="mt-1 w-full resize-y rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label>;
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <label className="block text-xs text-slate-400">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white">{options.map(([key, option]) => <option key={key} value={key}>{option}</option>)}</select></label>;
}

function WorkspaceTabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`flex min-h-10 items-center gap-2 rounded-md px-3 text-sm ${active ? "bg-[#f6c945] font-semibold text-slate-950" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}>{icon}{children}</button>;
}

function Panel({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="panel rounded-lg p-4"><div className="mb-4 flex items-start gap-2"><span className="mt-0.5 text-[#f6c945]">{icon}</span><div><h2 className="text-sm font-semibold text-slate-100">{title}</h2><p className="mt-1 text-xs text-slate-500">{subtitle}</p></div></div>{children}</section>;
}

function ComparisonMetric({ label, value }: { label: string; value: string }) {
  return <div className="border-slate-800 p-4 md:border-l md:first:border-l-0"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-base font-semibold text-white">{value}</p></div>;
}

function EvidenceReport({ report, warnings }: { report: string; warnings: string[] }) {
  return <Panel title="Evidence Report" subtitle="Measured, calculated and inferred evidence remain separate" icon={<Activity size={17} />}><pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-slate-300">{report}</pre>{warnings.length > 0 && <div className="mt-4 border-t border-slate-800 pt-3"><BulletList items={warnings} /></div>}</Panel>;
}

function BulletList({ items }: { items: string[] }) {
  return <ul className="space-y-2 text-sm leading-6 text-slate-400">{items.map((item, index) => <li key={`${index}-${item}`} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#f6c945]" /><span>{item}</span></li>)}</ul>;
}

function InlineError({ message }: { message: string }) {
  return <div className="mt-3 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{message}</div>;
}

function Unavailable({ text }: { text: string }) {
  return <div className="flex min-h-32 items-center justify-center text-sm text-slate-600">{text}</div>;
}

function expiryLabel(expiresAt: string): string {
  const minutes = Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 60_000));
  return minutes > 0 ? `${minutes}m left` : "expired";
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}

function cell(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "n/a";
}

function nearestPoint(points: XrkTrackPoint[], distance: number): XrkTrackPoint | null {
  return points.reduce<XrkTrackPoint | null>((best, point) => !best || Math.abs(point.distance_m - distance) < Math.abs(best.distance_m - distance) ? point : best, null);
}
