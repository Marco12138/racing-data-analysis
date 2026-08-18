"""Two-stage, temporary AiM XRK inspection and analysis API."""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Literal
from urllib.parse import unquote

import pandas as pd
from fastapi import APIRouter, File, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field

from ..analysis.llm_narrative import (
    build_xrk_narrative_evidence,
    generate_llm_narrative,
)
from ..analysis.xrk_session_analysis import analyze_xrk_session
from ..analysis.video_telemetry_sync import (
    MAX_SEARCH_CANDIDATES,
    estimate_video_telemetry_offset,
    telemetry_speed_summary,
)
from ..models.demo_session import DemoSessionResponse
from ..resources.demo_session import load_demo_session_resource
from ..utils.xrk_library import XrkSourceError, list_xrk_sources, resolve_xrk_source
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

PUBLIC_DEMO_SESSION = load_demo_session_resource()


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
    lap_quality_absolute_gap_s: float = Field(default=0.5, ge=0.05, le=5.0)
    lap_quality_relative_gap_pct: float = Field(default=1.0, ge=0.1, le=10.0)
    language: Literal["zh", "en"] = "en"


class LocalXrkInspectRequest(BaseModel):
    """Opaque local-library source selected by the browser."""

    source_id: str = Field(min_length=24, max_length=24)


class VideoFeaturePoint(BaseModel):
    """One browser-extracted, non-image video feature sample."""

    model_config = ConfigDict(extra="forbid")

    time_s: float = Field(ge=0, le=86_400)
    brightness: float = Field(ge=0, le=255)
    motion: float = Field(ge=0, le=1_000_000)


class TelemetrySpeedPoint(BaseModel):
    """One bounded telemetry speed summary sample."""

    model_config = ConfigDict(extra="forbid")

    time_s: float = Field(ge=0, le=86_400)
    speed_kmh: float = Field(ge=0, le=600)


class VideoSyncAutoRequest(BaseModel):
    """Inputs for coarse synchronization without uploading a video file."""

    model_config = ConfigDict(extra="forbid")

    inspection_id: str | None = Field(default=None, min_length=32, max_length=32)
    video_features: list[VideoFeaturePoint] = Field(min_length=8, max_length=5_000)
    telemetry_speed: list[TelemetrySpeedPoint] | None = Field(
        default=None,
        min_length=8,
        max_length=5_000,
    )
    max_offset_s: float = Field(default=300.0, ge=5.0, le=1_800.0)
    search_step_s: float = Field(default=0.25, ge=0.05, le=2.0)
    min_overlap_s: float = Field(default=5.0, ge=2.0, le=300.0)


@router.get("/demo-session", response_model=DemoSessionResponse)
def get_demo_session(response: Response) -> DemoSessionResponse:
    """Return the reviewed real-session summary bundled with the service."""
    response.headers["Cache-Control"] = (
        "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
    )
    return PUBLIC_DEMO_SESSION


@router.get("/local-library")
def local_xrk_library(request: Request) -> dict[str, Any]:
    """List whitelisted local XRK files without exposing absolute paths."""
    settings = request.app.state.settings
    require_local_xrk_mode(settings.app_mode)
    return {
        "sources": list_xrk_sources(
            settings.max_xrk_upload_bytes,
            settings.racing_xrk_roots,
        )
    }


@router.post("/inspect-local")
async def inspect_local_xrk(
    request: Request,
    payload: LocalXrkInspectRequest,
) -> dict[str, Any]:
    """Inspect a whitelisted local XRK without browser file transfer."""
    settings = request.app.state.settings
    require_local_xrk_mode(settings.app_mode)
    try:
        source = resolve_xrk_source(
            payload.source_id,
            settings.max_xrk_upload_bytes,
            settings.racing_xrk_roots,
        )
    except XrkSourceError as exc:
        raise PublicApiError(
            status_code=400,
            error_code="XRK_LOCAL_SOURCE_UNAVAILABLE",
            message=str(exc),
            error_type="local_source",
        ) from exc
    with source.open("rb") as stream:
        upload = UploadFile(
            file=stream,
            size=source.stat().st_size,
            filename=source.name,
        )
        return await inspect_xrk(request, upload)


def require_local_xrk_mode(app_mode: str) -> None:
    """Keep local filesystem discovery unavailable in cloud mode."""
    if app_mode != "local":
        raise PublicApiError(
            status_code=503,
            error_code="XRK_LOCAL_LIBRARY_UNAVAILABLE",
            message="The local XRK library is available only in local mode.",
            error_type="deployment_mode",
        )


@router.post("/inspect")
async def inspect_xrk(
    request: Request,
    file: UploadFile | None = File(default=None),
) -> dict[str, Any]:
    """Inspect real AiM channels and retain normalized data for 30 minutes."""
    settings = request.app.state.settings
    raw_upload = (
        file is None
        and request.headers.get("content-type", "").split(";", 1)[0].lower()
        == "application/octet-stream"
    )
    if raw_upload:
        file = await upload_file_from_binary_request(
            request,
            settings.max_xrk_upload_bytes,
        )
    if file is None:
        raise PublicApiError(
            status_code=422,
            error_code="XRK_UPLOAD_MISSING_FILE",
            message=(
                "The XRK file was not attached to the upload request. "
                "Please select the file again."
            ),
            error_type="missing_upload",
        )
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
            record.manifest["filename"] = original_name
            record.manifest["file_size_bytes"] = size_bytes
            (record.directory / "inspection.json").write_text(
                json.dumps(record.manifest, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            public = public_inspection(record.manifest)
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
    finally:
        if raw_upload:
            await file.close()


async def upload_file_from_binary_request(
    request: Request,
    max_bytes: int,
) -> UploadFile:
    """Materialize a bounded raw browser upload as a FastAPI UploadFile."""
    encoded_name = request.headers.get("X-XRK-Filename", "")
    filename = Path(unquote(encoded_name)).name if encoded_name else ""
    if not filename:
        raise PublicApiError(
            status_code=422,
            error_code="XRK_UPLOAD_MISSING_FILE",
            message=(
                "The XRK file was not attached to the upload request. "
                "Please select the file again."
            ),
            error_type="missing_upload",
        )

    declared_size = request.headers.get("content-length")
    if declared_size and declared_size.isdigit() and int(declared_size) > max_bytes:
        raise PublicApiError(
            status_code=413,
            error_code="XRK_FILE_TOO_LARGE",
            message=f"XRK/XRZ upload exceeds the {max_bytes} byte limit.",
            error_type="file_size",
        )

    spool = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b")
    size = 0
    try:
        async for chunk in request.stream():
            size += len(chunk)
            if size > max_bytes:
                raise PublicApiError(
                    status_code=413,
                    error_code="XRK_FILE_TOO_LARGE",
                    message=f"XRK/XRZ upload exceeds the {max_bytes} byte limit.",
                    error_type="file_size",
                )
            spool.write(chunk)
        if size == 0:
            raise PublicApiError(
                status_code=422,
                error_code="XRK_UPLOAD_MISSING_FILE",
                message=(
                    "The XRK file was not attached to the upload request. "
                    "Please select the file again."
                ),
                error_type="missing_upload",
            )
        spool.seek(0)
        return UploadFile(file=spool, size=size, filename=filename)
    except Exception:
        spool.close()
        raise


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
            lap_quality_config={
                "absolute_gap_threshold_s": payload.lap_quality_absolute_gap_s,
                "relative_gap_threshold_pct": payload.lap_quality_relative_gap_pct,
            },
            max_comparison_points=settings.xrk_max_comparison_points,
            language=payload.language,
        )
        narrative = await generate_llm_narrative(
            build_xrk_narrative_evidence(result)
        )
        if narrative is not None:
            result["narrative"] = narrative
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


@router.post("/video-sync/auto")
async def auto_sync_video(
    request: Request,
    payload: VideoSyncAutoRequest,
) -> dict[str, Any]:
    """Estimate a coarse video offset from browser features and real GPS speed."""
    candidate_count = int(
        (2 * payload.max_offset_s) // payload.search_step_s
    ) + 1
    if candidate_count > MAX_SEARCH_CANDIDATES:
        raise PublicApiError(
            status_code=422,
            error_code="VIDEO_SYNC_SEARCH_LIMIT_EXCEEDED",
            message=(
                f"Offset search is limited to {MAX_SEARCH_CANDIDATES:,} candidates; "
                "reduce max_offset_s or increase search_step_s."
            ),
            error_type="video_sync_limits",
        )
    source = "request_summary"
    if payload.inspection_id:
        source = "temporary_xrk_inspection"
        try:
            record = request.app.state.xrk_inspection_store.load(
                payload.inspection_id
            )
        except InspectionExpiredError as exc:
            raise PublicApiError(
                status_code=410,
                error_code="XRK_INSPECTION_EXPIRED",
                message=str(exc),
                error_type="expired_token",
            ) from exc
        if record.manifest.get("has_gps_speed") is False:
            raise PublicApiError(
                status_code=422,
                error_code="XRK_GPS_SPEED_UNAVAILABLE",
                message="GPS speed is unavailable for this inspection.",
                error_type="video_sync_data",
            )
        try:
            telemetry = await asyncio.to_thread(
                pd.read_parquet, record.telemetry_path
            )
        except Exception as exc:
            raise PublicApiError(
                status_code=422,
                error_code="VIDEO_SYNC_TELEMETRY_UNAVAILABLE",
                message="Normalized telemetry is unavailable for automatic video sync.",
                error_type="video_sync_data",
            ) from exc
        try:
            telemetry_points = telemetry_speed_summary(telemetry)
        except ValueError as exc:
            raise PublicApiError(
                status_code=422,
                error_code="XRK_GPS_SPEED_UNAVAILABLE",
                message=str(exc),
                error_type="video_sync_data",
            ) from exc
    elif payload.telemetry_speed:
        telemetry_points = [point.model_dump() for point in payload.telemetry_speed]
    else:
        raise PublicApiError(
            status_code=422,
            error_code="VIDEO_SYNC_TELEMETRY_REQUIRED",
            message="Provide a valid inspection_id or a bounded telemetry speed summary.",
            error_type="video_sync_data",
        )

    try:
        result = await asyncio.to_thread(
            estimate_video_telemetry_offset,
            [point.model_dump() for point in payload.video_features],
            telemetry_points,
            max_offset_s=payload.max_offset_s,
            search_step_s=payload.search_step_s,
            min_overlap_s=payload.min_overlap_s,
        )
    except ValueError as exc:
        raise PublicApiError(
            status_code=422,
            error_code="VIDEO_SYNC_INSUFFICIENT_DATA",
            message=str(exc),
            error_type="video_sync_data",
        ) from exc
    except Exception as exc:
        raise PublicApiError(
            status_code=400,
            error_code="VIDEO_SYNC_ANALYSIS_FAILED",
            message="Automatic video synchronization could not be completed.",
            error_type=type(exc).__name__,
        ) from exc
    result["source"] = source
    result["request_id"] = getattr(request.state, "request_id", "unknown")
    return result


@router.get("/inspections/{inspection_id}")
async def get_xrk_inspection(request: Request, inspection_id: str) -> dict[str, Any]:
    """Restore public metadata for one non-expired temporary inspection."""
    try:
        record = request.app.state.xrk_inspection_store.load(inspection_id)
    except InspectionExpiredError as exc:
        raise PublicApiError(
            status_code=410,
            error_code="XRK_INSPECTION_EXPIRED",
            message=str(exc),
            error_type="expired_token",
        ) from exc
    public = public_inspection(record.manifest)
    public["request_id"] = getattr(request.state, "request_id", "unknown")
    return public


@router.delete("/inspections/{inspection_id}")
async def delete_xrk_inspection(request: Request, inspection_id: str) -> dict[str, bool]:
    """Explicitly delete temporary normalized telemetry."""
    deleted = request.app.state.xrk_inspection_store.delete(inspection_id)
    return {"deleted": deleted}


def public_inspection(manifest: dict[str, Any]) -> dict[str, Any]:
    """Remove server-only artifact paths from an inspection response."""
    return {
        key: value
        for key, value in manifest.items()
        if key != "artifacts"
    }


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
