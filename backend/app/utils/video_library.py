"""Local video discovery, validation, extraction, and cache helpers."""

from __future__ import annotations

import hashlib
import os
import shutil
import time
import zipfile
from pathlib import Path, PurePosixPath

SUPPORTED_VIDEO_SUFFIXES = {".mp4", ".mov"}
SUPPORTED_SOURCE_SUFFIXES = SUPPORTED_VIDEO_SUFFIXES | {".zip"}
MAX_SOURCE_BYTES = 10 * 1024**3
CACHE_TTL_SECONDS = 24 * 60 * 60

STORAGE_ROOT = Path(__file__).resolve().parents[3] / "storage"
VIDEO_CACHE_ROOT = STORAGE_ROOT / "video_cache"


class VideoSourceError(ValueError):
    """Raised when a local video source is unavailable or unsafe."""


def get_video_roots() -> list[Path]:
    """Return resolved directories that the local API may inspect."""
    configured = os.getenv("RACING_VIDEO_ROOTS")
    values = configured.split(os.pathsep) if configured else [str(Path.home() / "Movies" / "Videos")]
    roots: list[Path] = []
    for value in values:
        path = Path(value).expanduser().resolve()
        if path.is_dir():
            roots.append(path)
    return roots


def source_id_for(path: Path) -> str:
    """Create a stable opaque identifier for an allowed local path."""
    return hashlib.sha256(str(path.resolve()).encode("utf-8")).hexdigest()[:24]


def list_video_sources() -> list[dict]:
    """List supported files below configured local video roots."""
    sources: list[dict] = []
    for root in get_video_roots():
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in SUPPORTED_SOURCE_SUFFIXES:
                continue
            try:
                size = path.stat().st_size
            except OSError:
                continue
            if size > MAX_SOURCE_BYTES:
                continue
            sources.append(
                {
                    "source_id": source_id_for(path),
                    "name": path.name,
                    "kind": path.suffix.lower().lstrip("."),
                    "size_bytes": size,
                    "root": root.name,
                    "relative_path": str(path.relative_to(root)),
                    "modified_at": path.stat().st_mtime,
                }
            )
    return sorted(sources, key=lambda item: item["modified_at"], reverse=True)


def resolve_source(source_id: str) -> Path:
    """Resolve a source id by rescanning only whitelisted directories."""
    for root in get_video_roots():
        for path in root.rglob("*"):
            if path.is_file() and path.suffix.lower() in SUPPORTED_SOURCE_SUFFIXES:
                resolved = path.resolve()
                if source_id_for(resolved) == source_id:
                    _validate_source(resolved, root)
                    return resolved
    raise VideoSourceError("The selected local video is no longer available.")


def prepare_media(source: Path, job_id: str) -> tuple[Path, list[str]]:
    """Return a playable media path, safely extracting ZIP sources when needed."""
    warnings: list[str] = []
    if source.suffix.lower() in SUPPORTED_VIDEO_SUFFIXES:
        return source, warnings

    target_dir = VIDEO_CACHE_ROOT / job_id
    target_dir.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(source) as archive:
            candidates = []
            for info in archive.infolist():
                member = PurePosixPath(info.filename)
                if info.is_dir() or member.suffix.lower() not in SUPPORTED_VIDEO_SUFFIXES:
                    continue
                if "__MACOSX" in member.parts or member.name.startswith("._"):
                    continue
                if member.is_absolute() or ".." in member.parts:
                    raise VideoSourceError("The ZIP contains an unsafe video path.")
                candidates.append(info)
            if not candidates:
                raise VideoSourceError("The ZIP does not contain an MP4 or MOV video.")
            selected = max(candidates, key=lambda item: item.file_size)
            if selected.file_size > MAX_SOURCE_BYTES:
                raise VideoSourceError("The extracted video exceeds the 10 GB local limit.")
            if len(candidates) > 1:
                warnings.append("Multiple videos were found; the largest file was selected.")
            target = target_dir / Path(selected.filename).name
            with archive.open(selected) as source_stream, target.open("wb") as target_stream:
                shutil.copyfileobj(source_stream, target_stream, length=8 * 1024 * 1024)
            return target, warnings
    except zipfile.BadZipFile as exc:
        raise VideoSourceError("The selected ZIP is damaged or unreadable.") from exc


def cleanup_video_cache(max_age_seconds: int = CACHE_TTL_SECONDS) -> None:
    """Remove analysis cache directories older than the configured TTL."""
    if not VIDEO_CACHE_ROOT.exists():
        return
    cutoff = time.time() - max_age_seconds
    for child in VIDEO_CACHE_ROOT.iterdir():
        try:
            if child.is_dir() and child.stat().st_mtime < cutoff:
                shutil.rmtree(child)
        except OSError:
            continue


def delete_job_cache(job_id: str) -> None:
    """Delete only the cache directory belonging to one analysis job."""
    target = (VIDEO_CACHE_ROOT / job_id).resolve()
    root = VIDEO_CACHE_ROOT.resolve()
    if target.parent != root:
        raise VideoSourceError("Invalid cache job id.")
    if target.exists():
        shutil.rmtree(target)


def _validate_source(path: Path, root: Path) -> None:
    """Validate containment, file type, and source size."""
    try:
        path.relative_to(root.resolve())
    except ValueError as exc:
        raise VideoSourceError("The video is outside the configured local library.") from exc
    if path.suffix.lower() not in SUPPORTED_SOURCE_SUFFIXES:
        raise VideoSourceError("Only MP4, MOV, and ZIP sources are supported.")
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise VideoSourceError("The source exceeds the 10 GB local limit.")
