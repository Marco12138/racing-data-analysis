"""Artificial geometry is test-only; private driving data is never a fixture."""

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.analysis.track_reference import (
    create_track_reference, gate_at, gate_crossings, match_track_reference,
    native_gps_frame, register_translation,
)
from backend.app.models.track_reference import SpatialGate, TrackAcceptance, TrackCorner
from backend.app.main import create_app
from backend.app.core.config import Settings


@pytest.fixture
def observed():
    """Seven complete real-shaped test laps with an explicit GPS source."""
    time = np.arange(0, 280.001, .1)
    angle = time / 40 * 2 * np.pi
    x, y = 140 * np.cos(angle), -115 * np.sin(angle)
    gps = pd.DataFrame({"session_time_s": time, "gps_lat": 30 + y / 6371000 * 180 / np.pi,
                        "gps_lon": 114 + x / (6371000 * np.cos(np.deg2rad(30))) * 180 / np.pi,
                        "speed": 72 + 8 * np.cos(2 * angle), "gps_fix": 3})
    manifest = {"fingerprint": "a" * 64, "lap_segments": 7,
                "channel_provenance": {"speed": {"source": "gps_receiver"}},
                "lap_timing": [{"lap": i + 1, "start_time_ms": i * 40000, "end_time_ms": (i + 1) * 40000,
                                "duration_s": 40.} for i in range(7)]}
    return gps, manifest


def test_translation_and_spatial_holdout_do_not_warp_lines():
    """Recover a bounded offset, while rejecting a changed layout and reverse gates."""
    angle = np.linspace(0, 2 * np.pi, 1000, endpoint=False)
    reference = np.column_stack((140 * np.cos(angle), 115 * np.sin(angle)))
    distance = np.r_[0, np.cumsum(np.linalg.norm(np.diff(reference, axis=0), axis=1))]
    shifted = reference + [6, -8]
    original = shifted.copy()
    result = register_translation(shifted, reference, distance, TrackAcceptance())
    assert result["status"] == "accepted"
    assert np.allclose(result["translation_m"], [-6, 8], atol=.05)
    assert result["sensor_error_identified"] is False
    assert result["independent_ground_truth"] is False
    np.testing.assert_array_equal(shifted, original)
    changed = reference * [1.15, 1]
    assert register_translation(changed, reference, distance, TrackAcceptance())["status"] == "rejected"


def test_directed_finite_gate_and_timestamp_brackets():
    gate = SpatialGate(a=(0, -5), b=(0, 5), forward=(1, 0))
    points = np.array([[-1., 0.], [1., 0.]])
    hits = gate_crossings(points, np.array([2., 2.1]), gate)
    assert hits[0]["session_time_s"] == pytest.approx(2.05)
    assert hits[0]["sample_bracket_s"] == [2., 2.1]
    assert not gate_crossings(points[::-1], np.array([2., 2.1]), gate)
    assert not gate_crossings(points + [0, 10], np.array([2., 2.1]), gate)
    assert not gate_crossings(points, np.array([2., 3.]), gate)
    assert not gate_crossings(points, np.array([2., 2.]), gate)


def test_moving_line_does_not_preserve_individual_lap_times():
    """Different within-lap passage offsets change the measured interval, without clock error."""
    logger_starts = np.array([0., 40., 81.])
    gate_offsets = np.array([3., 4., 3.5])
    crossings = logger_starts + gate_offsets
    np.testing.assert_allclose(np.diff(crossings), [41., 40.5])
    assert not np.allclose(np.diff(crossings), np.diff(logger_starts), atol=.05)
    np.testing.assert_allclose(np.diff(crossings), np.diff(logger_starts) + np.diff(gate_offsets))


def test_matching_preserves_logger_timing_and_fixed_corner_ids(observed):
    gps, manifest = observed
    config = create_track_reference(gps, manifest, 3, track_id="test-track")
    points = np.asarray(config.reference_path)
    config.start_finish_gate = gate_at(points, 30)
    config.corners = [TrackCorner(id="T1", name="Test corner", entry_gate=gate_at(points, 120), exit_gate=gate_at(points, 320)),
                      TrackCorner(id="T2", name="Test corner 2", entry_gate=gate_at(points, 450), exit_gate=gate_at(points, 730))]
    raw = gps.copy(deep=True)
    result = match_track_reference(gps, manifest, config)
    assert result["coverage"]["geometry_accepted_laps"] == 7
    assert result["coverage"]["exactly_once_ratio"] == 1.
    assert result["coverage"]["platform_laps"] == 6
    assert result["logger_timing_unchanged"] and not result["synthetic_curve_generated"]
    assert result["manual_confirmation_required"]
    assert result["gate_phases"]["coverage"]["calculated"] > 0
    for cycle in result["platform_laps"]:
        assert [c["id"] for c in cycle["corners"]] == ["T1", "T2"]
        assert abs(cycle["partition_identity_residual_s"]) < 1e-10
    for corner in result["gate_phases"]["corners"]:
        thresholds = [p["thresholds"] for p in corner["phases"] if p["status"] == "calculated"]
        assert all(t == thresholds[0] for t in thresholds)
        for phase in corner["phases"]:
            if phase["status"] != "calculated":
                continue
            window = next(c for cy in result["platform_laps"] if cy["platform_lap"] == phase["lap"] for c in cy["corners"] if c["id"] == corner["id"])
            assert not phase["driver_input_confirmed"]
            for event in phase["events"].values():
                if event:
                    assert window["phase_window_start_s"] <= event["session_time_s"] <= window["phase_window_end_s"]
    pd.testing.assert_frame_equal(gps, raw)
    # Removing a middle lap must not create a complete cycle over the missing lap.
    incomplete = gps[~gps.session_time_s.between(121, 124)]
    degraded = match_track_reference(incomplete, manifest, config)
    assert degraded["coverage"]["geometry_accepted_laps"] < 7
    assert any(c["status"] == "unavailable" for c in degraded["platform_laps"])


def test_native_timestamps_units_missing_channels_and_invalid_geometry(observed):
    channels = [{"canonical_name": name, "channel_id": i, "unit": unit} for i, (name, unit) in enumerate(
        [("gps_lat", "deg"), ("gps_lon", "deg"), ("speed", "m/s")])]
    native = pd.DataFrame([{"channel_id": i, "sample_index": k, "timecode_ms": t, "value": v}
                           for i, values in enumerate(([30] * 5, [114] * 5, [0, 10, 10, 10, 10]))
                           for k, (t, v) in enumerate(zip([0, 100, 100, 90, 1000], values))])
    frame, processing = native_gps_frame(native, {"channels": channels})
    assert frame.session_time_s.tolist() == [0., .1, 1.]
    assert frame.speed.iloc[0] == 0
    assert frame.speed.iloc[1] == 36
    assert processing["removed_coordinate_or_timestamp_samples"] == 2
    duplicate = {"canonical_name": "speed", "channel_id": 99, "unit": "km/h", "selected": False}
    channels[-1]["selected"] = True
    same, _ = native_gps_frame(native, {"channels": channels + [duplicate]})
    pd.testing.assert_frame_equal(same, frame)
    with pytest.raises(ValueError, match="GPS position"):
        native_gps_frame(native, {"channels": []})
    config = create_track_reference(*observed, 3, track_id="test-track")
    bad = config.model_dump()
    bad["reference_path"][10] = [50000, 0]
    with pytest.raises(ValidationError):
        type(config).model_validate(bad)
    with pytest.raises(ValidationError):
        SpatialGate(a=(0, 0), b=(0, 10), forward=(0, 1))
    bad = config.model_dump()
    bad["direction"] = "CCW" if bad["direction"] == "CW" else "CW"
    with pytest.raises(ValidationError, match="direction"):
        type(config).model_validate(bad)


def test_lap_translation_seams_cannot_create_tiny_or_double_platform_laps(observed, monkeypatch):
    """Opposite small shifts put the same physical passage on both logger sides."""
    from backend.app.analysis import track_reference
    gps, manifest = observed
    config = create_track_reference(gps, manifest, 3, track_id="seam-test")
    counter = 0

    def alternating_shift(*args):
        nonlocal counter
        counter += 1
        return {"status": "accepted", "reason": None, "translation_m": [0, 1 if counter % 2 else -1]}

    monkeypatch.setattr(track_reference, "register_translation", alternating_shift)
    result = match_track_reference(gps, manifest, config)
    assert any(c["reason"] == "platform_interval_length_mismatch" for c in result["platform_laps"])
    for cycle in result["platform_laps"]:
        if cycle["status"] == "calculated":
            assert cycle["length_compatible"]
            assert 20 < cycle["duration_s"] < 60
        else:
            assert cycle["duration_s"] is None


def test_native_cache_only_api_and_expiry(tmp_path, monkeypatch, observed):
    """Cloud routes do not accept host paths, and use existing token expiration."""
    from backend.app.api import track_reference_routes

    monkeypatch.setenv("APP_MODE", "cloud")
    monkeypatch.setenv("STORAGE_DIR", str(tmp_path))
    from backend.app.core.config import get_settings
    get_settings.cache_clear()
    app = create_app(Settings(app_mode="cloud", storage_dir=tmp_path, xrk_inspection_cache_dir=str(tmp_path / "cache")))
    with TestClient(app) as client:
        token = "e" * 32
        monkeypatch.setattr(track_reference_routes, "load_gps", lambda *a: (*observed, {}))
        draft = client.post("/api/v1/tracks/reference", json={"inspection_id": token, "lap": 3, "track_id": "test-track"})
        assert draft.status_code == 200, draft.text
        result = client.post("/api/v1/tracks/match", json={"inspection_id": token, "track_config": draft.json()})
        assert result.status_code == 200, result.text
        assert not result.json()["synthetic_curve_generated"]
        track_reference_routes._analysis_slots.acquire()
        track_reference_routes._analysis_slots.acquire()
        try:
            busy = client.post("/api/v1/tracks/match", json={"inspection_id": token, "track_config": draft.json()})
            assert busy.status_code == 429 and busy.json()["error_code"] == "TRACK_ANALYSIS_BUSY"
        finally:
            track_reference_routes._analysis_slots.release()
            track_reference_routes._analysis_slots.release()
        assert client.post("/api/v1/tracks/reference", json={"inspection_id": "/tmp/private.xrk", "lap": 3, "track_id": "test-track"}).status_code == 422
        def expired(*args):
            raise track_reference_routes.PublicApiError(410, "XRK_INSPECTION_EXPIRED", "Import again.")
        monkeypatch.setattr(track_reference_routes, "load_gps", expired)
        assert client.post("/api/v1/tracks/reference", json={"inspection_id": token, "lap": 3, "track_id": "test-track"}).status_code == 410
    get_settings.cache_clear()
