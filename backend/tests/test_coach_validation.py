"""API and persistence tests for three-state coach detector labels."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.core.config import Settings
from backend.app.main import create_app
from backend.app.utils import storage


def test_coach_can_confirm_reject_or_mark_pattern_uncertain(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    database = tmp_path / "coach.sqlite3"
    monkeypatch.setattr(storage, "DB_PATH", database)
    settings = Settings(
        app_env="test",
        database_url=f"sqlite:///{database}",
        allowed_hosts="testserver",
    )
    payload = {
        "inspection_id": "a" * 32,
        "episode_id": "lap-2-brake-1",
        "pattern_id": "lap-2-brake-1:brake_release_abrupt",
        "pattern_type": "BRAKE_RELEASE_ABRUPT",
        "locale": "zh",
        "notes": "视频中可见快速松刹",
    }

    with TestClient(create_app(settings)) as client:
        for verdict in ("confirmed", "rejected", "uncertain"):
            response = client.post(
                "/api/v1/feedback/coach-validation",
                json={**payload, "verdict": verdict},
            )
            assert response.status_code == 200
            assert response.json()["verdict"] == verdict

    with sqlite3.connect(database) as conn:
        rows = conn.execute(
            "SELECT verdict, notes FROM coach_validations ORDER BY id"
        ).fetchall()
        columns = {
            row[1] for row in conn.execute("PRAGMA table_info(coach_validations)")
        }
    assert rows == [
        ("confirmed", "视频中可见快速松刹"),
        ("rejected", "视频中可见快速松刹"),
        ("uncertain", "视频中可见快速松刹"),
    ]
    assert "telemetry_json" not in columns
    assert "video_blob" not in columns


def test_coach_validation_rejects_unknown_detector_label(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    database = tmp_path / "coach.sqlite3"
    monkeypatch.setattr(storage, "DB_PATH", database)
    settings = Settings(
        app_env="test",
        database_url=f"sqlite:///{database}",
        allowed_hosts="testserver",
    )
    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/v1/feedback/coach-validation",
            json={
                "inspection_id": "a" * 32,
                "episode_id": "lap-2-brake-1",
                "pattern_id": "untrusted",
                "pattern_type": "TRAIL_BRAKING_GOOD",
                "verdict": "confirmed",
                "locale": "en",
            },
        )
    assert response.status_code == 422
