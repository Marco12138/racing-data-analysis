"""Temporary cross-session driver and setup comparison endpoints."""

from __future__ import annotations

import asyncio
from typing import Any

import pandas as pd
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from ..analysis.cross_session_analysis import (
    analyze_setup_experiment,
    compare_driver_laps,
)
from ..importers.inspection_store import InspectionExpiredError, InspectionRecord
from .errors import PublicApiError
from .xrk_routes import ManualZoneRequest

router = APIRouter(tags=["cross-session analysis"])


class SessionLapReference(BaseModel):
    """One temporary session and optional quality-gated real lap."""

    inspection_id: str = Field(min_length=32, max_length=32)
    lap: int | None = Field(default=None, ge=1)


class DriverComparisonRequest(BaseModel):
    """Compare one real lap from each of two temporary sessions."""

    session_a: SessionLapReference
    session_b: SessionLapReference
    distance_step_m: float = Field(default=1.0, ge=0.25, le=10.0)
    manual_zones: list[ManualZoneRequest] = Field(default_factory=list, max_length=30)


class SetupChange(BaseModel):
    """One declared kart setup change."""

    category: str = Field(min_length=1, max_length=50)
    parameter: str = Field(min_length=1, max_length=80)
    before: str | float | int | None = None
    after: str | float | int | None = None
    unit: str | None = Field(default=None, max_length=30)


class SetupExperimentDefinition(BaseModel):
    """User-recorded setup context kept separate from measured telemetry."""

    id: str | None = Field(default=None, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    primary_change: SetupChange
    secondary_changes: list[SetupChange] = Field(default_factory=list, max_length=10)
    conditions: dict[str, str | float | int | None] = Field(default_factory=dict)
    driver_feedback: dict[str, str] = Field(default_factory=dict)


class SetupExperimentRequest(BaseModel):
    """Evaluate a setup experiment from two same-driver temporary sessions."""

    baseline_inspection_id: str = Field(min_length=32, max_length=32)
    modified_inspection_id: str = Field(min_length=32, max_length=32)
    experiment: SetupExperimentDefinition
    distance_step_m: float = Field(default=1.0, ge=0.25, le=10.0)
    manual_zones: list[ManualZoneRequest] = Field(default_factory=list, max_length=30)


@router.post("/comparisons/laps")
async def compare_laps(
    request: Request,
    payload: DriverComparisonRequest,
) -> dict[str, Any]:
    """Compare two real quality-gated laps without creating a synthetic target."""
    if payload.session_a.inspection_id == payload.session_b.inspection_id:
        raise PublicApiError(
            status_code=400,
            error_code="COMPARISON_SESSIONS_REQUIRED",
            message="Select two different temporary sessions for Driver Comparison.",
        )
    a, b = load_records(request, payload.session_a.inspection_id, payload.session_b.inspection_id)
    telemetry_a, telemetry_b = await read_telemetry(a, b)
    try:
        return await asyncio.to_thread(
            compare_driver_laps,
            telemetry_a,
            a.manifest,
            telemetry_b,
            b.manifest,
            lap_a=payload.session_a.lap,
            lap_b=payload.session_b.lap,
            distance_step_m=payload.distance_step_m,
            manual_zones=[zone.model_dump() for zone in payload.manual_zones],
            max_points=request.app.state.settings.xrk_max_comparison_points,
        )
    except ValueError as exc:
        raise PublicApiError(
            status_code=422,
            error_code="CROSS_SESSION_DATA_INCOMPATIBLE",
            message=str(exc),
            error_type="comparison_data",
        ) from exc
    except Exception as exc:
        raise PublicApiError(
            status_code=400,
            error_code="CROSS_SESSION_ANALYSIS_FAILED",
            message="The selected laps could not be compared.",
            error_type=type(exc).__name__,
        ) from exc


@router.post("/setup-experiments/analyze")
async def analyze_experiment(
    request: Request,
    payload: SetupExperimentRequest,
) -> dict[str, Any]:
    """Evaluate one recorded setup change using real Top-3 lap evidence."""
    if payload.baseline_inspection_id == payload.modified_inspection_id:
        raise PublicApiError(
            status_code=400,
            error_code="SETUP_SESSIONS_REQUIRED",
            message="Baseline and modified setup must use different sessions.",
        )
    baseline, modified = load_records(
        request,
        payload.baseline_inspection_id,
        payload.modified_inspection_id,
    )
    baseline_telemetry, modified_telemetry = await read_telemetry(baseline, modified)
    try:
        return await asyncio.to_thread(
            analyze_setup_experiment,
            baseline_telemetry,
            baseline.manifest,
            modified_telemetry,
            modified.manifest,
            payload.experiment.model_dump(),
            distance_step_m=payload.distance_step_m,
            manual_zones=[zone.model_dump() for zone in payload.manual_zones],
        )
    except ValueError as exc:
        raise PublicApiError(
            status_code=422,
            error_code="SETUP_EXPERIMENT_DATA_INCOMPATIBLE",
            message=str(exc),
            error_type="setup_experiment_data",
        ) from exc
    except Exception as exc:
        raise PublicApiError(
            status_code=400,
            error_code="SETUP_EXPERIMENT_ANALYSIS_FAILED",
            message="The setup experiment could not be analyzed.",
            error_type=type(exc).__name__,
        ) from exc


def load_records(request: Request, first: str, second: str) -> tuple[InspectionRecord, InspectionRecord]:
    """Load two fixed-expiry records with one stable public error."""
    try:
        return (
            request.app.state.xrk_inspection_store.load(first),
            request.app.state.xrk_inspection_store.load(second),
        )
    except InspectionExpiredError as exc:
        raise PublicApiError(
            status_code=410,
            error_code="XRK_INSPECTION_EXPIRED",
            message=str(exc),
            error_type="expired_token",
        ) from exc


async def read_telemetry(
    first: InspectionRecord,
    second: InspectionRecord,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Read both normalized Parquet artifacts concurrently."""
    a, b = await asyncio.gather(
        asyncio.to_thread(pd.read_parquet, first.telemetry_path),
        asyncio.to_thread(pd.read_parquet, second.telemetry_path),
    )
    return a, b
