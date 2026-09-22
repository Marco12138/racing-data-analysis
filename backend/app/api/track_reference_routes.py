"""Opt-in fixed-track sidecar on existing temporary XRK inspections."""

import asyncio
from threading import BoundedSemaphore

import pandas as pd
from fastapi import APIRouter, Request
from pydantic import Field

from ..analysis.track_reference import create_track_reference, match_track_reference, native_gps_frame
from ..importers.inspection_store import InspectionExpiredError
from ..models.track_reference import TrackModel, TrackReference
from .errors import PublicApiError

router = APIRouter(prefix="/tracks", tags=["track-reference"])
_analysis_slots = BoundedSemaphore(2)


class CreateTrackRequest(TrackModel):
    """Only an opaque live inspection may provide reference geometry."""

    inspection_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    lap: int = Field(ge=1)
    track_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    venue_aliases: list[str] = Field(default_factory=list, max_length=20)


class MatchTrackRequest(TrackModel):
    """Geometry stays user-owned; the service does not persist track configurations."""

    inspection_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    track_config: TrackReference


def load_gps(request: Request, inspection_id: str):
    """Read native GPS only within the existing fixed-expiry inspection cache."""
    try:
        record = request.app.state.xrk_inspection_store.load(inspection_id)
    except InspectionExpiredError as exc:
        raise PublicApiError(410, "XRK_INSPECTION_EXPIRED", str(exc)) from exc
    if record.native_channels_path is None:
        raise PublicApiError(422, "TRACK_NATIVE_GPS_UNAVAILABLE", "Native GPS is unavailable. Import the session again.")
    if len(record.manifest.get("lap_timing", [])) > 200:
        raise PublicApiError(422, "TRACK_SESSION_LIMIT", "The track prototype supports up to 200 timed laps per request.")
    frame, processing = native_gps_frame(pd.read_parquet(record.native_channels_path), record.manifest)
    if len(frame) > 500000:
        raise PublicApiError(422, "TRACK_SESSION_LIMIT", "The track prototype supports up to 500,000 native GPS samples.")
    return frame, record.manifest, processing


def run_analysis(request: Request, payload, *, create: bool):
    """Bound CPU work per process; cancellation cannot release a still-running thread."""
    if not _analysis_slots.acquire(blocking=False):
        raise PublicApiError(429, "TRACK_ANALYSIS_BUSY", "Track analysis is busy. Please try again shortly.")
    try:
        frame, manifest, processing = load_gps(request, payload.inspection_id)
        if create:
            return create_track_reference(frame, manifest, payload.lap, track_id=payload.track_id, aliases=payload.venue_aliases)
        result = match_track_reference(frame, manifest, payload.track_config)
        result["native_processing"] = processing
        return result
    finally:
        _analysis_slots.release()


@router.post("/reference", response_model=TrackReference)
async def create_reference(request: Request, payload: CreateTrackRequest):
    """Build a draft from one genuine lap, requiring later human gate confirmation."""
    try:
        return await asyncio.to_thread(run_analysis, request, payload, create=True)
    except ValueError as exc:
        raise PublicApiError(422, "TRACK_REFERENCE_UNAVAILABLE", str(exc)) from exc
    except OSError as exc:
        raise PublicApiError(410, "XRK_INSPECTION_EXPIRED", "The temporary native data is unavailable. Import the session again.") from exc


@router.post("/match")
async def match_reference(request: Request, payload: MatchTrackRequest):
    """Return per-lap translation, held-out residuals and timestamped gate crossings."""
    try:
        return await asyncio.to_thread(run_analysis, request, payload, create=False)
    except ValueError as exc:
        raise PublicApiError(422, "TRACK_MATCH_UNAVAILABLE", str(exc)) from exc
    except OSError as exc:
        raise PublicApiError(410, "XRK_INSPECTION_EXPIRED", "The temporary native data is unavailable. Import the session again.") from exc
