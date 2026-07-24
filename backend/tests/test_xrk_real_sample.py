"""Private opt-in acceptance test for a real AiM session."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from backend.app.importers.xrk_registry import XrkParserRegistry


@pytest.mark.skipif(
    not os.getenv("XRK_TEST_FILE_PATH"),
    reason="XRK_TEST_FILE_PATH is not configured",
)
def test_private_real_xrk_acceptance(tmp_path: Path) -> None:
    """Verify the known Wuhan sample without adding it to the repository."""
    source = Path(os.environ["XRK_TEST_FILE_PATH"]).expanduser().resolve()
    assert source.is_file()

    adapter = XrkParserRegistry("libxrk", enabled=True).require_available()
    manifest = adapter.inspect_and_extract(source, tmp_path / "inspection")

    assert len(manifest["channels"]) == 34
    assert manifest["valid_laps"] == list(range(1, 14))
    assert manifest["session_summary"]["fastest_lap"] == {
        "lap": 13,
        "lap_time_s": pytest.approx(40.326, abs=0.001),
    }
    assert manifest["has_gps"] is True
    assert manifest["has_gps_speed"] is True
    assert manifest["has_rpm"] is True
    assert manifest["has_accelerometer"] is True
    assert manifest["has_gyro"] is True
    assert manifest["has_predefined_sectors"] is False
    assert manifest["telemetry_rows"] == 13_745
    by_canonical = {
        channel["canonical_name"]: channel
        for channel in manifest["channels"]
        if channel["canonical_name"]
    }
    assert by_canonical["rpm"]["sample_count"] == 12_223
    assert by_canonical["gps_lat"]["sample_count"] == 15_278
