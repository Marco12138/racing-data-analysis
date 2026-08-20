"""Tests for the single-car lap integrity gate and corner-zone schema."""

from __future__ import annotations

import numpy as np
import pandas as pd

from backend.app.analysis.sector_zone_analysis import (
    generate_auto_zones,
    validate_lap_integrity,
)


def _lap_rows(
    *,
    speed_mps: float = 20.0,
    stall_range: tuple[int, int] | None = None,
    gap_at_index: int | None = None,
) -> pd.DataFrame:
    """Build a synthetic lap at 10 Hz with optional stall or distance gap."""
    times = np.arange(0.0, 40.0, 0.1)
    distance = speed_mps * times
    if stall_range is not None:
        start, end = stall_range
        freeze_at = distance[start]
        for index in range(start, end):
            distance[index] = freeze_at
    if gap_at_index is not None and gap_at_index < len(distance) - 1:
        distance[gap_at_index + 1 :] += 25.0
    return pd.DataFrame(
        {
            "lap_time_s": times,
            "distance_m": distance,
        }
    )


def test_clean_lap_passes_integrity_gate() -> None:
    result = validate_lap_integrity(_lap_rows())
    assert result["valid"] is True
    assert result["issues"] == []
    assert result["stats"]["samples"] > 100


def test_stall_detected_when_time_advances_without_distance() -> None:
    rows = _lap_rows(stall_range=(100, 140))  # 4 seconds frozen at 10 Hz
    result = validate_lap_integrity(rows)
    assert result["valid"] is False
    assert any(issue["type"] == "possible_stall" for issue in result["issues"])


def test_distance_gap_detected() -> None:
    rows = _lap_rows(gap_at_index=50)
    result = validate_lap_integrity(rows)
    assert result["valid"] is False
    assert any(issue["type"] == "distance_gap" for issue in result["issues"])


def test_missing_channels_and_short_lap_are_invalid() -> None:
    missing = validate_lap_integrity(pd.DataFrame({"lap_time_s": [0.0, 1.0]}))
    assert missing["valid"] is False
    assert missing["issues"][0]["type"] == "missing_channels"

    short = validate_lap_integrity(
        pd.DataFrame({"lap_time_s": np.arange(5), "distance_m": np.arange(5.0)})
    )
    assert short["valid"] is False
    assert short["issues"][0]["type"] == "insufficient_samples"


def test_auto_zones_include_apex_between_entry_and_exit() -> None:
    distance = np.arange(0.0, 401.0, 5.0)
    curvature = np.full_like(distance, 0.001)
    curvature += 0.05 * np.exp(-0.5 * ((distance - 175.0) / 15.0) ** 2)
    reference = pd.DataFrame(
        {
            "distance_m": distance,
            "curvature": curvature,
        }
    )
    zones = generate_auto_zones(reference)
    assert zones
    for zone in zones:
        assert "apex_distance_m" in zone
        assert zone["entry_distance_m"] <= zone["apex_distance_m"] <= zone["exit_distance_m"]
