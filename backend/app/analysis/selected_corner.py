"""User-selected physical corner intervals and exploratory real-lap grouping."""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import cut_tree, linkage
from scipy.spatial.distance import cdist

from ..models.track_reference import SpatialGate, TrackAcceptance
from .gps_processing import clean_gps_points
from .lap_quality import classify_lap_quality
from .track_reference import gate_crossings, register_translation


def _value(frame: pd.DataFrame, time: float, channel: str) -> float:
    """Interpolate only inside observed short, finite time brackets."""
    t = frame.session_time_s.to_numpy(float)
    i = int(np.searchsorted(t, time))
    if i < len(t) and abs(t[i] - time) < 1e-8:
        value = float(frame[channel].iloc[i])
        if np.isfinite(value):
            return value
    if i <= 0 or i >= len(t) or not 0 < t[i] - t[i - 1] <= .5:
        raise ValueError("corner_boundary_coverage_unavailable")
    values = frame[channel].iloc[i - 1:i + 1].to_numpy(float)
    if not np.isfinite(values).all():
        raise ValueError("corner_channel_gap")
    return float(np.interp(time, t[i - 1:i + 1], values))


def _gate(frame: pd.DataFrame, time: float) -> SpatialGate:
    """Construct a finite cross-track gate at the selected real timestamp."""
    center = np.array([_value(frame, time, key) for key in ("local_x_m", "local_y_m")])
    before, after = max(float(frame.session_time_s.iloc[0]), time - .2), min(float(frame.session_time_s.iloc[-1]), time + .2)
    tangent = np.array([_value(frame, after, key) - _value(frame, before, key) for key in ("local_x_m", "local_y_m")])
    norm = np.linalg.norm(tangent)
    if norm < .5:
        raise ValueError("corner_direction_unavailable")
    forward = tangent / norm
    normal = np.array([-forward[1], forward[0]])
    return SpatialGate(a=tuple(center - 10 * normal), b=tuple(center + 10 * normal), forward=tuple(forward))


def _section(frame: pd.DataFrame, start: float, end: float) -> pd.DataFrame:
    """Retain interior observations and exact interpolated boundary values."""
    t = frame.session_time_s.to_numpy(float)
    lo, hi = max(0, np.searchsorted(t, start) - 1), min(len(t), np.searchsorted(t, end) + 1)
    observed = frame.iloc[lo:hi]
    if len(observed) < 8 or np.any(np.diff(observed.session_time_s) <= 0) or np.any(np.diff(observed.session_time_s) > .5):
        raise ValueError("corner_timing_gap")
    columns = [key for key in ("session_time_s", "distance_m", "speed", "rpm") if key in frame]
    boundaries = [{key: time if key == "session_time_s" else _value(frame, time, key)
                   for key in columns if key != "rpm"} for time in (start, end)]
    if "rpm" in columns:
        for row, time in zip(boundaries, (start, end)):
            try:
                row["rpm"] = _value(frame, time, "rpm")
            except ValueError:
                row["rpm"] = np.nan
    section = pd.concat([pd.DataFrame([boundaries[0]]), frame.loc[frame.session_time_s.between(start, end, inclusive="neither"), columns], pd.DataFrame([boundaries[1]])], ignore_index=True)
    if "speed" not in section or not np.isfinite(section.speed).all() or np.any(np.diff(section.distance_m) <= 0):
        raise ValueError("corner_speed_or_distance_gap")
    return section


def _profile(section: pd.DataFrame) -> dict:
    """Sample curve shape by normalized observed distance; elapsed time is not a clustering feature."""
    distance = section.distance_m.to_numpy(float)
    progress = (distance - distance[0]) / (distance[-1] - distance[0])
    grid = np.linspace(0, 1, 41)
    speed = np.interp(grid, progress, section.speed)
    rpm = np.interp(grid, progress, section.rpm) if "rpm" in section and np.isfinite(section.rpm).all() else None
    # Display extrema from observed samples, not the sparse clustering grid.
    minimum = int(np.argmin(section.speed.to_numpy(float)))
    return {"progress": grid.tolist(), "speed": speed.tolist(), "rpm": rpm.tolist() if rpm is not None else None,
            "metrics": {"entry_speed_kmh": float(speed[0]), "minimum_speed_kmh": float(section.speed.iloc[minimum]),
                        "exit_speed_kmh": float(speed[-1]), "minimum_position_fraction": float(progress[minimum]),
                        "minimum_rpm": float(section.rpm.min()) if rpm is not None else None}}


def group_corner_patterns(rows: list[dict], confirmed_laps: list[int]) -> dict:
    """Ward clustering of observed profiles, with no timing labels or synthetic reference curves."""
    accepted = [row for row in rows if row["status"] == "candidate" and row["lap"] in confirmed_laps]
    base = {"status": "insufficient_confirmed_laps", "groups": [], "confirmed_laps": [r["lap"] for r in accepted],
            "most_common_group_ids": [], "fastest_observed_group_ids": [], "common_is_fastest": None,
            "confidence": "low", "synthetic_curve_generated": False, "silhouette": None,
            "method": "scipy_ward_normalized_distance_speed_rpm", "timing_used_for_clustering": False,
            "minimum_confirmed_laps": 4, "minimum_group_size": 2}
    if len(accepted) < 4:
        return base
    channels = ["speed"] + (["rpm"] if all(r["profile"]["rpm"] is not None for r in accepted) else [])
    features = []
    scales = {}
    for channel in channels:
        values = np.asarray([row["profile"][channel] for row in accepted])
        # Fixed floors are numerical regularizers, not claimed sensor noise bounds.
        scale = max(float(np.std(values)), 1.0 if channel == "speed" else 100.0)
        scales[channel] = scale
        features.append((values - np.mean(values, axis=0)) / scale / np.sqrt(values.shape[1]))
    x = np.concatenate(features, axis=1)
    distances = cdist(x, x)
    best_score, best_labels = -1.0, np.zeros(len(x), dtype=int)
    tree = linkage(x, method="ward")
    for k in range(2, min(3, len(x) // 2) + 1):
        labels = cut_tree(tree, n_clusters=k).ravel()
        if min(np.bincount(labels)) < 2:
            continue
        scores = []
        for i, label in enumerate(labels):
            own = np.flatnonzero(labels == label)
            a = float(np.mean(distances[i, own[own != i]]))
            b = min(float(np.mean(distances[i, labels == other])) for other in set(labels) if other != label)
            scores.append((b - a) / max(a, b) if max(a, b) > 0 else 0)
        score = float(np.mean(scores))
        if score > best_score:
            best_score, best_labels = score, labels
    separated = best_score >= .35 and float(np.max(distances)) >= .25
    labels = best_labels if separated else np.zeros(len(x), dtype=int)
    groups = []
    for label in sorted(set(labels)):
        indexes = np.flatnonzero(labels == label)
        members = [accepted[i] for i in indexes]
        medoid = int(indexes[np.argmin(distances[np.ix_(indexes, indexes)].sum(axis=1))])
        times = [r["elapsed_s"] for r in members]
        downstream = [r["downstream_s"] for r in members]
        groups.append({"id": int(label) + 1, "laps": [r["lap"] for r in members], "count": len(members),
                       "representative_lap": accepted[medoid]["lap"], "median_time_s": float(np.median(times)),
                       "time_range_s": [float(min(times)), float(max(times))],
                       "median_downstream_s": float(np.median(downstream)) if all(v is not None for v in downstream) else None,
                       "median_combined_s": float(np.median([t + d for t, d in zip(times, downstream)])) if all(v is not None for v in downstream) else None,
                       "metrics": {key: float(np.median([r["profile"]["metrics"][key] for r in members]))
                                   if all(r["profile"]["metrics"][key] is not None for r in members) else None
                                   for key in members[0]["profile"]["metrics"]}})
    common = [g["id"] for g in groups if g["count"] == max(g["count"] for g in groups)]
    fastest = [g["id"] for g in groups if abs(g["median_time_s"] - min(g["median_time_s"] for g in groups)) < 1e-6]
    return {**base, "status": "exploratory_groups" if separated else "no_clear_separation", "groups": groups,
            "channels": channels, "scales": scales, "silhouette": best_score if best_score >= -1 else None,
            "most_common_group_ids": common, "fastest_observed_group_ids": fastest,
            "common_is_fastest": common[0] == fastest[0] if separated and len(common) == len(fastest) == 1 else None}


def analyze_selected_corner(telemetry: pd.DataFrame, manifest: dict, *, source_lap: int,
                            start_session_s: float, end_session_s: float, confirmed_laps: list[int],
                            include_context: bool = False) -> dict:
    """Find directed spatial gate crossings across quality-gated real laps."""
    if not 4.9 <= end_session_s - start_session_s <= 5.1:
        raise ValueError("corner_selection_must_be_five_seconds")
    if not manifest.get("has_gps"):
        raise ValueError("corner_gps_unavailable")
    if manifest.get("channel_provenance", {}).get("speed", {}).get("source") != "gps_receiver":
        raise ValueError("corner_speed_provenance_unavailable")
    cleaned, gps_quality = clean_gps_points(telemetry)
    if cleaned.empty or "session_time_s" not in cleaned:
        raise ValueError("corner_gps_unavailable")
    quality = classify_lap_quality(manifest.get("lap_timing", []), cleaned)
    eligible = {row["lap"] for row in quality if row["analysis_eligible"]}
    if source_lap not in eligible:
        raise ValueError("corner_source_lap_not_eligible")
    source = cleaned[cleaned.lap == source_lap].reset_index(drop=True)
    context = None
    if include_context:
        from .review_context import review_context
        context = review_context(source, start_session_s, end_session_s)
        start_session_s, end_session_s = context["start_session_s"], context["end_session_s"]
    _section(source, start_session_s, end_session_s)
    entry, exit_gate = _gate(source, start_session_s), _gate(source, end_session_s)
    reference = source[["local_x_m", "local_y_m"]].to_numpy(float)
    downstream_gate = None
    downstream_distance = _value(source, end_session_s, "distance_m") + 50
    if downstream_distance < source.distance_m.iloc[-1]:
        downstream_time = float(np.interp(downstream_distance, source.distance_m, source.session_time_s))
        downstream_gate = _gate(source, downstream_time)
    rows = []
    for quality_row in quality:
        lap = int(quality_row["lap"])
        result = {"lap": lap, "status": "excluded", "reason": "lap_quality_gate", "quality": quality_row}
        if lap not in eligible:
            rows.append(result)
            continue
        if len(rows) >= 60:
            rows.append({**result, "reason": "session_review_limit"})
            continue
        frame = cleaned[cleaned.lap == lap].reset_index(drop=True)
        points = frame[["local_x_m", "local_y_m"]].to_numpy(float)
        registration = {"status": "accepted", "translation_m": [0., 0.], "method": "selected_real_lap"} if lap == source_lap else register_translation(points, reference, frame.distance_m.to_numpy(float), TrackAcceptance())
        result["registration"] = registration
        if registration["status"] != "accepted":
            rows.append({**result, "reason": "gps_registration_rejected"})
            continue
        aligned = points + registration["translation_m"]
        hits = [gate_crossings(aligned, frame.session_time_s.to_numpy(float), gate) for gate in (entry, exit_gate)]
        if any(len(h) != 1 for h in hits):
            rows.append({**result, "reason": "non_unique_or_missing_gate_crossing"})
            continue
        start, end = [h[0]["session_time_s"] for h in hits]
        if lap == source_lap:
            start, end = start_session_s, end_session_s
        if not 1 <= end - start <= 15:
            rows.append({**result, "reason": "gate_order_or_duration"})
            continue
        try:
            from .review_context import verify_section_path
            path_check = verify_section_path(reference[source.session_time_s.between(start_session_s, end_session_s)],
                                              aligned[frame.session_time_s.between(start, end)])
            section = _section(frame, start, end)
            profile = _profile(section)
        except ValueError as exc:
            rows.append({**result, "reason": str(exc)})
            continue
        downstream_s = None
        if downstream_gate:
            following = gate_crossings(aligned, frame.session_time_s.to_numpy(float), downstream_gate)
            if len(following) == 1 and 0 < following[0]["session_time_s"] - end < 15:
                try:
                    _section(frame, end, following[0]["session_time_s"])
                    downstream_s = following[0]["session_time_s"] - end
                except ValueError:
                    pass
        rows.append({**result, "status": "candidate", "reason": None, "start_session_s": start, "end_session_s": end,
                     "elapsed_s": end - start, "downstream_s": downstream_s, "profile": profile,
                     "start_distance_m": float(section.distance_m.iloc[0]), "end_distance_m": float(section.distance_m.iloc[-1]),
                     "sample_count": len(section), "path_check": path_check, "boundary_brackets_s": [h[0]["sample_bracket_s"] for h in hits],
                     "visual_confirmation_required": True})
    return {"version": 1, "source_lap": source_lap, "start_session_s": start_session_s, "end_session_s": end_session_s,
            "context": context,
            "gates": {"entry": entry.model_dump(), "exit": exit_gate.model_dump()}, "laps": rows, "gps_quality": gps_quality,
            "patterns": group_corner_patterns(rows, confirmed_laps), "synthetic_curve_generated": False,
            "evidence": {"measured": ["GPS position", "GPS speed", "RPM when available"],
                         "calculated": ["translation registration", "directed gate crossing times", "normalized-distance profiles"],
                         "inferred": ["exploratory driving-pattern groups"], "channel_provenance": manifest.get("channel_provenance", {})},
            "limitations": ["Video boundaries retain manual +/-0.5s uncertainty; visual similarity is not synchronization proof.",
                            "Timing is measured between the same inferred spatial gates, not fixed five-second clips.",
                            "Groups describe confirmed eligible laps in this session only; timing does not establish driving causality.",
                            "No sensor-noise bound, statistical significance, confirmed pedal inputs or guaranteed improvement is inferred."]}
