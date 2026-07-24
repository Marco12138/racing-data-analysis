"""Tests for XRK channel, GPS, distance, sector, and action analysis."""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from backend.app.analysis.gps_processing import (
    clean_gps_points,
    convert_latlon_to_local_xy,
)
from backend.app.analysis.rpm_analysis import detect_driver_actions
from backend.app.analysis.sector_zone_analysis import (
    calculate_virtual_sectors,
    generate_sector_boundaries,
)
from backend.app.analysis.telemetry_alignment import align_laps_by_distance
from backend.app.importers.xrk_inspection import inspect_channels
from backend.tests.test_xrk_import import FakeTable


def telemetry_fixture() -> pd.DataFrame:
    """Create two closed mock laps with different sample rates."""
    rows: list[dict[str, float | int]] = []
    for lap, duration, samples in [(1, 10.0, 121), (2, 10.6, 96)]:
        time = np.linspace(0, duration, samples)
        angle = np.linspace(0, 2 * np.pi, samples)
        speed = 62.0 + 7.0 * np.sin(angle - 0.4)
        rpm = 9_000.0 + 1_100.0 * np.sin(angle - 0.3)
        braking = (time > duration * 0.42) & (time < duration * 0.55)
        recovery = time >= duration * 0.55
        speed[braking] -= np.linspace(0, 16, braking.sum())
        rpm[braking] -= np.linspace(0, 2_200, braking.sum())
        rpm[recovery] += np.linspace(0, 1_000, recovery.sum())
        longitudinal_g = np.where(braking, -0.62, 0.15)
        for index in range(samples):
            rows.append(
                {
                    "lap": lap,
                    "lap_time_s": time[index],
                    "session_time_s": (lap - 1) * 12 + time[index],
                    "gps_lat": 30.0 + np.sin(angle[index]) * 0.00045,
                    "gps_lon": 114.0 + np.cos(angle[index]) * 0.00055,
                    "speed": speed[index],
                    "rpm": rpm[index],
                    "longitudinal_g": longitudinal_g[index],
                    "lateral_g": 0.8 * np.sin(angle[index]),
                    "curvature": 0.025 + 0.02 * max(0.0, np.sin(angle[index])),
                }
            )
    return pd.DataFrame(rows)


def test_channel_aliases_and_all_zero_channels() -> None:
    """Known channels resolve while all-zero channels remain unavailable."""
    log = SimpleNamespace(
        channels={
            "RPM": FakeTable("RPM", [0, 10], [8_000, 8_100]),
            "GPS Latitude": FakeTable("GPS Latitude", [0, 10], [30.0, 30.1]),
            "Calculated_Gear": FakeTable("Calculated_Gear", [0, 10], [0.0, 0.0]),
            "Custom Sensor": FakeTable("Custom Sensor", [0, 10], [1.0, 2.0]),
        }
    )

    channels, resolved = inspect_channels(log)

    assert resolved["rpm"] == "RPM"
    assert "gear" not in resolved
    gear = next(row for row in channels if row["name"] == "Calculated_Gear")
    assert gear["canonical_name"] == "gear"
    assert gear["available"] is False
    assert gear["all_zero"] is True
    assert next(row for row in channels if row["name"] == "Custom Sensor")[
        "canonical_name"
    ] is None


def test_gps_cleaning_projection_and_distance_alignment() -> None:
    """GPS should become local metres and align on a common distance grid."""
    raw = telemetry_fixture()
    raw.loc[len(raw)] = {
        **raw.iloc[-1].to_dict(),
        "gps_lat": 31.0,
        "gps_lon": 115.0,
        "lap_time_s": 10.7,
    }

    cleaned, quality = clean_gps_points(raw)
    aligned = align_laps_by_distance(cleaned, 1, 2, distance_step_m=2.0)

    assert not cleaned.empty
    assert quality["removed_points"] >= 1
    assert quality["retained_ratio"] < 1
    assert cleaned["distance_m"].min() == pytest.approx(0.0)
    assert cleaned.groupby("lap")["distance_m"].apply(
        lambda values: values.is_monotonic_increasing
    ).all()
    assert not aligned.empty
    assert aligned["distance_m"].diff().dropna().median() == pytest.approx(2.0)
    assert {"reference_rpm", "target_rpm", "cumulative_time_delta_s"}.issubset(
        aligned.columns
    )


def test_local_projection_preserves_shape_ratio() -> None:
    """Local projection should produce metre coordinates on both axes."""
    frame = pd.DataFrame(
        {"gps_lat": [30.0, 30.001], "gps_lon": [114.0, 114.001]}
    )
    projected, _ = convert_latlon_to_local_xy(frame)

    assert 109 < projected["local_y_m"].iloc[1] - projected["local_y_m"].iloc[0] < 113
    assert 94 < projected["local_x_m"].iloc[1] - projected["local_x_m"].iloc[0] < 98


def test_virtual_sectors_and_multisignal_events() -> None:
    """Virtual timing and no-brake rules should remain explicit."""
    cleaned, _ = clean_gps_points(telemetry_fixture())
    boundaries = generate_sector_boundaries(
        float(cleaned.groupby("lap")["distance_m"].max().median()),
        3,
        None,
    )
    lap_rows, result = calculate_virtual_sectors(cleaned, boundaries)
    _, events, metadata = detect_driver_actions(
        cleaned,
        sector_boundaries_m=boundaries,
    )
    event_types = {event["event_type"] for event in events}

    assert len(lap_rows) == 2
    assert len(boundaries) == 2
    assert result["analysis"]["fastest_lap"]["lap_time"] > 0
    assert "theoretical_best_lap" not in result["analysis"]
    assert "BRAKING_CONFIRMED" not in event_types
    assert event_types & {"BRAKING_LIKELY", "LIFTING"}
    assert "MINIMUM_RPM" in event_types
    assert all(
        "evidence" in event
        and "thresholds" in event
        and event["channels_used"]
        for event in events
    )
    assert metadata["thresholds"]["brake_active"] is None
