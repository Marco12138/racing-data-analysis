"""Tests for the optional local AiM XRK converter."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from backend.app.importers.xrk import (
    LapProfile,
    TELEMETRY_COLUMNS,
    XrkImportError,
    convert_log,
    cumulative_gps_distance,
    interpolate_channel,
    select_valid_laps,
    virtual_sector_times,
)


class FakeTable:
    """Minimal PyArrow-like table used without the optional XRK dependency."""

    def __init__(self, channel: str, timecodes: list[int], values: list[float]) -> None:
        self.channel = channel
        self.data = {"timecodes": timecodes, channel: values}
        self.num_rows = len(timecodes)

    def to_pydict(self) -> dict[str, list[int] | list[float]]:
        return self.data


class FakeLaps:
    def __init__(self, rows: list[dict[str, int]]) -> None:
        self.rows = rows

    def to_pylist(self) -> list[dict[str, int]]:
        return self.rows


def lap_profile(number: int, duration_ms: int, distance_m: float) -> LapProfile:
    return LapProfile(
        number=number,
        start_ms=0,
        end_ms=duration_ms,
        timecodes=np.linspace(0, duration_ms - 1, 20, dtype=np.int64),
        latitude=np.linspace(30.0, 30.001, 20),
        longitude=np.linspace(114.0, 114.001, 20),
        speed_mps=np.full(20, 20.0),
        distance_m=np.linspace(0.0, distance_m, 20),
    )


def test_select_valid_laps_excludes_out_and_long_final() -> None:
    profiles = [
        lap_profile(0, 11_000, 100.0),
        lap_profile(1, 42_000, 812.0),
        lap_profile(2, 41_500, 810.0),
        lap_profile(3, 77_000, 806.0),
    ]

    valid, excluded, stats = select_valid_laps(profiles)

    assert [lap.number for lap in valid] == [1, 2]
    assert [lap["lap"] for lap in excluded] == [0, 3]
    assert "duration_above_1.25x_median" in excluded[-1]["reasons"]
    assert stats["median_distance_m"] == pytest.approx(810.0, abs=2.0)


def test_virtual_sector_times_preserve_official_lap_time() -> None:
    lap = LapProfile(
        number=1,
        start_ms=0,
        end_ms=3_000,
        timecodes=np.array([0, 1_000, 2_000, 2_990]),
        latitude=np.zeros(4),
        longitude=np.zeros(4),
        speed_mps=np.ones(4),
        distance_m=np.array([0.0, 100.0, 200.0, 300.0]),
    )

    sectors = virtual_sector_times(lap, [100.0, 200.0])

    assert sectors == pytest.approx((1.0, 1.0, 1.0))
    assert sum(sectors) == pytest.approx(lap.duration_s)


def test_interpolate_channel_aligns_asynchronous_samples() -> None:
    values = interpolate_channel(
        np.array([0, 500, 1_000]),
        np.array([0, 1_000]),
        np.array([0.0, 10.0]),
    )

    assert values.tolist() == pytest.approx([0.0, 5.0, 10.0])


def test_cumulative_distance_rejects_large_gps_jump() -> None:
    latitude = np.array([30.0, 30.00001, 31.0])
    longitude = np.array([114.0, 114.00001, 115.0])

    distance = cumulative_gps_distance(latitude, longitude)

    assert 1.0 < distance[1] < 2.0
    assert distance[2] == pytest.approx(distance[1])


def test_convert_log_writes_platform_schemas_without_missing_data_estimates(
    tmp_path: Path,
) -> None:
    source = tmp_path / "session.xrk"
    source.write_bytes(b"synthetic-xrk-fixture")
    first_times = list(range(0, 5_000, 500))
    second_times = list(range(5_000, 10_000, 500))
    times = first_times + second_times
    lap_lat = np.linspace(30.0, 30.00009, 10).tolist()
    lap_lon = np.linspace(114.0, 114.00001, 10).tolist()
    channels = {
        "GPS Speed": FakeTable("GPS Speed", times, [20.0] * 20),
        "GPS Latitude": FakeTable("GPS Latitude", times, lap_lat + lap_lat),
        "GPS Longitude": FakeTable("GPS Longitude", times, lap_lon + lap_lon),
        "RPM": FakeTable("RPM", times, [8_000.0 + index for index in range(20)]),
        "Steering Angle": FakeTable("Steering Angle", times, list(range(20))),
        "GPS_LateralAcc": FakeTable("GPS_LateralAcc", times, [0.5] * 20),
        "GPS_InlineAcc": FakeTable("GPS_InlineAcc", times, [0.1] * 20),
        "GPS_Yaw_Rate": FakeTable("GPS_Yaw_Rate", times, [5.0] * 20),
        "WheelSpeed": FakeTable("WheelSpeed", times, [0.0] * 20),
        "Calculated_Gear": FakeTable("Calculated_Gear", times, [0.0] * 20),
    }
    log = SimpleNamespace(
        channels=channels,
        laps=FakeLaps(
            [
                {"num": 1, "start_time": 0, "end_time": 5_000},
                {"num": 2, "start_time": 5_000, "end_time": 10_000},
            ]
        ),
        metadata={"Driver": "Fixture"},
    )

    report = convert_log(log, source, tmp_path / "output", parser_version="test")

    with Path(report["outputs"]["laps_csv"]).open(encoding="utf-8") as file:
        laps = list(csv.DictReader(file))
    with Path(report["outputs"]["telemetry_csv"]).open(encoding="utf-8") as file:
        telemetry = list(csv.DictReader(file))
    extraction = json.loads(
        Path(report["outputs"]["extraction_report"]).read_text(encoding="utf-8")
    )

    assert len(laps) == 2
    assert sum(float(laps[0][f"sector_{index}"]) for index in range(1, 4)) == pytest.approx(
        float(laps[0]["lap_time"]), abs=0.005
    )
    assert list(telemetry[0]) == TELEMETRY_COLUMNS
    assert float(telemetry[0]["speed"]) == pytest.approx(72.0)
    assert "throttle" not in telemetry[0]
    assert "brake" not in telemetry[0]
    assert "gear" not in telemetry[0]
    assert extraction["virtual_sectors"]["derived_not_official"] is True
    assert extraction["source"]["original_modified"] is False


def test_convert_log_requires_gps_channels(tmp_path: Path) -> None:
    source = tmp_path / "missing-gps.xrk"
    source.write_bytes(b"synthetic")
    log = SimpleNamespace(
        channels={"RPM": FakeTable("RPM", [0, 100], [8000, 8100])},
        laps=FakeLaps([]),
        metadata={},
    )

    with pytest.raises(XrkImportError, match="missing required GPS channels"):
        convert_log(log, source, tmp_path / "output", parser_version="test")
