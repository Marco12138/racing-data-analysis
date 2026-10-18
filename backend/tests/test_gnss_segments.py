"""Segment labels do not turn local matches into whole-video validation."""

import json

import pytest

from backend.app.analysis.gnss_sync import verify_gnss_alignment
from backend.tests.test_gnss_sync import fixture


def test_held_out_passes_are_separate_from_fit_and_unsampled_edges():
    """Every time interval is accounted for without painting gaps green."""
    result = verify_gnss_alignment(*fixture())
    check = result["evidence"]["segmented_check"]
    assert check["counts"]["passed"] == 4
    assert check["counts"]["fit_only"] == 5
    assert check["counts"]["untested"] == 10
    assert not check["whole_recording_verified"] and not check["offset_applied"]
    assert check["manual_anchor_policy"] == "never_overwrite"
    rows = check["segments"]
    assert rows[0]["status"] == rows[-1]["status"] == "untested"
    assert rows[0]["session_range_s"][0] == result["evidence"]["matched_telemetry_range_s"][0]
    assert rows[-1]["session_range_s"][1] == result["evidence"]["matched_telemetry_range_s"][1]
    for a, b in zip(rows, rows[1:]):
        assert a["session_range_s"][1] == b["session_range_s"][0]
    for row in rows:
        assert row["video_range_s"][0]-row["session_range_s"][0] == pytest.approx(23.7)
        if row["status"] == "passed":
            assert row["role"] == "validation"
            assert row["offset_spread_s"] <= .25
            assert row["correlation_at_fit_offset"] >= .8
    json.dumps(result, allow_nan=False)


def test_bad_window_keeps_global_failure_while_other_holdouts_continue():
    """A known shift remains flagged with unchanged thresholds and lap identity."""
    import numpy as np
    clock, gps, ref = fixture()
    for row in gps:
        t = row["time_s"]-23.7
        if 20 <= t <= 42:
            row["speed_kmh"] = float(60+15*np.sin((t-.6)/4)+6*np.sin((t-.6)/1.6))
    result = verify_gnss_alignment(clock, gps, ref)
    check = result["evidence"]["segmented_check"]
    assert result["status"] == "weak"
    assert not result["evidence"]["speed_check"]["passed"]
    assert check["counts"]["passed"] == 3
    assert check["counts"]["gps_inconsistent"] == 1
    bad = next(r for r in check["segments"] if r["status"] == "gps_inconsistent")
    assert bad["session_range_s"] == [22, 39.8]
    assert bad["laps"] == [1]
    assert "OFFSET_SPREAD_EXCEEDS_LIMIT" in bad["reason_codes"]
    assert not bad["diagnostic"]["acceptance_changed"]
    assert not bad["diagnostic"]["window_discarded"]
    assert result["offset_ms"] == 23700


@pytest.mark.parametrize("fault", ["gap", "invalid_fix", "flat"])
def test_unscorable_windows_are_visible_not_silently_skipped(fault):
    """Other held-out windows remain inspectable despite a missing GPS interval."""
    clock, gps, ref = fixture()
    if fault == "gap":
        gps = [r for r in gps if not 23 < r["time_s"]-23.7 < 40]
    else:
        for row in gps:
            if 20 <= row["time_s"]-23.7 <= 42:
                if fault == "invalid_fix":
                    row["fix"] = 0
                else:
                    row["speed_kmh"] = 40
    result = verify_gnss_alignment(clock, gps, ref)
    check = result["evidence"]["segmented_check"]
    row = next(r for r in check["segments"] if r["session_range_s"] == [22, 39.8])
    assert row["status"] == "insufficient"
    assert check["counts"]["passed"] == 3
    assert not check["whole_recording_verified"]
    json.dumps(result, allow_nan=False)


def test_no_fit_or_speed_cannot_generate_segment_passes():
    """Clock-only estimates do not validate speed or video."""
    clock, gps, ref = fixture()
    for row in gps:
        row["speed_kmh"] = 40
    result = verify_gnss_alignment(clock, gps, ref)
    check = result["evidence"]["segmented_check"]
    assert check["counts"]["passed"] == 0
    assert check["counts"]["insufficient"] == 9
    assert all("NO_FROZEN_FIT_OFFSET" in r["reason_codes"]
               for r in check["segments"] if r["role"] != "none")
    empty = verify_gnss_alignment(clock, [], ref)["evidence"]["segmented_check"]
    assert len(empty["segments"]) == 1 and empty["counts"]["untested"] == 1
