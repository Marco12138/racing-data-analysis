"""Clip relevance feedback is not a driving label; retries must be idempotent."""
import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.app.core.config import Settings
from backend.app.main import create_app
from backend.app.utils import storage


@pytest.fixture
def feedback_client(tmp_path, monkeypatch):
    """Isolate feedback storage without reading user sessions or videos."""
    database = tmp_path / "feedback.sqlite"
    monkeypatch.setattr(storage, "DB_PATH", database)
    settings = Settings(app_env="test", database_url=f"sqlite:///{database}", allowed_hosts="testserver")
    with TestClient(create_app(settings)) as client:
        yield client, database, settings


def payload(**changes):
    """Small anonymous timing label, not synthetic telemetry presented to users."""
    return {"feedback_id": "a" * 32, "clip_id": "b" * 64,
            "session_fingerprint": "test-session", "zone_id": "zone-1",
            "reference_lap": 1, "target_lap": 2, "start_s": 3.0, "end_s": 7.0,
            "verdict": "accurate", "reason": None, "locale": "zh", **changes}


@pytest.mark.parametrize("verdict", ["accurate", "partly_accurate", "inaccurate", "uncertain"])
def test_choices_persist_without_video_or_driving_confirmation(feedback_client, verdict):
    """All four choices retain their meaning and survive app initialization."""
    client, database, settings = feedback_client
    response = client.post("/api/v1/feedback/clip-selection", json=payload(verdict=verdict))
    assert response.status_code == 200
    assert response.json()["received"]
    with TestClient(create_app(settings)) as restarted:
        stats = restarted.get("/api/v1/feedback/clip-selection/stats").json()
    assert stats["total"] == 1
    assert stats["groups"][0]["verdict"] == verdict
    assert stats["verified_driving_labels"] is False
    assert "test-session" not in json.dumps(stats)
    with sqlite3.connect(database) as conn:
        saved = json.loads(conn.execute("SELECT payload_json FROM clip_selection_feedback").fetchone()[0])
        assert saved["selection_version"] == "coach-review-v1"
        assert not {"video_blob", "telemetry", "filename"} & saved.keys()
        assert conn.execute("SELECT COUNT(*) FROM coach_validations").fetchone()[0] == 0


def test_retry_and_revision_do_not_add_votes(feedback_client):
    """Changing a choice updates the same receipt; another clip cannot reuse it."""
    client, _, _ = feedback_client
    for _ in range(2):
        assert client.post("/api/v1/feedback/clip-selection", json=payload()).status_code == 200
    assert client.post("/api/v1/feedback/clip-selection", json=payload(verdict="partly_accurate", reason="too_early")).status_code == 200
    stats = client.get("/api/v1/feedback/clip-selection/stats").json()
    assert stats["total"] == 1
    assert stats["groups"][0]["reason"] == "too_early"
    conflict = client.post("/api/v1/feedback/clip-selection", json=payload(clip_id="c" * 64))
    assert conflict.status_code == 409
    assert conflict.json()["error_code"] == "CLIP_FEEDBACK_CONFLICT"


@pytest.mark.parametrize("changes", [
    {"end_s": 3}, {"end_s": 130}, {"start_s": -1}, {"verdict": "confirmed_braking"},
    {"reason": "too_late"}, {"video_blob": "private"}, {"telemetry": [1, 2]},
    {"feedback_id": "bad"}, {"target_lap": -1}, {"locale": "unknown"},
])
def test_invalid_or_private_payload_rejected(feedback_client, changes):
    """Do not accept raw data or impossible time windows on the feedback route."""
    client, _, _ = feedback_client
    assert client.post("/api/v1/feedback/clip-selection", json=payload(**changes)).status_code == 422
    assert client.get("/api/v1/feedback/clip-selection/stats").json()["total"] == 0


def test_manual_corrections_do_not_count_as_automatic_success(feedback_client):
    """Retain two separate receipts and aggregate by source and side."""
    client, database, _ = feedback_client
    assert client.post("/api/v1/feedback/clip-selection", json=payload(verdict="inaccurate", reason="too_late")).status_code == 200
    corrected = payload(feedback_id="c" * 32, clip_id="d" * 64, selection_source="manual", side="reference", sync_confirmed=True,
                        correction={"original_clip_id": "b" * 64, "original_start_s": 3, "original_end_s": 7,
                                    "anchor_video_s": 4, "anchor_session_s": 20, "anchor_distance_m": 200})
    for _ in range(2):
        assert client.post("/api/v1/feedback/clip-selection", json=corrected).status_code == 200
    stats = client.get("/api/v1/feedback/clip-selection/stats").json()
    assert stats["total"] == 2
    assert {(r["selection_source"], r["side"], r["verdict"]) for r in stats["groups"]} == {
        ("automatic", "target", "inaccurate"), ("manual", "reference", "accurate")}
    assert "anchor_session_s" not in json.dumps(stats)
    with sqlite3.connect(database) as conn:
        assert conn.execute("SELECT COUNT(*) FROM coach_validations").fetchone()[0] == 0
    assert client.post("/api/v1/feedback/clip-selection", json={**corrected, "selection_source": "automatic", "correction": None}).status_code == 409


def test_unsynchronized_manual_preview_only_accepts_uncertain(feedback_client):
    """Manual cropping alone must not establish a telemetry correspondence."""
    client, _, _ = feedback_client
    value = payload(selection_source="manual", side="target", sync_confirmed=False, correction={}, verdict="uncertain")
    assert client.post("/api/v1/feedback/clip-selection", json=value).status_code == 200
    assert client.post("/api/v1/feedback/clip-selection", json={**value, "verdict": "accurate"}).status_code == 422


@pytest.mark.parametrize("changes", [
    {"correction": None}, {"sync_confirmed": True, "correction": {}},
    {"correction": {"anchor_video_s": 5}}, {"correction": {"original_start_s": 3}},
    {"correction": {"original_clip_id": "b" * 64, "original_start_s": 9, "original_end_s": 3}},
    {"correction": {"video_filename": "private.mp4"}}, {"side": "unknown"},
])
def test_incomplete_or_private_correction_rejected(feedback_client, changes):
    """The additive contract rejects incomplete provenance and file information."""
    client, _, _ = feedback_client
    value = payload(**{"selection_source": "manual", "sync_confirmed": False, "correction": {}, "verdict": "uncertain", **changes})
    assert client.post("/api/v1/feedback/clip-selection", json=value).status_code == 422
