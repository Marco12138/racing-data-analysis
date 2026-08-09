"""Public Demo session contract and reviewed-artifact provenance tests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from backend.app.core.config import Settings
from backend.app.main import create_app
from backend.app.resources.demo_session import (
    TRACK_THUMBNAIL_MAX_POINTS,
    build_demo_session_payload,
)
from backend.app.utils import storage

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
REVIEWED_ARTIFACT = REPOSITORY_ROOT / "public/demo/reviewed-real-session.json"
PACKAGE_RESOURCE = REPOSITORY_ROOT / "backend/app/resources/demo_session.json"


def test_package_resource_matches_reviewed_real_artifact() -> None:
    """Every public number must be selected from the reviewed real analysis."""
    reviewed = json.loads(REVIEWED_ARTIFACT.read_text(encoding="utf-8"))
    packaged = json.loads(PACKAGE_RESOURCE.read_text(encoding="utf-8"))

    assert packaged == build_demo_session_payload(reviewed)
    assert packaged["provenance"]["derived_from_real_session"] is True
    assert packaged["fastest_lap"] == reviewed["analysis"]["fastest_lap"]
    assert packaged["lap_rows"] == reviewed["analysis"]["lap_rows"]
    assert len(packaged["track"]["points"]) == TRACK_THUMBNAIL_MAX_POINTS

    source_sector_loss = reviewed["analysis"]["sectors"]["analysis"][
        "sector_loss"
    ]
    assert [row["lap"] for row in packaged["sector_loss"]["laps"]] == [
        row["lap"] for row in source_sector_loss
    ]
    assert [row["total_loss_s"] for row in packaged["sector_loss"]["laps"]] == [
        row["total_loss"] for row in source_sector_loss
    ]


def test_demo_session_endpoint_has_stable_contract_and_cache_headers(
    monkeypatch,
    tmp_path: Path,
) -> None:
    """The cloud-safe endpoint should not depend on the native XRK parser."""
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "sessions.sqlite3")
    settings = Settings(
        app_env="test",
        app_mode="cloud",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
        cors_origins="https://frontend.example",
        xrk_server_import_enabled=False,
        local_video_enabled=False,
        xrk_inspection_cache_dir=str(tmp_path / "inspection-cache"),
    )

    with TestClient(create_app(settings)) as client:
        response = client.get("/api/v1/xrk/demo-session")
        openapi = client.get("/openapi.json").json()

    assert response.status_code == 200
    assert response.headers["cache-control"] == (
        "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
    )
    body = response.json()
    assert list(body) == [
        "schema_version",
        "provenance",
        "display",
        "fastest_lap",
        "lap_rows",
        "track",
        "sector_loss",
        "summary",
        "synthetic_curve_generated",
    ]
    assert body["fastest_lap"] == {"lap": 13, "lap_time": 40.326}
    assert len(body["lap_rows"]) == 13
    assert body["summary"]["source"] in {"llm", "structured"}
    response_schema = openapi["paths"]["/api/v1/xrk/demo-session"]["get"][
        "responses"
    ]["200"]["content"]["application/json"]["schema"]
    assert response_schema["$ref"].endswith("/DemoSessionResponse")


def test_demo_session_contains_no_private_or_synthetic_reference_data() -> None:
    """The bundled payload must remain anonymous and use only local XY points."""
    packaged = json.loads(PACKAGE_RESOURCE.read_text(encoding="utf-8"))
    keys = {key.lower() for key in _walk_keys(packaged)}
    serialized = json.dumps(packaged, ensure_ascii=False).lower()

    assert packaged["synthetic_curve_generated"] is False
    assert "theoretical_best" not in keys
    assert "theoretical_lap_time" not in keys
    assert "theoretical_rpm_curve" not in keys
    assert "theoretical best" not in serialized
    assert not keys.intersection(
        {
            "gps_lat",
            "gps_lon",
            "latitude",
            "longitude",
            "filename",
            "file_path",
            "temporary_path",
        }
    )
    for private_fragment in (
        "/users/",
        "ren_kosmic",
        "wsk-wuhan",
        "marco",
        ".xrk",
        ".xrz",
    ):
        assert private_fragment not in serialized


def _walk_keys(value: Any) -> list[str]:
    """Collect nested mapping keys for privacy and contract assertions."""
    if isinstance(value, dict):
        return list(value) + [
            key
            for nested in value.values()
            for key in _walk_keys(nested)
        ]
    if isinstance(value, list):
        return [key for nested in value for key in _walk_keys(nested)]
    return []
