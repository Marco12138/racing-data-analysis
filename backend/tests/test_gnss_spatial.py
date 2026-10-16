"""Known synthetic signals test geometry; not driver or sensor-performance evidence."""

import json

import numpy as np
import pytest

from backend.app.analysis.gnss_spatial import verify_spatial_alignment
from backend.tests.test_gnss_sync import fixture


def test_geometry_fits_offset_and_translation_then_freezes_holdout():
    """Separate validation samples recover a known shift without fitting on them."""
    _, gps, reference = fixture(duration=240)
    for p in gps:
        p["lat"] += 8/111320
        p["lon"] -= 4/(111320*np.cos(np.deg2rad(30)))
    result = verify_spatial_alignment(gps, reference["series"], 23.5, [])
    assert result["passed"]
    assert result["proposed_offset_s"] == pytest.approx(23.7, abs=.051)
    assert result["translation_m"] == pytest.approx([4, -8], abs=.01)
    assert result["validation_p95_m"] < .01
    assert result["independent_ground_truth"] is False
    assert result["wrong_lap_independently_excluded"] is False
    assert {p["role"] for p in result["overlay"]} == {"fit", "validation"}
    assert len(result["overlay"]) <= 600
    json.dumps(result, allow_nan=False)


def test_held_out_disagreement_cannot_refit_itself_to_a_pass():
    """A changed validation-only position must stay visible with a frozen transform."""
    _, gps, reference = fixture(duration=240)
    for p in gps:
        block = int((p["time_s"]-23.7-1.5)//20)
        if block % 2 == 1:
            p["lat"] += 20/111320
    result = verify_spatial_alignment(gps, reference["series"], 23.7, [])
    assert not result["passed"]
    assert result["validation_median_m"] > 10


def test_available_laps_are_split_before_fitting():
    """Whole held-out laps are preferred to short within-lap blocks."""
    _, gps, reference = fixture(duration=300)
    laps = [{"lap": n, "start_time_ms": (10+40*(n-1))*1000,
             "end_time_ms": (10+40*n)*1000} for n in range(1, 7)]
    result = verify_spatial_alignment(gps, reference["series"], 23.7, laps)
    assert result["split"] == "alternating_complete_logger_laps"
    assert len(result["windows"]) == 3
    assert result["passed"]


def test_gaps_invalid_fixes_and_straight_only_motion_degrade():
    """Interpolation never replaces long holes; no geometry/time ambiguity is hidden."""
    _, gps, reference = fixture()
    bad = [{**p, "fix": 0} for p in gps]
    assert not verify_spatial_alignment(bad, reference["series"], 23.7, [])["passed"]
    gap = [p for p in gps if p["time_s"] < 50 or p["time_s"] > 160]
    assert not verify_spatial_alignment(gap, reference["series"], 23.7, [])["passed"]
    t = reference["series"]["gps_lat"][0]
    reference["series"]["gps_lat"] = (t, np.full(len(t), 30.))
    result = verify_spatial_alignment(gps, reference["series"], 23.7, [])
    assert result["reason"] == "GNSS_GEOMETRY_LOW_EXCITATION"


def test_geometry_does_not_search_another_lap_or_extrapolate_short_overlap():
    """Clock-conditioned local search explicitly cannot certify global lap identity."""
    _, gps, reference = fixture(duration=50)
    result = verify_spatial_alignment(gps, reference["series"], 23.7, [])
    assert result["reason"] == "GNSS_GEOMETRY_HOLDOUT_INSUFFICIENT"
    assert result["wrong_lap_independently_excluded"] is False
