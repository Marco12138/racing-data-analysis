"""Local-only XRK discovery with opaque source identifiers."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

SUPPORTED_XRK_SUFFIXES = {".xrk", ".xrz"}


class XrkSourceError(ValueError):
    """Raised when a local XRK source is unavailable or unsafe."""


def get_xrk_roots(configured: str | None) -> list[Path]:
    """Return resolved directories explicitly allowed for local XRK access."""
    roots: list[Path] = []
    for value in (configured or "").split(os.pathsep):
        if not value.strip():
            continue
        root = Path(value).expanduser().resolve()
        if root.is_dir():
            roots.append(root)
    return roots


def source_id_for(path: Path) -> str:
    """Create a stable opaque identifier without exposing a filesystem path."""
    return hashlib.sha256(str(path.resolve()).encode("utf-8")).hexdigest()[:24]


def list_xrk_sources(max_bytes: int, configured_roots: str | None) -> list[dict]:
    """List supported XRK files below configured local roots."""
    sources: list[dict] = []
    for root in get_xrk_roots(configured_roots):
        for path in root.rglob("*"):
            if (
                not path.is_file()
                or path.name.startswith("._")
                or "__MACOSX" in path.parts
                or path.suffix.lower() not in SUPPORTED_XRK_SUFFIXES
            ):
                continue
            try:
                stat = path.stat()
                with path.open("rb") as source:
                    header = source.read(5)
            except OSError:
                continue
            if stat.st_size <= 0 or stat.st_size > max_bytes:
                continue
            if not _has_xrk_signature(header):
                continue
            sources.append(
                {
                    "source_id": source_id_for(path),
                    "name": path.name,
                    "kind": path.suffix.lower().lstrip("."),
                    "size_bytes": stat.st_size,
                    "root": root.name,
                    "relative_path": str(path.relative_to(root)),
                    "modified_at": stat.st_mtime,
                }
            )
    return sorted(sources, key=lambda item: item["modified_at"], reverse=True)


def resolve_xrk_source(
    source_id: str,
    max_bytes: int,
    configured_roots: str | None,
) -> Path:
    """Resolve an opaque id by rescanning only explicitly allowed roots."""
    for root in get_xrk_roots(configured_roots):
        for path in root.rglob("*"):
            if (
                not path.is_file()
                or path.name.startswith("._")
                or "__MACOSX" in path.parts
                or path.suffix.lower() not in SUPPORTED_XRK_SUFFIXES
            ):
                continue
            resolved = path.resolve()
            if source_id_for(resolved) != source_id:
                continue
            try:
                resolved.relative_to(root)
            except ValueError as exc:
                raise XrkSourceError("The XRK file is outside the configured library.") from exc
            size = resolved.stat().st_size
            if size <= 0 or size > max_bytes:
                raise XrkSourceError("The XRK file is empty or exceeds the local limit.")
            return resolved
    raise XrkSourceError("The selected local XRK file is no longer available.")


def _has_xrk_signature(header: bytes) -> bool:
    """Recognize native XRK and compressed XRZ headers during discovery."""
    return header.startswith(b"<hCNF") or (
        len(header) >= 2
        and header[0] == 0x78
        and header[1] in {0x01, 0x9C, 0xDA}
    )
