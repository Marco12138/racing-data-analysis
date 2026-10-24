"""Real-lap statistics and spatially linked driver review regression tests."""

from copy import deepcopy

import numpy as np
import pytest

from backend.app.analysis.driver_review import build_driver_review, fastest_five_summary
from backend.app.analysis.review_context import review_context, verify_section_path
from backend.app.analysis.selected_corner import _profile
import pandas as pd
from backend.tests.test_cross_session_analysis import manifest_fixture
from backend.tests.test_xrk_track_analysis import telemetry_fixture
from backend.tests.test_cross_session_api import build_client, upload


def manifests(tmp_path):
    """Use declared mock GPS provenance, never a private recording fixture."""
    rows = [manifest_fixture(tmp_path / key) for key in ("a", "b")]
    for row in rows:
        row["channel_provenance"] = {"speed": {"source": "gps_receiver"}}
    return rows


def test_fastest_five_exact_population_variance():
    """Only eligible rows enter the five-fastest descriptive population."""
    rows = [{"lap": i + 1, "lap_time": 40 + i / 10, "analysis_eligible": True} for i in range(7)]
    rows.append({"lap": 9, "lap_time": 10, "analysis_eligible": False})
    summary = fastest_five_summary({"laps": rows})
    assert [r["lap"] for r in summary["laps"]] == [1, 2, 3, 4, 5]
    assert summary["variance_s2"] == pytest.approx(np.var([40, 40.1, 40.2, 40.3, 40.4], ddof=0))
    assert fastest_five_summary({"laps": rows[:4]})["variance_s2"] is None


def test_clip_minima_use_observed_samples_not_sparse_plot_grid():
    frame = pd.DataFrame({"distance_m": np.arange(201), "speed": 70., "rpm": 10000.})
    frame.loc[103, ["speed", "rpm"]] = [30., 6000.]
    result = _profile(frame)
    assert result["metrics"]["minimum_speed_kmh"] == 30
    assert result["metrics"]["minimum_rpm"] == 6000
    assert min(result["speed"]) > 30


def test_shared_gates_and_different_sampling_rates(tmp_path):
    """Independent rate changes must preserve physical crossing times, not array positions."""
    a, b = manifests(tmp_path)
    data = telemetry_fixture()
    result = build_driver_review(data, a, data.iloc[::2], b, source_start_s=2)
    corner = result["corners"][0]
    assert result["registration"]["status"] == "accepted"
    assert corner["status"] == "candidate", corner
    assert abs(corner["difference_s"]) < .03
    assert corner["a"]["elapsed_s"] == 5
    assert corner["a"]["driver_input_confirmed"] is False
    assert result["synthetic_curve_generated"] is False


def test_logger_start_offsets_do_not_change_shared_location(tmp_path):
    """A shifted logger origin is not interpreted as a physical corner displacement."""
    a, b = manifests(tmp_path)
    data = telemetry_fixture()
    shifted = data.copy()
    shifted["session_time_s"] += 50
    for lap in b["lap_timing"]:
        lap["start_time_ms"] += 50000
        lap["end_time_ms"] += 50000
    result = build_driver_review(data, a, shifted, b, source_start_s=2)
    c = result["corners"][0]
    assert c["b"]["start_session_s"] - c["a"]["start_session_s"] == pytest.approx(50, abs=.03)
    assert c["difference_s"] == pytest.approx(0, abs=.03)


def test_missing_gps_rpm_and_bad_provenance(tmp_path):
    """Missing channels never fabricate dynamic observations."""
    a, b = manifests(tmp_path)
    data = telemetry_fixture().drop(columns="rpm")
    result = build_driver_review(data, a, data, b, source_start_s=2)
    assert result["corners"][0]["a"]["metrics"]["minimum_rpm"] is None
    b["channel_provenance"] = {}
    assert build_driver_review(data, a, data, b)["corners"] == []
    no_gps = data.drop(columns=["gps_lat", "gps_lon"])
    result = build_driver_review(no_gps, a, no_gps, b)
    assert result["sessions"]["a"]["fastest_five"]["fastest"]
    assert result["corners"] == []


def test_gap_invalid_lap_and_other_track(tmp_path):
    """Unsafe intervals remain unavailable rather than being bridged or relabelled."""
    a, b = manifests(tmp_path)
    data = telemetry_fixture()
    with pytest.raises(ValueError, match="Quality Gate"):
        build_driver_review(data, a, data, b, lap_b=2)
    broken = data[~data.session_time_s.between(4, 5)]
    result = build_driver_review(data, a, broken, b, source_start_s=2)
    assert result["corners"][0]["status"] == "unavailable"
    other = deepcopy(b)
    other["metadata"]["Venue"] = "Different circuit"
    with pytest.raises(ValueError, match="different tracks"):
        build_driver_review(data, a, data, other)


def test_review_api_contract_and_deleted_token(monkeypatch, tmp_path):
    """New API keeps structured failures and existing token expiry semantics."""
    with build_client(monkeypatch, tmp_path, ["A", "B"]) as client:
        a, b = upload(client, "a.xrk"), upload(client, "b.xrk")
        payload = {"session_a": {"inspection_id": a["inspection_id"]}, "session_b": {"inspection_id": b["inspection_id"]}}
        response = client.post("/api/v1/comparisons/review", json=payload)
        assert response.status_code == 200, response.text
        assert response.json()["synthetic_curve_generated"] is False
        assert response.json()["sessions"]["a"]["fastest_five"]["count"] == 1
        client.delete(f"/api/v1/xrk/inspections/{b['inspection_id']}")
        response = client.post("/api/v1/comparisons/review", json=payload)
        assert response.status_code == 410
        assert response.json()["error_code"] == "XRK_INSPECTION_EXPIRED"


def test_context_includes_approach_and_recovery_without_pedal_claims():
    t = np.arange(0, 16, .04)
    speed = np.interp(t, [0, 4, 7, 11, 16], [65, 70, 30, 70, 70])
    frame = pd.DataFrame({"session_time_s": t, "speed": speed})
    context = review_context(frame, 6, 11)
    assert context["start_session_s"] < 4
    assert context["end_session_s"] >= 11
    assert context["seed_start_s"] == 6
    assert context["driver_input_confirmed"] is False
    assert review_context(frame[~frame.session_time_s.between(4, 5)], 6, 11)["status"] == "partial"
    assert review_context(frame.assign(speed=65), 6, 11)["status"] == "partial"


def test_matching_gates_do_not_accept_a_different_route_between_them():
    x = np.linspace(0, 100, 101)
    a = np.c_[x, np.zeros_like(x)]
    b = np.c_[x, 15 * np.sin(x * np.pi / 100)]
    assert np.allclose(a[[0, -1]], b[[0, -1]])
    with pytest.raises(ValueError, match="gps_inconsistent"):
        verify_section_path(a, b)
    assert verify_section_path(a, a + [0, .3])["p95_m"] < 1


def test_context_is_opt_in_and_uses_same_gate_endpoints(tmp_path):
    a, b = manifests(tmp_path)
    data = telemetry_fixture()
    seed = build_driver_review(data, a, data, b, source_start_s=2)
    result = build_driver_review(data, a, data, b, source_start_s=2, include_context=True)
    assert "context" not in seed["corners"][0]
    row = result["corners"][0]
    assert row["context"]["seed_end_s"] == 7
    if row["status"] == "candidate":
        assert row["a"]["elapsed_s"] == pytest.approx(row["b"]["elapsed_s"], abs=.03)
        assert row["path_check"]["visual_confirmation_required"] is True
