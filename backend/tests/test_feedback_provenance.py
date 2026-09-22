"""Demo, forged and historical feedback must not become real coaching evidence."""

import json
import sqlite3
from types import SimpleNamespace

from fastapi.testclient import TestClient

from backend.app.core.config import Settings
from backend.app.main import create_app
from backend.app.utils import storage
from scripts.render_feedback_stats import aggregate_feedback, load_feedback_rows


def test_feedback_provenance_is_server_resolved(tmp_path, monkeypatch):
    """Reject explicit demo/forgeries, quarantine old clients, accept a live source."""
    db = tmp_path / "feedback.sqlite"
    monkeypatch.setattr(storage, "DB_PATH", db)
    app = create_app(Settings(app_env="test", app_mode="cloud", allowed_hosts="testserver", database_url=f"sqlite:///{db}", xrk_inspection_cache_dir=str(tmp_path / "cache")))
    base = {"node_id": "priority-1", "source": "structured", "locale": "zh", "thumbs_up": True}
    with TestClient(app) as client:
        for fields in ({"data_origin": "demo"}, {"token": "published-demo"}, {"token": "published-demo", "data_origin": "real"}):
            r = client.post("/api/v1/feedback", json={**base, **fields})
            assert r.status_code == 422 and r.json()["error_code"] == "DEMO_FEEDBACK_DISABLED"
        assert client.post("/api/v1/feedback", json={**base, "token": "a" * 32, "data_origin": "real"}).status_code == 410
        assert client.post("/api/v1/feedback", json=base).status_code == 200
        stats = client.get("/api/v1/feedback/stats").json()
        assert stats["total"] == 0 and stats["excluded_unverified_count"] == 1
        monkeypatch.setattr(app.state.xrk_inspection_store, "load", lambda token: SimpleNamespace(manifest={"fingerprint": "real-fingerprint"}))
        assert client.post("/api/v1/feedback", json={**base, "token": "a" * 32, "data_origin": "real"}).status_code == 200
        clip = {"feedback_id": "b" * 32, "clip_id": "c" * 64, "inspection_id": "a" * 32,
                "session_fingerprint": "wrong-fingerprint", "data_origin": "real", "zone_id": "T1",
                "reference_lap": 1, "target_lap": 2, "start_s": 1, "end_s": 5, "verdict": "accurate", "locale": "en"}
        assert client.post("/api/v1/feedback/clip-selection", json=clip).status_code == 422
        stats = client.get("/api/v1/feedback/stats").json()
        assert stats["total"] == 1 and stats["excluded_unverified_count"] == 1
    rows, copy = load_feedback_rows(db)
    report = aggregate_feedback(rows, copy)
    assert report["total_feedback"] == 1 and report["excluded_unverified_count"] == 1


def test_legacy_database_is_preserved_but_quarantined(tmp_path, monkeypatch):
    """Migration never retroactively labels unknown historical votes as real."""
    db = tmp_path / "old.sqlite"
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE narrative_feedback (id INTEGER PRIMARY KEY, node_id TEXT, token TEXT, source TEXT, locale TEXT, thumbs_up INTEGER, created_at TEXT)")
        conn.execute("INSERT INTO narrative_feedback VALUES (1, 'p', 'published-demo', 'llm', 'en', 1, 'old')")
    rows, copy = load_feedback_rows(db)
    assert aggregate_feedback(rows, copy)["total_feedback"] == 0
    monkeypatch.setattr(storage, "DB_PATH", db)
    storage.init_db()
    storage.init_db()
    assert storage.narrative_feedback_stats()["excluded_unverified_count"] == 1
    storage.save_clip_feedback({"feedback_id": "a", "clip_id": "b", "verdict": "accurate"})
    assert storage.clip_feedback_stats()["total"] == 0
    assert storage.clip_feedback_stats()["excluded_unverified_count"] == 1
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT COUNT(*) FROM narrative_feedback").fetchone()[0] == 1
        assert json.loads(conn.execute("SELECT payload_json FROM clip_selection_feedback").fetchone()[0])["verdict"] == "accurate"
