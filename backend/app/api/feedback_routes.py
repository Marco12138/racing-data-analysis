"""Thumbs up/down feedback for AI coach advice."""

from __future__ import annotations

from fastapi import APIRouter

from ..models.feedback import NarrativeFeedbackRequest
from ..utils.storage import narrative_feedback_stats, save_narrative_feedback

router = APIRouter(tags=["feedback"])


@router.post("/feedback")
def submit_feedback(payload: NarrativeFeedbackRequest) -> dict:
    """Record one feedback row and confirm receipt."""
    feedback_id = save_narrative_feedback(
        node_id=payload.node_id,
        token=payload.token or "",
        source=payload.source,
        locale=payload.locale,
        thumbs_up=payload.thumbs_up,
    )
    return {"received": True, "id": feedback_id}


@router.get("/feedback/stats")
def feedback_stats() -> dict:
    """Return aggregate counts and the most recent 50 feedback rows."""
    return narrative_feedback_stats(limit=50)
