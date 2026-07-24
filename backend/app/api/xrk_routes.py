"""Two-stage, temporary AiM XRK inspection and analysis API."""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from ..analysis.xrk_session_analysis import analyze_xrk_session
from ..importers.inspection_store import InspectionExpiredError
from ..importers.service import (
    AimImportError,
    run_xrk_inspection,
    save_limited_upload,
)

router = APIRouter(prefix="/xrk", tags=["xrk"])


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
    inspection_id: str | None = None
    try:
        await request.app.state.xrk_rate_limiter.check(client_key)
        async with request.app.state.xrk_import_semaphore:
            inspection_id, output_dir, expires_at = store.create_directory()
            with tempfile.TemporaryDirectory(prefix="racing-xrk-upload-") as temp:
                upload_dir = Path(temp)
                original_name = Path(file.filename or "session.xrk").name
                suffix = Path(original_name).suffix.lower()
                source = upload_dir / f"source{suffix}"
                size_bytes = await save_limited_upload(
                    file,
                    source,
                    settings.max_xrk_upload_bytes,
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
            return public
    except AimImportError as exc:
        if inspection_id:
            store.delete(inspection_id)
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except asyncio.CancelledError:
        if inspection_id:
            store.delete(inspection_id)
        raise
    except Exception as exc:
        if inspection_id:
            store.delete(inspection_id)
        raise HTTPException(
            status_code=400,
            detail="Unable to inspect this XRK/XRZ file.",
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
        raise HTTPException(status_code=410, detail=str(exc)) from exc
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
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail="XRK analysis could not be completed with the selected settings.",
        ) from exc


@router.delete("/inspections/{inspection_id}")
async def delete_xrk_inspection(request: Request, inspection_id: str) -> dict[str, bool]:
    """Explicitly delete temporary normalized telemetry."""
    deleted = request.app.state.xrk_inspection_store.delete(inspection_id)
    return {"deleted": deleted}
