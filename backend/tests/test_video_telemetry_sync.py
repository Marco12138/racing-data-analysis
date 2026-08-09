"""Tests for bounded, coarse video-to-telemetry synchronization."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app.analysis.video_telemetry_sync import (
    estimate_video_telemetry_offset,
)
from backend.app.core.config import Settings
from backend.app.main import create_app
from backend.app.utils import storage


def synchronized_fixture(offset_s: float = 7.5) -> tuple[list[dict], list[dict]]:
    """Create real-valued summaries with repeated, traceable deceleration events."""
    times = np.arange(0.0, 60.0, 0.25)
    speed = np.full_like(times, 90.0)
    for center in (10.0, 26.0, 44.0):
        speed -= 18.0 * np.exp(-0.5 * ((times - center) / 0.7) ** 2)
    deceleration = np.maximum(-np.gradient(speed, times), 0.0)
    video_times = times + offset_s
    video = [
        {
            "time_s": float(time),
            "brightness": 100.0,
            "motion": float(value),
        }
        for time, value in zip(video_times, deceleration, strict=True)
    ]
    telemetry = [
        {"time_s": float(time), "speed_kmh": float(value)}
        for time, value in zip(times, speed, strict=True)
    ]
    return video, telemetry


def test_estimator_finds_coarse_offset_with_reliable_evidence() -> None:
    """Repeated matching events should produce a reliable coarse estimate."""
    video, telemetry = synchronized_fixture()

    result = estimate_video_telemetry_offset(
        video,
        telemetry,
        max_offset_s=15,
        search_step_s=0.25,
        min_overlap_s=10,
    )

    assert result["offset_ms"] == pytest.approx(7_500, abs=250)
    assert 0.7 <= result["confidence"] <= 1.0
    assert result["reliable"] is True
    assert result["evidence"]["telemetry_deceleration_events"] >= 3
    assert result["evidence"]["search_resolution_ms"] == 250
    assert "frame" not in result["evidence"]["method"]


def test_estimator_marks_unrelated_features_unreliable() -> None:
    """A numerically best candidate must not be presented as trustworthy."""
    _, telemetry = synchronized_fixture(offset_s=0)
    times = np.arange(0.0, 60.0, 0.25)
    random = np.random.default_rng(20260809)
    video = [
        {
            "time_s": float(time),
            "brightness": float(100 + random.normal(0, 4)),
            "motion": float(random.uniform(0, 1)),
        }
        for time in times
    ]

    result = estimate_video_telemetry_offset(
        video,
        telemetry,
        max_offset_s=15,
        search_step_s=0.25,
        min_overlap_s=10,
    )

    assert 0 <= result["confidence"] < 0.7
    assert result["reliable"] is False
    assert any("unreliable" in warning for warning in result["warnings"])


def test_estimator_rejects_missing_feature_data() -> None:
    """Short arrays cannot produce a plausible-looking offset."""
    with pytest.raises(ValueError, match="At least 8"):
        estimate_video_telemetry_offset(
            [{"time_s": 0, "brightness": 1, "motion": 1}],
            [{"time_s": 0, "speed_kmh": 10}],
        )


def test_auto_sync_api_prefers_temporary_inspection(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """The token path should load only its normalized Parquet speed samples."""
    client = build_client(monkeypatch, tmp_path)
    video, telemetry_rows = synchronized_fixture()
    telemetry = pd.DataFrame(telemetry_rows).rename(
        columns={"time_s": "session_time_s", "speed_kmh": "speed"}
    )
    telemetry["lap"] = 1
    telemetry["lap_time_s"] = telemetry["session_time_s"]

    with client:
        token = seed_inspection(client, telemetry, has_gps_speed=True)
        response = client.post(
            "/api/v1/xrk/video-sync/auto",
            json={
                "inspection_id": token,
                "video_features": video,
                "telemetry_speed": [
                    {"time_s": row["time_s"], "speed_kmh": 0}
                    for row in telemetry_rows
                ],
                "max_offset_s": 15,
                "search_step_s": 0.25,
                "min_overlap_s": 10,
            },
            headers={"X-Request-ID": "video-sync-success"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["offset_ms"] == pytest.approx(7_500, abs=250)
    assert body["source"] == "temporary_xrk_inspection"
    assert body["request_id"] == "video-sync-success"
    assert body["reliable"] is True


def test_auto_sync_api_requires_telemetry_source(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Missing telemetry should use the stable public error envelope."""
    client = build_client(monkeypatch, tmp_path)
    video, _ = synchronized_fixture()
    with client:
        response = client.post(
            "/api/v1/xrk/video-sync/auto",
            json={"video_features": video},
        )

    assert response.status_code == 422
    assert response.json()["error_code"] == "VIDEO_SYNC_TELEMETRY_REQUIRED"
    assert response.json()["status"] == "error"


def test_auto_sync_api_rejects_server_video_paths(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Cloud callers cannot ask the endpoint to inspect a host video path."""
    client = build_client(monkeypatch, tmp_path)
    video, telemetry = synchronized_fixture()
    with client:
        response = client.post(
            "/api/v1/xrk/video-sync/auto",
            json={
                "video_features": video,
                "telemetry_speed": telemetry,
                "video_path": "/Users/private/onboard.mp4",
            },
        )

    assert response.status_code == 422
    assert "video_path" in response.text


def test_auto_sync_api_limits_search_work(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Anonymous requests cannot multiply bounded arrays into huge searches."""
    client = build_client(monkeypatch, tmp_path)
    video, telemetry = synchronized_fixture()
    with client:
        response = client.post(
            "/api/v1/xrk/video-sync/auto",
            json={
                "video_features": video,
                "telemetry_speed": telemetry,
                "max_offset_s": 1_800,
                "search_step_s": 0.05,
            },
        )

    assert response.status_code == 422
    assert response.json()["error_code"] == "VIDEO_SYNC_SEARCH_LIMIT_EXCEEDED"


def test_auto_sync_api_returns_410_for_expired_token(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Expired inspection identifiers should retain the XRK API contract."""
    client = build_client(monkeypatch, tmp_path)
    video, _ = synchronized_fixture()
    with client:
        response = client.post(
            "/api/v1/xrk/video-sync/auto",
            json={
                "inspection_id": "a" * 32,
                "video_features": video,
            },
        )

    assert response.status_code == 410
    assert response.json()["error_code"] == "XRK_INSPECTION_EXPIRED"


def test_auto_sync_api_rejects_inspection_without_gps_speed(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Other XRK channels remain usable, but automatic sync needs real speed."""
    client = build_client(monkeypatch, tmp_path)
    video, telemetry_rows = synchronized_fixture()
    telemetry = pd.DataFrame(telemetry_rows).rename(
        columns={"time_s": "session_time_s", "speed_kmh": "speed"}
    )
    with client:
        token = seed_inspection(client, telemetry, has_gps_speed=False)
        response = client.post(
            "/api/v1/xrk/video-sync/auto",
            json={"inspection_id": token, "video_features": video},
        )

    assert response.status_code == 422
    assert response.json()["error_code"] == "XRK_GPS_SPEED_UNAVAILABLE"


def build_client(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> TestClient:
    """Create a cloud-mode app with isolated persistence."""
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "sessions.sqlite3")
    settings = Settings(
        app_env="test",
        app_mode="cloud",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
        xrk_inspection_cache_dir=str(tmp_path / "cache"),
    )
    return TestClient(create_app(settings))


def seed_inspection(
    client: TestClient,
    telemetry: pd.DataFrame,
    *,
    has_gps_speed: bool,
) -> str:
    """Write a minimal normalized inspection without any original video/XRK."""
    store = client.app.state.xrk_inspection_store
    token, directory, _ = store.create_directory()
    telemetry.to_parquet(directory / "telemetry.parquet", index=False)
    manifest = {
        "has_gps_speed": has_gps_speed,
        "artifacts": {"telemetry": "telemetry.parquet"},
    }
    (directory / "inspection.json").write_text(
        json.dumps(manifest), encoding="utf-8"
    )
    store.finalize(
        token,
        directory,
        datetime.now(UTC) + timedelta(minutes=30),
    )
    return token
