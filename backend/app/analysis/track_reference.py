"""Fixed spatial references and directed gates, separate from logger lap ranking."""

from hashlib import sha256
import json
from typing import Any

import numpy as np
import pandas as pd
from scipy.signal import find_peaks, savgol_filter
from scipy.spatial import cKDTree

from ..importers.native_signals import bounded_resample
from ..importers.xrk_inspection import convert_units
from ..models.track_reference import SpatialGate, TrackCorner, TrackReference
from .gps_processing import convert_latlon_to_local_xy
from .lap_quality import classify_lap_quality
from .corner_dynamics import fit_zone_thresholds, segment_corner_phases


def native_gps_frame(native: pd.DataFrame, manifest: dict) -> tuple[pd.DataFrame, dict]:
    """Pair native GPS axes by sample/time; do not sort away timestamp defects."""
    descriptions = {}
    for canonical in ("gps_lat", "gps_lon", "speed", "gps_fix", "gps_accuracy_m"):
        candidates = [row for row in manifest["channels"] if row.get("canonical_name") == canonical]
        chosen = [row for row in candidates if row.get("selected") is True]
        if not chosen and len(candidates) == 1 and candidates[0].get("selected") is not False:
            chosen = candidates
        if len(chosen) == 1:
            descriptions[canonical] = chosen[0]
    if not {"gps_lat", "gps_lon"}.issubset(descriptions):
        raise ValueError("Native GPS position is unavailable.")
    frames = {}
    for name in ("gps_lat", "gps_lon", "speed", "gps_fix", "gps_accuracy_m"):
        description = descriptions.get(name)
        if not description:
            continue
        part = native[native.channel_id == description["channel_id"]].sort_values("sample_index")
        frames[name] = (part.timecode_ms.to_numpy(dtype=float) / 1000, part.value.to_numpy(dtype=float))
    t, lat = frames["gps_lat"]
    lon_t, lon = frames["gps_lon"]
    for name in ("gps_lat", "gps_lon"):
        unit = (descriptions[name].get("unit") or "").strip().lower()
        if unit not in {"deg", "degree", "degrees", "°"}:
            raise ValueError("Native GPS coordinate units are not verified degrees.")
    if not np.array_equal(t, lon_t):
        raise ValueError("Native GPS axes have different timebases; explicit synchronization is required.")
    finite_t = np.isfinite(t)
    running = np.maximum.accumulate(np.where(finite_t, t, -np.inf))
    increasing = finite_t & (t > np.r_[-np.inf, running[:-1]])
    keep = increasing & np.isfinite(lat) & np.isfinite(lon) & (np.abs(lat) <= 85) & (np.abs(lon) <= 180) & ((lat != 0) | (lon != 0))
    result = pd.DataFrame({"session_time_s": t[keep], "gps_lat": lat[keep], "gps_lon": lon[keep]})
    processing = {}
    for name, (source_t, values) in frames.items():
        if name in {"gps_lat", "gps_lon"}:
            continue
        if np.array_equal(source_t, t):
            sampled, method = values[keep].copy(), {"method": "native_shared_GPS_timestamps_no_resampling"}
        else:
            sampled, method = bounded_resample(source_t, values, result.session_time_s.to_numpy(), discrete=name == "gps_fix")
        if name == "speed":
            sampled = convert_units("speed", sampled, descriptions[name].get("unit"))
        result[name] = sampled
        processing[name] = method
    return result, {"native_samples": len(t), "removed_coordinate_or_timestamp_samples": int((~keep).sum()),
                    "timebase": "native_GPS_seconds", "auxiliary_processing": processing,
                    "selected_source_channels": {key: {k: row.get(k) for k in ("channel_id", "name", "source", "unit")} for key, row in descriptions.items()}}


def direction(points: np.ndarray) -> str:
    """Return polygon winding in an east/north coordinate frame."""
    following = np.roll(points, -1, axis=0)
    return "CCW" if np.sum(points[:, 0] * following[:, 1] - following[:, 0] * points[:, 1]) > 0 else "CW"


def gate_at(points: np.ndarray, index: int, width_m: float = 20) -> SpatialGate:
    """Construct an unconfirmed finite normal gate from local path tangent."""
    tangent = points[(index + 4) % len(points)] - points[(index - 4) % len(points)]
    tangent /= np.linalg.norm(tangent)
    normal = np.array([-tangent[1], tangent[0]])
    return SpatialGate(a=tuple(points[index] - normal * width_m / 2), b=tuple(points[index] + normal * width_m / 2), forward=tuple(tangent))


def _lap_frame(gps: pd.DataFrame, timing: dict, origin: dict) -> pd.DataFrame:
    """Keep observed samples within one logger interval and one fixed projection."""
    frame = gps[gps.session_time_s.between(timing["start_time_ms"] / 1000, timing["end_time_ms"] / 1000)].copy()
    frame, _ = convert_latlon_to_local_xy(frame, **origin)
    frame["lap"] = int(timing["lap"])
    frame["lap_time_s"] = frame.session_time_s - timing["start_time_ms"] / 1000
    points = frame[["local_x_m", "local_y_m"]].to_numpy()
    frame["distance_m"] = np.r_[0, np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))] if len(frame) else []
    return frame


def _geometry_quality(frame: pd.DataFrame, length: float | None, config) -> list[str]:
    """Reject incomplete/gapped geometry before fitting, independently of speed ranking."""
    if len(frame) < 50:
        return ["insufficient_native_GPS"]
    t = frame.session_time_s.to_numpy()
    points = frame[["local_x_m", "local_y_m"]].to_numpy()
    steps = np.linalg.norm(np.diff(points, axis=0), axis=1)
    reasons = []
    if np.any(np.diff(t) <= 0) or np.max(np.diff(t)) > config.max_time_gap_s:
        reasons.append("nonmonotonic_or_gapped_GPS")
    if np.max(steps) > 20 or np.linalg.norm(points[-1] - points[0]) > 20:
        reasons.append("incomplete_or_discontinuous_lap")
    if length and abs(steps.sum() / length - 1) > config.max_length_difference_ratio:
        reasons.append("lap_length_mismatch")
    if "gps_fix" in frame and (frame.gps_fix.dropna() < 2).any():
        reasons.append("invalid_GPS_fix")
    return reasons


def create_track_reference(gps: pd.DataFrame, manifest: dict, lap: int, *, track_id: str,
                           aliases: list[str] | None = None) -> TrackReference:
    """Use one real quality-gated lap as geometry, never splice fast sectors."""
    timing = manifest.get("lap_timing", [])
    reference = next((row for row in timing if row["lap"] == lap), None)
    if reference is None:
        raise ValueError("The reference lap is not a complete timed lap.")
    selected = gps[gps.session_time_s.between(reference["start_time_ms"] / 1000, reference["end_time_ms"] / 1000)]
    origin = {"origin_lat": float(selected.gps_lat.median()), "origin_lon": float(selected.gps_lon.median())}
    frames = [_lap_frame(gps, row, origin) for row in timing]
    quality = classify_lap_quality({r["lap"]: r for r in timing}, pd.concat(frames, ignore_index=True))
    if not next(row for row in quality if row["lap"] == lap)["analysis_eligible"]:
        raise ValueError("The reference lap did not pass the existing Lap Quality Gate.")
    from ..models.track_reference import TrackAcceptance
    frame = next(f for f in frames if not f.empty and int(f.lap.iloc[0]) == lap)
    reasons = _geometry_quality(frame, None, TrackAcceptance())
    if reasons:
        raise ValueError("Reference GPS is unsuitable: " + ", ".join(reasons))
    raw = frame[["local_x_m", "local_y_m"]].to_numpy()
    s = frame.distance_m.to_numpy()
    keep = np.r_[True, np.diff(s) > .001]
    grid = np.linspace(0, s[-1], min(4096, max(100, int(s[-1]) + 1)))
    points = np.column_stack([np.interp(grid, s[keep], raw[keep, axis]) for axis in range(2)])
    smooth = savgol_filter(points, 21, 3, axis=0, mode="wrap")
    tangent = np.gradient(smooth, grid, axis=0)
    heading = np.unwrap(np.arctan2(tangent[:, 1], tangent[:, 0]))
    curvature = np.abs(np.gradient(heading, grid))
    peaks, _ = find_peaks(curvature, prominence=.006, distance=max(1, int(30 / np.median(np.diff(grid)))))
    peaks = [int(i) for i in peaks if 25 < grid[i] < grid[-1] - 25][:20]
    corners = []
    for number, peak in enumerate(peaks):
        previous = peaks[number - 1] if number else peaks[-1] - len(points)
        following = peaks[number + 1] if number + 1 < len(peaks) else peaks[0] + len(points)
        before = max(3, min(20, (peak - previous) // 3))
        after = max(3, min(25, (following - peak) // 3))
        corners.append(TrackCorner(id=f"C{number + 1:02d}", name=f"Candidate {number + 1}",
                                   entry_gate=gate_at(points, peak - before), exit_gate=gate_at(points, peak + after)))
    return TrackReference(track_id=track_id, venue_aliases=aliases or [], direction=direction(raw),
                          **origin, source_fingerprint=manifest["fingerprint"], source_lap=lap,
                          reference_path=points.tolist(), start_finish_gate=gate_at(points, 0), corners=corners)


def _residuals(points: np.ndarray, reference: np.ndarray, tree: cKDTree) -> tuple[np.ndarray, np.ndarray]:
    """Project onto nearby polyline segments, retaining lateral departures."""
    nearest = tree.query(points)[1]
    candidates, residuals = [], []
    for offset in (-1, 0):
        indexes = (nearest + offset) % len(reference)
        start, end = reference[indexes], reference[(indexes + 1) % len(reference)]
        vec = end - start
        fraction = np.clip(np.sum((points - start) * vec, axis=1) / np.maximum(np.sum(vec * vec, axis=1), 1e-12), 0, 1)
        projected = start + fraction[:, None] * vec
        candidates.append(projected)
        residuals.append(np.linalg.norm(points - projected, axis=1))
    best = np.argmin(residuals, axis=0)
    projected = np.stack(candidates)[best, np.arange(len(points))]
    return projected, np.linalg.norm(points - projected, axis=1)


def register_translation(points: np.ndarray, reference: np.ndarray, distance: np.ndarray, config) -> dict:
    """Bounded translation ICP with spatial-block holdout; no rotation or warping."""
    tree = cKDTree(reference)
    blocks = (distance // 20).astype(int) % 2
    # Equal-distance subsampling prevents slow corners dominating the fit.
    keep = np.r_[True, np.diff(np.floor(distance)) > 0]
    shifts, validations = [], []
    for fold in (0, 1):
        fit = points[keep & (blocks == fold)]
        validation = points[keep & (blocks != fold)]
        if len(fit) < 25 or len(validation) < 25:
            return {"status": "unavailable", "reason": "insufficient_spatial_holdout"}
        shift = np.zeros(2)
        for _ in range(80):
            target, residual = _residuals(fit + shift, reference, tree)
            trim = residual <= np.quantile(residual, .9)
            update = np.median(target[trim] - fit[trim] - shift, axis=0)
            shift += update
            if np.linalg.norm(shift) > config.max_translation_m:
                return {"status": "rejected", "reason": "translation_exceeds_limit", "translation_m": shift.tolist()}
            if np.linalg.norm(update) < .001:
                break
        shifts.append(shift)
        validations.append(_residuals(validation + shift, reference, tree)[1])
    shift = np.mean(shifts, axis=0)
    residual = _residuals(points + shift, reference, tree)[1]
    holdout = np.concatenate(validations)
    median, p95 = float(np.median(holdout)), float(np.quantile(holdout, .95))
    stability = float(np.linalg.norm(shifts[0] - shifts[1]))
    accepted = median < config.median_residual_m and p95 < config.p95_residual_m and stability < config.max_fold_shift_difference_m
    return {"status": "accepted" if accepted else "rejected", "reason": None if accepted else "holdout_geometry_or_shift_stability_failed",
            "translation_m": shift.tolist(), "translation_norm_m": float(np.linalg.norm(shift)),
            "before_median_m": float(np.median(_residuals(points, reference, tree)[1])),
            "median_m": float(np.median(residual)), "p95_m": float(np.quantile(residual, .95)),
            "holdout_median_m": median, "holdout_p95_m": p95, "fold_shift_difference_m": stability,
            "method": "translation_only_ICP_20m_alternating_spatial_blocks_trimmed_median",
            "sensor_error_identified": False, "independent_ground_truth": False}


def gate_crossings(points: np.ndarray, time: np.ndarray, gate: SpatialGate, max_gap_s: float = .5) -> list[dict]:
    """Interpolate directed finite-gate intersections only across observed short steps."""
    center = (np.array(gate.a) + gate.b) / 2
    line = np.subtract(gate.b, gate.a)
    signed = (points - center) @ np.array(gate.forward)
    hits = []
    for i in np.flatnonzero((signed[:-1] < 0) & (signed[1:] >= 0)):
        dt = time[i + 1] - time[i]
        if not 0 < dt <= max_gap_s or np.linalg.norm(points[i + 1] - points[i]) > 20:
            continue
        fraction = -signed[i] / (signed[i + 1] - signed[i])
        point = points[i] + fraction * (points[i + 1] - points[i])
        across = np.dot(point - gate.a, line) / np.dot(line, line)
        if 0 <= across <= 1:
            hits.append({"session_time_s": float(time[i] + fraction * dt), "sample_bracket_s": [float(time[i]), float(time[i + 1])],
                         "sampling_interval_s": float(dt), "position_m": point.tolist()})
    return hits


def analyze_gate_phases(gps: pd.DataFrame, manifest: dict, cycles: list[dict], config: TrackReference) -> dict:
    """Apply frozen zone thresholds within previous-exit/current-exit spatial windows."""
    base = {"status": "unavailable", "corners": [], "driver_input_confirmed": False,
            "manually_validated": False, "source": ["GPS speed", "GPS trajectory curvature"],
            "window": "previous_corner_exit_to_current_corner_exit", "synthetic_curve_generated": False}
    if "speed" not in gps or manifest.get("channel_provenance", {}).get("speed", {}).get("source") != "gps_receiver":
        return {**base, "reason": "GPS_speed_provenance_unconfirmed"}
    projected, _ = convert_latlon_to_local_xy(gps, origin_lat=config.origin_lat, origin_lon=config.origin_lon)
    output = []
    for corner in config.corners:
        by_lap, zones, unavailable = {}, {}, []
        for cycle in cycles:
            row = next(c for c in cycle["corners"] if c["id"] == corner.id)
            start, entry, end = row["phase_window_start_s"], row["entry_session_time_s"], row["phase_window_end_s"]
            reason = "missing_or_unordered_spatial_gates"
            if cycle["status"] != "calculated" or row["status"] != "calculated" or start is None or not start < entry < end:
                unavailable.append({"lap": cycle["platform_lap"], "status": "unavailable", "reason": reason})
                continue
            times = projected.session_time_s.to_numpy()
            lo, hi = max(0, np.searchsorted(times, start) - 1), min(len(times), np.searchsorted(times, end) + 1)
            observed = projected.iloc[lo:hi]
            t = observed.session_time_s.to_numpy()
            if len(t) < 7 or t[0] > start or t[-1] < end or np.max(np.diff(t)) > config.acceptance.max_time_gap_s:
                unavailable.append({"lap": cycle["platform_lap"], "status": "unavailable", "reason": "incomplete_or_gapped_gate_window"})
                continue
            values = observed[["local_x_m", "local_y_m", "speed"]].to_numpy()
            steps = np.linalg.norm(np.diff(values[:, :2], axis=0), axis=1)
            if not np.isfinite(values).all() or np.any(steps <= .001) or np.max(steps) > 20:
                unavailable.append({"lap": cycle["platform_lap"], "status": "unavailable", "reason": "invalid_GPS_in_gate_window"})
                continue
            # Only the two boundary samples are interpolated, within observed short
            # brackets. Time-series values are never taken from the reference path.
            grid = np.unique(np.r_[start, t[(t > start) & (t < end)], end])
            xy = np.column_stack([np.interp(grid, t, values[:, i]) for i in (0, 1)])
            distance = np.r_[0, np.cumsum(np.linalg.norm(np.diff(xy, axis=0), axis=1))]
            if np.any(np.diff(distance) <= .001):
                unavailable.append({"lap": cycle["platform_lap"], "status": "unavailable", "reason": "stationary_GPS_in_gate_window"})
                continue
            width = min(11, len(xy) if len(xy) % 2 else len(xy) - 1)
            smooth = savgol_filter(xy, width, 2, axis=0)
            tangent = np.gradient(smooth, grid, axis=0)
            heading = np.unwrap(np.arctan2(tangent[:, 1], tangent[:, 0]))
            curvature = np.gradient(heading, distance)
            distance -= np.interp(entry, grid, distance)
            lap = cycle["platform_lap"]
            by_lap[lap] = pd.DataFrame({"lap": lap, "lap_time_s": grid - cycle["start_session_time_s"],
                                       "session_time_s": grid, "distance_m": distance,
                                       "speed": np.interp(grid, t, values[:, 2]), "curvature": curvature})
            zones[lap] = {"id": corner.id, "entry_distance_m": 0., "exit_distance_m": float(distance[-1]),
                          "window_start_distance_m": float(distance[0]), "window_end_distance_m": float(distance[-1])}
        common = {"id": corner.id, "entry_distance_m": 0., "exit_distance_m": min((z["exit_distance_m"] for z in zones.values()), default=0.)}
        calibration = fit_zone_thresholds(by_lap, common, zones)
        phases = [segment_corner_phases(frame, zones[lap], calibration) for lap, frame in by_lap.items()]
        for phase in phases:
            origin_time = next(c["start_session_time_s"] for c in cycles if c["platform_lap"] == phase["lap"])
            for event in phase.get("events", {}).values():
                if event:
                    event["session_time_s"] = event["lap_time_s"] + origin_time
            phase["distance_origin"] = "this_corner_entry_gate"
        output.append({"id": corner.id, "name": corner.name, "calibration": calibration,
                       "phases": sorted(phases + unavailable, key=lambda p: p["lap"])})
    phases = [p for c in output for p in c["phases"]]
    valid = [p for p in phases if p["status"] == "calculated"]
    return {**base, "status": "calculated" if valid else "unavailable", "corners": output,
            "processing": "native GPS; short-bracket gate interpolation; 11-sample quadratic XY smoothing; observed-distance curvature; frozen zone thresholds",
            "coverage": {"attempted": len(phases), "calculated": len(valid), "complete_five": sum(p["complete"] for p in valid)}}


def match_track_reference(gps: pd.DataFrame, manifest: dict, config: TrackReference) -> dict[str, Any]:
    """Match full observed laps, report spatial gates and preserve original logger times."""
    reference = np.asarray(config.reference_path)
    length = float(np.linalg.norm(np.diff(reference, axis=0), axis=1).sum())
    origin = {"origin_lat": config.origin_lat, "origin_lon": config.origin_lon}
    timing = manifest.get("lap_timing", [])
    frames = [_lap_frame(gps, row, origin) for row in timing]
    if not frames:
        raise ValueError("No complete timed laps are available.")
    existing = {r["lap"]: r for r in classify_lap_quality({r["lap"]: r for r in timing}, pd.concat(frames, ignore_index=True))}
    gates = {"start_finish": config.start_finish_gate}
    for corner in config.corners:
        gates[f"{corner.id}:entry"] = corner.entry_gate
        gates[f"{corner.id}:exit"] = corner.exit_gate
    results, crossings, traces = [], {key: [] for key in gates}, []
    for row, frame in zip(timing, frames):
        lap = row["lap"]
        base = {"logger_lap": lap, "logger_duration_s": row["duration_s"], "lap_quality": existing[lap], "geometry_status": "rejected"}
        reasons = _geometry_quality(frame, length, config.acceptance)
        if existing[lap]["quality_status"] not in {"REFERENCE_ELIGIBLE", "CONTEXT_ONLY"}:
            reasons.append("existing_lap_quality_gate")
        points = frame[["local_x_m", "local_y_m"]].to_numpy()
        stride = max(1, int(np.ceil(len(points) / 450)))
        trace = {"logger_lap": lap, "raw_xy": points[::stride].tolist(), "registered_xy": []}
        traces.append(trace)
        if len(points) and direction(points) != config.direction:
            reasons.append("wrong_direction")
        if reasons:
            results.append({**base, "reasons": reasons})
            continue
        registration = register_translation(points, reference, frame.distance_m.to_numpy(), config.acceptance)
        base["registration"] = registration
        if registration["status"] != "accepted":
            results.append({**base, "reasons": [registration["reason"]]})
            continue
        shift = np.array(registration["translation_m"])
        moved = points + shift
        # A bounded one-sample context catches a gate at a logger boundary. Never
        # connect differently translated laps into a new fabricated GPS trace.
        start, end = row["start_time_ms"] / 1000, row["end_time_ms"] / 1000
        t_all = gps.session_time_s.to_numpy()
        lo, hi = max(0, np.searchsorted(t_all, start) - 1), min(len(gps), np.searchsorted(t_all, end, side="right") + 1)
        context, _ = convert_latlon_to_local_xy(gps.iloc[lo:hi], **origin)
        context_points = context[["local_x_m", "local_y_m"]].to_numpy() + shift
        hits = {}
        for key, gate in gates.items():
            found = gate_crossings(context_points, context.session_time_s.to_numpy(), gate, config.acceptance.max_time_gap_s)
            # Ownership is half-open in the logger timebase; no duplicated seams.
            hits[key] = [h for h in found if start <= h["session_time_s"] < end]
            crossings[key].extend({**h, "logger_lap": lap} for h in hits[key])
        results.append({**base, "geometry_status": "accepted", "reasons": [], "gate_counts": {key: len(h) for key, h in hits.items()}})
        trace["registered_xy"] = moved[::stride].tolist()
    sf = sorted(crossings["start_finish"], key=lambda hit: hit["session_time_s"])
    accepted_laps = {row["logger_lap"] for row in results if row["geometry_status"] == "accepted"}
    whole, _ = convert_latlon_to_local_xy(gps, **origin)
    whole_time = whole.session_time_s.to_numpy()
    whole_xy = whole[["local_x_m", "local_y_m"]].to_numpy()
    whole_distance = np.r_[0, np.cumsum(np.linalg.norm(np.diff(whole_xy, axis=0), axis=1))]
    cycles = []
    for first, last in zip(sf[:-1], sf[1:]):
        t0, t1 = first["session_time_s"], last["session_time_s"]
        source_laps = [row["lap"] for row in timing if row["start_time_ms"] / 1000 < t1 and row["end_time_ms"] / 1000 > t0]
        sources_valid = bool(source_laps) and set(source_laps).issubset(accepted_laps) and first["logger_lap"] + 1 == last["logger_lap"]
        travelled = float(np.interp(t1, whole_time, whole_distance) - np.interp(t0, whole_time, whole_distance))
        length_valid = abs(travelled / length - 1) <= config.acceptance.max_length_difference_ratio
        valid = sources_valid and length_valid
        corners = []
        for index, corner in enumerate(config.corners):
            entry = [h for h in crossings[f"{corner.id}:entry"] if t0 <= h["session_time_s"] < t1]
            exit_hits = [h for h in crossings[f"{corner.id}:exit"] if t0 <= h["session_time_s"] < t1]
            previous = config.corners[index - 1]
            previous_exits = [h for h in crossings[f"{previous.id}:exit"] if t0 - (t1 - t0) < h["session_time_s"] < (entry[0]["session_time_s"] if len(entry) == 1 else t0)
                              and h["logger_lap"] in source_laps + [min(source_laps, default=-1) - 1]]
            previous_hit = max(previous_exits, key=lambda h: h["session_time_s"]) if previous_exits else None
            good = valid and len(entry) == len(exit_hits) == 1 and entry[0]["session_time_s"] < exit_hits[0]["session_time_s"]
            corners.append({"id": corner.id, "name": corner.name, "status": "calculated" if good else "unavailable",
                            "reason": None if good else "missing_multiple_or_unordered_gate_crossings",
                            "entry_count": len(entry), "exit_count": len(exit_hits),
                            "entry_session_time_s": entry[0]["session_time_s"] if good else None,
                            "exit_session_time_s": exit_hits[0]["session_time_s"] if good else None,
                            "duration_s": exit_hits[0]["session_time_s"] - entry[0]["session_time_s"] if good else None,
                            "phase_window_start_s": previous_hit["session_time_s"] if good and previous_hit else None,
                            "phase_window_end_s": exit_hits[0]["session_time_s"] if good else None,
                            "manually_validated": corner.confirmed and corner.entry_gate.confirmed and corner.exit_gate.confirmed})
        # A shifted gate partitions adjacent laps differently: do not assert equal lap times.
        logger = next(r for r in timing if r["lap"] == first["logger_lap"])
        next_logger = next(r for r in timing if r["lap"] == last["logger_lap"])
        offset_start = t0 - logger["start_time_ms"] / 1000
        offset_end = t1 - next_logger["start_time_ms"] / 1000
        original_span = (next_logger["start_time_ms"] - logger["start_time_ms"]) / 1000
        cycles.append({"platform_lap": len(cycles) + 1, "status": "calculated" if valid else "unavailable",
                       "reason": None if valid else "platform_interval_length_mismatch" if sources_valid else "nonconsecutive_or_rejected_source_laps", "source_logger_laps": source_laps,
                       "observed_distance_m": travelled, "length_compatible": length_valid,
                       "start_session_time_s": t0, "end_session_time_s": t1, "duration_s": t1 - t0 if valid else None,
                       "logger_start_span_s": original_span, "boundary_offsets_s": [offset_start, offset_end],
                       "partition_identity_residual_s": (t1 - t0) - (original_span + offset_end - offset_start),
                       "timing_validation": "arithmetic_partition_identity_only_not_independent_accuracy", "corners": corners,
                       "all_corner_gates_once": bool(corners) and all(c["status"] == "calculated" for c in corners)})
    all_corners = [c for row in cycles if row["status"] == "calculated" for c in row["corners"]]
    counts = [n for row in results if row["geometry_status"] == "accepted" for key, n in row["gate_counts"].items() if key != "start_finish"]
    phases = analyze_gate_phases(gps, manifest, cycles, config)
    return {"track_id": config.track_id, "revision": config.revision,
            "config_hash": sha256(json.dumps(config.model_dump(), sort_keys=True).encode()).hexdigest(),
            "status": "provisional" if accepted_laps else "unavailable", "lap_length_m": length,
            "laps": results, "platform_laps": cycles, "gate_crossings": crossings, "traces": traces, "gate_phases": phases,
            "importer_excluded_laps": manifest.get("excluded_laps", []), "native_lap_segments": manifest.get("lap_segments"),
            "acceptance": config.acceptance.model_dump(),
            "coverage": {"logger_laps": len(results), "geometry_accepted_laps": len(accepted_laps),
                         "platform_laps": sum(row["status"] == "calculated" for row in cycles),
                         "fully_gated_platform_laps": sum(row["status"] == "calculated" and row["all_corner_gates_once"] for row in cycles),
                         "gate_lap_pairs": len(counts), "exactly_once_gate_lap_pairs": sum(n == 1 for n in counts),
                         "exactly_once_ratio": sum(n == 1 for n in counts) / len(counts) if counts else None,
                         "corner_lap_pairs": len(all_corners), "calculated_corner_lap_pairs": sum(c["status"] == "calculated" for c in all_corners)},
            "manual_confirmation_required": not config.start_finish_gate.confirmed or not config.corners or any(not c.confirmed or not c.entry_gate.confirmed or not c.exit_gate.confirmed for c in config.corners),
            "synthetic_curve_generated": False, "logger_timing_unchanged": True,
            "warnings": ["A fitted translation does not prove GPS error rather than driving-line variation.",
                         "Spatial holdout is internal validation, not surveyed ground truth.",
                         "Moving the timing gate can change individual lap durations. Logger times are retained.",
                         "Candidate curvature peaks are not official corners. Confirm names, grouping and the physical timing line.",
                         "This sidecar does not change Top 3 ranking, coaching or the existing Lap Quality Gate."]}
