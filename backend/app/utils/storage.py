"""Tiny SQLite storage for MVP session records."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[3] / "storage" / "sessions.sqlite3"


def init_db() -> None:
    """Create local SQLite tables when missing."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lap_filename TEXT NOT NULL,
                telemetry_filename TEXT,
                report TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )


def save_session_record(lap_filename: str, telemetry_filename: str | None, report: str) -> int:
    """Persist a lightweight session record and return its id."""
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "INSERT INTO sessions (lap_filename, telemetry_filename, report, created_at) VALUES (?, ?, ?, ?)",
            (lap_filename, telemetry_filename, report, datetime.now(timezone.utc).isoformat()),
        )
        return int(cursor.lastrowid)

