"""Orchestrate temporary XRK track, lap, action, sector, and zone analysis."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .gps_processing import clean_gps_points, resample_lap_by_distance
from .braking_analysis import analyze_braking_episodes
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
    validate_lap_integrity,
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
    language: str = "en",
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
        language=language,
    )
    if not manifest.get("has_gps"):
        base["warnings"].append(
            "GPS is unavailable; track, distance alignment, sectors, and zones were skipped."
        )
        base["report"] = generate_xrk_report(base, language=language)
        return base

    cleaned, gps_quality = clean_gps_points(telemetry)
    if cleaned.empty:
        base["warnings"].append(
            "GPS samples did not pass quality checks; track analysis is unavailable."
        )
        base["gps_quality"] = gps_quality
        base["report"] = generate_xrk_report(base, language=language)
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
        base["report"] = generate_xrk_report(base, language=language)
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
    braking_analysis = analyze_braking_episodes(
        classified,
        reference_lap=reference_lap,
        target_lap=target_lap,
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
    integrity = validate_lap_integrity(reference_trace)
    base["data_quality"] = {
        "reference_lap": int(reference_lap),
        "valid": integrity["valid"],
        "issues": integrity["issues"],
        "stats": integrity["stats"],
    }
    if integrity["valid"]:
        auto_zones = generate_auto_zones(reference_resampled)
    else:
        auto_zones = []
        base["warnings"].append(
            "Reference lap {} data integrity is in question ({}); automatic corner "
            "zones were skipped. Use a complete, uninterrupted single-car lap as "
            "the reference.".format(
                reference_lap,
                "; ".join(issue["type"] for issue in integrity["issues"]),
            )
        )
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
        language=language,
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
            "braking_analysis": braking_analysis,
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
    base["report"] = generate_xrk_report(base, language=language)
    base["warnings"].extend(sector_result["warnings"])
    return json_safe(base)


def basic_response(
    manifest: dict[str, Any],
    timing: dict[int, dict[str, Any]],
    reference_lap: int,
    target_lap: int,
    quality_summary: dict[str, Any],
    language: str = "en",
) -> dict[str, Any]:
    """Create a capability-aware response before optional GPS analysis."""
    zh = language == "zh"
    reference_statement = (
        "所有基准均来自真实完成且通过圈质量门的圈。"
        if zh
        else "All benchmarks come from real, completed laps that passed the Lap Quality Gate."
    )
    coach_limitations = (
        ["不生成合成目标圈或合成 RPM 曲线。", "弯道共识与下游验证需要 GPS 数据。"]
        if zh
        else [
            "No synthetic target lap or synthetic RPM curve is produced.",
            "GPS is required for corner consensus and downstream validation.",
        ]
    )
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
            "direct_steering": "steering_angle"
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
        "braking_analysis": {
            "available": False,
            "reason": "Distance-based direct-brake analysis is unavailable.",
            "capabilities": {
                "direct_brake": False,
                "direct_steering": False,
                "late_reinforcement": False,
                "abrupt_release": False,
                "brake_steering_overlap": False,
            },
            "thresholds": {},
            "episodes": [],
            "comparisons": [],
            "evidence_boundary": {
                "measured": [],
                "calculated": [],
                "not_concluded": [
                    "Trail-braking quality",
                    "Wheel lock-up without independent wheel speed",
                ],
            },
        },
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
            "reference_statement": reference_statement,
            "top_valid_laps": quality_summary["top_valid_laps"],
            "common_fast_patterns": [],
            "fastest_lap_net_differences": [],
            "fastest_lap_unique_features": [],
            "emerging_improvements": [],
            "rejected_apparent_improvements": [],
            "training_priorities": [],
            "stable_strengths": [],
            "limitations": coach_limitations,
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
            ("steering_angle", "Direct steering angle"),
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
            "Direct-brake episode phases when brake is available",
            "Brake and steering overlap when both channels are available",
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


_XRK_REPORT_TEXT: dict[str, dict[str, str]] = {
    "en": {
        "measured": "Measured",
        "laps": "- {count} timed laps were read from the logger.",
        "fastest": "- The fastest logger lap is Lap {lap} at {lap_time:.3f}s.",
        "gate": "- Every benchmark in this report is a real completed lap that passed the Lap Quality Gate.",
        "rpm": "- RPM is available as a directly recorded channel.",
        "gps": "- GPS position and GPS speed are available as recorded channels.",
        "calculated": "Calculated",
        "refs": "- Reference Lap: {reference}; Selected Lap: {target}.",
        "top_laps": "- Top valid laps: {laps}.",
        "no_top": "- No reference-eligible Top laps are available.",
        "range": "- Empirical achievable improvement range: {minimum:.3f}–{maximum:.3f}s ({confidence} confidence).",
        "zone": "- {name} has the largest selected-lap zone delta at {loss:+.3f}s.",
        "finding": "- {label}: reference {reference:.3f} vs selected {target:.3f} ({difference:+.3f} {unit}).",
        "inferred": "Inferred",
        "events": "- Conservative driver-action candidates: {events}.",
        "no_events": "- No driver-action candidate passed the current evidence thresholds.",
        "brake": (
            "- Confirmed braking is unavailable because no direct brake channel is present; "
            "BRAKING_LIKELY is an inference from RPM, speed, longitudinal G, and curvature."
        ),
        "virtual": "- Virtual sectors and Suggested Zones are calculated analysis aids, not official timing points.",
        "coach": "AI Coach Summary",
        "priority": "- Priority {index}, {corner}: {what}",
        "rejected": "- Rejected {corner}: local gain {local:.3f}s, downstream cost {downstream:.3f}s, net {net:+.3f}s.",
        "unique": "- Fastest-lap-only {corner}: {features}. This is not a stable training reference.",
        "policy": "Reference policy",
        "policy_1": "- No stitched target lap or synthetic RPM trace is generated.",
        "policy_2": "- The improvement range is empirical and conservative.",
        "policy_3": "- Valid improvements are not guaranteed to coexist in the same lap.",
    },
    "zh": {
        "measured": "测量",
        "laps": "- 已从记录仪读取 {count} 圈计时数据。",
        "fastest": "- 记录仪最快圈为第 {lap} 圈，{lap_time:.3f}s。",
        "gate": "- 本报告中的每个基准都是通过圈质量门的真实完成圈。",
        "rpm": "- RPM 为直接记录的通道。",
        "gps": "- GPS 位置与 GPS 速度为记录通道。",
        "calculated": "计算",
        "refs": "- 参考圈：第 {reference} 圈；对比圈：第 {target} 圈。",
        "top_laps": "- 有效最快圈：{laps}。",
        "no_top": "- 无通过圈质量门的参考有效圈。",
        "range": "- 经验可改进区间：{minimum:.3f}–{maximum:.3f}s（{confidence} 置信度）。",
        "zone": "- {name} 是所选圈 Zone 差最大的位置，差值为 {loss:+.3f}s。",
        "finding": "- {label}：参考 {reference:.3f}，对比 {target:.3f}（{difference:+.3f} {unit}）。",
        "inferred": "推断",
        "events": "- 保守驾驶行为候选：{events}。",
        "no_events": "- 无驾驶行为候选通过当前证据阈值。",
        "brake": "- 缺少直接刹车通道，无法确认刹车；BRAKING_LIKELY 由 RPM、速度、纵向 G 与曲率推断。",
        "virtual": "- 虚拟 Sector 与建议 Zone 为计算辅助，不是官方计时点。",
        "coach": "AI 教练摘要",
        "priority": "- 重点 {index}，{corner}：{what}",
        "rejected": "- 已拒绝 {corner}：本地收益 {local:.3f}s，下游代价 {downstream:.3f}s，净收益 {net:+.3f}s。",
        "unique": "- 仅最快圈出现 {corner}：{features}。该现象不是稳定的训练基准。",
        "policy": "参考口径",
        "policy_1": "- 不生成拼接目标圈或合成 RPM 曲线。",
        "policy_2": "- 改进区间为经验性保守估计。",
        "policy_3": "- 验证过的改进不保证能在同一圈内共存。",
    },
}


def generate_xrk_report(result: dict[str, Any], language: str = "en") -> str:
    """Generate a measured/calculated/inferred driver review."""
    t = _XRK_REPORT_TEXT["zh" if language == "zh" else "en"]
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
        t["measured"],
        t["laps"].format(count=len(result["lap_rows"])),
        t["fastest"].format(lap=fastest["lap"], lap_time=fastest["lap_time"]),
        t["gate"],
    ]
    if result["capabilities"]["rpm"]:
        lines.append(t["rpm"])
    if result["capabilities"]["gps"]:
        lines.append(t["gps"])
    lines.extend(
        [
            "",
            t["calculated"],
            t["refs"].format(
                reference=result["reference_lap"],
                target=result["target_lap"],
            ),
            (
                t["top_laps"].format(
                    laps=", ".join(
                        (
                            f"Lap {row['lap']} ({row['lap_time']:.3f}s)"
                            if language != "zh"
                            else f"第 {row['lap']} 圈（{row['lap_time']:.3f}s）"
                        )
                        for row in top_laps
                    )
                )
                if top_laps
                else t["no_top"]
            ),
        ]
    )
    if improvement.get("maximum_improvement_s", 0) > 0:
        lines.append(
            t["range"].format(
                minimum=improvement["minimum_improvement_s"],
                maximum=improvement["maximum_improvement_s"],
                confidence=improvement["confidence"],
            )
        )
    if largest_zone:
        lines.append(
            t["zone"].format(
                name=largest_zone["name"],
                loss=largest_zone["estimated_zone_loss_s"],
            )
        )
        for finding in largest_zone.get("findings", [])[:4]:
            lines.append(
                t["finding"].format(
                    label=finding["label"],
                    reference=finding["reference"],
                    target=finding["target"],
                    difference=finding["difference"],
                    unit=finding["unit"],
                )
            )
    lines.extend(["", t["inferred"]])
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
            t["events"].format(
                events=", ".join(
                    f"{event_type} {count}"
                    for event_type, count in sorted(event_counts.items())
                )
            )
        )
    else:
        lines.append(t["no_events"])
    if not result["capabilities"]["direct_brake"]:
        lines.append(t["brake"])
    lines.append(t["virtual"])
    priorities = coach.get("training_priorities", [])
    if priorities:
        lines.extend(["", t["coach"]])
        for index, priority in enumerate(priorities[:3], start=1):
            lines.append(
                t["priority"].format(
                    index=index,
                    corner=priority["corner"],
                    what=priority["what_to_test"],
                )
            )
    rejected = coach.get("rejected_apparent_improvements", [])
    for item in rejected[:3]:
        lines.append(
            t["rejected"].format(
                corner=item["corner"],
                local=item["local_gain_s"],
                downstream=item["downstream_cost_s"],
                net=item["net_gain_s"],
            )
        )
    unique_features = coach.get("fastest_lap_unique_features", [])
    for item in unique_features[:3]:
        lines.append(
            t["unique"].format(
                corner=item["corner"],
                features="; ".join(item["features"]),
            )
        )
    lines.extend(
        [
            "",
            t["policy"],
            t["policy_1"],
            t["policy_2"],
            t["policy_3"],
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
