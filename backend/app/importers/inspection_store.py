"""Short-lived normalized XRK inspection storage."""

from __future__ import annotations

import json
import os
import re
import shutil
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any


class InspectionExpiredError(RuntimeError):
    """Raised when an inspection token is absent or expired."""


@dataclass(frozen=True)
class InspectionRecord:
    """Resolved inspection paths and manifest."""

    inspection_id: str
    directory: Path
    manifest: dict[str, Any]
    expires_at: datetime

    @property
    def telemetry_path(self) -> Path:
        return self.directory / self.manifest["artifacts"]["telemetry"]


class InspectionStore:
    """Manage opaque, fixed-expiry XRK analysis artifacts."""

    def __init__(self, root: Path, ttl_seconds: int) -> None:
        self.root = root.expanduser().resolve()
        self.ttl_seconds = ttl_seconds
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def create_directory(self) -> tuple[str, Path, datetime]:
        """Create one private cache directory and fixed expiry timestamp."""
        self.cleanup()
        inspection_id = uuid.uuid4().hex
        directory = self.root / inspection_id
        directory.mkdir(mode=0o700)
        expires_at = datetime.now(UTC) + timedelta(seconds=self.ttl_seconds)
        return inspection_id, directory, expires_at

    def finalize(
        self,
        inspection_id: str,
        directory: Path,
        expires_at: datetime,
    ) -> InspectionRecord:
        """Attach opaque token metadata after parser output is complete."""
        manifest_path = directory / "inspection.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["inspection_id"] = inspection_id
        manifest["expires_at"] = expires_at.isoformat()
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.utime(directory, (expires_at.timestamp(), expires_at.timestamp()))
        return InspectionRecord(inspection_id, directory, manifest, expires_at)

    def load(self, inspection_id: str) -> InspectionRecord:
        """Resolve a non-expired inspection without accepting arbitrary paths."""
        self.cleanup()
        if not re.fullmatch(r"[0-9a-f]{32}", inspection_id):
            raise InspectionExpiredError("XRK inspection is invalid or expired.")
        directory = self.root / inspection_id
        manifest_path = directory / "inspection.json"
        if not manifest_path.is_file():
            raise InspectionExpiredError("XRK inspection is invalid or expired.")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        try:
            expires_at = datetime.fromisoformat(manifest["expires_at"])
        except (KeyError, TypeError, ValueError) as exc:
            self.delete(inspection_id)
            raise InspectionExpiredError("XRK inspection is invalid or expired.") from exc
        if expires_at <= datetime.now(UTC):
            self.delete(inspection_id)
            raise InspectionExpiredError("XRK inspection has expired. Please upload it again.")
        telemetry_path = directory / manifest.get("artifacts", {}).get(
            "telemetry",
            "",
        )
        if not telemetry_path.is_file():
            self.delete(inspection_id)
            raise InspectionExpiredError("XRK inspection artifacts are unavailable.")
        return InspectionRecord(inspection_id, directory, manifest, expires_at)

    def delete(self, inspection_id: str) -> bool:
        """Delete one normalized inspection directory."""
        if not re.fullmatch(r"[0-9a-f]{32}", inspection_id):
            return False
        directory = self.root / inspection_id
        if not directory.exists():
            return False
        shutil.rmtree(directory, ignore_errors=True)
        return True

    def cleanup(self) -> int:
        """Delete malformed and fixed-expiry cache directories."""
        now = time.time()
        removed = 0
        for child in self.root.iterdir():
            if not child.is_dir():
                continue
            manifest_path = child / "inspection.json"
            expired = child.stat().st_mtime <= now - self.ttl_seconds
            if manifest_path.is_file():
                try:
                    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                    expires_at = datetime.fromisoformat(
                        manifest["expires_at"]
                    ).timestamp()
                    expired = expires_at <= now
                except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                    expired = True
            if expired:
                shutil.rmtree(child, ignore_errors=True)
                removed += 1
        return removed
