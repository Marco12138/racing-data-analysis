"""Build real-lap corner benchmarks without constructing a synthetic lap."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


DEFAULT_CONSENSUS_CONFIG: dict[str, float] = {
    "feature_similarity_threshold": 0.60,
    "minimum_repeat_count": 2.0,
    "maximum_downstream_cost_s": 0.02,
    "minimum_net_gain_s": 0.01,
    "distance_tolerance_m": 10.0,
    "rpm_tolerance_pct": 4.0,
    "speed_tolerance_kmh": 2.5,
}


def extract_corner_features(
    lap_df: pd.DataFrame,
    corner_zone: dict[str, Any],
    downstream_end_distance: float | None = None,
) -> dict[str, Any]:
    """Extract measured and calculated features for one real lap and zone."""
    ordered = lap_df.sort_values("distance_m").drop_duplicates("distance_m", keep="last")
    entry = float(corner_zone["entry_distance_m"])
    exit_distance = float(corner_zone["exit_distance_m"])
    if downstream_end_distance is None:
        downstream_end_distance = min(
            float(ordered["distance_m"].max()), exit_distance + 100.0
        )
    zone = ordered[ordered["distance_m"].between(entry, exit_distance)]
    if len(zone) < 3:
        return {}

    time_column = "lap_time_s"
    rpm_column = "rpm_smoothed" if "rpm_smoothed" in zone else "rpm"
    distance = ordered["distance_m"].to_numpy(dtype=float)
    lap_time = ordered[time_column].to_numpy(dtype=float)
    entry_time = _interpolate(distance, lap_time, entry)
    exit_time = _interpolate(distance, lap_time, exit_distance)
    downstream_time = _interpolate(distance, lap_time, downstream_end_distance)

    rpm_slope = _numeric(zone, "rpm_slope")
    speed_slope = _numeric(zone, "speed_slope")
    lift_distance = None
    if len(rpm_slope):
        threshold = float(np.nanquantile(rpm_slope, 0.20))
        candidates = zone.loc[rpm_slope.index][rpm_slope <= threshold]
        if len(candidates):
            lift_distance = float(candidates["distance_m"].iloc[0])

    minimum_rpm = _finite_min(zone, rpm_column)
    minimum_rpm_distance = None
    if rpm_column in zone and pd.to_numeric(zone[rpm_column], errors="coerce").notna().any():
        minimum_index = pd.to_numeric(zone[rpm_column], errors="coerce").idxmin()
        minimum_rpm_distance = float(zone.loc[minimum_index, "distance_m"])

    recovery_distance = None
    if len(rpm_slope) and minimum_rpm_distance is not None:
        post_minimum = zone[zone["distance_m"] >= minimum_rpm_distance]
        positive_threshold = max(0.0, float(np.nanquantile(rpm_slope, 0.65)))
        recovery = post_minimum[
            pd.to_numeric(post_minimum["rpm_slope"], errors="coerce")
            >= positive_threshold
        ]
        if "speed_slope" in recovery:
            recovery = recovery[
                pd.to_numeric(recovery["speed_slope"], errors="coerce") >= 0
            ]
        if len(recovery):
            recovery_distance = float(recovery["distance_m"].iloc[0])

    evidence_channels = [
        channel
        for channel in ("rpm", "speed", "gps_lat", "gps_lon", "longitudinal_g", "lateral_g")
        if channel in zone and pd.to_numeric(zone[channel], errors="coerce").notna().any()
    ]
    return {
        "lap": int(zone["lap"].iloc[0]),
        "entry_distance_m": round(entry, 3),
        "exit_distance_m": round(exit_distance, 3),
        "downstream_end_distance_m": round(float(downstream_end_distance), 3),
        "elapsed_time_s": _round_or_none(exit_time - entry_time),
        "downstream_elapsed_s": _round_or_none(downstream_time - exit_time),
        "entry_speed_kmh": _interpolated_column(ordered, "speed", entry),
        "minimum_speed_kmh": _finite_min(zone, "speed"),
        "minimum_rpm": minimum_rpm,
        "minimum_rpm_distance_m": _round_or_none(minimum_rpm_distance),
        "lift_distance_m": _round_or_none(lift_distance),
        "reacceleration_distance_m": _round_or_none(recovery_distance),
        "exit_speed_kmh": _interpolated_column(ordered, "speed", exit_distance),
        "exit_rpm": _interpolated_column(ordered, rpm_column, exit_distance),
        "maximum_deceleration": _finite_min(zone, "longitudinal_g"),
        "rpm_slope_median": _finite_median(zone, "rpm_slope"),
        "speed_slope_median": _finite_median(zone, "speed_slope"),
        "evidence_channels": evidence_channels,
    }


def build_top3_consensus_benchmark(
    aligned_laps: dict[int, pd.DataFrame],
    corner_zones: list[dict[str, Any]],
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compare up to three quality-gated real laps and summarize repeated patterns."""
    settings = {**DEFAULT_CONSENSUS_CONFIG, **(config or {})}
    lap_order = [
        int(lap)
        for lap in settings.get("lap_order", aligned_laps.keys())
        if int(lap) in aligned_laps
    ][:3]
    lap_times = {
        int(lap): float(value)
        for lap, value in settings.get("lap_times", {}).items()
    }
    corners: list[dict[str, Any]] = []
    lap_length = min(
        (
            float(frame["distance_m"].max())
            for frame in aligned_laps.values()
            if not frame.empty
        ),
        default=0.0,
    )

    for index, zone in enumerate(corner_zones):
        next_entry = (
            float(corner_zones[index + 1]["entry_distance_m"])
            if index + 1 < len(corner_zones)
            else lap_length
        )
        downstream_end = min(
            lap_length,
            max(float(zone["exit_distance_m"]), next_entry),
        )
        features = [
            extract_corner_features(aligned_laps[lap], zone, downstream_end)
            for lap in lap_order
        ]
        features = [feature for feature in features if feature]
        if not features:
            continue

        fastest = features[0]
        peers = features[1:]
        similarities = [
            _feature_similarity(fastest, feature, settings)
            for feature in features
        ]
        supporting_laps = [
            feature["lap"]
            for feature, similarity in zip(features, similarities)
            if similarity >= settings["feature_similarity_threshold"]
        ]
        repeatability = float(np.mean(similarities)) if similarities else 0.0
        local_gain = _gain_against_peers(fastest, peers, "elapsed_time_s")
        downstream_cost = max(
            0.0,
            _cost_against_peers(fastest, peers, "downstream_elapsed_s"),
        )
        net_gain = local_gain - downstream_cost
        common_pattern = _common_fast_pattern(features, settings)
        unique_features = _fastest_unique_features(fastest, peers, settings)
        evidence_channels = sorted(
            {
                channel
                for feature in features
                for channel in feature["evidence_channels"]
            }
        )
        transferable = bool(
            len(supporting_laps) >= int(settings["minimum_repeat_count"])
            and net_gain >= settings["minimum_net_gain_s"]
            and downstream_cost <= settings["maximum_downstream_cost_s"]
            and len(evidence_channels) >= 2
        )
        confidence = (
            "high"
            if len(supporting_laps) == 3 and len(evidence_channels) >= 3
            else "medium"
            if len(supporting_laps) >= 2 and len(evidence_channels) >= 2
            else "low"
        )
        corners.append(
            {
                "corner_id": str(zone.get("id") or f"zone-{index + 1}"),
                "corner": str(zone.get("name") or f"Zone {index + 1}"),
                "entry_distance_m": round(float(zone["entry_distance_m"]), 3),
                "exit_distance_m": round(float(zone["exit_distance_m"]), 3),
                "downstream_end_distance_m": round(downstream_end, 3),
                "source_laps": [feature["lap"] for feature in features],
                "common_fast_pattern": common_pattern,
                "fastest_lap_unique_features": unique_features,
                "repeatability_score": round(repeatability, 3),
                "occurrence_count": len(supporting_laps),
                "supporting_laps": supporting_laps,
                "local_gain": round(local_gain, 3),
                "downstream_cost": round(downstream_cost, 3),
                "net_gain": round(net_gain, 3),
                "transferable_improvement": transferable,
                "evidence": {
                    "features_by_lap": features,
                    "channels": evidence_channels,
                    "similarity_by_lap": {
                        str(feature["lap"]): round(similarity, 3)
                        for feature, similarity in zip(features, similarities)
                    },
                    "lap_times": {
                        str(feature["lap"]): lap_times.get(feature["lap"])
                        for feature in features
                    },
                    "provenance": "real_completed_reference_eligible_laps",
                },
                "confidence": confidence,
            }
        )

    return {
        "reference_policy": "real_completed_reference_eligible_laps_only",
        "lap_order": lap_order,
        "lap_count": len(lap_order),
        "synthetic_curve_generated": False,
        "corners": corners,
    }


def estimate_achievable_improvement_range(
    top_laps: list[dict[str, Any]],
    validated_corner_improvements: list[dict[str, Any]],
) -> dict[str, Any]:
    """Estimate a conservative empirical range from compatible repeated real patterns."""
    candidates = [
        item
        for item in validated_corner_improvements
        if item.get("transferable_improvement")
        and float(item.get("net_gain", 0.0)) > 0
        and float(item.get("downstream_cost", 0.0)) <= 0.02
        and (
            int(item.get("occurrence_count", 0)) >= 2
            or bool(item.get("coach_confirmed"))
        )
    ]
    selected: list[dict[str, Any]] = []
    for candidate in sorted(candidates, key=lambda item: float(item["net_gain"]), reverse=True):
        if any(_zones_conflict(candidate, existing) for existing in selected):
            continue
        selected.append(candidate)

    if not selected:
        return {
            "minimum_improvement_s": 0.0,
            "maximum_improvement_s": 0.0,
            "confidence": "low",
            "basis": [],
            "source_laps": [int(row["lap"]) for row in top_laps[:3]],
            "limitations": [
                "No repeated, downstream-safe real-lap pattern passed validation."
            ],
        }

    gains = [float(item["net_gain"]) for item in selected]
    strongest = max(gains)
    minimum = strongest * 0.50
    maximum = min(sum(gains) * 0.70, strongest * 1.75)
    confidence = (
        "high"
        if len(selected) >= 2
        and all(item.get("confidence") == "high" for item in selected)
        else "medium"
    )
    return {
        "minimum_improvement_s": round(minimum, 3),
        "maximum_improvement_s": round(max(minimum, maximum), 3),
        "confidence": confidence,
        "basis": [
            f"{item['common_fast_pattern'][0]} at {item['corner']}"
            if item.get("common_fast_pattern")
            else f"Repeated net-positive real-lap pattern at {item['corner']}"
            for item in selected
        ],
        "source_laps": [int(row["lap"]) for row in top_laps[:3]],
        "limitations": [
            "This is an empirical conservative range, not a target lap time.",
            "The selected improvements are not guaranteed to coexist in one lap.",
        ],
    }


def build_ai_coach_summary(
    top_laps: list[dict[str, Any]],
    consensus: dict[str, Any],
    achievable_range: dict[str, Any],
    *,
    direct_brake_available: bool,
) -> dict[str, Any]:
    """Turn structured real-lap evidence into a conservative coach summary."""
    corners = consensus.get("corners", [])
    transferable = sorted(
        (corner for corner in corners if corner["transferable_improvement"]),
        key=lambda corner: corner["net_gain"],
        reverse=True,
    )
    emerging = [
        corner
        for corner in corners
        if corner["net_gain"] > 0 and not corner["transferable_improvement"]
    ]
    rejected = [
        corner
        for corner in corners
        if corner["local_gain"] > 0
        and (corner["net_gain"] <= 0 or corner["downstream_cost"] > 0.02)
    ]
    common_patterns = [
        {
            "corner": corner["corner"],
            "patterns": corner["common_fast_pattern"],
            "repeatability_score": corner["repeatability_score"],
            "confidence": corner["confidence"],
        }
        for corner in corners
        if corner["common_fast_pattern"]
    ]
    priorities = [
        _training_priority(corner, direct_brake_available)
        for corner in transferable[:3]
    ]
    strengths = [
        {
            "corner": corner["corner"],
            "finding": corner["common_fast_pattern"][0],
            "evidence": corner["evidence"]["features_by_lap"],
        }
        for corner in corners
        if corner["repeatability_score"] >= 0.75
        and corner["common_fast_pattern"]
    ][:3]
    return {
        "reference_statement": (
            "All benchmarks come from real, completed laps that passed the Lap Quality Gate."
        ),
        "top_valid_laps": top_laps[:3],
        "common_fast_patterns": common_patterns,
        "fastest_lap_net_differences": [
            {
                "corner": corner["corner"],
                "local_gain_s": corner["local_gain"],
                "downstream_cost_s": corner["downstream_cost"],
                "net_gain_s": corner["net_gain"],
                "confidence": corner["confidence"],
            }
            for corner in corners
            if corner["net_gain"] > 0
        ],
        "fastest_lap_unique_features": [
            {
                "corner": corner["corner"],
                "features": corner.get("fastest_lap_unique_features", []),
                "transferable_improvement": False,
                "confidence": corner["confidence"],
                "reason": (
                    "This behavior appears as a fastest-lap difference but has not "
                    "shown enough repeatability to become a training reference."
                ),
            }
            for corner in corners
            if corner.get("fastest_lap_unique_features")
        ],
        "emerging_improvements": [
            {
                "corner": corner["corner"],
                "reason": "A real-lap gain exists, but it has not repeated enough to train as a stable pattern.",
                "supporting_laps": corner["supporting_laps"],
                "confidence": corner["confidence"],
            }
            for corner in emerging[:3]
        ],
        "rejected_apparent_improvements": [
            {
                "corner": corner["corner"],
                "local_gain_s": corner["local_gain"],
                "downstream_cost_s": corner["downstream_cost"],
                "net_gain_s": corner["net_gain"],
                "reason": "The local gain is offset by downstream cost or a non-positive net result.",
            }
            for corner in rejected[:3]
        ],
        "training_priorities": priorities,
        "stable_strengths": strengths,
        "achievable_improvement_range": achievable_range,
        "limitations": [
            "No synthetic target lap or synthetic RPM curve is produced.",
            "The improvement range is empirical and conservative.",
            "Not every validated improvement is guaranteed to coexist in one lap.",
            *(
                []
                if direct_brake_available
                else [
                    "No direct brake channel is present; braking remains an inference and cannot be confirmed."
                ]
            ),
        ],
    }


def _training_priority(
    corner: dict[str, Any],
    direct_brake_available: bool,
) -> dict[str, Any]:
    features = corner["evidence"]["features_by_lap"]
    recoveries = [
        feature["reacceleration_distance_m"]
        for feature in features
        if feature.get("reacceleration_distance_m") is not None
    ]
    target = round(float(np.median(recoveries)), 1) if recoveries else None
    what_to_test = (
        f"Test a sustained RPM recovery near {target:.1f} m while keeping the preceding "
        "preparation unchanged."
        if target is not None
        else "Repeat the measured fast-lap exit pattern without changing more than one input."
    )
    return {
        "corner": corner["corner"],
        "why": (
            f"The pattern appears in {corner['occurrence_count']} eligible laps and retains "
            f"a {corner['net_gain']:.3f}s net gain after downstream cost."
        ),
        "what_to_test": what_to_test,
        "training_drill": (
            "Run three consecutive laps changing only the recovery phase, then compare the "
            "delta at corner exit and at the downstream endpoint."
        ),
        "success_criteria": [
            "The behavior appears in at least two of three comparable laps.",
            "The time advantage remains positive at the downstream endpoint.",
            "No secondary RPM drop or exit-speed loss is introduced.",
        ],
        "stop_condition": (
            "Stop the experiment if the earlier recovery creates a secondary RPM drop, "
            "trajectory instability, or a downstream time loss."
        ),
        "evidence": corner["evidence"],
        "confidence": corner["confidence"],
        "limitation": (
            None
            if direct_brake_available
            else "Brake application cannot be confirmed without a direct brake channel."
        ),
    }


def _feature_similarity(
    first: dict[str, Any],
    second: dict[str, Any],
    settings: dict[str, Any],
) -> float:
    comparisons: list[float] = []
    for key in ("lift_distance_m", "reacceleration_distance_m"):
        if first.get(key) is not None and second.get(key) is not None:
            comparisons.append(
                max(
                    0.0,
                    1.0
                    - abs(float(first[key]) - float(second[key]))
                    / settings["distance_tolerance_m"],
                )
            )
    if first.get("minimum_rpm") and second.get("minimum_rpm"):
        baseline = max(abs(float(first["minimum_rpm"])), 1.0)
        comparisons.append(
            max(
                0.0,
                1.0
                - abs(float(first["minimum_rpm"]) - float(second["minimum_rpm"]))
                / (baseline * settings["rpm_tolerance_pct"] / 100.0),
            )
        )
    if first.get("exit_speed_kmh") is not None and second.get("exit_speed_kmh") is not None:
        comparisons.append(
            max(
                0.0,
                1.0
                - abs(float(first["exit_speed_kmh"]) - float(second["exit_speed_kmh"]))
                / settings["speed_tolerance_kmh"],
            )
        )
    return float(np.mean(comparisons)) if comparisons else 0.0


def _common_fast_pattern(
    features: list[dict[str, Any]],
    settings: dict[str, Any],
) -> list[str]:
    patterns: list[str] = []
    for key, label, tolerance in [
        ("lift_distance_m", "Lift position repeats near", settings["distance_tolerance_m"]),
        (
            "reacceleration_distance_m",
            "Sustained RPM recovery repeats near",
            settings["distance_tolerance_m"],
        ),
    ]:
        values = [float(item[key]) for item in features if item.get(key) is not None]
        if len(values) >= 2 and np.ptp(values) <= tolerance:
            patterns.append(f"{label} {np.median(values):.1f} m")
    rpm = [float(item["minimum_rpm"]) for item in features if item.get("minimum_rpm")]
    if len(rpm) >= 2 and np.ptp(rpm) / max(np.mean(rpm), 1.0) <= 0.04:
        patterns.append(f"Minimum RPM remains repeatable near {np.median(rpm):.0f} rpm")
    speed = [
        float(item["exit_speed_kmh"])
        for item in features
        if item.get("exit_speed_kmh") is not None
    ]
    if len(speed) >= 2 and np.ptp(speed) <= settings["speed_tolerance_kmh"]:
        patterns.append(f"Exit speed repeats near {np.median(speed):.1f} km/h")
    return patterns


def _fastest_unique_features(
    fastest: dict[str, Any],
    peers: list[dict[str, Any]],
    settings: dict[str, Any],
) -> list[str]:
    if not peers:
        return []
    features: list[str] = []
    for key, label in [
        ("lift_distance_m", "lift position"),
        ("reacceleration_distance_m", "RPM recovery"),
    ]:
        peer_values = [float(item[key]) for item in peers if item.get(key) is not None]
        if fastest.get(key) is not None and peer_values:
            difference = float(fastest[key]) - float(np.median(peer_values))
            if abs(difference) > settings["distance_tolerance_m"]:
                features.append(f"Fastest-lap {label} differs by {difference:+.1f} m")
    peer_rpm = [float(item["minimum_rpm"]) for item in peers if item.get("minimum_rpm")]
    if fastest.get("minimum_rpm") and peer_rpm:
        difference = float(fastest["minimum_rpm"]) - float(np.median(peer_rpm))
        if abs(difference) > max(100.0, float(fastest["minimum_rpm"]) * 0.04):
            features.append(f"Fastest-lap minimum RPM differs by {difference:+.0f} rpm")
    return features


def _gain_against_peers(
    fastest: dict[str, Any],
    peers: list[dict[str, Any]],
    key: str,
) -> float:
    values = [float(item[key]) for item in peers if item.get(key) is not None]
    if fastest.get(key) is None or not values:
        return 0.0
    return max(0.0, float(np.median(values)) - float(fastest[key]))


def _cost_against_peers(
    fastest: dict[str, Any],
    peers: list[dict[str, Any]],
    key: str,
) -> float:
    values = [float(item[key]) for item in peers if item.get(key) is not None]
    if fastest.get(key) is None or not values:
        return 0.0
    return float(fastest[key]) - float(np.median(values))


def _zones_conflict(first: dict[str, Any], second: dict[str, Any]) -> bool:
    first_group = first.get("conflict_group")
    second_group = second.get("conflict_group")
    if first_group and second_group and first_group == second_group:
        return True
    return not (
        float(first["exit_distance_m"]) <= float(second["entry_distance_m"])
        or float(second["exit_distance_m"]) <= float(first["entry_distance_m"])
    )


def _numeric(frame: pd.DataFrame, column: str) -> pd.Series:
    if column not in frame:
        return pd.Series(dtype=float)
    return pd.to_numeric(frame[column], errors="coerce").dropna()


def _finite_min(frame: pd.DataFrame, column: str) -> float | None:
    values = _numeric(frame, column)
    return round(float(values.min()), 3) if len(values) else None


def _finite_median(frame: pd.DataFrame, column: str) -> float | None:
    values = _numeric(frame, column)
    return round(float(values.median()), 3) if len(values) else None


def _interpolated_column(
    frame: pd.DataFrame,
    column: str,
    distance_m: float,
) -> float | None:
    if column not in frame:
        return None
    valid = frame[["distance_m", column]].dropna()
    if len(valid) < 2:
        return None
    return _round_or_none(
        _interpolate(
            valid["distance_m"].to_numpy(dtype=float),
            valid[column].to_numpy(dtype=float),
            distance_m,
        )
    )


def _interpolate(x: np.ndarray, y: np.ndarray, value: float) -> float:
    return float(np.interp(value, x, y))


def _round_or_none(value: Any) -> float | None:
    if value is None:
        return None
    number = float(value)
    return round(number, 3) if np.isfinite(number) else None
