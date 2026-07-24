"""Two-stage XRK API tests using normalized mock telemetry."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.api import xrk_routes
from backend.app.core.config import Settings
from backend.app.importers.inspection_store import InspectionExpiredError, InspectionStore
from backend.app.main import create_app
from backend.app.utils import storage
from backend.tests.test_xrk_track_analysis import telemetry_fixture


def write_inspection(output_dir: Path) -> None:
    """Write the same artifacts a parser worker would create."""
    output_dir.mkdir(parents=True, exist_ok=True)
    telemetry_fixture().to_parquet(output_dir / "telemetry.parquet", index=False)
    manifest = {
        "filename": "fixture.xrk",
        "file_size_bytes": 321,
        "fingerprint": "fixture",
        "parser": {
            "library": "libxrk",
            "version": "test",
            "license": "MIT",
            "status": "beta",
            "platform": "cross-platform",
        },
        "metadata": {"Driver": "Fixture", "Vehicle": "Kart", "Venue": "Test Track"},
        "laps": 2,
        "valid_laps": [1, 2],
        "lap_timing": [
            {"lap": 1, "start_time_ms": 0, "end_time_ms": 10_000, "duration_s": 10.0},
            {"lap": 2, "start_time_ms": 12_000, "end_time_ms": 22_600, "duration_s": 10.6},
        ],
        "excluded_laps": [],
        "channels": [
            {
                "name": "RPM",
                "canonical_name": "rpm",
                "unit": "rpm",
                "sample_count": 217,
                "available": True,
                "all_zero": False,
            }
        ],
        "has_gps": True,
        "has_rpm": True,
        "has_lap_timing": True,
        "has_predefined_sectors": False,
        "available_canonical_channels": [
            "gps_lat",
            "gps_lon",
            "speed",
            "rpm",
            "longitudinal_g",
            "lateral_g",
        ],
        "telemetry_rows": 217,
        "warnings": ["Official sectors unavailable."],
        "artifacts": {"telemetry": "telemetry.parquet"},
    }
    (output_dir / "inspection.json").write_text(json.dumps(manifest), encoding="utf-8")


def test_inspect_analyze_delete_contract(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """The token should inspect, recalculate, delete, then return 410."""
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "sessions.sqlite3")

    async def fake_inspection(_: Path, output_dir: Path, __: int) -> None:
        write_inspection(output_dir)

    monkeypatch.setattr(xrk_routes, "run_xrk_inspection", fake_inspection)
    settings = Settings(
        app_env="test",
        app_mode="cloud",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
        cors_origins="https://frontend.example",
        xrk_inspection_cache_dir=str(tmp_path / "cache"),
        max_xrk_upload_bytes=1024,
    )
    with TestClient(create_app(settings)) as client:
        inspected = client.post(
            "/api/v1/xrk/inspect",
            files={"file": ("fixture.xrk", b"<hCNFreal-parser-mocked", "application/octet-stream")},
        )
        assert inspected.status_code == 200
        body = inspected.json()
        assert body["laps"] == 2
        assert body["has_gps"] is True
        assert body["channels"][0]["canonical_name"] == "rpm"
        assert "artifacts" not in body
        token = body["inspection_id"]

        analyzed = client.post(
            "/api/v1/xrk/analyze",
            json={
                "inspection_id": token,
                "target_lap": 2,
                "distance_step_m": 2,
                "sector_count": 3,
            },
        )
        assert analyzed.status_code == 200
        result = analyzed.json()
        assert result["reference_lap"] == 1
        assert result["target_lap"] == 2
        assert result["file_fingerprint"] == "fixture"
        assert result["fastest_lap"]["lap_time"] == pytest.approx(10.0)
        assert min(row["lap_time"] for row in result["sectors"]["lap_rows"]) == pytest.approx(10.0)
        assert result["track"]["reference"]
        assert result["comparison"]
        assert result["sectors"]["official"] is False
        assert result["sectors"]["sector_best"]
        assert result["sectors"]["theoretical_best"] > 0
        assert set(result["evidence_catalog"]) == {"measured", "calculated", "inferred"}

        assert client.delete(f"/api/v1/xrk/inspections/{token}").json() == {
            "deleted": True
        }
        expired = client.post(
            "/api/v1/xrk/analyze",
            json={"inspection_id": token},
        )
        assert expired.status_code == 410
        assert expired.json()["error_code"] == "XRK_INSPECTION_EXPIRED"
        assert "expired" in expired.json()["message"]


def test_inspect_rejects_invalid_signature_with_structured_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Renamed files should never reach the native parser process."""
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "sessions.sqlite3")
    settings = Settings(
        app_env="test",
        app_mode="cloud",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
        xrk_inspection_cache_dir=str(tmp_path / "cache"),
    )
    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/v1/xrk/inspect",
            files={"file": ("renamed.xrk", b"not-an-aim-file", "application/octet-stream")},
            headers={"X-Request-ID": "signature-test"},
        )
    assert response.status_code == 400
    assert response.json() == {
        "status": "error",
        "error_code": "XRK_UNSUPPORTED_FORMAT",
        "message": "The uploaded file does not have a supported AiM XRK/XRZ signature.",
        "request_id": "signature-test",
    }
    assert response.headers["X-Request-ID"] == "signature-test"


def test_inspect_reports_disabled_parser_capability(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """The upload endpoint should use the same real capability as the UI."""
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "sessions.sqlite3")
    settings = Settings(
        app_env="test",
        app_mode="cloud",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
        xrk_inspection_cache_dir=str(tmp_path / "cache"),
        xrk_server_import_enabled=False,
    )
    with TestClient(create_app(settings)) as client:
        capability = client.get("/api/v1/capabilities").json()
        response = client.post(
            "/api/v1/xrk/inspect",
            files={"file": ("fixture.xrk", b"<hCNFfixture", "application/octet-stream")},
        )

    assert capability["aim_imports"] is False
    assert capability["xrk_server_import"]["status"] == "disabled"
    assert response.status_code == 400
    assert response.json()["error_code"] == "XRK_UPLOAD_REJECTED"


def test_inspection_store_has_fixed_expiry(tmp_path: Path) -> None:
    """Loading must not renew a temporary inspection's fixed expiry."""
    store = InspectionStore(tmp_path / "cache", ttl_seconds=60)
    token, directory, _ = store.create_directory()
    write_inspection(directory)
    expired_at = datetime.now(UTC) - timedelta(seconds=1)
    store.finalize(token, directory, expired_at)

    with pytest.raises(InspectionExpiredError):
        store.load(token)
    assert not directory.exists()
