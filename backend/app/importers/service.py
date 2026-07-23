"""Secure orchestration for anonymous AiM XRK/XRZ imports."""

from __future__ import annotations

import asyncio
import csv
import json
import os
import sys
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from fastapi import UploadFile

from ..analysis.handling_analysis import generate_handling_flags
from ..analysis.lap_analysis import analyze_laps
from ..analysis.report_generator import generate_report
from ..analysis.telemetry_analysis import analyze_telemetry


class AimImportError(RuntimeError):
    """An XRK import failure with an intended HTTP status."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


class ImportRateLimiter:
    """Small in-memory sliding-window limiter for the single-worker Demo API."""

    def __init__(self, limit: int, window_seconds: int = 3600) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._requests: dict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def check(self, client_key: str) -> None:
        """Record one request or raise when the hourly allowance is exhausted."""
        now = time.monotonic()
        async with self._lock:
            requests = self._requests[client_key]
            while requests and requests[0] <= now - self.window_seconds:
                requests.popleft()
            if len(requests) >= self.limit:
                raise AimImportError(
                    "XRK import limit reached. Please try again later.",
                    status_code=429,
                )
            requests.append(now)


async def save_limited_upload(
    upload: UploadFile,
    destination: Path,
    max_bytes: int,
) -> int:
    """Stream an upload to disk while enforcing the configured byte limit."""
    filename = upload.filename or "session.xrk"
    if Path(filename).suffix.lower() not in {".xrk", ".xrz"}:
        raise AimImportError("Only AiM .xrk and .xrz files are accepted.")

    total = 0
    try:
        with destination.open("wb") as output:
            while chunk := await upload.read(1024 * 1024):
                total += len(chunk)
                if total > max_bytes:
                    raise AimImportError(
                        f"XRK/XRZ file exceeds the {max_bytes // (1024**2)} MB limit.",
                        status_code=413,
                    )
                output.write(chunk)
    finally:
        await upload.close()

    if total == 0:
        raise AimImportError("The uploaded XRK/XRZ file is empty.")
    return total


async def run_xrk_conversion(
    source: Path,
    output_dir: Path,
    timeout_seconds: int,
) -> None:
    """Parse an untrusted logger file in a separate Python process."""
    backend_root = Path(__file__).resolve().parents[2]
    environment = os.environ.copy()
    existing_pythonpath = environment.get("PYTHONPATH", "")
    environment["PYTHONPATH"] = os.pathsep.join(
        value for value in [str(backend_root), existing_pythonpath] if value
    )
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "app.importers.worker",
        str(source),
        str(output_dir),
        cwd=str(backend_root),
        env=environment,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=timeout_seconds,
        )
    except TimeoutError as exc:
        process.kill()
        await process.wait()
        raise AimImportError(
            f"XRK parsing exceeded the {timeout_seconds} second limit.",
            status_code=504,
        ) from exc

    if process.returncode == 0:
        return

    message = stderr.decode("utf-8", errors="replace").strip()
    if "XRK support is not installed" in message:
        raise AimImportError("XRK parser is unavailable on this server.", status_code=503)
    if "missing required GPS channels" in message or "No complete timed laps" in message:
        raise AimImportError(message, status_code=422)
    raise AimImportError(message or "Unable to parse the XRK/XRZ file.")


def build_import_response(
    output_dir: Path,
    *,
    max_telemetry_rows: int,
) -> dict[str, Any]:
    """Read converter artifacts and return a path-free API response."""
    laps_path = output_dir / "laps.csv"
    telemetry_path = output_dir / "telemetry.csv"
    report_path = output_dir / "extraction_report.json"
    if not all(path.is_file() for path in [laps_path, telemetry_path, report_path]):
        raise AimImportError("XRK parser did not produce complete output.", status_code=422)

    lap_frame = pd.read_csv(laps_path)
    telemetry_frame = pd.read_csv(telemetry_path)
    report = json.loads(report_path.read_text(encoding="utf-8"))

    lap_analysis = analyze_laps(lap_frame)
    telemetry_analysis = analyze_telemetry(telemetry_frame)
    handling_flags = generate_handling_flags(telemetry_frame)
    analysis_report = generate_report(
        lap_analysis,
        telemetry_analysis,
        handling_flags,
    )
    warnings = [str(item) for item in report.get("warnings", [])]
    if warnings:
        analysis_report = "\n\n".join(
            [
                analysis_report,
                "AiM Import Notes:\n- " + "\n- ".join(warnings),
            ]
        )

    telemetry_rows, downsampled = downsample_telemetry(
        telemetry_frame,
        max_rows=max_telemetry_rows,
    )
    if downsampled:
        warnings.append(
            f"Telemetry chart data was downsampled to {len(telemetry_rows)} rows; "
            "summary statistics use the complete recording."
        )

    public_source = {
        key: value
        for key, value in report.get("source", {}).items()
        if key not in {"path"}
    }
    return {
        "format": "aim_xrk",
        "source": public_source,
        "metadata": report.get("metadata", {}),
        "lap_selection": report.get("lap_selection", {}),
        "virtual_sectors": report.get("virtual_sectors", {}),
        "channels": report.get("channels", []),
        "warnings": warnings,
        "lap_rows": dataframe_records(lap_frame),
        "telemetry_rows": telemetry_rows,
        "telemetry_rows_total": int(len(telemetry_frame)),
        "telemetry_downsampled": downsampled,
        "lap_analysis": lap_analysis,
        "telemetry_analysis": telemetry_analysis,
        "handling_flags": handling_flags,
        "report": analysis_report,
    }


def downsample_telemetry(
    frame: pd.DataFrame,
    *,
    max_rows: int,
) -> tuple[list[dict[str, Any]], bool]:
    """Uniformly reduce each lap for charting while retaining lap coverage."""
    if len(frame) <= max_rows:
        return dataframe_records(frame), False

    groups = list(frame.groupby("lap", sort=False, dropna=False))
    allocations = allocate_rows(
        [len(group) for _, group in groups],
        max_rows,
    )
    selected: list[pd.DataFrame] = []
    for (_, group), allocation in zip(groups, allocations, strict=True):
        indexes = np.linspace(0, len(group) - 1, allocation, dtype=int)
        selected.append(group.iloc[np.unique(indexes)])
    sampled = pd.concat(selected, ignore_index=True)
    return dataframe_records(sampled), True


def allocate_rows(group_sizes: list[int], max_rows: int) -> list[int]:
    """Allocate a fixed chart budget proportionally across laps."""
    if not group_sizes:
        return []
    allocations = [max(2, int(max_rows * size / sum(group_sizes))) for size in group_sizes]
    allocations = [min(size, allocation) for size, allocation in zip(group_sizes, allocations)]
    while sum(allocations) > max_rows:
        index = max(range(len(allocations)), key=lambda item: allocations[item])
        if allocations[index] <= 2:
            break
        allocations[index] -= 1
    while sum(allocations) < max_rows:
        candidates = [
            index
            for index, size in enumerate(group_sizes)
            if allocations[index] < size
        ]
        if not candidates:
            break
        index = max(candidates, key=lambda item: group_sizes[item] - allocations[item])
        allocations[index] += 1
    return allocations


def dataframe_records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    """Return JSON-safe records with unavailable cells represented as null."""
    cleaned = frame.astype(object).where(pd.notna(frame), None)
    return cleaned.to_dict(orient="records")
