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


def test_missing_xrk_file_returns_traceable_public_error(tmp_path: Path) -> None:
    """An empty Safari multipart upload should not expose Pydantic internals."""
    settings = Settings(
        app_env="test",
        app_mode="cloud",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
        cors_origins="https://frontend.example",
        xrk_inspection_cache_dir=str(tmp_path / "cache"),
    )
    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/v1/xrk/inspect",
            headers={"X-Request-ID": "missing-file-test"},
        )

    assert response.status_code == 422
    assert response.json() == {
        "status": "error",
        "error_code": "XRK_UPLOAD_MISSING_FILE",
        "message": (
            "The XRK file was not attached to the upload request. "
            "Please select the file again."
        ),
        "request_id": "missing-file-test",
    }
    assert response.headers["X-Request-ID"] == "missing-file-test"


def test_raw_browser_upload_reaches_xrk_parser(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Raw browser uploads avoid multipart bodies being dropped by a proxy."""
    async def fake_inspection(_: Path, output_dir: Path, __: int) -> None:
        write_inspection(output_dir)

    monkeypatch.setattr(xrk_routes, "run_xrk_inspection", fake_inspection)
    settings = Settings(
        app_env="test",
        app_mode="local",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
        cors_origins="http://localhost:3000",
        xrk_inspection_cache_dir=str(tmp_path / "cache"),
        max_xrk_upload_bytes=1024,
    )
    with TestClient(create_app(settings)) as client:
        preflight = client.options(
            "/api/v1/xrk/inspect",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-xrk-filename",
            },
        )
        response = client.post(
            "/api/v1/xrk/inspect",
            content=b"<hCNFreal-parser-mocked",
            headers={
                "Content-Type": "application/octet-stream",
                "X-XRK-Filename": "driver%20session.xrk",
            },
        )

    assert preflight.status_code == 200
    assert "x-xrk-filename" in preflight.headers["access-control-allow-headers"].lower()
    assert response.status_code == 200
    assert response.json()["filename"] == "driver session.xrk"
    assert response.json()["laps"] == 2


def test_local_xrk_library_inspects_whitelisted_file(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Local mode should bypass browser transfer without exposing file paths."""
    source_root = tmp_path / "logs"
    source_root.mkdir()
    (source_root / "driver session.xrk").write_bytes(b"<hCNFreal-parser-mocked")
    monkeypatch.setenv("RACING_XRK_ROOTS", str(source_root))

    async def fake_inspection(_: Path, output_dir: Path, __: int) -> None:
        write_inspection(output_dir)

    monkeypatch.setattr(xrk_routes, "run_xrk_inspection", fake_inspection)
    settings = Settings(
        app_env="test",
        app_mode="local",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
        cors_origins="http://localhost:3000",
        xrk_inspection_cache_dir=str(tmp_path / "cache"),
        max_xrk_upload_bytes=1024,
    )
    with TestClient(create_app(settings)) as client:
        library = client.get("/api/v1/xrk/local-library")
        assert library.status_code == 200
        source = library.json()["sources"][0]
        assert source["name"] == "driver session.xrk"
        assert str(tmp_path) not in json.dumps(source)
        inspected = client.post(
            "/api/v1/xrk/inspect-local",
            json={"source_id": source["source_id"]},
        )

    assert inspected.status_code == 200
    assert inspected.json()["laps"] == 2


def test_local_xrk_library_is_unavailable_in_cloud_mode(tmp_path: Path) -> None:
    """Cloud deployments must never expose server filesystem discovery."""
    settings = Settings(
        app_env="test",
        app_mode="cloud",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
        cors_origins="https://example.com",
        xrk_inspection_cache_dir=str(tmp_path / "cache"),
    )
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/v1/xrk/local-library")

    assert response.status_code == 503
    assert response.json()["error_code"] == "XRK_LOCAL_LIBRARY_UNAVAILABLE"


def test_inspect_analyze_delete_contract(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """The token should inspect, recalculate, delete, then return 410."""
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "sessions.sqlite3")

    async def fake_narrative(evidence: dict) -> str:
        assert "comparison" not in evidence
        assert "track" not in evidence
        return "训练重点一：保持真实圈参考。"

    monkeypatch.setattr(xrk_routes, "generate_llm_narrative", fake_narrative)

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
        assert "theoretical_best" not in result["sectors"]
        assert result["lap_quality"]["top_valid_laps"][0]["lap"] == 1
        assert result["top_laps_comparison"]["synthetic_curve_generated"] is False
        assert result["consensus_benchmark"]["synthetic_curve_generated"] is False
        assert "theoretical" not in result["report"].lower()
        assert set(result["evidence_catalog"]) == {"measured", "calculated", "inferred"}
        assert result["narrative"] == "训练重点一：保持真实圈参考。"

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
