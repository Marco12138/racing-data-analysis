"""Cross-session real-lap and setup experiment API tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.api import xrk_routes
from backend.app.core.config import Settings
from backend.app.main import create_app
from backend.app.utils import storage
from backend.tests.test_xrk_analysis_api import write_inspection


def build_client(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    drivers: list[str],
    *,
    max_comparison_points: int = 5_000,
) -> TestClient:
    """Create an app whose mocked parser emits the requested driver names."""
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "sessions.sqlite3")
    calls = iter(drivers)

    async def fake_inspection(_: Path, output_dir: Path, __: int) -> None:
        write_inspection(output_dir)
        manifest_path = output_dir / "inspection.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["metadata"]["Driver"] = next(calls)
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    monkeypatch.setattr(xrk_routes, "run_xrk_inspection", fake_inspection)
    settings = Settings(
        app_env="test",
        app_mode="cloud",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
        cors_origins="https://frontend.example",
        xrk_inspection_cache_dir=str(tmp_path / "cache"),
        max_xrk_upload_bytes=1024,
        xrk_max_comparison_points=max_comparison_points,
    )
    return TestClient(create_app(settings))


def upload(client: TestClient, name: str) -> dict:
    response = client.post(
        "/api/v1/xrk/inspect",
        files={"file": (name, b"<hCNFmocked", "application/octet-stream")},
    )
    assert response.status_code == 200
    return response.json()


def test_restore_and_compare_two_temporary_sessions(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Two independent tokens should restore and compare real eligible laps."""
    with build_client(monkeypatch, tmp_path, ["Driver A", "Driver B"]) as client:
        first = upload(client, "a.xrk")
        second = upload(client, "b.xrk")

        restored = client.get(f"/api/v1/xrk/inspections/{first['inspection_id']}")
        assert restored.status_code == 200
        assert restored.json()["filename"] == "a.xrk"
        assert "artifacts" not in restored.json()

        compared = client.post(
            "/api/v1/comparisons/laps",
            json={
                "session_a": {"inspection_id": first["inspection_id"]},
                "session_b": {"inspection_id": second["inspection_id"]},
                "distance_step_m": 2,
            },
        )
        assert compared.status_code == 200, compared.text
        result = compared.json()
        assert result["sessions"]["a"]["selected_lap"] == 1
        assert result["sessions"]["b"]["selected_lap"] == 1
        assert result["comparison"]
        assert result["track"]["a"] and result["track"]["b"]
        assert result["synthetic_curve_generated"] is False
        assert "theoretical" not in result["report"].lower()


def test_setup_experiment_uses_real_top_laps_and_reports_confounders(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Same-driver sessions may be evaluated without filling a synthetic Top 3."""
    with build_client(monkeypatch, tmp_path, ["Marco", "Marco"]) as client:
        baseline = upload(client, "baseline.xrk")
        modified = upload(client, "modified.xrk")
        response = client.post(
            "/api/v1/setup-experiments/analyze",
            json={
                "baseline_inspection_id": baseline["inspection_id"],
                "modified_inspection_id": modified["inspection_id"],
                "experiment": {
                    "name": "Rear pressure check",
                    "primary_change": {
                        "category": "tire_pressure",
                        "parameter": "rear_cold_pressure_psi",
                        "before": 11.5,
                        "after": 11.0,
                        "unit": "psi",
                    },
                    "secondary_changes": [{
                        "category": "other",
                        "parameter": "fuel",
                        "before": "unknown",
                        "after": "unknown",
                    }],
                    "conditions": {"track_condition": "dry"},
                    "driver_feedback": {"corner_exit": "More stable"},
                },
            },
        )
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["baseline"]["lap_count"] == 1
        assert result["modified"]["lap_count"] == 1
        assert result["synthetic_curve_generated"] is False
        assert result["confounders"]
        assert result["next_test"]
        assert "theoretical" not in result["report"].lower()


def test_setup_experiment_rejects_different_drivers(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Driver differences must not be presented as setup causation."""
    with build_client(monkeypatch, tmp_path, ["A", "B"]) as client:
        baseline = upload(client, "a.xrk")
        modified = upload(client, "b.xrk")
        response = client.post(
            "/api/v1/setup-experiments/analyze",
            json={
                "baseline_inspection_id": baseline["inspection_id"],
                "modified_inspection_id": modified["inspection_id"],
                "experiment": {
                    "name": "Invalid causal comparison",
                    "primary_change": {
                        "category": "axle",
                        "parameter": "axle_stiffness",
                        "before": "medium",
                        "after": "soft",
                    },
                },
            },
        )
        assert response.status_code == 422
        assert response.json()["error_code"] == "SETUP_EXPERIMENT_DATA_INCOMPATIBLE"
        assert "same identified driver" in response.json()["message"]


def test_comparison_returns_expired_token_contract(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """A deleted or expired inspection must retain the stable public 410 contract."""
    with build_client(monkeypatch, tmp_path, ["A", "B"]) as client:
        first = upload(client, "a.xrk")
        second = upload(client, "b.xrk")
        client.delete(f"/api/v1/xrk/inspections/{first['inspection_id']}")

        response = client.post(
            "/api/v1/comparisons/laps",
            json={
                "session_a": {"inspection_id": first["inspection_id"]},
                "session_b": {"inspection_id": second["inspection_id"]},
            },
        )

        assert response.status_code == 410
        assert response.json()["error_code"] == "XRK_INSPECTION_EXPIRED"
        assert "expired" in response.json()["message"].lower()


def test_comparison_rejects_requested_lap_outside_quality_gate(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """A requested lap must be a real lap accepted by the quality gate."""
    with build_client(monkeypatch, tmp_path, ["A", "B"]) as client:
        first = upload(client, "a.xrk")
        second = upload(client, "b.xrk")

        response = client.post(
            "/api/v1/comparisons/laps",
            json={
                "session_a": {"inspection_id": first["inspection_id"], "lap": 999},
                "session_b": {"inspection_id": second["inspection_id"]},
            },
        )

        assert response.status_code == 422
        assert response.json()["error_code"] == "CROSS_SESSION_DATA_INCOMPATIBLE"
        assert "did not pass the Lap Quality Gate" in response.json()["message"]


def test_comparison_api_accepts_manual_zones_and_caps_response(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """The public endpoint should pass manual zones and enforce configured row caps."""
    with build_client(
        monkeypatch,
        tmp_path,
        ["A", "B"],
        max_comparison_points=100,
    ) as client:
        first = upload(client, "a.xrk")
        second = upload(client, "b.xrk")

        response = client.post(
            "/api/v1/comparisons/laps",
            json={
                "session_a": {"inspection_id": first["inspection_id"]},
                "session_b": {"inspection_id": second["inspection_id"]},
                "distance_step_m": 0.25,
                "manual_zones": [{
                    "id": "manual-t1",
                    "name": "Manual T1",
                    "entry_distance_m": 25.0,
                    "exit_distance_m": 75.0,
                }],
            },
        )

        assert response.status_code == 200, response.text
        result = response.json()
        assert len(result["comparison"]) == 100
        assert len(result["track"]["a"]) == 100
        assert result["zones"][0]["id"] == "manual-t1"
        assert result["zones"][0]["source"] == "manual"
