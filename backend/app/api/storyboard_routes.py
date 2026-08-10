"""Create and share read-only AI driving review storyboards."""

from __future__ import annotations

import asyncio
import re
import secrets
from datetime import UTC, datetime, timedelta

import pandas as pd
from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from ..analysis.session_storyboard import (
    DEFAULT_TTL_SECONDS,
    StoryboardAlignment,
    build_storyboard,
)
from ..analysis.xrk_session_analysis import analyze_xrk_session
from ..core.ownership import ANONYMOUS_ACTOR
from ..importers.inspection_store import InspectionExpiredError
from ..models.storyboard import (
    StoryboardAlignmentRequest,
    StoryboardResponse,
)
from ..utils.storage import load_storyboard, save_storyboard
from .errors import PublicApiError
from .xrk_routes import XrkAnalyzeRequest

router = APIRouter(tags=["storyboard"])
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{20,64}$")


class StoryboardCreateRequest(BaseModel):
    """Analysis parameters plus the browser video-telemetry alignment anchor."""

    model_config = ConfigDict(extra="forbid")

    analysis: XrkAnalyzeRequest
    alignment: StoryboardAlignmentRequest


@router.post("/storyboard", response_model=StoryboardResponse)
async def create_storyboard(
    request: Request,
    payload: StoryboardCreateRequest,
) -> StoryboardResponse:
    """Analyze one temporary inspection and publish a shareable storyboard."""
    store = request.app.state.xrk_inspection_store
    settings = request.app.state.settings
    try:
        record = store.load(payload.analysis.inspection_id)
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
            reference_lap=payload.analysis.reference_lap,
            target_lap=payload.analysis.target_lap,
            distance_step_m=payload.analysis.distance_step_m
            or settings.xrk_default_distance_step_m,
            sector_count=payload.analysis.sector_count,
            sector_boundaries_m=payload.analysis.sector_boundaries_m,
            manual_zones=[
                zone.model_dump()
                for zone in payload.analysis.manual_zones
            ],
            lap_quality_config={
                "absolute_gap_threshold_s": payload.analysis.lap_quality_absolute_gap_s,
                "relative_gap_threshold_pct": payload.analysis.lap_quality_relative_gap_pct,
            },
            max_comparison_points=settings.xrk_max_comparison_points,
        )
        storyboard = await asyncio.to_thread(
            build_storyboard,
            result,
            telemetry,
            alignment=StoryboardAlignment(
                offset_ms=payload.alignment.offset_ms,
                video_duration_s=payload.alignment.video_duration_s,
                target_lap=payload.alignment.target_lap,
                telemetry_session_time_s=payload.alignment.telemetry_session_time_s,
                video_time_s=payload.alignment.video_time_s,
            ),
            max_nodes=5,
        )
    except ValueError as exc:
        raise PublicApiError(
            status_code=422,
            error_code="STORYBOARD_EVIDENCE_UNAVAILABLE",
            message=str(exc),
            error_type="storyboard_data",
        ) from exc
    except Exception as exc:
        raise PublicApiError(
            status_code=400,
            error_code="STORYBOARD_CREATION_FAILED",
            message="The teaching storyboard could not be created.",
            error_type=type(exc).__name__,
        ) from exc

    token = secrets.token_urlsafe(24)
    now = datetime.now(UTC)
    payload_dict = {
        **storyboard,
        "token": token,
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(seconds=DEFAULT_TTL_SECONDS)).isoformat(),
    }
    save_storyboard(
        token,
        payload_dict,
        actor=ANONYMOUS_ACTOR,
        ttl_seconds=DEFAULT_TTL_SECONDS,
    )
    return StoryboardResponse.model_validate(payload_dict)


@router.get("/storyboards/{token}", response_model=StoryboardResponse)
def get_storyboard(request: Request, token: str) -> StoryboardResponse:
    """Return one read-only storyboard by its opaque share token."""
    if not TOKEN_PATTERN.fullmatch(token):
        raise PublicApiError(
            status_code=404,
            error_code="STORYBOARD_NOT_FOUND",
            message="The storyboard does not exist or has expired.",
            error_type="storyboard_lookup",
        )
    payload = load_storyboard(token, actor=ANONYMOUS_ACTOR)
    if payload is None:
        raise PublicApiError(
            status_code=404,
            error_code="STORYBOARD_NOT_FOUND",
            message="The storyboard does not exist or has expired.",
            error_type="storyboard_lookup",
        )
    return StoryboardResponse.model_validate(payload)
