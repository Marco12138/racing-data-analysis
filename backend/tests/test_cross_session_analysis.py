"""Unit coverage for cross-session degradation and alignment rules."""

from __future__ import annotations

import pytest

from backend.app.analysis.cross_session_analysis import compare_driver_laps
from backend.tests.test_xrk_analysis_api import write_inspection
from backend.tests.test_xrk_track_analysis import telemetry_fixture


def manifest_fixture(tmp_path, driver: str = "Fixture") -> dict:
    """Build a parser-like manifest without retaining the temporary files."""
    write_inspection(tmp_path)
    import json

    manifest = json.loads((tmp_path / "inspection.json").read_text())
    manifest["inspection_id"] = "a" * 32
    manifest["expires_at"] = "2099-01-01T00:00:00+00:00"
    manifest["metadata"]["Driver"] = driver
    return manifest


def test_different_sample_rates_are_aligned_by_distance(tmp_path) -> None:
    """Downsampling one logger must not trigger index-based comparison."""
    telemetry = telemetry_fixture()
    first = manifest_fixture(tmp_path / "a")
    second = manifest_fixture(tmp_path / "b")
    result = compare_driver_laps(
        telemetry,
        first,
        telemetry.iloc[::2].reset_index(drop=True),
        second,
        distance_step_m=2,
    )
    distances = [row["distance_m"] for row in result["comparison"]]
    assert distances == sorted(set(distances))
    assert distances[1] - distances[0] == pytest.approx(2.0)
    assert result["synthetic_curve_generated"] is False


def test_missing_gps_degrades_to_real_lap_timing(tmp_path) -> None:
    """Missing GPS should preserve timing instead of failing the whole result."""
    telemetry = telemetry_fixture()
    no_gps = telemetry.drop(columns=["gps_lat", "gps_lon"])
    first = manifest_fixture(tmp_path / "a")
    second = manifest_fixture(tmp_path / "b")
    second["has_gps"] = False
    result = compare_driver_laps(no_gps, first, no_gps, second)
    assert result["sessions"]["a"]["selected_lap_time_s"] == pytest.approx(10.0)
    assert result["comparison"] == []
    assert result["track"] is None
    assert any("GPS is unavailable" in warning for warning in result["warnings"])


def test_track_length_mismatch_over_ten_percent_is_rejected(tmp_path) -> None:
    """Clearly incompatible GPS lap lengths must not be overlaid as one track."""
    telemetry = telemetry_fixture()
    stretched = telemetry.copy()
    origin_lat = stretched["gps_lat"].median()
    origin_lon = stretched["gps_lon"].median()
    stretched["gps_lat"] = origin_lat + (stretched["gps_lat"] - origin_lat) * 1.25
    stretched["gps_lon"] = origin_lon + (stretched["gps_lon"] - origin_lon) * 1.25
    first = manifest_fixture(tmp_path / "a")
    second = manifest_fixture(tmp_path / "b")
    with pytest.raises(ValueError, match="more than 10%"):
        compare_driver_laps(telemetry, first, stretched, second)
