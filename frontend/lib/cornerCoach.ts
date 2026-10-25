import type { CornerLap } from "./selectedCorner";

export type CoachSample = { distance_m: number; section_speed: number | null; overall_speed: number | null;
  section_rpm: number | null; overall_rpm: number | null; section_time: number; overall_time: number; gain_s: number };
type Selection = { section: CornerLap; overall: CornerLap; sectionTies: number[]; overallTies: number[]; excluded: number[] };
export type CornerCoachComparison = { status: "unavailable"; reason: string } | (Selection & (
  { status: "same_lap" } | { status: "available"; samples: CoachSample[]; gain_s: number;
    downstream_gain_s: number | null; combined_gain_s: number | null; downstream_gps_warning: boolean;
    parts: { index: number; start_m: number; end_m: number; gain_s: number }[] }
));
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const tied = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Select by observed gate time and real full-lap timing, not curve similarity. */
export function compareCornerBest(rows: CornerLap[], gpsFlagged: number[] = [], rejected: number[] = [], downstreamFlagged: number[] = []): CornerCoachComparison {
  const valid = rows.filter(r => r.quality.analysis_eligible && finite(r.quality.lap_time) && r.quality.lap_time > 0)
    .sort((a, b) => a.quality.lap_time! - b.quality.lap_time! || a.lap - b.lap);
  const overall = valid[0];
  if (!overall) return { status: "unavailable", reason: "no_valid_lap_time" };
  if (gpsFlagged.includes(overall.lap)) return { status: "unavailable", reason: "overall_gps_warning" };
  if (rejected.includes(overall.lap)) return { status: "unavailable", reason: "overall_video_rejected" };
  if (overall.status !== "candidate" || !finite(overall.elapsed_s)) return { status: "unavailable", reason: "overall_section_unavailable" };
  const excluded = [...new Set([...gpsFlagged, ...rejected])];
  const candidates = valid.filter(r => r.status === "candidate" && finite(r.elapsed_s) && r.elapsed_s > 0 && !excluded.includes(r.lap))
    .sort((a, b) => a.elapsed_s! - b.elapsed_s! || a.lap - b.lap);
  if (candidates.length < 2) return { status: "unavailable", reason: "insufficient_candidates" };
  const sectionTies = candidates.filter(r => tied(r.elapsed_s!, candidates[0].elapsed_s!)).map(r => r.lap);
  const section = sectionTies.includes(overall.lap) ? overall : candidates[0];
  const selection = { section, overall, sectionTies, excluded,
    overallTies: valid.filter(r => tied(r.quality.lap_time!, overall.quality.lap_time!)).map(r => r.lap) };
  if (section.lap === overall.lap) return { ...selection, status: "same_lap" };
  const a = section.spatial_profile, b = overall.spatial_profile;
  if (a?.status !== "available" || b?.status !== "available" || a.method !== b.method
    || a.method !== "shared_directed_spatial_gates" || a.points.length < 4 || a.points.length !== b.points.length)
    return { status: "unavailable", reason: "shared_checkpoints_unavailable" };
  if (a.points.some((p, i) => !finite(p.distance_m) || !finite(p.elapsed_s) || !finite(b.points[i].elapsed_s)
    || !finite(p.session_time_s) || !finite(b.points[i].session_time_s)
    || !tied(p.distance_m, b.points[i].distance_m) || (i > 0 && (p.distance_m <= a.points[i - 1].distance_m
      || p.elapsed_s <= a.points[i - 1].elapsed_s || b.points[i].elapsed_s <= b.points[i - 1].elapsed_s)))
    || !tied(a.points[0].elapsed_s, 0) || !tied(b.points[0].elapsed_s, 0)
    || !tied(a.points.at(-1)!.elapsed_s, section.elapsed_s!) || !tied(b.points.at(-1)!.elapsed_s, overall.elapsed_s!))
    return { status: "unavailable", reason: "shared_checkpoints_unavailable" };
  const samples: CoachSample[] = a.points.map((p, i) => ({ distance_m: p.distance_m,
    section_speed: finite(p.speed) ? p.speed : null, overall_speed: finite(b.points[i].speed) ? b.points[i].speed : null,
    section_rpm: finite(p.rpm) ? p.rpm : null, overall_rpm: finite(b.points[i].rpm) ? b.points[i].rpm : null,
    section_time: p.session_time_s, overall_time: b.points[i].session_time_s, gain_s: b.points[i].elapsed_s - p.elapsed_s }));
  const length = samples.at(-1)!.distance_m;
  const cuts = [0, length / 3, 2 * length / 3, length].map(d => samples.find(p => tied(p.distance_m, d)));
  if (cuts.some(p => !p)) return { status: "unavailable", reason: "shared_checkpoints_unavailable" };
  const parts = cuts.slice(0, -1).map((p, index) => ({ index, start_m: p!.distance_m, end_m: cuts[index + 1]!.distance_m,
    gain_s: cuts[index + 1]!.gain_s - p!.gain_s }));
  const gain = overall.elapsed_s! - section.elapsed_s!;
  const downstreamWarning = [section.lap, overall.lap].some(lap => downstreamFlagged.includes(lap));
  const downstream = !downstreamWarning && finite(section.downstream_s) && finite(overall.downstream_s) ? overall.downstream_s - section.downstream_s : null;
  return { ...selection, status: "available", samples, parts, gain_s: gain, downstream_gain_s: downstream,
    combined_gain_s: downstream === null ? null : gain + downstream, downstream_gps_warning: downstreamWarning };
}
