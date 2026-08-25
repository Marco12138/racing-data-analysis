"""Tests for direct-channel braking episodes and evidence gates."""

from __future__ import annotations

import numpy as np
import pandas as pd

from backend.app.analysis.braking_analysis import analyze_braking_episodes


def braking_frame() -> pd.DataFrame:
    """Build two real-lap-shaped traces with one deliberate brake episode each."""
    rows: list[dict[str, float | int]] = []
    for lap in (1, 2):
        for index, lap_time in enumerate(np.arange(0.0, 8.0, 0.05)):
            phase = lap_time - (2.0 + 0.1 * (lap - 1))
            if phase < 0 or phase > 0.75:
                brake = 0.0
            elif phase <= 0.20:
                brake = phase / 0.20 * 80.0
            elif phase <= 0.38:
                brake = 80.0 - (phase - 0.20) / 0.18 * 45.0
            elif phase <= 0.58:
                brake = 35.0 + (phase - 0.38) / 0.20 * 40.0
            else:
                brake = max(0.0, 75.0 - (phase - 0.58) / 0.12 * 75.0)
            steering = 0.0 if phase < 0.44 else min(20.0, (phase - 0.44) * 90.0)
            rows.append(
                {
                    "lap": lap,
                    "lap_time_s": lap_time,
                    "session_time_s": (lap - 1) * 9.0 + lap_time,
                    "distance_m": lap_time * 20.0,
                    "brake": brake,
                    "steering_angle": steering,
                    "speed": 80.0 - brake * 0.15,
                    "rpm": 10_000.0 - brake * 15.0,
                    "curvature": 0.02 if phase >= 0.44 else 0.0,
                    "longitudinal_g": -brake / 80.0,
                    "lateral_g": steering / 20.0,
                    "sample": index,
                }
            )
    return pd.DataFrame(rows)


def test_builds_episodes_and_detects_direct_channel_patterns() -> None:
    result = analyze_braking_episodes(
        braking_frame(),
        reference_lap=1,
        target_lap=2,
        sector_boundaries_m=[55.0, 110.0],
    )

    assert result["available"] is True
    assert result["capabilities"]["direct_brake"] is True
    assert result["capabilities"]["direct_steering"] is True
    assert len(result["episodes"]) == 2
    assert len(result["comparisons"]) == 1
    target = next(item for item in result["episodes"] if item["lap"] == 2)
    pattern_types = {item["event_type"] for item in target["patterns"]}
    assert "BRAKE_LATE_REINFORCEMENT" in pattern_types
    assert "BRAKE_RELEASE_ABRUPT" in pattern_types
    assert "BRAKE_STEERING_OVERLAP" in pattern_types
    assert target["first_peak"]["brake"] is not None
    assert target["overlap_duration_s"] is not None
    assert "Trail-braking quality" in result["evidence_boundary"]["not_concluded"]


def test_missing_steering_hides_overlap_without_losing_brake_episode() -> None:
    frame = braking_frame().drop(columns=["steering_angle"])
    result = analyze_braking_episodes(
        frame,
        reference_lap=1,
        target_lap=2,
    )

    assert result["available"] is True
    assert result["capabilities"]["brake_steering_overlap"] is False
    assert all(
        pattern["event_type"] != "BRAKE_STEERING_OVERLAP"
        for episode in result["episodes"]
        for pattern in episode["patterns"]
    )


def test_missing_direct_brake_returns_explicit_unavailable_result() -> None:
    frame = braking_frame().drop(columns=["brake"])
    result = analyze_braking_episodes(
        frame,
        reference_lap=1,
        target_lap=2,
    )

    assert result["available"] is False
    assert result["episodes"] == []
    assert result["comparisons"] == []
    assert result["capabilities"]["late_reinforcement"] is False
