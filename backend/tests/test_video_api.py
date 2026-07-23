"""Integration tests for the local video analysis API."""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.api import video_routes
from backend.app.main import app
from backend.app.utils import storage, video_library


def test_video_job_stream_markers_and_export(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    sample_video: Path,
) -> None:
    """The local API should analyze a ZIP, stream media, and export paired laps."""
    library_root = tmp_path / "library"
    library_root.mkdir()
    archive = library_root / "session.zip"
    with zipfile.ZipFile(archive, "w", allowZip64=True) as bundle:
        bundle.write(sample_video, arcname="session.mp4")
        bundle.writestr("__MACOSX/._session.mp4", b"resource fork")

    cache_root = tmp_path / "cache"
    monkeypatch.setenv("RACING_VIDEO_ROOTS", str(library_root))
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "sessions.sqlite3")
    monkeypatch.setattr(video_library, "VIDEO_CACHE_ROOT", cache_root)
    monkeypatch.setattr(video_routes, "VIDEO_CACHE_ROOT", cache_root)

    with TestClient(app) as client:
        source = client.get("/api/video/library").json()["sources"][0]
        created = client.post("/api/video/jobs", json={"source_id": source["source_id"]})
        assert created.status_code == 202
        job_id = created.json()["job_id"]

        job = client.get(f"/api/video/jobs/{job_id}").json()
        assert job["status"] == "completed"
        assert job["metadata"]["resolution"] == "320x180"
        assert len(job["keyframes"]) == 12
        assert not any("Multiple videos" in warning for warning in job["warnings"])

        frame = client.get(f"/api/video/jobs/{job_id}/frames/{job['keyframes'][0]['filename']}")
        assert frame.status_code == 200
        assert frame.headers["content-type"] == "image/jpeg"

        storage.update_video_job(job_id, media_path="/old/project/location/session.mp4")
        stream = client.get(f"/api/video/jobs/{job_id}/stream", headers={"Range": "bytes=0-1023"})
        assert stream.status_code in {200, 206}
        assert stream.content

        start = client.post(
            f"/api/video/jobs/{job_id}/markers",
            json={"marker_type": "lap_start", "timestamp": 0.25, "lap": 1, "notes": "start"},
        )
        end = client.post(
            f"/api/video/jobs/{job_id}/markers",
            json={"marker_type": "lap_end", "timestamp": 1.25, "lap": 1, "notes": "finish"},
        )
        assert start.status_code == 201
        assert end.status_code == 201

        exported = client.get(f"/api/video/jobs/{job_id}/markers.csv")
        assert exported.status_code == 200
        assert "00:00:00.250" in exported.text
        assert "00:00:01.250" in exported.text

        removed = client.delete(f"/api/video/jobs/{job_id}/markers/{start.json()['marker']['id']}")
        assert removed.status_code == 204
        cleared = client.delete(f"/api/video/jobs/{job_id}")
        assert cleared.status_code == 204
