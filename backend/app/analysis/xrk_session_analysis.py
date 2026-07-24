"""Orchestrate temporary XRK track, lap, action, sector, and zone analysis."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .gps_processing import clean_gps_points, resample_lap_by_distance
from .corner_consensus import (
    build_ai_coach_summary,
    build_top3_consensus_benchmark,
    estimate_achievable_improvement_range,
)
from .lap_analysis import analyze_laps
from .lap_quality import build_lap_quality_summary, classify_lap_quality
from .rpm_analysis import (
    compare_rpm_behavior_by_lap,
    detect_driver_actions,
)
from .sector_zone_analysis import (
    analyze_zones,
    build_track_id,
    calculate_track_curvature,
    calculate_virtual_sectors,
    generate_auto_zones,
    generate_sector_boundaries,
)
from .telemetry_alignment import (
    align_laps_by_distance,
    align_multiple_laps_by_distance,
)


def analyze_xrk_session(
    telemetry: pd.DataFrame,
    manifest: dict[str, Any],
    *,
    reference_lap: int | None = None,
    target_lap: int | None = None,
    distance_step_m: float = 1.0,
    sector_count: int = 3,
    sector_boundaries_m: list[float] | None = None,
    manual_zones: list[dict[str, Any]] | None = None,
    lap_quality_config: dict[str, float] | None = None,
    max_comparison_points: int = 5_000,
) -> dict[str, Any]:
    """Run all supported analyses while preserving unavailable capabilities."""
    timing = {
        int(row["lap"]): row
        for row in manifest.get("lap_timing", [])
        if row.get("lap") is not None
    }
    if not timing:
        raise ValueError("No usable timed laps are available.")
    available_laps = sorted(timing)
    quality_rows = classify_lap_quality(timing, telemetry, lap_quality_config)
    quality_summary = build_lap_quality_summary(
        quality_rows, telemetry, lap_quality_config
    )
    eligible_laps = [
        int(row["lap"]) for row in quality_summary["top_valid_laps"]
    ]
    if not eligible_laps:
        raise ValueError("No laps passed the Lap Quality Gate.")
    fastest_lap = eligible_laps[0]
    reference_lap = reference_lap if reference_lap in eligible_laps else fastest_lap
    default_target = next(
        (lap for lap in eligible_laps if lap != reference_lap),
        reference_lap,
    )
    target_lap = target_lap if target_lap in timing else default_target

    base = basic_response(
        manifest,
        timing,
        reference_lap,
        target_lap,
        quality_summary,
    )
    if not manifest.get("has_gps"):
        base["warnings"].append(
            "GPS is unavailable; track, distance alignment, sectors, and zones were skipped."
        )
        base["report"] = generate_xrk_report(base)
        return base

    cleaned, gps_quality = clean_gps_points(telemetry)
    if cleaned.empty:
        base["warnings"].append(
            "GPS samples did not pass quality checks; track analysis is unavailable."
        )
        base["gps_quality"] = gps_quality
        return base
    processed = calculate_track_curvature(cleaned)
    available_after_cleaning = sorted(int(value) for value in processed["lap"].unique())
    quality_rows = classify_lap_quality(timing, processed, lap_quality_config)
    quality_summary = build_lap_quality_summary(
        quality_rows, processed, lap_quality_config
    )
    eligible_after_cleaning = [
        int(row["lap"])
        for row in quality_summary["top_valid_laps"]
        if int(row["lap"]) in available_after_cleaning
    ]
    if not eligible_after_cleaning:
        base["warnings"].append(
            "No GPS-complete laps passed the Lap Quality Gate; distance comparison is unavailable."
        )
        base["lap_quality"] = quality_summary
        base["report"] = generate_xrk_report(base)
        return base
    if reference_lap not in eligible_after_cleaning:
        reference_lap = eligible_after_cleaning[0]
    if target_lap not in available_after_cleaning:
        target_lap = next(
            (lap for lap in eligible_after_cleaning if lap != reference_lap),
            reference_lap,
        )
    base["reference_lap"] = reference_lap
    base["target_lap"] = target_lap
    base["fastest_lap"] = {
        "lap": int(quality_summary["top_valid_laps"][0]["lap"]),
        "lap_time": float(quality_summary["top_valid_laps"][0]["lap_time"]),
    }
    base["lap_quality"] = quality_summary

    lap_lengths = processed.groupby("lap")["distance_m"].max()
    lap_length_m = float(lap_lengths.median())
    boundaries = generate_sector_boundaries(
        lap_length_m,
        sector_count,
        sector_boundaries_m,
    )
    lap_rows, sector_result = calculate_virtual_sectors(processed, boundaries)
    lap_rows = reconcile_logger_lap_times(lap_rows, timing)
    sector_result["analysis"] = analyze_laps(pd.DataFrame(lap_rows))
    sector_analysis = sector_result["analysis"]
    classified, events, action_meta = detect_driver_actions(
        processed,
        sector_boundaries_m=boundaries,
    )
    aligned = align_laps_by_distance(
        classified,
        reference_lap,
        target_lap,
        distance_step_m,
    )
    if len(aligned) > max_comparison_points:
        indexes = np.linspace(0, len(aligned) - 1, max_comparison_points, dtype=int)
        aligned = aligned.iloc[np.unique(indexes)].reset_index(drop=True)
    top_lap_numbers = [
        int(row["lap"]) for row in quality_summary["top_valid_laps"]
    ]
    comparison_lap_numbers = list(top_lap_numbers)
    consistent_lap = quality_summary.get("fastest_consistent_lap")
    if (
        consistent_lap
        and int(consistent_lap["lap"]) not in comparison_lap_numbers
    ):
        comparison_lap_numbers.append(int(consistent_lap["lap"]))
    top_aligned, top_resampled = align_multiple_laps_by_distance(
        classified,
        comparison_lap_numbers,
        distance_step_m,
    )
    if len(top_aligned) > max_comparison_points:
        indexes = np.linspace(
            0, len(top_aligned) - 1, max_comparison_points, dtype=int
        )
        top_aligned = top_aligned.iloc[np.unique(indexes)].reset_index(drop=True)

    reference_trace = classified[classified["lap"] == reference_lap]
    reference_resampled = resample_lap_by_distance(
        reference_trace,
        distance_step_m,
    )
    auto_zones = generate_auto_zones(reference_resampled)
    zones = normalize_manual_zones(
        manual_zones or [],
        lap_length_m,
    )
    if not zones:
        zones = auto_zones
    zone_comparisons = analyze_zones(
        classified,
        events,
        zones,
        reference_lap,
        target_lap,
    )
    consensus = build_top3_consensus_benchmark(
        {
            lap: frame
            for lap, frame in top_resampled.items()
            if lap in top_lap_numbers
        },
        zones,
        {
            "lap_order": top_lap_numbers,
            "lap_times": {
                int(row["lap"]): float(row["lap_time"])
                for row in quality_summary["top_valid_laps"]
            },
        },
    )
    achievable_range = estimate_achievable_improvement_range(
        quality_summary["top_valid_laps"],
        consensus["corners"],
    )
    coach_summary = build_ai_coach_summary(
        quality_summary["top_valid_laps"],
        consensus,
        achievable_range,
        direct_brake_available="brake"
        in manifest.get("available_canonical_channels", []),
    )
    reference_events = [event for event in events if event["lap"] == reference_lap]
    target_events = [event for event in events if event["lap"] == target_lap]
    visible_events = [
        event
        for event in events
        if event["lap"] in {reference_lap, target_lap}
    ]
    event_comparison = compare_rpm_behavior_by_lap(
        reference_events,
        target_events,
    )
    track_id = build_track_id(manifest.get("metadata", {}), reference_resampled)

    base.update(
        {
            "reference_lap": reference_lap,
            "target_lap": target_lap,
            "gps_quality": gps_quality,
            "track": {
                "track_id": track_id,
                "lap_length_m": round(lap_length_m, 3),
                "reference_lap": reference_lap,
                "target_lap": target_lap,
                "reference": track_points(aligned, "reference"),
                "target": track_points(aligned, "target"),
            },
            "comparison": dataframe_records(aligned),
            "top_laps_comparison": {
                "laps": quality_summary["top_valid_laps"],
                "fastest_consistent_lap": quality_summary[
                    "fastest_consistent_lap"
                ],
                "aligned": dataframe_records(top_aligned),
                "distance_step_m": distance_step_m,
                "synthetic_curve_generated": False,
            },
            "events": visible_events,
            "event_comparison": event_comparison,
            "action_analysis": {
                **action_meta,
                "event_counts_by_lap": event_counts_by_lap(events),
            },
            "sectors": {
                "source": "virtual_distance",
                "official": False,
                "count": sector_count,
                "boundaries_m": [
                    0.0,
                    *[round(value, 3) for value in boundaries],
                    round(lap_length_m, 3),
                ],
                "lap_rows": lap_rows,
                "sector_best": sector_analysis["sector_best"],
                **sector_result,
            },
            "zones": {
                "automatic": auto_zones,
                "active": zones,
                "comparisons": zone_comparisons,
            },
            "evidence_catalog": evidence_catalog(manifest),
            "consensus_benchmark": consensus,
            "achievable_improvement_range": achievable_range,
            "ai_coach_summary": coach_summary,
            "video_sync": video_sync_payload(timing),
        }
    )
    base["report"] = generate_xrk_report(base)
    base["warnings"].extend(sector_result["warnings"])
    return json_safe(base)


def basic_response(
    manifest: dict[str, Any],
    timing: dict[int, dict[str, Any]],
    reference_lap: int,
    target_lap: int,
    quality_summary: dict[str, Any],
) -> dict[str, Any]:
    """Create a capability-aware response before optional GPS analysis."""
    lap_rows = [
        {
            "lap": lap,
            "lap_time": float(row["duration_s"]),
            "notes": "logger_lap_timing",
        }
        for lap, row in sorted(timing.items())
    ]
    return {
        "format": "aim_xrk_analysis",
        "inspection_id": manifest.get("inspection_id"),
        "expires_at": manifest.get("expires_at"),
        "file_fingerprint": manifest.get("fingerprint"),
        "metadata": manifest.get("metadata", {}),
        "channels": manifest.get("channels", []),
        "capabilities": {
            "gps": bool(manifest.get("has_gps")),
            "rpm": bool(manifest.get("has_rpm")),
            "lap_timing": bool(manifest.get("has_lap_timing")),
            "official_sectors": bool(manifest.get("has_predefined_sectors")),
            "direct_brake": "brake"
            in manifest.get("available_canonical_channels", []),
            "direct_throttle": "throttle"
            in manifest.get("available_canonical_channels", []),
        },
        "reference_lap": reference_lap,
        "target_lap": target_lap,
        "fastest_lap": min(
            lap_rows,
            key=lambda row: row["lap_time"],
        ),
        "lap_rows": lap_rows,
        "track": None,
        "comparison": [],
        "lap_quality": quality_summary,
        "top_laps_comparison": {
            "laps": quality_summary["top_valid_laps"],
            "fastest_consistent_lap": quality_summary["fastest_consistent_lap"],
            "aligned": [],
            "distance_step_m": None,
            "synthetic_curve_generated": False,
        },
        "events": [],
        "event_comparison": [],
        "sectors": None,
        "zones": {"automatic": [], "active": [], "comparisons": []},
        "evidence_catalog": evidence_catalog(manifest),
        "consensus_benchmark": {
            "reference_policy": "real_completed_reference_eligible_laps_only",
            "lap_order": [
                int(row["lap"]) for row in quality_summary["top_valid_laps"]
            ],
            "lap_count": len(quality_summary["top_valid_laps"]),
            "synthetic_curve_generated": False,
            "corners": [],
        },
        "achievable_improvement_range": {
            "minimum_improvement_s": 0.0,
            "maximum_improvement_s": 0.0,
            "confidence": "low",
            "basis": [],
            "source_laps": [
                int(row["lap"]) for row in quality_summary["top_valid_laps"]
            ],
            "limitations": ["Distance-based corner evidence is unavailable."],
        },
        "ai_coach_summary": {
            "reference_statement": (
                "All benchmarks come from real, completed laps that passed the Lap Quality Gate."
            ),
            "top_valid_laps": quality_summary["top_valid_laps"],
            "common_fast_patterns": [],
            "fastest_lap_net_differences": [],
            "fastest_lap_unique_features": [],
            "emerging_improvements": [],
            "rejected_apparent_improvements": [],
            "training_priorities": [],
            "stable_strengths": [],
            "limitations": [
                "No synthetic target lap or synthetic RPM curve is produced.",
                "GPS is required for corner consensus and downstream validation.",
            ],
        },
        "video_sync": video_sync_payload(timing),
        "warnings": list(manifest.get("warnings", [])),
        "report": "",
    }


def normalize_manual_zones(
    zones: list[dict[str, Any]],
    lap_length_m: float,
) -> list[dict[str, Any]]:
    """Validate manual zones and reject wrap-around or empty ranges."""
    normalized: list[dict[str, Any]] = []
    for index, zone in enumerate(zones, start=1):
        try:
            entry = float(zone["entry_distance_m"])
            exit_distance = float(zone["exit_distance_m"])
        except (KeyError, TypeError, ValueError):
            continue
        if not (0 <= entry < exit_distance <= lap_length_m):
            continue
        normalized.append(
            {
                "id": str(zone.get("id") or f"manual-zone-{index}"),
                "name": str(zone.get("name") or f"Manual Zone {index}")[:80],
                "entry_distance_m": round(entry, 3),
                "exit_distance_m": round(exit_distance, 3),
                "source": "manual",
                "confidence": "user_defined",
                "evidence": {},
            }
        )
    return normalized


def event_counts_by_lap(events: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    """Summarize all session events without returning every event sample."""
    counts: dict[str, dict[str, int]] = {}
    for event in events:
        lap = str(event["lap"])
        event_type = event["event_type"]
        counts.setdefault(lap, {})
        counts[lap][event_type] = counts[lap].get(event_type, 0) + 1
    return counts


def reconcile_logger_lap_times(
    lap_rows: list[dict[str, Any]],
    timing: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Preserve official logger duration while retaining GPS crossing splits."""
    reconciled: list[dict[str, Any]] = []
    for source in lap_rows:
        row = dict(source)
        official = float(timing[int(row["lap"])]["duration_s"])
        sector_keys = sorted(
            key for key in row if key.startswith("sector_")
        )
        if sector_keys:
            final_key = sector_keys[-1]
            preceding = sum(float(row[key]) for key in sector_keys[:-1])
            row[final_key] = round(max(0.0, official - preceding), 3)
        row["lap_time"] = round(official, 3)
        reconciled.append(row)
    return reconciled


def track_points(frame: pd.DataFrame, prefix: str) -> list[dict[str, Any]]:
    """Build compact track-map points from one side of an aligned comparison."""
    if frame.empty:
        return []
    mapping = {
        "distance_m": "distance_m",
        "lap_time_s": f"{prefix}_lap_time_s",
        "session_time_s": f"{prefix}_session_time_s",
        "speed": f"{prefix}_speed",
        "rpm": f"{prefix}_rpm",
        "longitudinal_g": f"{prefix}_longitudinal_g",
        "lateral_g": f"{prefix}_lateral_g",
        "gps_lat": f"{prefix}_gps_lat",
        "gps_lon": f"{prefix}_gps_lon",
        "local_x_m": f"{prefix}_local_x_m",
        "local_y_m": f"{prefix}_local_y_m",
        "curvature": f"{prefix}_curvature",
        "time_delta_s": "cumulative_time_delta_s",
    }
    output = pd.DataFrame()
    for target, source in mapping.items():
        if source in frame:
            output[target] = frame[source]
    return dataframe_records(output)


def video_sync_payload(timing: dict[int, dict[str, Any]]) -> dict[str, Any]:
    """Expose session timing needed for browser-local video synchronization."""
    return {
        "video_time_offset_ms": 0,
        "lap_video_ranges": [
            {
                "lap": lap,
                "telemetry_start_s": round(row["start_time_ms"] / 1000.0, 3),
                "telemetry_end_s": round(row["end_time_ms"] / 1000.0, 3),
                "video_start_s": None,
                "video_end_s": None,
            }
            for lap, row in sorted(timing.items())
        ],
    }


def evidence_catalog(manifest: dict[str, Any]) -> dict[str, list[str]]:
    """Describe the provenance boundary for every result class."""
    available = set(manifest.get("available_canonical_channels", []))
    measured = [
        label
        for key, label in [
            ("rpm", "RPM"),
            ("speed", "GPS speed"),
            ("gps_lat", "GPS latitude"),
            ("gps_lon", "GPS longitude"),
            ("longitudinal_g", "Longitudinal G"),
            ("lateral_g", "Lateral G"),
            ("brake", "Direct brake channel"),
            ("throttle", "Direct throttle channel"),
            ("gear", "Calculated gear"),
            ("predictive_time", "Predictive time"),
        ]
        if key in available
    ]
    return {
        "measured": measured,
        "calculated": [
            "Local X/Y coordinates",
            "Cleaned cumulative distance",
            "Smoothed RPM",
            "RPM and speed derivatives",
            "Track curvature",
            "Distance-aligned lap delta",
            "Virtual sector and zone time",
        ],
        "inferred": [
            "Lifting",
            "Likely braking when direct brake is unavailable",
            "Coasting",
            "Re-acceleration",
            "Throttle hesitation",
            "Suggested corner zones",
        ],
    }


def generate_xrk_report(result: dict[str, Any]) -> str:
    """Generate a measured/calculated/inferred driver review."""
    fastest = result["fastest_lap"]
    quality = result.get("lap_quality") or {}
    top_laps = quality.get("top_valid_laps", [])
    coach = result.get("ai_coach_summary") or {}
    improvement = result.get("achievable_improvement_range") or {}
    zone_comparisons = result.get("zones", {}).get("comparisons", [])
    largest_zone = max(
        (
            zone
            for zone in zone_comparisons
            if zone.get("estimated_zone_loss_s") is not None
        ),
        key=lambda zone: zone["estimated_zone_loss_s"],
        default=None,
    )
    lines = [
        "Measured",
        f"- {len(result['lap_rows'])} timed laps were read from the logger.",
        f"- The fastest logger lap is Lap {fastest['lap']} at {fastest['lap_time']:.3f}s.",
        "- Every benchmark in this report is a real completed lap that passed the Lap Quality Gate.",
    ]
    if result["capabilities"]["rpm"]:
        lines.append("- RPM is available as a directly recorded channel.")
    if result["capabilities"]["gps"]:
        lines.append("- GPS position and GPS speed are available as recorded channels.")
    lines.extend(
        [
            "",
            "Calculated",
            f"- Reference Lap: {result['reference_lap']}; Selected Lap: {result['target_lap']}.",
            (
                "- Top valid laps: "
                + ", ".join(
                    f"Lap {row['lap']} ({row['lap_time']:.3f}s)"
                    for row in top_laps
                )
                + "."
                if top_laps
                else "- No reference-eligible Top laps are available."
            ),
        ]
    )
    if improvement.get("maximum_improvement_s", 0) > 0:
        lines.append(
            "- Empirical achievable improvement range: "
            f"{improvement['minimum_improvement_s']:.3f}–"
            f"{improvement['maximum_improvement_s']:.3f}s "
            f"({improvement['confidence']} confidence)."
        )
    if largest_zone:
        lines.append(
            f"- {largest_zone['name']} has the largest selected-lap zone delta "
            f"at {largest_zone['estimated_zone_loss_s']:+.3f}s."
        )
        for finding in largest_zone.get("findings", [])[:4]:
            lines.append(
                f"- {finding['label']}: reference {finding['reference']:.3f} "
                f"vs selected {finding['target']:.3f} "
                f"({finding['difference']:+.3f} {finding['unit']})."
            )
    lines.extend(["", "Inferred"])
    target_events = [
        event
        for event in result.get("events", [])
        if event["lap"] == result["target_lap"]
    ]
    event_counts: dict[str, int] = {}
    for event in target_events:
        event_counts[event["event_type"]] = event_counts.get(event["event_type"], 0) + 1
    if event_counts:
        lines.append(
            "- Conservative driver-action candidates: "
            + ", ".join(
                f"{event_type} {count}"
                for event_type, count in sorted(event_counts.items())
            )
            + "."
        )
    else:
        lines.append("- No driver-action candidate passed the current evidence thresholds.")
    if not result["capabilities"]["direct_brake"]:
        lines.append(
            "- Confirmed braking is unavailable because no direct brake channel is present; "
            "BRAKING_LIKELY is an inference from RPM, speed, longitudinal G, and curvature."
        )
    lines.append(
        "- Virtual sectors and Suggested Zones are calculated analysis aids, not official timing points."
    )
    priorities = coach.get("training_priorities", [])
    if priorities:
        lines.extend(["", "AI Coach Summary"])
        for index, priority in enumerate(priorities[:3], start=1):
            lines.append(
                f"- Priority {index}, {priority['corner']}: {priority['what_to_test']}"
            )
    rejected = coach.get("rejected_apparent_improvements", [])
    for item in rejected[:3]:
        lines.append(
            f"- Rejected {item['corner']}: local gain {item['local_gain_s']:.3f}s, "
            f"downstream cost {item['downstream_cost_s']:.3f}s, "
            f"net {item['net_gain_s']:+.3f}s."
        )
    unique_features = coach.get("fastest_lap_unique_features", [])
    for item in unique_features[:3]:
        lines.append(
            f"- Fastest-lap-only {item['corner']}: "
            + "; ".join(item["features"])
            + ". This is not a stable training reference."
        )
    lines.extend(
        [
            "",
            "Reference policy",
            "- No stitched target lap or synthetic RPM trace is generated.",
            "- The improvement range is empirical and conservative.",
            "- Valid improvements are not guaranteed to coexist in the same lap.",
        ]
    )
    return "\n".join(lines)


def dataframe_records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    """Return JSON-safe dataframe records."""
    if frame.empty:
        return []
    cleaned = frame.astype(object).where(pd.notna(frame), None)
    return cleaned.to_dict(orient="records")


def json_safe(value: Any) -> Any:
    """Recursively convert NumPy and non-finite values for JSON responses."""
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and not np.isfinite(value):
        return None
    return value
