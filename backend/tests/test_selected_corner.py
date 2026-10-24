"""Synthetic fixtures stay in tests; production compares only observed laps."""

import copy
import json

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app.analysis.selected_corner import analyze_selected_corner, group_corner_patterns, _clip_telemetry, _coach_profile
from backend.app.core.config import Settings
from backend.app.main import create_app


def corner_fixture():
    """Six timed circles with different rates, known translation and two speed shapes."""
    frames, timing = [], []
    for lap in range(1, 7):
        duration = 40 + lap * .04
        t = np.linspace(0, duration, 801 if lap % 2 else 1001)
        angle = 2 * np.pi * t / duration
        speed = 60 + (4 if lap <= 4 else -4) * np.sin(angle * 2)
        frames.append(pd.DataFrame({"lap": lap, "lap_time_s": t, "session_time_s": (lap - 1) * 45 + t,
                                    "gps_lat": 30 + 100 * np.sin(angle) / 111195,
                                    "gps_lon": 114 + (100 * np.cos(angle) + lap * .2) / (111195 * np.cos(np.radians(30))),
                                    "gps_fix": 3, "speed": speed, "rpm": 9000 + speed * 50}))
        timing.append({"lap": lap, "duration_s": duration})
    return pd.concat(frames, ignore_index=True), {"has_gps": True, "lap_timing": timing,
                                                "channel_provenance": {"speed": {"source": "gps_receiver"}}}


def test_physical_gates_different_sample_rates_and_real_duration():
    frame, manifest = corner_fixture()
    original = frame.copy(deep=True)
    result = analyze_selected_corner(frame, manifest, source_lap=1, start_session_s=10, end_session_s=15, confirmed_laps=[])
    assert all(row["status"] == "candidate" for row in result["laps"])
    assert result["patterns"]["status"] == "insufficient_confirmed_laps"
    for row in result["laps"]:
        expected = 5 * (40 + row["lap"] * .04) / 40.04
        assert row["elapsed_s"] == pytest.approx(expected, abs=.01)
        assert row["visual_confirmation_required"]
        assert row["registration"]["status"] == "accepted"
        trace = row["telemetry"]
        assert len(trace) == row["sample_count"]
        assert trace[0]["elapsed_s"] == 0
        assert trace[0]["session_time_s"] == row["start_session_s"]
        assert trace[-1]["session_time_s"] == row["end_session_s"]
        assert trace[-1]["elapsed_s"] == pytest.approx(row["elapsed_s"])
        observed = frame[(frame.lap == row["lap"]) & frame.session_time_s.between(row["start_session_s"], row["end_session_s"], inclusive="neither")]
        assert [p["session_time_s"] for p in trace[1:-1]] == observed.session_time_s.tolist()
        assert [p["speed"] for p in trace[1:-1]] == pytest.approx(observed.speed.tolist())
        assert [p["rpm"] for p in trace[1:-1]] == pytest.approx(observed.rpm.tolist())
        spatial = row["spatial_profile"]
        assert spatial["status"] == "available", spatial
        assert spatial["method"] == "shared_directed_spatial_gates"
        assert spatial["independent_ground_truth"] is False
        checkpoints = spatial["points"]
        distances = np.array([p["distance_m"] for p in checkpoints])
        assert np.all(np.diff(distances) > 0)
        assert np.all(np.diff([p["session_time_s"] for p in checkpoints]) > 0)
        assert distances == pytest.approx([p["distance_m"] for p in result["laps"][0]["spatial_profile"]["points"]])
        # The fixture's circle has constant angular speed: elapsed fraction is known analytically.
        assert [p["elapsed_s"] for p in checkpoints] == pytest.approx(distances / distances[-1] * expected, abs=.01)
        assert checkpoints[-1]["elapsed_s"] == pytest.approx(row["elapsed_s"])
        lap_frame = frame[frame.lap == row["lap"]]
        for point in checkpoints:
            assert point["speed"] == pytest.approx(np.interp(point["session_time_s"], lap_frame.session_time_s, lap_frame.speed))
            assert point["rpm"] == pytest.approx(np.interp(point["session_time_s"], lap_frame.session_time_s, lap_frame.rpm))
    assert result["laps"][-1]["elapsed_s"] != 5
    pd.testing.assert_frame_equal(frame, original)


def test_gaps_missing_rpm_invalid_quality_and_boundary_degrade():
    frame, manifest = corner_fixture()
    frame = frame.drop(columns="rpm")
    frame = frame[~((frame.lap == 3) & frame.lap_time_s.between(12, 13))]
    manifest["lap_timing"][3]["duration_s"] = 55
    result = analyze_selected_corner(frame, manifest, source_lap=1, start_session_s=10, end_session_s=15, confirmed_laps=list(range(1, 7)))
    rows = {r["lap"]: r for r in result["laps"]}
    assert rows[3]["reason"] == "corner_timing_gap"
    assert rows[4]["reason"] == "lap_quality_gate"
    assert rows[1]["profile"]["rpm"] is None
    assert all(p["rpm"] is None for p in rows[1]["telemetry"])
    assert all(p["rpm"] is None for p in rows[1]["spatial_profile"]["points"])
    assert "telemetry" not in rows[3]
    assert 3 not in result["patterns"]["confirmed_laps"]
    assert result["patterns"]["channels"] == ["speed"]
    with pytest.raises(ValueError):
        analyze_selected_corner(frame, manifest, source_lap=1, start_session_s=38, end_session_s=43, confirmed_laps=[])
    with pytest.raises(ValueError, match="gps_unavailable"):
        analyze_selected_corner(frame, {**manifest, "has_gps": False}, source_lap=1, start_session_s=10, end_session_s=15, confirmed_laps=[])
    with pytest.raises(ValueError, match="provenance_unavailable"):
        analyze_selected_corner(frame, {**manifest, "channel_provenance": {}}, source_lap=1, start_session_s=10, end_session_s=15, confirmed_laps=[])


def pattern_rows():
    """Clear profile families with a minority faster family, not generated product data."""
    rows = []
    for lap in range(1, 7):
        speed = 60 + (8 if lap <= 4 else -8) * np.sin(np.linspace(0, np.pi, 41)) + lap * .005
        rows.append({"status": "candidate", "lap": lap, "elapsed_s": 5 if lap <= 4 else 4.8,
                     "downstream_s": 3 if lap <= 4 else 3.3,
                     "profile": {"speed": speed.tolist(), "rpm": None, "metrics": {"entry_speed_kmh": float(speed[0])}}})
    return rows


def test_clustering_never_uses_time_and_does_not_force_small_or_identical_groups():
    rows = pattern_rows()
    result = group_corner_patterns(rows, [1, 2, 3, 4, 5, 6])
    assert result["status"] == "exploratory_groups"
    assert sorted(g["count"] for g in result["groups"]) == [2, 4]
    assert result["common_is_fastest"] is False
    assert not result["synthetic_curve_generated"]
    changed = copy.deepcopy(rows)
    for row in changed:
        row["elapsed_s"] = 100 - row["lap"]
    other = group_corner_patterns(changed, list(range(1, 7)))
    assert [g["laps"] for g in result["groups"]] == [g["laps"] for g in other["groups"]]
    assert all(g["representative_lap"] in g["laps"] for g in result["groups"])
    assert group_corner_patterns(rows, [1, 2, 3])["status"] == "insufficient_confirmed_laps"
    for row in rows:
        row["profile"]["speed"] = [60.] * 41
    assert group_corner_patterns(rows, list(range(1, 7)))["status"] == "no_clear_separation"


def test_clip_telemetry_preserves_zero_and_serializes_missing_values():
    section = pd.DataFrame({"session_time_s": [100., 100.1, 100.2], "speed": [0., 30., 40.], "rpm": [0., np.nan, 9000.]})
    result = _clip_telemetry(section)
    assert result[0]["speed"] == 0 and result[0]["rpm"] == 0
    assert result[1]["rpm"] is None
    assert result[-1]["rpm"] == 9000
    json.dumps(result, allow_nan=False)


def test_shared_checkpoint_failures_do_not_invent_positions(monkeypatch):
    from backend.app.analysis import selected_corner as module
    from backend.app.models.track_reference import SpatialGate
    gate = SpatialGate(a=(0., -10.), b=(0., 10.), forward=(1., 0.))
    frame = pd.DataFrame({"session_time_s": np.arange(0., 5.1, .1), "speed": 50., "rpm": 0.})
    xy = np.column_stack([frame.session_time_s, np.zeros(len(frame))])
    checkpoints = [(float(i), gate) for i in range(4)]
    assert _coach_profile(frame, xy, 1., 4., [])["reason"] == "corner_checkpoint_geometry_unavailable"
    monkeypatch.setattr(module, "gate_crossings", lambda *args: [])
    assert _coach_profile(frame, xy, 1., 4., checkpoints)["reason"] == "corner_checkpoint_not_unique"
    monkeypatch.setattr(module, "gate_crossings", lambda *args: [{"session_time_s": 2.}, {"session_time_s": 3.}])
    assert _coach_profile(frame, xy, 1., 4., checkpoints)["reason"] == "corner_checkpoint_not_unique"
    monkeypatch.setattr(module, "gate_crossings", lambda *args: [{"session_time_s": 2.}])
    assert _coach_profile(frame, xy, 1., 4., checkpoints)["reason"] == "corner_checkpoint_order"
    hits = iter([2., 3.])
    monkeypatch.setattr(module, "gate_crossings", lambda *args: [{"session_time_s": next(hits)}])
    result = _coach_profile(frame, xy, 1., 4., checkpoints)
    assert result["status"] == "available"
    assert all(p["rpm"] == 0 for p in result["points"])
    json.dumps(result, allow_nan=False)


def test_api_expiry_validation_no_paths_and_compatible_errors(tmp_path):
    settings = Settings(app_env="test", app_mode="cloud", allowed_hosts="testserver", cors_origins="https://frontend.example",
                        database_url=f"sqlite:///{tmp_path / 'db.sqlite'}", xrk_inspection_cache_dir=str(tmp_path / "cache"))
    app = create_app(settings)
    with TestClient(app) as client:
        store = app.state.xrk_inspection_store
        token, directory, expiry = store.create_directory()
        frame, manifest = corner_fixture()
        frame.to_parquet(directory / "telemetry.parquet", index=False)
        manifest["artifacts"] = {"telemetry": "telemetry.parquet"}
        (directory / "inspection.json").write_text(json.dumps(manifest))
        store.finalize(token, directory, expiry)
        payload = dict(inspection_id=token, source_lap=1, start_session_s=10, end_session_s=15, confirmed_laps=[])
        response = client.post("/api/v1/xrk/selected-corner", json=payload)
        assert response.status_code == 200
        assert response.json()["request_id"]
        assert len(response.json()["laps"]) == 6
        assert str(tmp_path) not in response.text
        assert client.post("/api/v1/xrk/selected-corner", json={**payload, "file_path": "/etc/passwd"}).status_code == 422
        bad = client.post("/api/v1/xrk/selected-corner", json={**payload, "end_session_s": 30})
        assert bad.status_code == 422
        assert bad.json()["error_code"] == "CORNER_SELECTION_MUST_BE_FIVE_SECONDS"
        assert "Traceback" not in bad.text
        store.delete(token)
        assert client.post("/api/v1/xrk/selected-corner", json=payload).status_code == 410
