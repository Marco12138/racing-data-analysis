"""Cross-session real-lap comparison and conservative setup experiments."""

from __future__ import annotations

from dataclasses import dataclass
from statistics import median
from typing import Any

import numpy as np
import pandas as pd

from .corner_consensus import extract_corner_features
from .gps_processing import clean_gps_points, resample_lap_by_distance
from .lap_quality import build_lap_quality_summary, classify_lap_quality
from .rpm_analysis import detect_driver_actions
from .sector_zone_analysis import calculate_track_curvature, generate_auto_zones, zone_metrics
from .xrk_session_analysis import dataframe_records, evidence_catalog, json_safe


@dataclass
class PreparedSession:
    """Normalized temporary session plus its quality-gated analysis state."""

    manifest: dict[str, Any]
    telemetry: pd.DataFrame
    processed: pd.DataFrame
    quality: dict[str, Any]
    events: list[dict[str, Any]]
    gps_quality: dict[str, Any]
    lap_length_m: float | None


def compare_driver_laps(
    telemetry_a: pd.DataFrame,
    manifest_a: dict[str, Any],
    telemetry_b: pd.DataFrame,
    manifest_b: dict[str, Any],
    *,
    lap_a: int | None = None,
    lap_b: int | None = None,
    distance_step_m: float = 1.0,
    manual_zones: list[dict[str, Any]] | None = None,
    max_points: int = 5_000,
) -> dict[str, Any]:
    """Compare two real quality-gated laps from separate temporary sessions."""
    a = prepare_session(telemetry_a, manifest_a)
    b = prepare_session(telemetry_b, manifest_b)
    selected_a = select_real_lap(a, lap_a)
    selected_b = select_real_lap(b, lap_b)
    warnings = track_compatibility_warnings(a, b, reject_large_difference=True)
    response: dict[str, Any] = {
        "format": "cross_session_real_lap_comparison",
        "sessions": {
            "a": session_summary(a, selected_a),
            "b": session_summary(b, selected_b),
        },
        "lap_time_difference_s": round(
            lap_time_for(b, selected_b) - lap_time_for(a, selected_a), 6
        ),
        "comparison": [],
        "track": None,
        "zones": [],
        "evidence_catalog": merge_evidence(a, b),
        "warnings": warnings,
        "synthetic_curve_generated": False,
        "reference_policy": "real_completed_quality_gated_laps_only",
    }
    if a.processed.empty or b.processed.empty:
        response["warnings"].append(
            "GPS is unavailable in one or both sessions; distance-domain comparison was skipped."
        )
        response["report"] = comparison_report(response)
        return json_safe(response)

    frame_a = resample_lap_by_distance(
        a.processed[a.processed["lap"] == selected_a], distance_step_m
    )
    frame_b = resample_lap_by_distance(
        b.processed[b.processed["lap"] == selected_b], distance_step_m
    )
    if frame_a.empty or frame_b.empty:
        response["warnings"].append("The selected laps could not be resampled by distance.")
        response["report"] = comparison_report(response)
        return json_safe(response)
    aligned = align_two_sessions(frame_a, frame_b, max_points=max_points)
    zones = normalize_zones(manual_zones or [], float(aligned["distance_m"].max()))
    if not zones:
        zones = generate_auto_zones(frame_a[frame_a["distance_m"] <= aligned["distance_m"].max()])
    response.update(
        {
            "comparison": dataframe_records(aligned),
            "track": {
                "lap_length_a_m": round(float(frame_a["distance_m"].max()), 3),
                "lap_length_b_m": round(float(frame_b["distance_m"].max()), 3),
                "common_distance_m": round(float(aligned["distance_m"].max()), 3),
                "a": track_records(aligned, "a"),
                "b": track_records(aligned, "b"),
            },
            "zones": compare_zones(a, b, selected_a, selected_b, zones),
        }
    )
    response["report"] = comparison_report(response)
    return json_safe(response)


def analyze_setup_experiment(
    telemetry_baseline: pd.DataFrame,
    manifest_baseline: dict[str, Any],
    telemetry_modified: pd.DataFrame,
    manifest_modified: dict[str, Any],
    experiment: dict[str, Any],
    *,
    distance_step_m: float = 1.0,
    manual_zones: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Evaluate one setup change using real Top-3 laps from two sessions."""
    baseline = prepare_session(telemetry_baseline, manifest_baseline)
    modified = prepare_session(telemetry_modified, manifest_modified)
    ensure_same_driver_and_track(baseline, modified)
    warnings = track_compatibility_warnings(baseline, modified, reject_large_difference=True)
    baseline_laps = [int(row["lap"]) for row in baseline.quality["top_valid_laps"]]
    modified_laps = [int(row["lap"]) for row in modified.quality["top_valid_laps"]]
    if not baseline_laps or not modified_laps:
        raise ValueError("Both setup sessions need at least one lap that passes the Lap Quality Gate.")
    confounders = setup_confounders(experiment, baseline, modified)
    response: dict[str, Any] = {
        "format": "setup_experiment_real_lap_analysis",
        "experiment": experiment,
        "baseline": aggregate_session_summary(baseline, baseline_laps),
        "modified": aggregate_session_summary(modified, modified_laps),
        "zones": [],
        "measured": merge_evidence(baseline, modified)["measured"],
        "calculated": [
            "Lap Quality Gate",
            "Top valid-lap median and range",
            "Distance-aligned zone time",
            "Local gain, downstream cost, and net gain",
            "Repeatability score",
        ],
        "driver_feedback": experiment.get("driver_feedback", {}),
        "inferred": [],
        "confounders": confounders,
        "next_test": [],
        "warnings": warnings,
        "synthetic_curve_generated": False,
        "reference_policy": "real_completed_quality_gated_laps_only",
    }
    if baseline.processed.empty or modified.processed.empty:
        response["warnings"].append(
            "GPS is unavailable in one or both sessions; corner-level setup evidence was skipped."
        )
        response["next_test"] = knowledge_suggestions(experiment, [], confounders)
        response["report"] = setup_report(response)
        return json_safe(response)

    common_distance = min(
        float(baseline.processed[baseline.processed["lap"].isin(baseline_laps)]["distance_m"].max()),
        float(modified.processed[modified.processed["lap"].isin(modified_laps)]["distance_m"].max()),
    )
    baseline_reference = resample_lap_by_distance(
        baseline.processed[baseline.processed["lap"] == baseline_laps[0]],
        distance_step_m,
        max_distance_m=common_distance,
    )
    zones = normalize_zones(manual_zones or [], common_distance)
    if not zones:
        zones = generate_auto_zones(baseline_reference)
    response["zones"] = compare_setup_zones(
        baseline,
        modified,
        baseline_laps,
        modified_laps,
        zones,
        common_distance,
    )
    response["inferred"] = [
        {
            "zone": row["name"],
            "finding": (
                "The modified setup is associated with a repeatable positive net gain."
                if row["net_gain_s"] > 0 and row["repeatability_score"] >= 0.67
                else "The observed difference is not yet repeatable enough for a setup conclusion."
            ),
            "confidence": row["confidence"],
        }
        for row in response["zones"]
    ]
    response["next_test"] = knowledge_suggestions(
        experiment, response["zones"], confounders
    )
    response["report"] = setup_report(response)
    return json_safe(response)


def prepare_session(telemetry: pd.DataFrame, manifest: dict[str, Any]) -> PreparedSession:
    """Clean one session and build its real-lap quality and action evidence."""
    timing = manifest.get("lap_timing", [])
    cleaned, gps_quality = clean_gps_points(telemetry)
    processed = calculate_track_curvature(cleaned) if not cleaned.empty else pd.DataFrame()
    quality_source = processed if not processed.empty else telemetry
    quality = build_lap_quality_summary(
        classify_lap_quality(timing, quality_source), quality_source
    )
    events: list[dict[str, Any]] = []
    if not processed.empty:
        processed, events, _ = detect_driver_actions(processed)
    lap_length = (
        float(processed.groupby("lap")["distance_m"].max().median())
        if not processed.empty
        else None
    )
    return PreparedSession(
        manifest=manifest,
        telemetry=telemetry,
        processed=processed,
        quality=quality,
        events=events,
        gps_quality=gps_quality,
        lap_length_m=lap_length,
    )


def select_real_lap(session: PreparedSession, requested: int | None) -> int:
    eligible = [int(row["lap"]) for row in session.quality["top_valid_laps"]]
    if not eligible:
        raise ValueError("No lap passed the Lap Quality Gate in this session.")
    if requested is None:
        return eligible[0]
    if requested not in eligible:
        raise ValueError(f"Lap {requested} did not pass the Lap Quality Gate.")
    return requested


def align_two_sessions(a: pd.DataFrame, b: pd.DataFrame, *, max_points: int) -> pd.DataFrame:
    length = min(len(a), len(b))
    a = a.iloc[:length].reset_index(drop=True)
    b = b.iloc[:length].reset_index(drop=True)
    aligned = pd.DataFrame({"distance_m": a["distance_m"]})
    channels = [
        "lap_time_s", "session_time_s", "speed", "rpm", "longitudinal_g",
        "lateral_g", "gps_lat", "gps_lon", "local_x_m", "local_y_m",
    ]
    for channel in channels:
        if channel in a:
            aligned[f"a_{channel}"] = a[channel]
        if channel in b:
            aligned[f"b_{channel}"] = b[channel]
        if channel in a and channel in b and channel not in {"gps_lat", "gps_lon", "local_x_m", "local_y_m"}:
            aligned[f"difference_{channel}"] = b[channel] - a[channel]
    if {"a_lap_time_s", "b_lap_time_s"}.issubset(aligned):
        aligned["cumulative_time_delta_s"] = aligned["b_lap_time_s"] - aligned["a_lap_time_s"]
    if len(aligned) > max_points:
        indexes = np.unique(np.linspace(0, len(aligned) - 1, max_points, dtype=int))
        aligned = aligned.iloc[indexes].reset_index(drop=True)
    return aligned


def compare_zones(
    a: PreparedSession,
    b: PreparedSession,
    lap_a: int,
    lap_b: int,
    zones: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    output = []
    for zone in zones:
        entry = float(zone["entry_distance_m"])
        exit_distance = float(zone["exit_distance_m"])
        metrics_a = zone_metrics(a.processed, a.events, lap_a, entry, exit_distance)
        metrics_b = zone_metrics(b.processed, b.events, lap_b, entry, exit_distance)
        time_a = metrics_a.get("elapsed_time_s")
        time_b = metrics_b.get("elapsed_time_s")
        output.append({
            **zone,
            "a": metrics_a,
            "b": metrics_b,
            "time_difference_s": round(time_b - time_a, 3)
            if time_a is not None and time_b is not None else None,
        })
    return output


def compare_setup_zones(
    baseline: PreparedSession,
    modified: PreparedSession,
    baseline_laps: list[int],
    modified_laps: list[int],
    zones: list[dict[str, Any]],
    common_distance: float,
) -> list[dict[str, Any]]:
    output = []
    for index, zone in enumerate(zones):
        downstream_end = (
            float(zones[index + 1]["entry_distance_m"])
            if index + 1 < len(zones) else common_distance
        )
        baseline_features = features_for_laps(
            baseline.processed, baseline_laps, zone, downstream_end
        )
        modified_features = features_for_laps(
            modified.processed, modified_laps, zone, downstream_end
        )
        if not baseline_features or not modified_features:
            continue
        baseline_stats = aggregate_features(baseline_features)
        modified_stats = aggregate_features(modified_features)
        local_gain = (baseline_stats.get("elapsed_time_s") or 0.0) - (modified_stats.get("elapsed_time_s") or 0.0)
        downstream_cost = max(
            0.0,
            (modified_stats.get("downstream_elapsed_s") or 0.0)
            - (baseline_stats.get("downstream_elapsed_s") or 0.0),
        )
        baseline_median = baseline_stats.get("elapsed_time_s")
        repeatability = (
            sum(
                1 for feature in modified_features
                if baseline_median is not None
                and feature.get("elapsed_time_s") is not None
                and feature["elapsed_time_s"] < baseline_median
            ) / len(modified_features)
        )
        confidence = setup_confidence(
            len(baseline_features), len(modified_features), repeatability
        )
        output.append({
            "id": zone.get("id", f"zone-{index + 1}"),
            "name": zone.get("name", f"Zone {index + 1}"),
            "entry_distance_m": zone["entry_distance_m"],
            "exit_distance_m": zone["exit_distance_m"],
            "baseline_top3": baseline_stats,
            "modified_top3": modified_stats,
            "source_laps": {"baseline": baseline_laps, "modified": modified_laps},
            "local_gain_s": round(local_gain, 3),
            "downstream_cost_s": round(downstream_cost, 3),
            "net_gain_s": round(local_gain - downstream_cost, 3),
            "repeatability_score": round(repeatability, 3),
            "confidence": confidence,
            "evidence": sorted(set(
                channel for feature in baseline_features + modified_features
                for channel in feature.get("evidence_channels", [])
            )),
        })
    return output


def features_for_laps(
    telemetry: pd.DataFrame,
    laps: list[int],
    zone: dict[str, Any],
    downstream_end: float,
) -> list[dict[str, Any]]:
    features = []
    for lap in laps:
        frame = telemetry[telemetry["lap"] == lap]
        feature = extract_corner_features(frame, zone, downstream_end)
        if feature:
            features.append(feature)
    return features


def aggregate_features(features: list[dict[str, Any]]) -> dict[str, Any]:
    keys = [
        "elapsed_time_s", "downstream_elapsed_s", "entry_speed_kmh",
        "minimum_speed_kmh", "minimum_rpm", "lift_distance_m",
        "reacceleration_distance_m", "exit_speed_kmh",
    ]
    result: dict[str, Any] = {"lap_count": len(features)}
    for key in keys:
        values = [float(row[key]) for row in features if row.get(key) is not None]
        result[key] = round(float(median(values)), 3) if values else None
        if key == "elapsed_time_s" and values:
            result["elapsed_time_range_s"] = round(max(values) - min(values), 3)
    return result


def aggregate_session_summary(session: PreparedSession, laps: list[int]) -> dict[str, Any]:
    times = [lap_time_for(session, lap) for lap in laps]
    return {
        "inspection_id": session.manifest.get("inspection_id"),
        "metadata": session.manifest.get("metadata", {}),
        "top_valid_laps": session.quality["top_valid_laps"],
        "lap_count": len(laps),
        "median_lap_time_s": round(float(median(times)), 6),
        "lap_time_range_s": round(max(times) - min(times), 6),
        "lap_quality": session.quality,
    }


def session_summary(session: PreparedSession, lap: int) -> dict[str, Any]:
    return {
        "inspection_id": session.manifest.get("inspection_id"),
        "metadata": session.manifest.get("metadata", {}),
        "selected_lap": lap,
        "selected_lap_time_s": lap_time_for(session, lap),
        "lap_quality": session.quality,
        "gps_quality": session.gps_quality,
        "available_channels": session.manifest.get("available_canonical_channels", []),
    }


def lap_time_for(session: PreparedSession, lap: int) -> float:
    for row in session.manifest.get("lap_timing", []):
        if int(row.get("lap", -1)) == lap:
            return float(row["duration_s"])
    raise ValueError(f"Lap {lap} has no logger timing.")


def track_compatibility_warnings(
    a: PreparedSession,
    b: PreparedSession,
    *,
    reject_large_difference: bool,
) -> list[str]:
    warnings: list[str] = []
    track_a = metadata_value(a.manifest, "Venue")
    track_b = metadata_value(b.manifest, "Venue")
    if track_a and track_b and normalize_text(track_a) != normalize_text(track_b):
        raise ValueError("The selected sessions identify different tracks.")
    if a.lap_length_m and b.lap_length_m:
        difference = abs(a.lap_length_m - b.lap_length_m) / max(a.lap_length_m, b.lap_length_m)
        if reject_large_difference and difference > 0.10:
            raise ValueError("The selected sessions differ in median lap length by more than 10%.")
        if difference > 0.03:
            warnings.append(
                f"Median lap lengths differ by {difference * 100:.1f}%; distance comparisons have reduced confidence."
            )
    if not track_a or not track_b:
        warnings.append("Track metadata is incomplete; same-track compatibility is inferred from GPS length.")
    return warnings


def ensure_same_driver_and_track(a: PreparedSession, b: PreparedSession) -> None:
    driver_a = metadata_value(a.manifest, "Driver")
    driver_b = metadata_value(b.manifest, "Driver")
    if not driver_a or not driver_b or normalize_text(driver_a) != normalize_text(driver_b):
        raise ValueError(
            "Setup experiments require the same identified driver in both sessions; use Driver Comparison instead."
        )
    track_compatibility_warnings(a, b, reject_large_difference=True)


def setup_confounders(
    experiment: dict[str, Any], baseline: PreparedSession, modified: PreparedSession
) -> list[str]:
    confounders = []
    if experiment.get("secondary_changes"):
        confounders.append("Multiple setup changes were recorded, so causal confidence is reduced.")
    conditions = experiment.get("conditions", {})
    for field, label in [
        ("tire_model", "tire model"),
        ("ambient_temperature_c", "ambient temperature"),
        ("track_condition", "track condition"),
    ]:
        if conditions.get(field) in (None, "", "unknown"):
            confounders.append(f"The {label} was not controlled or recorded.")
    if not baseline.quality.get("minimum_top_laps_met") or not modified.quality.get("minimum_top_laps_met"):
        confounders.append("One or both sessions have fewer than three reference-eligible laps.")
    return confounders


def knowledge_suggestions(
    experiment: dict[str, Any], zones: list[dict[str, Any]], confounders: list[str]
) -> list[dict[str, Any]]:
    category = str(experiment.get("primary_change", {}).get("category", "other"))
    registry = {
        "tire_pressure": "Repeat the same pressure change while recording cold and hot pressures for all four tyres.",
        "track_width": "Repeat the track-width change alone and check entry response plus downstream exit speed.",
        "caster": "Repeat the caster change alone and prioritize entry behavior and steering sensitivity evidence.",
        "camber": "Repeat the camber change with tyre-temperature or wear evidence across the tread.",
        "toe": "Repeat the toe change while checking turn-in response and straight-line speed cost.",
        "axle": "Repeat the axle change in comparable grip conditions and inspect exit behavior and hopping evidence.",
        "hub_length": "Repeat the hub-length change and validate exit speed without a downstream stability cost.",
        "ride_height": "Repeat the ride-height change alone and record track grip and driver feedback.",
        "seat_strut": "Repeat the seat-strut change alone and compare rear support through corner exit.",
        "other": "Repeat the primary change in comparable conditions before treating it as transferable.",
    }
    positive = sorted(
        (zone for zone in zones if zone.get("net_gain_s", 0) > 0),
        key=lambda row: row["net_gain_s"],
        reverse=True,
    )
    suggestions = [{
        "priority": 1,
        "candidate": registry.get(category, registry["other"]),
        "basis": (
            f"Best observed repeatable zone: {positive[0]['name']} ({positive[0]['net_gain_s']:+.3f}s net)."
            if positive else "No repeatable positive zone gain has been established."
        ),
        "confidence": "medium" if positive and not confounders else "low",
    }]
    if confounders:
        suggestions.append({
            "priority": 2,
            "candidate": "Control the missing conditions or remove simultaneous setup changes in the next test.",
            "basis": confounders[0],
            "confidence": "high",
        })
    return suggestions[:3]


def normalize_zones(zones: list[dict[str, Any]], lap_length: float) -> list[dict[str, Any]]:
    output = []
    for index, zone in enumerate(zones, start=1):
        entry = float(zone["entry_distance_m"])
        exit_distance = float(zone["exit_distance_m"])
        if 0 <= entry < exit_distance <= lap_length:
            output.append({
                "id": str(zone.get("id") or f"manual-zone-{index}"),
                "name": str(zone.get("name") or f"Manual Zone {index}")[:80],
                "entry_distance_m": round(entry, 3),
                "exit_distance_m": round(exit_distance, 3),
                "source": "manual",
            })
    return output


def track_records(aligned: pd.DataFrame, prefix: str) -> list[dict[str, Any]]:
    mapping = {
        "distance_m": "distance_m",
        "lap_time_s": f"{prefix}_lap_time_s",
        "local_x_m": f"{prefix}_local_x_m",
        "local_y_m": f"{prefix}_local_y_m",
        "speed": f"{prefix}_speed",
        "rpm": f"{prefix}_rpm",
    }
    frame = pd.DataFrame()
    for target, source in mapping.items():
        if source in aligned:
            frame[target] = aligned[source]
    return dataframe_records(frame)


def merge_evidence(a: PreparedSession, b: PreparedSession) -> dict[str, list[str]]:
    first = evidence_catalog(a.manifest)
    second = evidence_catalog(b.manifest)
    return {
        key: sorted(set(first.get(key, []) + second.get(key, [])))
        for key in {"measured", "calculated", "inferred"}
    }


def metadata_value(session: dict[str, Any], key: str) -> str:
    value = session.get("metadata", {}).get(key)
    return str(value).strip() if value not in (None, "") else ""


def normalize_text(value: str) -> str:
    return "".join(character.lower() for character in value if character.isalnum())


def setup_confidence(baseline_count: int, modified_count: int, repeatability: float) -> str:
    if baseline_count >= 3 and modified_count >= 3 and repeatability >= 0.99:
        return "high"
    if baseline_count >= 2 and modified_count >= 2 and repeatability >= 0.5:
        return "medium"
    return "low"


def comparison_report(result: dict[str, Any]) -> str:
    a = result["sessions"]["a"]
    b = result["sessions"]["b"]
    lines = [
        "Driver Comparison",
        "",
        "Measured",
        f"- A Lap {a['selected_lap']}: {a['selected_lap_time_s']:.3f}s.",
        f"- B Lap {b['selected_lap']}: {b['selected_lap_time_s']:.3f}s.",
        "",
        "Calculated",
        f"- B minus A lap-time difference: {result['lap_time_difference_s']:+.3f}s.",
        "- Available curves are aligned by cumulative track distance.",
        "",
        "Inferred",
        "- Corner observations are conservative comparisons, not setup or vehicle-dynamics diagnoses.",
        "",
        "Reference policy",
        "- Both references are real completed laps that passed the Lap Quality Gate.",
        "- No stitched target lap or synthetic RPM trace is generated.",
    ]
    return "\n".join(lines)


def setup_report(result: dict[str, Any]) -> str:
    lines = [
        "Setup Experiment",
        "",
        "Measured",
        "- " + ", ".join(result["measured"]) if result["measured"] else "- No direct telemetry channels were available.",
        "",
        "Calculated",
        f"- Baseline Top-{result['baseline']['lap_count']} median: {result['baseline']['median_lap_time_s']:.3f}s.",
        f"- Modified Top-{result['modified']['lap_count']} median: {result['modified']['median_lap_time_s']:.3f}s.",
        "",
        "Driver Feedback",
    ]
    feedback = result.get("driver_feedback", {})
    lines.extend(
        f"- {key.replace('_', ' ').title()}: {value}"
        for key, value in feedback.items() if value
    )
    if not any(feedback.values()):
        lines.append("- No driver feedback was recorded.")
    lines.extend(["", "Inferred"])
    for item in result.get("inferred", [])[:3]:
        lines.append(f"- {item['zone']}: {item['finding']} ({item['confidence']}).")
    if not result.get("inferred"):
        lines.append("- Corner-level setup influence is unavailable or not repeatable.")
    lines.extend(["", "Confounders"])
    lines.extend(f"- {item}" for item in result.get("confounders", []))
    if not result.get("confounders"):
        lines.append("- No declared confounder was identified; uncontrolled factors may still exist.")
    lines.extend(["", "Next Test"])
    lines.extend(f"- {item['candidate']}" for item in result.get("next_test", [])[:3])
    lines.extend([
        "",
        "Reference policy",
        "- Every benchmark is a real completed lap that passed the Lap Quality Gate.",
        "- Association does not establish mechanical causation.",
        "- No stitched target lap or synthetic RPM trace is generated.",
    ])
    return "\n".join(lines)
