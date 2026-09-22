"""Thumbs up/down feedback for AI coach advice."""

from __future__ import annotations

from fastapi import APIRouter, Request
from .errors import PublicApiError
from .feedback_provenance import feedback_origin

from ..models.feedback import ClipFeedbackRequest, CoachValidationRequest, NarrativeFeedbackRequest
from ..utils.storage import (
    narrative_feedback_stats,
    save_coach_validation,
    save_narrative_feedback,
    save_clip_feedback,
    clip_feedback_stats,
)

router = APIRouter(tags=["feedback"])


@router.post("/feedback/clip-selection")
def submit_clip_feedback(request: Request, payload: ClipFeedbackRequest) -> dict:
    """Accept only timing/selection labels; no video, filename or raw telemetry."""
    origin = feedback_origin(request, declared=payload.data_origin, token=payload.inspection_id, fingerprint=payload.session_fingerprint)
    if not save_clip_feedback({**payload.model_dump(), "data_origin": origin}):
        raise PublicApiError(409, "CLIP_FEEDBACK_CONFLICT", "This receipt belongs to another clip. Please reload the review.")
    return {"received": True, "id": payload.feedback_id, "verdict": payload.verdict}


@router.get("/feedback/clip-selection/stats")
def selection_stats() -> dict:
    """Summarize anonymous selection accuracy without publishing individual votes."""
    return clip_feedback_stats()


@router.post("/feedback")
def submit_feedback(request: Request, payload: NarrativeFeedbackRequest) -> dict:
    """Record one feedback row and confirm receipt."""
    origin = feedback_origin(request, declared=payload.data_origin, token=payload.token, node_id=payload.node_id)
    feedback_id = save_narrative_feedback(
        node_id=payload.node_id,
        token=payload.token or "",
        source=payload.source,
        locale=payload.locale,
        thumbs_up=payload.thumbs_up,
        data_origin=origin,
    )
    return {"received": True, "id": feedback_id}


@router.get("/feedback/stats")
def feedback_stats() -> dict:
    """Return aggregate counts and the most recent 50 feedback rows."""
    return narrative_feedback_stats(limit=50)


@router.post("/feedback/coach-validation")
def submit_coach_validation(request: Request, payload: CoachValidationRequest) -> dict:
    """Record a coach's confirmed/rejected/uncertain detector label."""
    origin = feedback_origin(request, declared=payload.data_origin, token=payload.inspection_id)
    validation_id = save_coach_validation(
        inspection_id=payload.inspection_id,
        episode_id=payload.episode_id,
        pattern_id=payload.pattern_id,
        pattern_type=payload.pattern_type,
        verdict=payload.verdict,
        locale=payload.locale,
        notes=payload.notes or "",
        data_origin=origin,
    )
    return {"received": True, "id": validation_id, "verdict": payload.verdict}
