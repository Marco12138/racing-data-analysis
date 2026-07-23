"""Tests for local video discovery and safe ZIP preparation."""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from backend.app.utils import video_library
from backend.app.utils.video_library import VideoSourceError


def test_library_discovers_only_supported_sources(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Discovery should stay inside configured roots and ignore unrelated files."""
    (tmp_path / "drive.mp4").write_bytes(b"video")
    (tmp_path / "notes.txt").write_text("ignore")
    monkeypatch.setenv("RACING_VIDEO_ROOTS", str(tmp_path))

    sources = video_library.list_video_sources()

    assert [source["name"] for source in sources] == ["drive.mp4"]
    assert video_library.resolve_source(sources[0]["source_id"]).name == "drive.mp4"


@pytest.mark.parametrize("archive_mode", ["damaged", "empty", "unsafe"])
def test_invalid_zip_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    archive_mode: str,
) -> None:
    """Damaged, empty, and path-traversal archives should fail clearly."""
    archive = tmp_path / f"{archive_mode}.zip"
    if archive_mode == "damaged":
        archive.write_bytes(b"not-a-zip")
    else:
        with zipfile.ZipFile(archive, "w") as bundle:
            if archive_mode == "empty":
                bundle.writestr("readme.txt", "no video")
            else:
                bundle.writestr("../escape.mp4", b"unsafe")
    monkeypatch.setattr(video_library, "VIDEO_CACHE_ROOT", tmp_path / "cache")

    with pytest.raises(VideoSourceError):
        video_library.prepare_media(archive, "job-safe")
