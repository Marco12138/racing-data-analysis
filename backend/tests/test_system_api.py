"""Tests for production-facing system and API configuration behavior."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.core.config import Settings
from backend.app.main import create_app
from backend.app.utils import storage


def test_cloud_mode_disables_local_video_library(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """A public cloud API must not expose its host filesystem as a video library."""
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "sessions.sqlite3")
    settings = Settings(
        app_env="test",
        app_mode="cloud",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
        cors_origins="https://frontend.example",
    )

    with TestClient(create_app(settings)) as client:
        capabilities = client.get(
            "/api/v1/system/capabilities",
            headers={"X-Request-ID": "test-request-id"},
        )
        assert capabilities.status_code == 200
        assert capabilities.json()["local_video_library"] is False
        assert capabilities.headers["X-Request-ID"] == "test-request-id"

        library = client.get("/api/v1/video/library")
        assert library.status_code == 503
        assert "disabled in cloud mode" in library.json()["detail"]


def test_versioned_health_and_csv_validation(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Versioned health routes should work and invalid uploads should fail clearly."""
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "sessions.sqlite3")
    settings = Settings(
        app_env="test",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
        max_csv_upload_bytes=1024,
    )

    with TestClient(create_app(settings)) as client:
        ready = client.get("/api/v1/system/health/ready")
        assert ready.status_code == 200
        assert ready.json()["status"] == "ready"

        public_health = client.get("/api/v1/health")
        assert public_health.status_code == 200
        assert public_health.json() == {"status": "ok"}

        invalid = client.post(
            "/api/v1/analysis",
            files={"lap_file": ("laps.txt", b"lap,lap_time\n1,50.0\n", "text/plain")},
        )
        assert invalid.status_code == 400
        assert invalid.json()["detail"] == "Only CSV files are accepted."
