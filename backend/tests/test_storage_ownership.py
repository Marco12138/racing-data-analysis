"""Tests for the incremental session ownership persistence boundary."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from backend.app.core.ownership import ANONYMOUS_OWNER_ID, ActorContext
from backend.app.utils import storage


def test_existing_sqlite_database_is_migrated_without_losing_rows(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Older anonymous Demo rows receive the stable anonymous owner."""
    database = tmp_path / "legacy.sqlite3"
    with sqlite3.connect(database) as conn:
        conn.execute(
            """
            CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lap_filename TEXT NOT NULL,
                telemetry_filename TEXT,
                report TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "INSERT INTO sessions (lap_filename, report, created_at) VALUES ('laps.csv', 'ok', 'now')"
        )

    monkeypatch.setattr(storage, "DB_PATH", database)
    storage.init_db()

    with sqlite3.connect(database) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}
        owner = conn.execute("SELECT owner_id FROM sessions WHERE id = 1").fetchone()[0]
    assert "owner_id" in columns
    assert owner == ANONYMOUS_OWNER_ID


def test_storage_operations_are_scoped_to_actor_owner(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """One future authenticated actor cannot access another actor's video data."""
    database = tmp_path / "owned.sqlite3"
    monkeypatch.setattr(storage, "DB_PATH", database)
    owner_a = ActorContext.authenticated_user("driver-a")
    owner_b = ActorContext.authenticated_user("driver-b")

    storage.create_video_job(
        "job-a",
        "source-a",
        "session.mp4",
        "/private/session.mp4",
        actor=owner_a,
    )
    assert storage.get_video_job("job-a", actor=owner_b) is None

    storage.update_video_job("job-a", actor=owner_b, status="completed")
    assert storage.get_video_job("job-a", actor=owner_a)["status"] == "queued"
    with pytest.raises(LookupError, match="not found for owner"):
        storage.add_video_marker("job-a", "event", 1.0, None, "", actor=owner_b)
    assert storage.delete_video_job("job-a", actor=owner_b) is False

    marker = storage.add_video_marker(
        "job-a",
        "event",
        1.0,
        None,
        "review",
        actor=owner_a,
    )
    job = storage.get_video_job("job-a", actor=owner_a)
    assert job is not None
    assert "owner_id" not in job
    assert job["markers"] == [marker]
    assert storage.delete_video_job("job-a", actor=owner_a) is True


def test_session_records_keep_anonymous_default_and_accept_explicit_owner(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Current callers remain anonymous while future auth can pass an actor."""
    database = tmp_path / "sessions.sqlite3"
    monkeypatch.setattr(storage, "DB_PATH", database)
    authenticated = ActorContext.authenticated_user("subject-123")

    storage.save_session_record("anonymous.csv", None, "report")
    storage.save_session_record("owned.csv", None, "report", actor=authenticated)

    with sqlite3.connect(database) as conn:
        rows = conn.execute(
            "SELECT lap_filename, owner_id FROM sessions ORDER BY id"
        ).fetchall()
    assert rows == [
        ("anonymous.csv", ANONYMOUS_OWNER_ID),
        ("owned.csv", "user:subject-123"),
    ]


def test_actor_context_rejects_empty_identifiers() -> None:
    """Invalid identity input must fail before a repository query is built."""
    with pytest.raises(ValueError):
        ActorContext(owner_id=" ", authenticated=False)
    with pytest.raises(ValueError):
        ActorContext.authenticated_user(" ")
