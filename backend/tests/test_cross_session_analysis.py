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


def test_track_length_mismatch_between_three_and_ten_percent_warns(tmp_path) -> None:
    """Moderate length differences should reduce confidence without blocking analysis."""
    telemetry = telemetry_fixture()
    stretched = scale_gps(telemetry, 1.06)
    first = manifest_fixture(tmp_path / "a")
    second = manifest_fixture(tmp_path / "b")

    result = compare_driver_laps(telemetry, first, stretched, second)

    assert result["comparison"]
    assert any("Median lap lengths differ" in warning for warning in result["warnings"])


def test_vehicle_metadata_difference_warns_without_rejection(tmp_path) -> None:
    """Different declared hardware is context, not a reason to reject valid laps."""
    telemetry = telemetry_fixture()
    first = manifest_fixture(tmp_path / "a")
    second = manifest_fixture(tmp_path / "b")
    first["metadata"].update({"Vehicle": "Kart A", "Chassis": "Kosmic"})
    second["metadata"].update({"Vehicle": "Kart B", "Chassis": "Tony Kart"})

    result = compare_driver_laps(telemetry, first, telemetry, second)

    assert result["comparison"]
    assert any("Vehicle metadata differs" in warning for warning in result["warnings"])
    assert any("Chassis metadata differs" in warning for warning in result["warnings"])


def test_missing_rpm_and_g_channels_degrade_gracefully(tmp_path) -> None:
    """Optional vehicle channels may disappear without losing GPS/timing comparison."""
    telemetry = telemetry_fixture().drop(
        columns=["rpm", "longitudinal_g", "lateral_g"]
    )
    first = manifest_fixture(tmp_path / "a")
    second = manifest_fixture(tmp_path / "b")
    for manifest in (first, second):
        manifest["has_rpm"] = False
        manifest["available_canonical_channels"] = [
            channel
            for channel in manifest["available_canonical_channels"]
            if channel not in {"rpm", "longitudinal_g", "lateral_g"}
        ]

    result = compare_driver_laps(telemetry, first, telemetry, second)

    assert result["comparison"]
    assert "a_rpm" not in result["comparison"][0]
    assert "a_longitudinal_g" not in result["comparison"][0]
    assert result["track"]["a"]


def test_manual_zones_and_response_point_limit_are_preserved(tmp_path) -> None:
    """Valid manual zones should replace auto zones and output must respect its cap."""
    telemetry = telemetry_fixture()
    first = manifest_fixture(tmp_path / "a")
    second = manifest_fixture(tmp_path / "b")

    result = compare_driver_laps(
        telemetry,
        first,
        telemetry,
        second,
        distance_step_m=0.25,
        manual_zones=[{
            "id": "manual-t1",
            "name": "Manual T1",
            "entry_distance_m": 25.0,
            "exit_distance_m": 75.0,
        }],
        max_points=25,
    )

    assert len(result["comparison"]) == 25
    assert len(result["track"]["a"]) == 25
    assert result["zones"][0]["id"] == "manual-t1"
    assert result["zones"][0]["source"] == "manual"


def scale_gps(telemetry, factor: float):
    """Scale a fixture track around its centre without changing lap timing."""
    scaled = telemetry.copy()
    origin_lat = scaled["gps_lat"].median()
    origin_lon = scaled["gps_lon"].median()
    scaled["gps_lat"] = origin_lat + (scaled["gps_lat"] - origin_lat) * factor
    scaled["gps_lon"] = origin_lon + (scaled["gps_lon"] - origin_lon) * factor
    return scaled
