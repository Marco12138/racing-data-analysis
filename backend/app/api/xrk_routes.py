"""Two-stage, temporary AiM XRK inspection and analysis API."""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, File, Request, UploadFile
from pydantic import BaseModel, Field

from ..analysis.xrk_session_analysis import analyze_xrk_session
from .errors import PublicApiError
from ..importers.inspection_store import InspectionExpiredError
from ..importers.service import (
    AimImportError,
    run_xrk_inspection,
    save_limited_upload,
)

router = APIRouter(prefix="/xrk", tags=["xrk"])
logger = logging.getLogger("racing.xrk")
logger.setLevel(logging.INFO)
logger.propagate = False
if not logger.handlers:
    log_handler = logging.StreamHandler(sys.stdout)
    log_handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(log_handler)


class ManualZoneRequest(BaseModel):
    """User-defined non-wrapping track analysis range."""

    id: str | None = None
    name: str | None = Field(default=None, max_length=80)
    entry_distance_m: float = Field(ge=0)
    exit_distance_m: float = Field(gt=0)


class XrkAnalyzeRequest(BaseModel):
    """Parameters for recalculating one temporary normalized inspection."""

    inspection_id: str = Field(min_length=32, max_length=32)
    reference_lap: int | None = Field(default=None, ge=1)
    target_lap: int | None = Field(default=None, ge=1)
    distance_step_m: float | None = Field(default=None, ge=0.25, le=10.0)
    sector_count: int = Field(default=3, ge=2, le=6)
    sector_boundaries_m: list[float] | None = None
    manual_zones: list[ManualZoneRequest] = Field(default_factory=list, max_length=30)


@router.post("/inspect")
async def inspect_xrk(
    request: Request,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """Inspect real AiM channels and retain normalized data for 30 minutes."""
    settings = request.app.state.settings
    store = request.app.state.xrk_inspection_store
    client_key = request.client.host if request.client else "unknown"
    request_id = getattr(request.state, "request_id", "unknown")
    original_name = Path(file.filename or "session.xrk").name
    suffix = Path(original_name).suffix.lower()
    parser_probe = request.app.state.xrk_parser_registry.probe()
    inspection_id: str | None = None
    size_bytes = 0
    parsing_started_at: float | None = None
    log_xrk_event(
        request_id=request_id,
        stage="request_received",
        filename=original_name,
        extension=suffix,
        parser_probe=parser_probe,
    )
    try:
        if not parser_probe.available:
            raise AimImportError(
                parser_probe.message or "XRK parser is unavailable on this server.",
                status_code=(
                    400
                    if parser_probe.error_code == "XRK_UPLOAD_REJECTED"
                    else 503
                ),
                error_code=parser_probe.error_code or "XRK_PARSER_NOT_INSTALLED",
                error_type="parser_capability",
            )
        await request.app.state.xrk_rate_limiter.check(client_key)
        async with request.app.state.xrk_import_semaphore:
            inspection_id, output_dir, expires_at = store.create_directory()
            log_xrk_event(
                request_id=request_id,
                stage="temporary_workspace_created",
                filename=original_name,
                extension=suffix,
                parser_probe=parser_probe,
                temporary_path_created=True,
            )
            with tempfile.TemporaryDirectory(prefix="racing-xrk-upload-") as temp:
                upload_dir = Path(temp)
                source = upload_dir / f"source{suffix}"
                size_bytes = await save_limited_upload(
                    file,
                    source,
                    settings.max_xrk_upload_bytes,
                )
                log_xrk_event(
                    request_id=request_id,
                    stage="upload_complete",
                    filename=original_name,
                    extension=suffix,
                    file_size=size_bytes,
                    parser_probe=parser_probe,
                    upload_complete=True,
                    temporary_path_created=True,
                )
                parsing_started_at = time.monotonic()
                log_xrk_event(
                    request_id=request_id,
                    stage="parsing_started",
                    filename=original_name,
                    extension=suffix,
                    file_size=size_bytes,
                    parser_probe=parser_probe,
                    upload_complete=True,
                    temporary_path_created=True,
                    parsing_started=True,
                )
                await run_xrk_inspection(
                    source,
                    output_dir,
                    settings.xrk_parse_timeout_seconds,
                )
            record = store.finalize(
                inspection_id,
                output_dir,
                expires_at,
            )
            public = {
                key: value
                for key, value in record.manifest.items()
                if key != "artifacts"
            }
            public["filename"] = original_name
            public["file_size_bytes"] = size_bytes
            parsing_duration_ms = round(
                (time.monotonic() - parsing_started_at) * 1000
            ) if parsing_started_at is not None else None
            public["request_id"] = request_id
            public["processing_duration_ms"] = (
                public.get("processing_duration_ms") or parsing_duration_ms
            )
            log_xrk_event(
                request_id=request_id,
                stage="parsing_finished",
                filename=original_name,
                extension=suffix,
                file_size=size_bytes,
                parser_probe=parser_probe,
                upload_complete=True,
                temporary_path_created=True,
                parsing_started=True,
                parsing_finished=True,
                parsing_duration_ms=parsing_duration_ms,
                channel_count=len(public.get("channels", [])),
                lap_count=int(public.get("laps", 0)),
            )
            return public
    except AimImportError as exc:
        if inspection_id:
            store.delete(inspection_id)
        log_xrk_event(
            request_id=request_id,
            stage="failed",
            filename=original_name,
            extension=suffix,
            file_size=size_bytes,
            parser_probe=parser_probe,
            upload_complete=size_bytes > 0,
            temporary_path_created=inspection_id is not None,
            parsing_started=parsing_started_at is not None,
            parsing_finished=False,
            parsing_duration_ms=(
                round((time.monotonic() - parsing_started_at) * 1000)
                if parsing_started_at is not None
                else None
            ),
            error_code=exc.error_code,
            error_type=exc.error_type,
        )
        raise PublicApiError(
            status_code=exc.status_code,
            error_code=exc.error_code,
            message=str(exc),
            error_type=exc.error_type,
        ) from exc
    except asyncio.CancelledError:
        if inspection_id:
            store.delete(inspection_id)
        raise
    except Exception as exc:
        if inspection_id:
            store.delete(inspection_id)
        log_xrk_event(
            request_id=request_id,
            stage="failed",
            filename=original_name,
            extension=suffix,
            file_size=size_bytes,
            parser_probe=parser_probe,
            upload_complete=size_bytes > 0,
            temporary_path_created=inspection_id is not None,
            parsing_started=parsing_started_at is not None,
            parsing_finished=False,
            error_code="XRK_PARSE_FAILED",
            error_type=type(exc).__name__,
        )
        raise PublicApiError(
            status_code=400,
            error_code="XRK_PARSE_FAILED",
            message="Unable to inspect this XRK/XRZ file.",
            error_type=type(exc).__name__,
        ) from exc


@router.post("/analyze")
async def analyze_xrk(
    request: Request,
    payload: XrkAnalyzeRequest,
) -> dict[str, Any]:
    """Analyze one temporary normalized XRK inspection."""
    store = request.app.state.xrk_inspection_store
    settings = request.app.state.settings
    try:
        record = store.load(payload.inspection_id)
    except InspectionExpiredError as exc:
        raise PublicApiError(
            status_code=410,
            error_code="XRK_INSPECTION_EXPIRED",
            message=str(exc),
            error_type="expired_token",
        ) from exc
    try:
        telemetry = await asyncio.to_thread(pd.read_parquet, record.telemetry_path)
        result = await asyncio.to_thread(
            analyze_xrk_session,
            telemetry,
            record.manifest,
            reference_lap=payload.reference_lap,
            target_lap=payload.target_lap,
            distance_step_m=payload.distance_step_m
            or settings.xrk_default_distance_step_m,
            sector_count=payload.sector_count,
            sector_boundaries_m=payload.sector_boundaries_m,
            manual_zones=[
                zone.model_dump()
                for zone in payload.manual_zones
            ],
            max_comparison_points=settings.xrk_max_comparison_points,
        )
        return result
    except ValueError as exc:
        raise PublicApiError(
            status_code=422,
            error_code="XRK_NO_CHANNELS_FOUND",
            message=str(exc),
            error_type="analysis_data",
        ) from exc
    except Exception as exc:
        raise PublicApiError(
            status_code=400,
            error_code="XRK_PARSE_FAILED",
            message="XRK analysis could not be completed with the selected settings.",
            error_type=type(exc).__name__,
        ) from exc


@router.delete("/inspections/{inspection_id}")
async def delete_xrk_inspection(request: Request, inspection_id: str) -> dict[str, bool]:
    """Explicitly delete temporary normalized telemetry."""
    deleted = request.app.state.xrk_inspection_store.delete(inspection_id)
    return {"deleted": deleted}


def log_xrk_event(
    *,
    request_id: str,
    stage: str,
    filename: str,
    extension: str,
    parser_probe: Any,
    file_size: int = 0,
    upload_complete: bool = False,
    temporary_path_created: bool = False,
    parsing_started: bool = False,
    parsing_finished: bool = False,
    parsing_duration_ms: int | None = None,
    channel_count: int | None = None,
    lap_count: int | None = None,
    error_code: str | None = None,
    error_type: str | None = None,
) -> None:
    """Emit one privacy-safe structured XRK lifecycle event."""
    logger.info(
        json.dumps(
            {
                "event": "xrk_inspection",
                "stage": stage,
                "request_id": request_id,
                "filename": filename,
                "extension": extension,
                "file_size": file_size,
                "upload_complete": upload_complete,
                "temporary_path_created": temporary_path_created,
                "parser_selected": parser_probe.name,
                "parser_version": parser_probe.version,
                "parsing_started": parsing_started,
                "parsing_finished": parsing_finished,
                "parsing_duration_ms": parsing_duration_ms,
                "channel_count": channel_count,
                "lap_count": lap_count,
                "error_code": error_code,
                "error_type": error_type,
            },
            separators=(",", ":"),
        )
    )
