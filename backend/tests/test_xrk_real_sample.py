"""Opt-in private-file acceptance: a directory or any individual XRK/XRZ."""

import os
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from backend.app.importers.xrk import load_xrk
from backend.app.importers.xrk_registry import XrkParserRegistry
from backend.app.analysis.xrk_session_analysis import analyze_xrk_session


def private_sources():
    """An explicit file takes precedence; a configured empty directory fails."""
    filename = os.getenv("XRK_TEST_FILE_PATH")
    directory = os.getenv("XRK_TEST_DATA_DIR")
    if filename:
        return [Path(filename).expanduser()]
    if directory:
        files = sorted(p for p in Path(directory).expanduser().rglob("*")
                       if p.is_file() and p.suffix.lower() in {".xrk", ".xrz"} and not p.name.startswith("._"))
        if not files:
            raise pytest.UsageError("XRK_TEST_DATA_DIR contains no XRK/XRZ files")
        return files
    return [pytest.param(None, marks=pytest.mark.skip(reason="Set XRK_TEST_DATA_DIR or XRK_TEST_FILE_PATH for private acceptance"))]


@pytest.mark.parametrize("source", private_sources())
def test_private_real_xrk_acceptance(tmp_path: Path, source: Path) -> None:
    """Verify every native array and lock known IMU/GPS-only regressions."""
    assert source.is_file()
    adapter = XrkParserRegistry("libxrk", enabled=True).require_available()
    manifest = adapter.inspect_and_extract(source, tmp_path / "inspection")
    assert manifest["channels"]
    assert manifest["sensor_capabilities"]["body_dynamics_available"] is False
    native = pd.read_parquet(tmp_path / "inspection" / "native_channels.parquet")
    analysis = analyze_xrk_session(pd.read_parquet(tmp_path / "inspection" / "telemetry.parquet"), manifest)
    dynamics = analysis.get("corner_dynamics", {})
    if "eligible_laps" in dynamics:
        assert dynamics["eligible_laps"] == sorted(row["lap"] for row in analysis["lap_quality"]["laps"] if row["analysis_eligible"])
        for corner in dynamics["corners"]:
            for phase in corner["phases"]:
                if phase["status"] == "calculated":
                    assert phase["thresholds"] == corner["calibration"]["thresholds"]
                    assert phase["metrics"]["minimum_speed_kmh"] == phase["events"]["minimum_speed"]["speed_kmh"]
            for comparison in corner["comparisons"].values():
                assert comparison["repeatability"]["ci_method"] == "student_t_iid_mean"
                background = comparison["background"]
                assert not set(background["source_laps"]) & {dynamics["reference_lap"], dynamics["target_lap"]}
                if background["lap_count"] < 5:
                    assert comparison["outside_observed_repeatability_band"] is None
    raw = load_xrk(source)
    for channel in manifest["channels"]:
        original = raw.channels[channel["name"]].to_pydict()
        cached = native[native.channel_id == channel["channel_id"]]
        np.testing.assert_equal(cached.timecode_ms.to_numpy(dtype=float), np.asarray(original["timecodes"], dtype=float))
        np.testing.assert_equal(cached.value.to_numpy(dtype=float), np.asarray(original[channel["name"]], dtype=float))
    by_canonical = {c["canonical_name"]: c for c in manifest["channels"] if c["canonical_name"]}
    if source.name == "ren_kosmic_WUHAN_a_0809.xrk":
        assert len(manifest["channels"]) == 34
        assert manifest["valid_laps"] == list(range(1, 14))
        assert manifest["session_summary"]["fastest_lap"] == {"lap": 13, "lap_time_s": pytest.approx(40.326, abs=.001)}
        assert not manifest["has_accelerometer"] and not manifest["has_gyro"]
        assert manifest["has_gps_yaw"] and manifest["has_gps_speed"] and manifest["has_rpm"]
        assert manifest["telemetry_rows"] == 13_745
        assert by_canonical["rpm"]["sample_count"] == 12_223
        assert by_canonical["gps_lat"]["sample_count"] == 15_278
    elif source.name == "Fu Zhongzheng_24 OTK_WSK-WH_a_0898.xrk":
        assert manifest["has_accelerometer"] and manifest["has_gyro"]
        for name in ("accel_x", "accel_y", "accel_z", "gyro_x", "gyro_y", "gyro_z"):
            assert by_canonical[name]["source"] == "raw_sensor"
            assert by_canonical[name]["native_sample_rate_hz"] == pytest.approx(50)
        assert by_canonical["yaw_rate"]["source"] == "gps_derived"
