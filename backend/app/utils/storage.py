"""Tiny SQLite storage for MVP session records."""

from __future__ import annotations

import sqlite3
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ..core.config import get_settings
from ..core.ownership import ANONYMOUS_ACTOR, ActorContext

DB_PATH = get_settings().sqlite_path


def init_db() -> None:
    """Create local SQLite tables when missing."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id TEXT NOT NULL DEFAULT 'anonymous-public-demo',
                lap_filename TEXT NOT NULL,
                telemetry_filename TEXT,
                report TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS video_jobs (
                id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL DEFAULT 'anonymous-public-demo',
                source_id TEXT NOT NULL,
                source_name TEXT NOT NULL,
                source_path TEXT NOT NULL,
                media_path TEXT,
                status TEXT NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                metadata_json TEXT,
                keyframes_json TEXT,
                warnings_json TEXT NOT NULL DEFAULT '[]',
                report TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS video_markers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id TEXT NOT NULL DEFAULT 'anonymous-public-demo',
                job_id TEXT NOT NULL,
                marker_type TEXT NOT NULL,
                timestamp REAL NOT NULL,
                lap INTEGER,
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY(job_id) REFERENCES video_jobs(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS storyboards (
                token TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL DEFAULT 'anonymous-public-demo',
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS narrative_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                node_id TEXT NOT NULL,
                token TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL,
                locale TEXT NOT NULL,
                thumbs_up INTEGER NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS coach_validations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                inspection_id TEXT NOT NULL,
                episode_id TEXT NOT NULL,
                pattern_id TEXT NOT NULL,
                pattern_type TEXT NOT NULL,
                verdict TEXT NOT NULL,
                locale TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
            """
        )
        _ensure_owner_column(conn, "sessions")
        _ensure_owner_column(conn, "video_jobs")
        _ensure_owner_column(conn, "video_markers")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_owner_created ON sessions(owner_id, created_at)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_video_jobs_owner_updated ON video_jobs(owner_id, updated_at)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_video_markers_owner_job ON video_markers(owner_id, job_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_storyboards_owner_created ON storyboards(owner_id, created_at)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_coach_validations_pattern_created "
            "ON coach_validations(pattern_type, created_at)"
        )


def check_database() -> None:
    """Raise when the configured database cannot answer a trivial query."""
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("SELECT 1").fetchone()


def save_session_record(
    lap_filename: str,
    telemetry_filename: str | None,
    report: str,
    *,
    actor: ActorContext = ANONYMOUS_ACTOR,
) -> int:
    """Persist a lightweight session record and return its id."""
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "INSERT INTO sessions (owner_id, lap_filename, telemetry_filename, report, created_at) VALUES (?, ?, ?, ?, ?)",
            (
                actor.owner_id,
                lap_filename,
                telemetry_filename,
                report,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        return int(cursor.lastrowid)


def create_video_job(
    job_id: str,
    source_id: str,
    source_name: str,
    source_path: str,
    *,
    actor: ActorContext = ANONYMOUS_ACTOR,
) -> None:
    """Create a queued local video analysis job."""
    now = _now()
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO video_jobs (
                id, owner_id, source_id, source_name, source_path, status, progress,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?)
            """,
            (job_id, actor.owner_id, source_id, source_name, source_path, now, now),
        )


def update_video_job(
    job_id: str,
    *,
    actor: ActorContext = ANONYMOUS_ACTOR,
    **values: object,
) -> None:
    """Update allowlisted video job fields."""
    allowed = {
        "media_path",
        "status",
        "progress",
        "metadata_json",
        "keyframes_json",
        "warnings_json",
        "report",
        "error",
    }
    updates = {key: value for key, value in values.items() if key in allowed}
    if not updates:
        return
    updates["updated_at"] = _now()
    assignments = ", ".join(f"{key} = ?" for key in updates)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            f"UPDATE video_jobs SET {assignments} WHERE id = ? AND owner_id = ?",
            (*updates.values(), job_id, actor.owner_id),
        )


def complete_video_job(
    job_id: str,
    media_path: str,
    metadata: dict,
    keyframes: list[dict],
    warnings: list[str],
    report: str,
    *,
    actor: ActorContext = ANONYMOUS_ACTOR,
) -> None:
    """Persist completed local video analysis results."""
    update_video_job(
        job_id,
        media_path=media_path,
        status="completed",
        progress=100,
        metadata_json=json.dumps(metadata),
        keyframes_json=json.dumps(keyframes),
        warnings_json=json.dumps(warnings),
        report=report,
        error=None,
        actor=actor,
    )


def get_video_job(
    job_id: str,
    *,
    actor: ActorContext = ANONYMOUS_ACTOR,
) -> dict | None:
    """Return one video job with decoded JSON fields and markers."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM video_jobs WHERE id = ? AND owner_id = ?",
            (job_id, actor.owner_id),
        ).fetchone()
        if row is None:
            return None
        result = dict(row)
        result.pop("owner_id", None)
        result["metadata"] = _decode_json(result.pop("metadata_json"), None)
        result["keyframes"] = _decode_json(result.pop("keyframes_json"), [])
        result["warnings"] = _decode_json(result.pop("warnings_json"), [])
        result["markers"] = [
            dict(marker)
            for marker in conn.execute(
                "SELECT id, marker_type, timestamp, lap, notes, created_at FROM video_markers WHERE job_id = ? AND owner_id = ? ORDER BY timestamp, id",
                (job_id, actor.owner_id),
            ).fetchall()
        ]
        return result


def add_video_marker(
    job_id: str,
    marker_type: str,
    timestamp: float,
    lap: int | None,
    notes: str,
    *,
    actor: ActorContext = ANONYMOUS_ACTOR,
) -> dict:
    """Persist and return a manual timeline marker."""
    created_at = _now()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(
            "INSERT INTO video_markers (owner_id, job_id, marker_type, timestamp, lap, notes, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM video_jobs WHERE id = ? AND owner_id = ?)",
            (
                actor.owner_id,
                job_id,
                marker_type,
                timestamp,
                lap,
                notes,
                created_at,
                job_id,
                actor.owner_id,
            ),
        )
        if cursor.rowcount == 0:
            raise LookupError("Video analysis job not found for owner.")
        row = conn.execute(
            "SELECT id, marker_type, timestamp, lap, notes, created_at FROM video_markers WHERE id = ? AND owner_id = ?",
            (cursor.lastrowid, actor.owner_id),
        ).fetchone()
        return dict(row)


def delete_video_marker(
    job_id: str,
    marker_id: int,
    *,
    actor: ActorContext = ANONYMOUS_ACTOR,
) -> bool:
    """Delete one marker belonging to a video job."""
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "DELETE FROM video_markers WHERE id = ? AND job_id = ? AND owner_id = ?",
            (marker_id, job_id, actor.owner_id),
        )
        return cursor.rowcount > 0


def delete_video_job(
    job_id: str,
    *,
    actor: ActorContext = ANONYMOUS_ACTOR,
) -> bool:
    """Delete a video job and its marker records."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "DELETE FROM video_markers WHERE job_id = ? AND owner_id = ?",
            (job_id, actor.owner_id),
        )
        cursor = conn.execute(
            "DELETE FROM video_jobs WHERE id = ? AND owner_id = ?",
            (job_id, actor.owner_id),
        )
        return cursor.rowcount > 0


def save_storyboard(
    token: str,
    payload: dict,
    *,
    actor: ActorContext = ANONYMOUS_ACTOR,
    ttl_seconds: int = 7 * 24 * 3600,
) -> None:
    """Persist one read-only storyboard payload for a fixed lifetime."""
    now = _now()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO storyboards (token, owner_id, payload_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
            (
                token,
                actor.owner_id,
                json.dumps(payload, ensure_ascii=False),
                now,
                _now_plus(ttl_seconds),
            ),
        )


def load_storyboard(
    token: str,
    *,
    actor: ActorContext = ANONYMOUS_ACTOR,
) -> dict | None:
    """Return one non-expired storyboard payload or None."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT payload_json, expires_at FROM storyboards WHERE token = ? AND owner_id = ?",
            (token, actor.owner_id),
        ).fetchone()
        if row is None:
            return None
        expires_at = row["expires_at"]
        if _now_iso() > expires_at:
            conn.execute(
                "DELETE FROM storyboards WHERE token = ? AND owner_id = ?",
                (token, actor.owner_id),
            )
            return None
        return _decode_json(row["payload_json"], None)


def delete_storyboard(
    token: str,
    *,
    actor: ActorContext = ANONYMOUS_ACTOR,
) -> bool:
    """Delete one storyboard owned by the actor; returns whether it existed."""
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "DELETE FROM storyboards WHERE token = ? AND owner_id = ?",
            (token, actor.owner_id),
        )
        return cursor.rowcount > 0


def save_narrative_feedback(
    node_id: str,
    token: str,
    source: str,
    locale: str,
    thumbs_up: bool,
) -> int:
    """Persist one AI-advice thumbs up/down record."""
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "INSERT INTO narrative_feedback (node_id, token, source, locale, thumbs_up, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (node_id, token, source, locale, 1 if thumbs_up else 0, _now()),
        )
        return int(cursor.lastrowid)


def narrative_feedback_stats(limit: int = 50) -> dict:
    """Return aggregate counts and the most recent feedback rows."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        total = conn.execute("SELECT COUNT(*) AS count FROM narrative_feedback").fetchone()["count"]
        thumbs_up = conn.execute(
            "SELECT COUNT(*) AS count FROM narrative_feedback WHERE thumbs_up = 1"
        ).fetchone()["count"]
        recent = [
            dict(row)
            for row in conn.execute(
                "SELECT id, node_id, token, source, locale, thumbs_up, created_at "
                "FROM narrative_feedback ORDER BY id DESC LIMIT ?",
                (max(1, limit),),
            ).fetchall()
        ]
    return {
        "total": total,
        "thumbs_up_count": thumbs_up,
        "thumbs_down_count": total - thumbs_up,
        "recent": recent,
    }


def save_coach_validation(
    inspection_id: str,
    episode_id: str,
    pattern_id: str,
    pattern_type: str,
    verdict: str,
    locale: str,
    notes: str = "",
) -> int:
    """Persist one coach-confirmed detector label without telemetry payloads."""
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "INSERT INTO coach_validations ("
            "inspection_id, episode_id, pattern_id, pattern_type, verdict, locale, notes, created_at"
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                inspection_id,
                episode_id,
                pattern_id,
                pattern_type,
                verdict,
                locale,
                notes,
                _now(),
            ),
        )
        return int(cursor.lastrowid)


def _decode_json(value: str | None, default: object) -> object:
    """Decode optional stored JSON with a safe default."""
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def _ensure_owner_column(conn: sqlite3.Connection, table: str) -> None:
    """Add the ownership scope to databases created by earlier Demo versions."""
    if table not in {"sessions", "video_jobs", "video_markers"}:
        raise ValueError("Unsupported ownership migration table.")
    columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    if "owner_id" not in columns:
        conn.execute(
            f"ALTER TABLE {table} ADD COLUMN owner_id TEXT NOT NULL "
            "DEFAULT 'anonymous-public-demo'"
        )


def _now() -> str:
    """Return a UTC ISO timestamp for local records."""
    return datetime.now(timezone.utc).isoformat()


def _now_iso() -> str:
    return _now()


def _now_plus(seconds: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()
