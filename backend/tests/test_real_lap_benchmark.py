"""Real-lap quality, consensus, and achievable-gain tests."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.app.analysis.corner_consensus import (
    build_ai_coach_summary,
    build_top3_consensus_benchmark,
    estimate_achievable_improvement_range,
)
from backend.app.analysis.lap_quality import (
    build_lap_quality_summary,
    classify_lap_quality,
)
from backend.app.analysis.telemetry_alignment import (
    align_multiple_laps_by_distance,
)


def benchmark_telemetry() -> pd.DataFrame:
    """Build four complete laps with repeatable and compromised corner patterns."""
    rows: list[dict[str, float | int]] = []
    for lap, duration, recovery_shift in [
        (1, 40.00, 0.0),
        (2, 40.18, 2.0),
        (3, 40.31, 3.0),
        (4, 41.20, 18.0),
    ]:
        distance = np.linspace(0.0, 800.0, 401)
        lap_time = distance / 800.0 * duration
        rpm = 10_200.0 - 1_900.0 * np.exp(
            -((distance - (260.0 + recovery_shift)) / 45.0) ** 2
        )
        speed = 92.0 - 22.0 * np.exp(
            -((distance - (250.0 + recovery_shift)) / 55.0) ** 2
        )
        rpm_slope = np.gradient(rpm, lap_time)
        speed_slope = np.gradient(speed, lap_time)
        for index, point in enumerate(distance):
            rows.append(
                {
                    "lap": lap,
                    "distance_m": point,
                    "lap_time_s": lap_time[index],
                    "session_time_s": (lap - 1) * 45.0 + lap_time[index],
                    "rpm": rpm[index],
                    "rpm_smoothed": rpm[index],
                    "rpm_slope": rpm_slope[index],
                    "speed": speed[index],
                    "speed_slope": speed_slope[index],
                    "longitudinal_g": speed_slope[index] / 35.3,
                    "lateral_g": np.sin(point / 800.0 * np.pi * 2),
                    "gps_lat": 30.0 + np.sin(point / 800.0 * np.pi * 2) * 0.001,
                    "gps_lon": 114.0 + np.cos(point / 800.0 * np.pi * 2) * 0.001,
                }
            )
    return pd.DataFrame(rows)


def test_quality_gate_never_fills_top_three_with_slow_lap() -> None:
    telemetry = benchmark_telemetry()
    laps = [
        {"lap": 1, "lap_time": 40.00},
        {"lap": 2, "lap_time": 40.18},
        {"lap": 3, "lap_time": 40.31},
        {"lap": 4, "lap_time": 41.20},
    ]

    rows = classify_lap_quality(laps, telemetry)
    summary = build_lap_quality_summary(rows, telemetry)

    assert [row["lap"] for row in summary["top_valid_laps"]] == [1, 2, 3]
    assert next(row for row in rows if row["lap"] == 4)["quality_status"] == "CONTEXT_ONLY"


def test_quality_gate_reports_fewer_than_three_without_backfill() -> None:
    telemetry = benchmark_telemetry()
    laps = [
        {"lap": 1, "lap_time": 40.00},
        {"lap": 2, "lap_time": 40.18},
        {"lap": 3, "lap_time": 40.80},
    ]

    summary = build_lap_quality_summary(
        classify_lap_quality(laps, telemetry), telemetry
    )

    assert [row["lap"] for row in summary["top_valid_laps"]] == [1, 2]
    assert summary["minimum_top_laps_met"] is False
    assert "Only 2" in summary["notice"]


def test_multiple_laps_align_by_distance_without_synthetic_curve() -> None:
    aligned, per_lap = align_multiple_laps_by_distance(
        benchmark_telemetry(), [1, 2, 3], distance_step_m=2.0
    )

    assert set(per_lap) == {1, 2, 3}
    assert aligned["distance_m"].diff().dropna().median() == pytest.approx(2.0)
    assert {"lap_1_rpm", "lap_2_rpm", "lap_3_rpm"}.issubset(aligned.columns)
    assert not any("synthetic" in column for column in aligned.columns)


def test_consensus_and_improvement_range_use_repeated_real_laps() -> None:
    _, per_lap = align_multiple_laps_by_distance(
        benchmark_telemetry(), [1, 2, 3], distance_step_m=2.0
    )
    zones = [
        {
            "id": "t1",
            "name": "T1",
            "entry_distance_m": 180.0,
            "exit_distance_m": 340.0,
        }
    ]
    consensus = build_top3_consensus_benchmark(
        per_lap,
        zones,
        {
            "lap_order": [1, 2, 3],
            "lap_times": {1: 40.0, 2: 40.18, 3: 40.31},
            "maximum_downstream_cost_s": 0.5,
        },
    )
    corner = consensus["corners"][0]
    corner["transferable_improvement"] = True
    corner["occurrence_count"] = 2
    corner["net_gain"] = 0.12
    corner["downstream_cost"] = 0.0
    improvement = estimate_achievable_improvement_range(
        [{"lap": 1}, {"lap": 2}, {"lap": 3}],
        [corner],
    )
    coach = build_ai_coach_summary(
        [{"lap": 1}, {"lap": 2}, {"lap": 3}],
        consensus,
        improvement,
        direct_brake_available=False,
    )

    assert consensus["synthetic_curve_generated"] is False
    assert consensus["lap_order"] == [1, 2, 3]
    assert improvement["minimum_improvement_s"] > 0
    assert improvement["maximum_improvement_s"] >= improvement["minimum_improvement_s"]
    assert "target lap time" in improvement["limitations"][0]
    assert coach["reference_statement"].startswith("All benchmarks")
    assert any("No direct brake" in item for item in coach["limitations"])


def test_local_gain_with_downstream_cost_is_rejected() -> None:
    compromised = {
        "corner": "T7",
        "entry_distance_m": 500.0,
        "exit_distance_m": 600.0,
        "local_gain": 0.08,
        "downstream_cost": 0.19,
        "net_gain": -0.11,
        "occurrence_count": 2,
        "transferable_improvement": False,
        "confidence": "medium",
        "repeatability_score": 0.7,
        "common_fast_pattern": ["Earlier entry delta"],
        "supporting_laps": [1, 2],
        "evidence": {"features_by_lap": [], "channels": ["rpm", "speed"]},
    }
    consensus = {
        "corners": [compromised],
        "synthetic_curve_generated": False,
    }
    coach = build_ai_coach_summary(
        [{"lap": 1}, {"lap": 2}],
        consensus,
        estimate_achievable_improvement_range(
            [{"lap": 1}, {"lap": 2}], [compromised]
        ),
        direct_brake_available=False,
    )

    assert coach["training_priorities"] == []
    assert coach["rejected_apparent_improvements"][0]["corner"] == "T7"
